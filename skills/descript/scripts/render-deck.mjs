#!/usr/bin/env node
/**
 * render-deck.mjs — render an HTML slide deck to one PNG per slide with headless Google Chrome.
 *
 * Works with any deck whose slides are sibling elements matched by --selector (default: section.slide, .slide).
 * If the deck defines a global go(n) function (common hand-rolled decks) it is used; otherwise all other slides
 * are hidden and the chosen one gets class "on" and display restored.
 * If the deck embeds a `const SCRIPT=[...]` speaker-notes array, titles/notes are extracted into manifest.json.
 *
 * Usage:
 *   node render-deck.mjs <deck.html> --out <dir> [--width 1920] [--height 1080] [--scale 1] [--prefix slide]
 *        [--slides 1,3-5] [--selector "section.slide"] [--hide ".masthead,.gutter,.hud,.notes,.transcript"]
 *        [--stage ".stage"] [--budget 8000] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
 *        [--keep-tmp]
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const deckArg = args._[0];
if (!deckArg || args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].split("\n").slice(1).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  process.exit(deckArg ? 0 : 1);
}

const deckPath = resolvePath(deckArg);
if (!existsSync(deckPath)) fail(`Deck not found: ${deckPath}`);
const outDir = resolvePath(args.out || join(dirname(deckPath), `${basename(deckPath, ".html")}-slides`));
const width = Number(args.width || 1920);
const height = Number(args.height || 1080);
const scale = Number(args.scale || 1);
const prefix = args.prefix || "slide";
const selector = args.selector || "section.slide, .slide";
const hideSelector = args.hide || ".masthead,.gutter,.hud,.notes,.transcript,nav,header,footer";
const stageSelector = args.stage || ".stage";
const budget = Number(args.budget || 8000);
const chrome = args.chrome || findChrome();
if (!chrome) fail("Google Chrome not found. Pass --chrome <path-to-binary>.");

const html = readFileSync(deckPath, "utf8");
const slides = discoverSlides(html, selector);
if (!slides.length) fail(`No slides matched selector "${selector}" in ${deckPath}`);
const script = extractScript(html);
const wanted = parseRange(args.slides, slides.length);

mkdirSync(outDir, { recursive: true });
const tmpDir = join(outDir, ".render-tmp");
mkdirSync(tmpDir, { recursive: true });
const profileDir = join(tmpDir, "chrome-profile");

const manifest = [];
console.error(`Rendering ${wanted.length}/${slides.length} slide(s) at ${width}x${height}@${scale}x → ${outDir}`);
for (const index of wanted) {
  const n = index + 1;
  const meta = slides[index];
  const notes = script?.[index] || {};
  const title = meta.title || notes.t || `slide-${n}`;
  const file = `${prefix}-${String(n).padStart(2, "0")}-${slugify(title)}.png`;
  const outPath = join(outDir, file);
  const tmpHtml = join(tmpDir, `slide-${n}.html`);
  writeFileSync(tmpHtml, injectRenderHarness(html, { index, deckDir: dirname(deckPath), width, height, selector, hideSelector, stageSelector }));

  const chromeArgs = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--allow-file-access-from-files",
    `--user-data-dir=${profileDir}`, `--window-size=${width},${height}`, `--force-device-scale-factor=${scale}`,
    `--virtual-time-budget=${budget}`, `--screenshot=${outPath}`, `file://${tmpHtml}`,
  ];
  const run = spawnSync(chrome, chromeArgs, { encoding: "utf8", timeout: 120000 });
  if (run.status !== 0 || !existsSync(outPath)) {
    fail(`Chrome failed on slide ${n} (exit ${run.status}): ${(run.stderr || "").split("\n").filter((l) => !/DevTools|Fontconfig|registration/i.test(l)).slice(-5).join("\n")}`);
  }
  const dims = pngDimensions(outPath);
  const ok = dims.width === width * scale && dims.height === height * scale;
  if (!ok) console.error(`  warning: ${file} is ${dims.width}x${dims.height}, expected ${width * scale}x${height * scale}`);
  console.error(`  ${file}  ${dims.width}x${dims.height}${ok ? "" : "  (size mismatch)"}`);
  manifest.push({
    index: n, file, title, on_screen: notes.screen || null,
    notes_plain: Array.isArray(notes.say) ? notes.say.map(stripHtml).join("\n") : null,
    cue: notes.cue || null, flag: notes.flag || null, width: dims.width, height: dims.height,
  });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ deck: deckPath, rendered_at: new Date().toISOString(), width: width * scale, height: height * scale, slides: manifest }, null, 2) + "\n");
if (!args.keep_tmp) rmSync(tmpDir, { recursive: true, force: true });
console.log(JSON.stringify({ out_dir: outDir, count: manifest.length, files: manifest.map((m) => m.file) }, null, 2));

// ---------- helpers ----------

function injectRenderHarness(source, { index, deckDir, width, height, selector, hideSelector, stageSelector }) {
  const css = `
<base href="file://${deckDir}/">
<style id="render-harness-css">
  html,body{margin:0!important;padding:0!important;width:${width}px!important;height:${height}px!important;overflow:hidden!important;min-height:0!important;display:block!important}
  ${hideSelector}{display:none!important}
  ${stageSelector}{position:fixed!important;inset:0!important;width:${width}px!important;height:${height}px!important;max-width:none!important;border:0!important;aspect-ratio:auto!important;box-shadow:none!important}
  *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
</style>`;
  const js = `
<script id="render-harness-js">
(function(){
  var SEL=${JSON.stringify(selector)}, N=${index};
  function show(){
    var all=Array.prototype.slice.call(document.querySelectorAll(SEL));
    if(typeof window.go==='function'){ try{ window.go(N); }catch(e){} }
    all.forEach(function(s,k){
      if(k===N){ s.classList.add('on'); s.removeAttribute('hidden'); s.style.removeProperty('display'); if(getComputedStyle(s).display==='none') s.style.display='flex'; }
      else { s.classList.remove('on'); s.style.setProperty('display','none','important'); }
    });
    window.scrollTo(0,0);
  }
  function ready(){ show(); if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(function(){ show(); document.documentElement.setAttribute('data-render-ready','1'); }); } }
  if(document.readyState==='complete') ready(); else window.addEventListener('load', ready);
})();
</script>`;
  let out = source;
  out = out.includes("</head>") ? out.replace("</head>", `${css}\n</head>`) : css + out;
  out = out.includes("</body>") ? out.replace("</body>", `${js}\n</body>`) : out + js;
  return out;
}

function discoverSlides(source, selector) {
  // Lightweight tag scan: supports "tag.class" / ".class" / "tag" alternatives separated by commas.
  const alternatives = selector.split(",").map((s) => s.trim()).filter(Boolean);
  const found = [];
  const tagRe = /<([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(source))) {
    const [, tag, attrs] = m;
    const classes = (attrs.match(/class\s*=\s*"([^"]*)"/i)?.[1] || "").split(/\s+/).filter(Boolean);
    const matches = alternatives.some((alt) => {
      const [t, ...cls] = alt.split(".");
      if (t && t.toLowerCase() !== tag.toLowerCase()) return false;
      return cls.every((c) => classes.includes(c));
    });
    if (matches) found.push({ title: attrs.match(/data-title\s*=\s*"([^"]*)"/i)?.[1] || null });
  }
  // The first alternative that matches anything wins (avoid double counting section.slide and .slide).
  return found;
}

function extractScript(source) {
  const start = source.search(/const\s+SCRIPT\s*=\s*\[/);
  if (start === -1) return null;
  const open = source.indexOf("[", start);
  let depth = 0, inStr = null, esc = false, end = -1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "[") depth += 1;
    if (ch === "]") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const literal = source.slice(open, end + 1);
  try { return JSON.parse(literal); } catch { /* fall through */ }
  try { return new Function(`"use strict"; return (${literal});`)(); } catch { return null; }
}

function stripHtml(s) { return String(s).replace(/<[^>]+>/g, "").replace(/@/g, "").replace(/\s+/g, " ").trim(); }
function slugify(s) { return String(s).toLowerCase().replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "slide"; }

function parseRange(spec, total) {
  if (!spec) return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of String(spec).split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!a) continue;
    for (let i = a; i <= (b || a); i += 1) if (i >= 1 && i <= total) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

function pngDimensions(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return candidates.find((c) => c && existsSync(c)) || null;
}

function parseArgs(rawArgs) {
  const out = { _: [] };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    const key = k.replaceAll("-", "_");
    if (v !== undefined) { out[key] = v; continue; }
    const next = rawArgs[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next; i += 1;
  }
  return out;
}

function resolvePath(p) { return isAbsolute(p) ? p : resolve(process.cwd(), p); }
function fail(message) { console.error(message); process.exit(1); }
