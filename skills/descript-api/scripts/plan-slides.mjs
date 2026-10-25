#!/usr/bin/env node
/**
 * plan-slides.mjs — map rendered slides to narration timecodes and draft the Underlord prompt.
 *
 * Inputs: the manifest.json written by render-deck.mjs (slide titles, on-screen text, speaker notes) and an SRT
 * transcript exported with `descript.mjs transcript --format srt`. For every slide it searches the transcript, in order,
 * for the best-matching cue phrase (title, on-screen first line, first sentences of the notes) and proposes an IN point.
 * OUT = next slide's IN; the last slide runs to the end. Slide 1 starts at 00:00 unless --first-at-zero false.
 *
 * Usage:
 *   node plan-slides.mjs --manifest output/<Comp>/manifest.json --srt records/<proj>/<comp>.srt --folder <Comp>
 *        [--project <uuid>] [--composition <uuid>] [--composition-name <name>] [--duration <seconds>]
 *        [--pin 12=11:45,8=07:45]       force IN points for given slides (mm:ss[.s] or seconds)
 *        [--min-gap 8]                  minimum seconds between consecutive IN points (default 8)
 *        [--min-score 0.7]              reject matches below this share of cue words found (default 0.7)
 *        [--snap 6]                     snap IN back to the sentence start, at most this many seconds earlier (default 6)
 *        [--out plan.md] [--json plan.json] [--prompt-out prompt.md] [--mode split-fill|overlay]
 *        [--layout "Screen layout: screen placeholder + camera picture-in-picture bottom-right"]
 *
 * Review the plan before sending the prompt: unmatched slides are marked "SET MANUALLY" and the prompt refuses to
 * render until every slide has an IN point (use --pin).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.manifest || !args.srt) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].split("\n").slice(1).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  process.exit(args.help ? 0 : 1);
}

const STOP = new Set("a an the and or of to in on for with is are it its this that these those be as at by from we you your our they them he she his her not no so if then than let lets let's now here there what which who how when where why do does did have has had will would can could should also just very into about over up down out off".split(" "));

const manifest = JSON.parse(readFileSync(resolvePath(args.manifest), "utf8"));
const slides = manifest.slides || manifest;
const words = parseSrtWords(readFileSync(resolvePath(args.srt), "utf8"));
if (!words.length) fail("No words found in the SRT transcript");
const transcriptEnd = words[words.length - 1].end;
const freq = new Map();
for (const w of words) if (w.norm) freq.set(w.norm, (freq.get(w.norm) || 0) + 1);
const idf = (t) => Math.log(1 + words.length / (1 + (freq.get(t) || 0)));
const duration = args.duration != null ? Number(args.duration) : transcriptEnd;
const folder = String(args.folder || "").replace(/^\/+|\/+$/g, "");
const minGap = Number(args.min_gap ?? 8);
const minScore = Number(args.min_score ?? 0.7);
const snapBack = Number(args.snap ?? 6);
const pins = parsePins(args.pin);
const firstAtZero = args.first_at_zero !== false && args.first_at_zero !== "false";

// ---------- matching ----------

const rows = [];
let cursor = 0; // seconds; next slide must start at or after cursor
for (let i = 0; i < slides.length; i += 1) {
  const s = slides[i];
  const n = s.index || i + 1;
  const media = folder ? `${folder}/${s.file}` : s.file;
  let inSec = null, how = "", cueText = "", score = null, matched = "";
  if (pins[n] != null) { inSec = pins[n]; how = "pinned"; }
  else if (i === 0 && firstAtZero) { inSec = 0; how = "first slide"; }
  else {
    const best = bestMatch(candidates(s), cursor);
    if (best) { inSec = best.start; how = `matched ${best.label}`; cueText = best.cue; score = best.score; matched = best.text; }
  }
  if (inSec != null && i > 0 && inSec < cursor) { how += ` (adjusted from ${fmt(inSec)} to respect min-gap)`; inSec = cursor; }
  if (inSec != null) cursor = inSec + minGap;
  rows.push({ index: n, file: s.file, media, title: s.title, in: inSec, how, cue: cueText || (s.cue ? `deck cue: ${s.cue}` : ""), score, matched, flag: s.flag || null });
}
for (let i = 0; i < rows.length; i += 1) {
  const next = rows.slice(i + 1).find((r) => r.in != null);
  rows[i].out = i === rows.length - 1 ? duration : next ? next.in : null;
}
const missing = rows.filter((r) => r.in == null).map((r) => r.index);

// ---------- outputs ----------

const md = renderMarkdown();
if (args.out) writeOut(args.out, md); else process.stdout.write(md);
if (args.json) {
  writeOut(args.json, JSON.stringify({
    project_id: args.project || null, composition_id: args.composition || null, composition_name: args.composition_name || null,
    canvas: [manifest.width || 1920, manifest.height || 1080], duration, media_folder: folder || null,
    layout: args.layout || null, generated_at: new Date().toISOString(), source: { manifest: resolvePath(args.manifest), srt: resolvePath(args.srt) },
    clips: rows.map((r) => ({ index: r.index, media: r.media, in: r.in, out: r.out, cue: r.matched || r.cue || null, match: r.how, score: r.score })),
  }, null, 2) + "\n");
}
if (args.prompt_out) {
  if (missing.length) fail(`Cannot write the prompt: slides ${missing.join(", ")} have no IN point. Re-run with --pin ${missing.map((m) => `${m}=mm:ss`).join(",")}`);
  writeOut(args.prompt_out, renderPrompt(args.mode || "split-fill"));
}
if (missing.length) console.error(`Unmatched slides (set manually or --pin): ${missing.join(", ")}`);
console.error(`Planned ${rows.length - missing.length}/${rows.length} slides · duration ${fmt(duration)}${args.out ? ` · plan → ${resolvePath(args.out)}` : ""}${args.prompt_out ? ` · prompt → ${resolvePath(args.prompt_out)}` : ""}`);

// ---------- helpers ----------

function candidates(slide) {
  const out = [];
  const push = (label, text) => { const t = String(text || "").replace(/\s+/g, " ").trim(); if (t && tokens(t).length >= 2 && !out.some((c) => c.cue === t)) out.push({ label, cue: t }); };
  if (slide.cue_phrase) push("cue_phrase", slide.cue_phrase);
  push("title", slide.title);
  for (const line of String(slide.on_screen || "").split(/\n+/).slice(0, 2)) push("on-screen", line);
  const sentences = String(slide.notes_plain || "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  sentences.forEach((sen, k) => push(`notes sentence ${k + 1}`, sen));
  return out;
}

function bestMatch(cands, fromSec) {
  // Sections are sequential, so the slide's IN point is the EARLIEST window (after the previous slide) where any cue
  // phrase matches adequately — not the best-scoring window, which tends to sit in the middle of the section.
  let best = null;
  const startIdx = words.findIndex((w) => w.start >= fromSec);
  if (startIdx === -1) return null;
  for (const c of cands) {
    const cueTokens = tokens(c.cue).slice(0, 14);
    const need = cueTokens.length;
    if (need < 2) continue;
    const cueSet = new Set(cueTokens);
    const minHits = c.label === "title" || c.label === "cue_phrase" ? 2 : 3; // long text needs more evidence than a title
    const win = Math.max(need + 2, Math.round(need * 1.5));
    const total = cueTokens.reduce((acc, t) => acc + idf(t), 0);
    // Weighted score: rare words count more than words the speaker uses all the time.
    const matchAt = (i) => { const set = new Set(words.slice(i, i + win).map((w) => w.norm)); const found = cueTokens.filter((t) => set.has(t)); return { hits: found.length, score: found.reduce((acc, t) => acc + idf(t), 0) / total }; };
    for (let i = startIdx; i < words.length - 1; i += 1) {
      if (words[i].stop) continue;
      let m = matchAt(i);
      if (m.hits < minHits || m.score < minScore) continue;
      // Trim leading words that are not part of the cue while the match stays as strong.
      while (!cueSet.has(words[i].norm) && i + 1 < words.length && matchAt(i + 1).hits >= m.hits) { i += 1; m = matchAt(i); }
      const { hits, score } = m;
      const slice = words.slice(i, i + win);
      // Snap back to the start of the sentence that contains the cue (at most --snap seconds earlier).
      let j = i;
      while (j > 0 && !words[j].boundary && words[i].start - words[j - 1].start <= snapBack) j -= 1;
      const found = { hits, score, start: words[j].start, text: words.slice(j, i + win).map((w) => w.raw).join(" "), label: c.label, cue: c.cue };
      if (!best || found.start < best.start - 0.01 || (Math.abs(found.start - best.start) <= 0.01 && found.hits > best.hits)) best = found;
      break; // earliest adequate window for this candidate
    }
  }
  return best;
}

function tokens(text) {
  return String(text).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").map(stem).filter((w) => w && !STOP.has(w));
}
function stem(w) { if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`; if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1); return w; }

function parseSrtWords(srt) {
  const out = [];
  const blocks = srt.replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [a, b] = timeLine.split("-->").map((t) => srtTime(t.trim()));
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    const raws = text.split(/\s+/).filter(Boolean);
    if (!raws.length) continue;
    const per = (b - a) / raws.length;
    raws.forEach((raw, k) => {
      const norm = tokens(raw)[0] || "";
      const prev = out[out.length - 1];
      out.push({ raw, norm, start: a + per * k, end: a + per * (k + 1), stop: !norm, boundary: !prev || /[.!?]["')]*$/.test(prev.raw) || a + per * k - prev.end >= 0.5 });
    });
  }
  return out;
}
function srtTime(t) { const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0; }
function parsePins(spec) {
  const out = {};
  for (const part of String(spec || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = part.split("=");
    if (!k || v == null) continue;
    out[Number(k)] = parseTime(v);
  }
  return out;
}
function parseTime(v) {
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) fail(`Bad time: ${v}`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
function fmt(sec) { if (sec == null) return "—"; const m = Math.floor(sec / 60); const s = sec - m * 60; return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`; }

function renderMarkdown() {
  const lines = [];
  lines.push(`# ${args.composition_name || "Composition"} — slide placement plan (generated ${new Date().toISOString().slice(0, 10)}, review before use)`, "");
  if (args.project) lines.push(`- Project: \`${args.project}\``);
  if (args.composition) lines.push(`- Composition: \`${args.composition}\`${args.composition_name ? ` (${args.composition_name})` : ""}`);
  lines.push(`- Duration: ${fmt(duration)} · transcript speech ends ${fmt(transcriptEnd)} · media folder: \`${folder || "(root)"}/\``);
  lines.push(`- Sources: \`${args.manifest}\`, \`${args.srt}\``, "");
  lines.push("IN points are the first word of the transcript window that best matches the slide's title / on-screen text / notes.");
  lines.push("OUT = next slide's IN; the last slide runs to the end. Scores weight cue words by how rare they are in the transcript.", "");
  lines.push("| # | Media name | IN | OUT | Match | Transcript window | Notes |", "|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const note = [r.in == null ? "**SET MANUALLY**" : "", r.score != null && r.score < 0.75 ? "weak match — verify" : "", r.flag ? `deck flag: ${r.flag.slice(0, 80)}` : ""].filter(Boolean).join("; ");
    lines.push(`| ${r.index} | ${r.media} | ${fmt(r.in)} | ${fmt(r.out)} | ${r.how}${r.score != null ? ` (${Math.round(r.score * 100)}%)` : ""} | ${r.matched ? `"${r.matched.slice(0, 70)}"` : r.cue ? r.cue.slice(0, 70) : ""} | ${note} |`);
  }
  lines.push("", "## Next", "- Fix any SET MANUALLY / weak rows with `--pin N=mm:ss` and re-run, then generate the prompt with `--prompt-out`.",
    "- Send with `descript.mjs agent --prompt-file <prompt> --model claude-opus-5.5 --dry-run`, then `--wait --yes` after the user confirms the credits.", "");
  return lines.join("\n");
}

function renderPrompt(mode) {
  const comp = args.composition_name || "the composition";
  const compId = args.composition ? ` (composition id ${args.composition})` : "";
  const proj = args.project ? ` in project ${args.project}` : "";
  const layout = args.layout || 'the "Screen" layout: a large screen/browser-window media placeholder with the speaker camera as a small picture-in-picture in the bottom-right corner';
  const table = rows.map((r, i) => `| ${r.index} | ${fmt(r.in)} | ${i === rows.length - 1 ? `end (${fmt(duration)})` : fmt(r.out)} | ${r.media} |`).join("\n");
  const cues = rows.map((r) => `${r.index} ${r.matched ? `"${r.matched.slice(0, 60)}"` : "(time set manually)"}`).join(" · ");
  const scope = `Edit ONLY the composition "${comp}"${compId}${proj}. Do not create, duplicate, or modify any other composition, and do not import, rename, duplicate, or delete any media.`;
  const rules = `HARD RULES
- Keep all audio, all words, all existing cuts, captions, and the total runtime exactly as they are. Do not remove or add speech.
- Do not add transitions, spacer scenes, black frames, gaps, silence, stock media, music, titles, or text overlays.
- No generated music, sound effects, or layout changes: do not generate or add music or SFX, and do not search for or apply layout packs.
- Place every split on a word boundary: between two words, preferably at the end of a sentence, never inside a word. Move a split by up to ±1.0 s from the requested time if that is what it takes. Report the final time of every split you made.
- Use only the ${rows.length} media names listed above, exactly as written (folder "${folder}/"). If one cannot be found, leave that scene empty and report it; do not substitute other media.
- Do not touch media in any other folder.

REPORT BACK
Return a table with: scene number, final start and end timecodes, the image placed, and — for every scene — confirmation of the layout and that the camera inset is unchanged. List anything you could not do exactly as specified.`;
  if (mode === "overlay") {
    return `${scope}

CURRENT STATE
- ${comp} is a finished ${fmt(duration)} talking-head recording with narration. The ${rows.length} slide images already exist in this project's media under the folder "${folder}/".

TASK
Add each image below as a full-frame visual layer over the recording from IN to OUT (16:9, edge to edge, no letterboxing), keeping the speaker visible as a picture-in-picture in the bottom-right corner (about 25% of the frame width). Between slides, if any gap exists, show the camera recording as-is. Never overlap two slides.

| Slide | IN | OUT | Image |
|------:|----|-----|-------|
${table}

Spoken cues at each IN, for reference: ${cues}.

${rules}
`;
  }
  return `${scope}

CURRENT STATE
- ${comp} is a finished ${fmt(duration)} talking-head recording. It currently consists of ONE scene that uses ${layout}.
- The ${rows.length} slide images already exist in this project's media under the folder "${folder}/".

TASK
1. Split that single scene into exactly ${rows.length} consecutive scenes at the timecodes below. The scenes must be contiguous: scene N ends exactly where scene N+1 begins, and scene ${rows.length} runs to the end of the composition.
2. Every scene must keep the SAME layout that the composition already uses — same placeholder geometry, same camera picture-in-picture position and size, same background. Do not change the layout type, do not apply a different layout or template, do not add new layers.
3. Fill the empty screen placeholder of each scene with the image listed for it, fitted inside the placeholder without cropping, static for the whole scene:

| Scene | Start | End | Image to put in the Screen placeholder |
|------:|-------|-----|-----------------------------------------|
${table}

Spoken cues at each start, for reference: ${cues}.

${rules}
`;
}

function writeOut(p, content) { const abs = resolvePath(p); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); }
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
