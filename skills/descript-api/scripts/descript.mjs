#!/usr/bin/env node
/**
 * descript.mjs — zero-dependency CLI for the Descript public REST API (v1).
 * Node >= 20 (native fetch). Docs: https://help.descript.com/developers
 *
 * Token resolution: DESCRIPT_TOKEN env → DESCRIPT_ENV_FILE → nearest .env (cwd upward, then the plugin root)
 *                   → ~/.config/descript/.env → ~/.descript-cli/config.json (official CLI). The token is never printed.
 *
 * Run `node descript.mjs help` for commands.
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const API_BASE_URL = (process.env.DESCRIPT_API_BASE_URL || "https://descriptapi.com/v1").replace(/\/+$/, "");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "../../.."); // <repo>/skills/descript-api/scripts → <repo>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /^[0-9a-f]{5}$/i;
const JOB_TYPES = ["import/project_media", "import/drive_media", "agent", "publish"];
const EXIT = { OK: 0, ERROR: 1, JOB_FAILED: 2, TIMEOUT: 3 };

const CONTENT_TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
  // added to Descript's supported formats in 2026
  ".avif": "image/avif", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".mxf": "application/mxf",
  ".opus": "audio/opus",
};

class CliError extends Error {
  constructor(message, code = EXIT.ERROR) { super(message); this.exitCode = code; }
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  const commands = {
    status, projects, project, resolve: resolveCmd, upload, library_upload: libraryUpload, agent, jobs, job, cancel,
    transcript, publish, published, models, search, help: () => printHelp(),
  };
  if (!command || command === "-h" || command === "--help") return printHelp();
  const fn = commands[command.replaceAll("-", "_")] || commands[command];
  if (!fn) throw new CliError(`Unknown command: ${command}\nRun "help" for usage.`);
  await fn(args);
}

function printHelp() {
  console.log(`descript.mjs — Descript REST API helper (base ${API_BASE_URL})

TARGETS: wherever an ID is accepted you may pass a UUID, a 5-char short ID (compositions), a composition name,
         or a full URL like https://web.descript.com/<project-uuid>/<short-id>.

Read-only (free):
  status                                   Token check: drive name/id, api version
  projects [--name X] [--all] [--limit N] [--sort updated_at] [--json]
           [--updated-after ISO] [--updated-before ISO] [--created-after ISO] [--created-before ISO]
  project <id|url> [--media] [--folder F] [--json]      Compositions (+ media files, optionally one folder)
  resolve <url|short|name> [--project ID]  Print project + composition UUID/name for a URL or short ID
  jobs [--project ID] [--type import/project_media|import/drive_media|agent|publish] [--limit N] [--json]
  job <job-id> [--wait] [--interval 5] [--max 240] [--json]
  models [--json]                          Agent models + aliases (cost tier, description). --model also accepts
                                           family aliases (claude-opus → newest Opus); "auto" is the default.
  search --query "text" [--type image|video|audio|project|...] [--match name|content|visual]
         [--sort relevance|newest|oldest] [--owner UUID[,UUID]] [--updated-after ISO] [--updated-before ISO]
         [--limit N] [--json]              --match content returns moment start–end: where a phrase is spoken
  published <slug> [--json]                Published project by share slug (download_url, expiry, privacy, metadata)
  transcript --project ID --composition ID --format srt|markdown|txt|html|rtf|docx
             [--timecodes SECONDS] [--markers] [--speakers off|changes|every_paragraph] --out FILE

Writes (media minutes / AI credits / outward-facing — confirm with the user first):
  upload --project ID --folder NAME <files...> [--name-map src=dst,...] [--language en]
         [--composition NEWNAME [--width 1920 --height 1080]] [--force] [--no-wait] [--dry-run] [--json]
         Direct-upload local files into an existing project. Refuses exact media-name collisions unless --force.
  library-upload [--folder-id root|UUID] <files...> [--language en] [--no-wait] [--dry-run] [--json]
         Direct-upload local files into the Drive's Media Library (POST /jobs/import/drive_media), not a project.
         --folder-id defaults to root. Prints per-file status, media seconds used, folder id, asset ids.
         There is no REST delete: remove test assets in the Descript app.
  agent --project ID --composition ID (--prompt "..." | --prompt-file F) [--model auto]
        [--conversation UUID] [--wait] [--yes] [--dry-run] [--out result.json] [--json]
        Underlord edit of a composition. Billable: requires --yes (or --dry-run to print the payload only).
        --out saves the raw job result (agent_response, credits, conversation_id) for the placement record.
  publish --project ID --composition ID [--resolution 1080p] [--access unlisted|public|drive|private]
          [--media-type Video|Audio] [--wait] [--yes] [--dry-run] [--json]
          Billable/outward-facing: requires --yes. 422 = Video requested on an audio-only composition.
  cancel <job-id>

Exit codes: 0 ok · 1 error/validation · 2 job finished but result.status != success · 3 poll timeout
Env: DESCRIPT_TOKEN, DESCRIPT_ENV_FILE, DESCRIPT_API_BASE_URL, DESCRIPT_DEBUG=1 (prints which token source was used)`);
}

// ---------- args / env ----------

function parseArgs(rawArgs) {
  const args = { _: [] };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) { args._.push(arg); continue; }
    const [keyPart, inlineValue] = arg.slice(2).split(/=(.*)/s);
    const key = keyPart.replaceAll("-", "_");
    if (inlineValue !== undefined) { args[key] = inlineValue; continue; }
    if (key.startsWith("no_")) { args[key.slice(3)] = false; continue; }
    const next = rawArgs[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
    args[key] = next; i += 1;
  }
  return args;
}

function parseEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sep = t.indexOf("=");
    if (sep === -1) continue;
    const key = t.slice(0, sep).trim().replace(/^export\s+/, "");
    let value = t.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function findUp(filename, starts) {
  const seen = new Set();
  for (const start of starts) {
    let cur = resolve(start);
    while (!seen.has(cur)) {
      seen.add(cur);
      const candidate = join(cur, filename);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return null;
}

let cachedToken = null;
function token() {
  if (cachedToken) return cachedToken;
  const sources = [];
  if (process.env.DESCRIPT_TOKEN) sources.push(["env DESCRIPT_TOKEN", process.env.DESCRIPT_TOKEN]);
  if (process.env.DESCRIPT_ENV_FILE && existsSync(process.env.DESCRIPT_ENV_FILE)) {
    sources.push([process.env.DESCRIPT_ENV_FILE, parseEnvFile(process.env.DESCRIPT_ENV_FILE).DESCRIPT_TOKEN]);
  }
  const envPath = findUp(".env", [process.cwd(), PLUGIN_ROOT]);
  if (envPath) sources.push([envPath, parseEnvFile(envPath).DESCRIPT_TOKEN]);
  const userEnv = join(homedir(), ".config", "descript", ".env");
  if (existsSync(userEnv)) sources.push([userEnv, parseEnvFile(userEnv).DESCRIPT_TOKEN]);
  const cliConfig = join(homedir(), ".descript-cli", "config.json");
  if (existsSync(cliConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(cliConfig, "utf8"));
      sources.push([cliConfig, cfg.profiles?.[cfg.activeProfile || "default"]?.apiKey]);
    } catch { /* ignore */ }
  }
  const hit = sources.find(([, v]) => v && v.trim());
  if (!hit) {
    throw new CliError("Missing DESCRIPT_TOKEN. Export it, put it in a .env file (cwd or ~/.config/descript/.env), set DESCRIPT_ENV_FILE, or run `descript-api config set api-key`. Create a token in Descript → Settings → API.");
  }
  cachedToken = hit[1].trim();
  if (process.env.DESCRIPT_DEBUG) console.error(`[token source] ${hit[0]}`);
  return cachedToken;
}

// ---------- http ----------

async function request(path, options = {}, attempt = 1) {
  const { raw = false, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${token()}`, ...(rest.body ? { "Content-Type": "application/json" } : {}), ...(rest.headers || {}) },
  });
  if (response.status === 429 && attempt <= 3) {
    const wait = Number(response.headers.get("Retry-After") || 5);
    console.error(`429 rate limited — retrying in ${wait}s (attempt ${attempt}/3)`);
    await sleep(wait * 1000);
    return request(path, options, attempt + 1);
  }
  if (response.status === 204) return null;
  if (raw) {
    if (!response.ok) throw new CliError(`Descript API ${response.status}: ${await response.text()}`);
    return response;
  }
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    const hint = ["Retry-After", "X-RateLimit-Remaining"].map((h) => (response.headers.get(h) ? `${h}: ${response.headers.get(h)}` : null)).filter(Boolean).join(", ");
    // v1.2 error body: {error: "<code>", message: "..."} (codes: invalid_input, payment_required, forbidden,
    // not_found, unprocessable_entity, rate_limit_exceeded). Older bodies may nest {error: {message}}.
    const code = typeof body?.error === "string" && body?.message ? body.error : null;
    const message = body?.message || body?.error?.message || body?.error || text || "Request failed";
    const err = new CliError(`Descript API ${response.status}: ${code ? `${code}: ` : ""}${typeof message === "string" ? message : JSON.stringify(message)}${hint ? ` (${hint})` : ""}`);
    err.status = response.status;
    err.code = code;
    throw err;
  }
  return body;
}

function safeJson(text) { try { return JSON.parse(text); } catch { return text; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- target resolution ----------

function parseTarget(value) {
  if (!value) return {};
  const str = String(value).trim();
  const url = str.match(/^https?:\/\/(?:web\.)?descript\.com\/([0-9a-f-]{36})(?:\/([0-9a-z]{5}))?/i);
  if (url) return { project_id: url[1], composition_ref: url[2] || null };
  if (UUID_RE.test(str)) return { uuid: str };
  if (SHORT_RE.test(str)) return { composition_ref: str };
  return { composition_ref: str };
}

function requireProjectId(args, { allowFromTarget } = {}) {
  const fromTarget = allowFromTarget ? parseTarget(allowFromTarget).project_id : null;
  const fromArg = args.project ? parseTarget(args.project) : {};
  const id = fromArg.project_id || fromArg.uuid || fromTarget;
  if (!id) throw new CliError("--project <uuid|url> is required");
  if (!UUID_RE.test(id)) throw new CliError(`Not a project UUID: ${id}`);
  return id;
}

async function getProject(projectId) {
  return request(`/projects/${encodeURIComponent(projectId)}`);
}

function findComposition(project, ref) {
  const comps = project.compositions || [];
  const parsed = parseTarget(ref);
  const needle = (parsed.uuid || parsed.composition_ref || "").toLowerCase();
  if (!needle) throw new CliError("Composition reference is empty");
  const byId = comps.filter((c) => c.id.toLowerCase() === needle || c.id.toLowerCase().startsWith(needle));
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) throw new CliError(`Short ID ${needle} is ambiguous in this project`);
  const byName = comps.filter((c) => c.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new CliError(`Multiple compositions named "${ref}"; use the UUID or short ID`);
  throw new CliError(`Composition not found in project "${project.name}": ${ref}`);
}

// ---------- commands: read-only ----------

async function status(args) {
  const s = await request("/status");
  if (args.json) return console.log(JSON.stringify(s, null, 2));
  console.log(`API ${s.api_version} · drive: ${s.drive_name || "(none)"} (${s.drive_id || "-"})`);
}

async function projects(args) {
  const query = new URLSearchParams({ limit: String(args.limit || 100), sort: args.sort || "updated_at", direction: args.direction || "desc" });
  if (args.name) query.set("name", args.name);
  for (const key of ["updated_after", "updated_before", "created_after", "created_before"]) if (args[key]) query.set(key, String(args[key]));
  const all = [];
  let cursor = "";
  do {
    if (cursor) query.set("cursor", cursor);
    const page = await request(`/projects?${query}`);
    all.push(...(page.data || []));
    cursor = page.pagination?.next_cursor || "";
  } while (cursor && args.all);
  if (args.json) return console.log(JSON.stringify(all, null, 2));
  if (!all.length) return console.log("No projects found.");
  console.log(pad("Project ID", 38) + pad("Updated", 26) + "Name");
  for (const p of all) console.log(pad(p.id, 38) + pad(p.updated_at || "", 26) + p.name + (p.folder_path ? `  [${p.folder_path}]` : ""));
}

async function project(args) {
  const target = args._[0] || args.project;
  const projectId = requireProjectId({ project: target });
  const p = await getProject(projectId);
  const media = Object.entries(p.media_files || {});
  const folderFilter = args.folder ? String(args.folder).replace(/^\/+|\/+$/g, "") : null;
  const filtered = folderFilter ? media.filter(([name]) => name.startsWith(`${folderFilter}/`)) : media;
  if (args.json) {
    return console.log(JSON.stringify(args.media ? { ...p, media_files: Object.fromEntries(filtered) } : { ...p, media_files: undefined, media_count: media.length }, null, 2));
  }
  console.log(`Project: ${p.name}\nID: ${p.id}\nDrive: ${p.drive_name || p.drive_id || "-"}\nUpdated: ${p.updated_at}\nMedia files: ${media.length} · Compositions: ${(p.compositions || []).length} · Publishes: ${(p.publishes || []).length}\n`);
  console.log(pad("Composition ID", 38) + pad("Short", 7) + pad("Type", 7) + pad("Duration", 10) + "Name");
  for (const c of p.compositions || []) {
    console.log(pad(c.id, 38) + pad(c.id.slice(0, 5), 7) + pad(c.media_type || "", 7) + pad(fmtDuration(c.duration), 10) + c.name);
  }
  if (p.publishes?.length) {
    console.log("\nPublishes:");
    for (const pub of p.publishes) console.log(`- ${pub.name} [${pub.access_level}${pub.media_type ? `, ${String(pub.media_type).toLowerCase()}` : ""}] ${pub.share_url} (composition ${pub.composition_id})`);
  }
  if (args.media) {
    console.log(`\nMedia${folderFilter ? ` in ${folderFilter}/` : ""}: ${filtered.length}`);
    for (const [name, info] of filtered.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
      console.log(`- ${name}  (${info.type}${info.duration != null ? `, ${info.duration.toFixed(2)}s` : ""})`);
    }
  } else {
    const folders = {};
    for (const [name] of media) { const f = name.includes("/") ? name.split("/").slice(0, -1).join("/") : "(root)"; folders[f] = (folders[f] || 0) + 1; }
    console.log("\nMedia folders: " + Object.entries(folders).sort().map(([f, n]) => `${f} (${n})`).join(", "));
  }
}

async function resolveCmd(args) {
  const ref = args._[0];
  if (!ref) throw new CliError("Usage: resolve <url|short-id|name> [--project ID]");
  const projectId = requireProjectId(args, { allowFromTarget: ref });
  const p = await getProject(projectId);
  const parsed = parseTarget(ref);
  const compRef = parsed.composition_ref || parsed.uuid;
  const result = { project_id: p.id, project_name: p.name };
  if (compRef) {
    const c = findComposition(p, compRef);
    Object.assign(result, { composition_id: c.id, composition_short_id: c.id.slice(0, 5), composition_name: c.name, duration: c.duration, url: `https://web.descript.com/${p.id}/${c.id.slice(0, 5)}` });
  }
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  for (const [k, v] of Object.entries(result)) console.log(`${k}: ${v}`);
}

async function jobs(args) {
  const query = new URLSearchParams({ limit: String(args.limit || 20) });
  if (args.project) query.set("project_id", requireProjectId(args));
  if (args.type) {
    if (!JOB_TYPES.includes(String(args.type))) throw new CliError(`--type must be one of: ${JOB_TYPES.join(", ")}`);
    query.set("type", args.type);
  }
  const page = await request(`/jobs?${query}`);
  if (args.json) return console.log(JSON.stringify(page, null, 2));
  if (!(page.data || []).length) return console.log("No jobs found (job history covers the last 7 days by default, 30 max).");
  for (const j of page.data || []) {
    const r = j.result || {};
    console.log(`${j.created_at}  ${pad(j.job_type, 22)} ${pad(j.job_state, 10)} ${pad(r.status || j.progress?.label || "", 10)} ${j.job_id}${r.ai_credits_used != null ? `  credits=${r.ai_credits_used}` : ""}${r.media_seconds_used != null ? `  media_s=${r.media_seconds_used}` : ""}${jobExtras(j)}`);
  }
}

function jobExtras(j) {
  const errorCode = j.result?.error_code || j.error_code;
  return `${j.stopped_at ? `  stopped=${j.stopped_at}` : ""}${errorCode ? `  error_code=${errorCode}` : ""}`;
}

async function job(args) {
  const id = args._[0];
  if (!id) throw new CliError("Usage: job <job-id> [--wait]");
  if (!args.wait) {
    const j = await request(`/jobs/${encodeURIComponent(id)}`);
    return console.log(JSON.stringify(j, null, 2));
  }
  const j = await waitForJob(id, { intervalSeconds: Number(args.interval || 5), maxAttempts: Number(args.max || 240), quiet: Boolean(args.json) });
  console.log(JSON.stringify(j, null, 2));
  if (j.result?.status && j.result.status !== "success") process.exitCode = EXIT.JOB_FAILED;
}

async function cancel(args) {
  const id = args._[0];
  if (!id) throw new CliError("Usage: cancel <job-id>");
  await request(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  console.log(`Cancelled ${id}`);
}

async function models(args) {
  const m = await request("/agent/models");
  if (args.json) return console.log(JSON.stringify(m, null, 2));
  console.log("Models:");
  for (const x of m.availableModels || []) console.log(`- ${pad(x.id, 22)} cost=${x.cost}`);
  console.log("Aliases:");
  for (const a of m.aliases || []) console.log(`- ${pad(a.id, 22)} → ${a.resolvesTo} (${a.cost})${a.description ? `  ${a.description}` : ""}`);
  console.log("Pass any model id or alias to agent --model; family aliases (e.g. claude-opus) resolve to the newest model of that family.");
}

const SEARCH_SORTS = ["relevance", "newest", "oldest"];

async function search(args) {
  if (!args.query) throw new CliError("--query is required");
  if (args.sort && !SEARCH_SORTS.includes(String(args.sort))) throw new CliError(`--sort must be one of: ${SEARCH_SORTS.join(", ")}`);
  const query = new URLSearchParams({ query: String(args.query), limit: String(args.limit || 30) });
  for (const key of ["type", "match"]) {
    if (args[key]) for (const v of String(args[key]).split(",").map((s) => s.trim()).filter(Boolean)) query.append(key, v);
  }
  if (args.sort) query.set("sort", String(args.sort));
  if (args.owner) for (const o of String(args.owner).split(",").map((s) => s.trim()).filter(Boolean)) query.append("owner[]", o);
  for (const key of ["updated_after", "updated_before"]) if (args[key]) query.set(key, String(args[key]));
  const res = await request(`/search?${query}`);
  if (args.json) return console.log(JSON.stringify(res, null, 2));
  if (!(res.results || []).length) return console.log("No results.");
  for (const r of res.results || []) {
    const m = r.moment;
    const moment = m && (m.start_time_sec != null || m.end_time_sec != null) ? `  @ ${fmtDuration(m.start_time_sec)}–${fmtDuration(m.end_time_sec)}` : "";
    const where = r.location ? `  [${r.location}]` : "";
    const dur = typeof r.duration === "number" ? `  (${fmtDuration(r.duration)})` : "";
    console.log(`${pad(r.type, 10)} ${r.name}${where}${dur}${moment}  ${r.url || ""}${r.project_id ? `  project=${r.project_id}` : ""}`);
  }
}

async function published(args) {
  const slug = args._[0];
  if (!slug || slug === true) throw new CliError("Usage: published <slug> [--json]   (slug = last path segment of the share URL)");
  const clean = String(slug).replace(/^https?:\/\/[^/]+\/(?:view\/)?/i, "").replace(/[/?#].*$/, "");
  const p = await request(`/published_projects/${encodeURIComponent(clean)}`);
  if (args.json) return console.log(JSON.stringify(p, null, 2));
  for (const [k, v] of Object.entries(p || {})) console.log(`${k}: ${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`);
}

async function transcript(args) {
  const projectId = requireProjectId(args, { allowFromTarget: args.composition });
  const format = args.format || "srt";
  const body = { project_id: projectId, format };
  if (args.composition) body.composition_id = (await resolveCompositionId(projectId, args.composition)).id;
  if (args.speakers) body.include_speaker_labels = args.speakers;
  if (args.markers) body.include_markers = true;
  if (args.timecodes) body.timecodes = { frequency_seconds: Number(args.timecodes) || 30, on_paragraphs: true, on_markers: Boolean(args.markers) };
  const response = await request("/export/transcript", { method: "POST", body: JSON.stringify(body), raw: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (args.out) {
    mkdirSync(dirname(resolvePath(args.out)), { recursive: true });
    writeFileSync(resolvePath(args.out), buffer);
    console.error(`Wrote ${buffer.length} bytes → ${resolvePath(args.out)} (composition ${response.headers.get("X-Composition-Id") || body.composition_id || "default"})`);
  } else {
    process.stdout.write(buffer);
  }
}

// ---------- commands: writes ----------

async function upload(args) {
  const projectId = requireProjectId(args);
  const files = args._;
  if (!files.length) throw new CliError("Provide at least one local file to upload");
  const folder = String(args.folder || "").replace(/^\/+|\/+$/g, "");
  const nameMap = Object.fromEntries(String(args.name_map || "").split(",").filter(Boolean).map((pair) => pair.split("=").map((s) => s.trim())));
  const items = files.map((f) => {
    const localPath = resolvePath(f);
    if (!existsSync(localPath) || !statSync(localPath).isFile()) throw new CliError(`Not a file: ${localPath}`);
    const base = nameMap[basename(localPath)] || basename(localPath);
    const contentType = CONTENT_TYPES[extname(localPath).toLowerCase()];
    if (!contentType) throw new CliError(`Unsupported file type: ${localPath}`);
    return { localPath, mediaName: folder ? `${folder}/${base}` : base, baseName: base, contentType, fileSize: statSync(localPath).size };
  });
  const dupes = items.map((i) => i.mediaName).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) throw new CliError(`Duplicate upload names: ${[...new Set(dupes)].join(", ")}`);

  const projectBefore = await getProject(projectId);
  const existing = Object.keys(projectBefore.media_files || {});
  const exact = items.filter((i) => existing.includes(i.mediaName));
  if (exact.length && !args.force) {
    throw new CliError(`Refusing to upload: these media names already exist in "${projectBefore.name}" (Descript would suffix them):\n${exact.map((i) => `- ${i.mediaName}`).join("\n")}\nUse a different --folder, --name-map, or --force.`);
  }
  const existingBasenames = new Set(existing.map((n) => n.split("/").pop()));
  const baseClash = items.filter((i) => existingBasenames.has(i.baseName) && !existing.includes(i.mediaName));
  if (baseClash.length) console.error(`Warning: ${baseClash.length} basename(s) already exist elsewhere in the project; Descript may append -N suffixes: ${baseClash.map((i) => i.baseName).join(", ")}`);

  const addMedia = {};
  for (const i of items) addMedia[i.mediaName] = { content_type: i.contentType, file_size: i.fileSize, ...(args.language ? { language: args.language } : {}) };
  const payload = { project_id: projectId, add_media: addMedia };
  if (args.composition) {
    payload.add_compositions = [{ name: String(args.composition), width: Number(args.width || 1920), height: Number(args.height || 1080), clips: items.map((i) => ({ media: i.mediaName })) }];
  }
  if (args.dry_run) return console.log(JSON.stringify(payload, null, 2));

  console.error(`Requesting upload URLs for ${items.length} file(s) → ${projectBefore.name} ${folder ? `(${folder}/)` : ""}`);
  const importJob = await request("/jobs/import/project_media", { method: "POST", body: JSON.stringify(payload) });
  await putUploads(items, importJob.upload_urls);
  if (args.wait === false) return console.log(JSON.stringify({ job_id: importJob.job_id, project_url: importJob.project_url, uploaded: items.map((i) => i.mediaName) }, null, 2));

  const done = await waitForJob(importJob.job_id, { intervalSeconds: Number(args.interval || 5), maxAttempts: Number(args.max || 240), quiet: Boolean(args.json) });
  const projectAfter = await getProject(projectId);
  const live = Object.keys(projectAfter.media_files || {});
  const result = {
    job_id: importJob.job_id, project_url: importJob.project_url, status: done.result?.status,
    media_seconds_used: done.result?.media_seconds_used, media_status: done.result?.media_status,
    created_compositions: done.result?.created_compositions || [],
    uploaded: items.map((i) => ({ requested: i.mediaName, live: live.includes(i.mediaName) ? i.mediaName : (live.find((n) => n.startsWith(i.mediaName.replace(/\.[^.]+$/, "")) && !existing.includes(n)) || null) })),
  };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\nImport job ${result.job_id}: ${result.status} (media seconds used: ${result.media_seconds_used ?? "?"})`);
    for (const u of result.uploaded) console.log(`- ${u.requested}${u.live && u.live !== u.requested ? `  → live as ${u.live}` : u.live ? "" : "  (NOT FOUND in project yet)"}`);
    if (result.created_compositions.length) console.log(`Created compositions: ${result.created_compositions.map((c) => `${c.name} (${c.id})`).join(", ")}`);
    console.log(`Open: ${result.project_url}`);
  }
  if (result.status !== "success") process.exitCode = EXIT.JOB_FAILED;
}

async function libraryUpload(args) {
  const files = args._;
  if (!files.length) throw new CliError("Usage: library-upload [--folder-id root|UUID] <files...> [--language en] [--no-wait] [--dry-run] [--json]");
  const folderId = args.folder_id && args.folder_id !== true ? String(args.folder_id) : "root";
  if (folderId !== "root" && !UUID_RE.test(folderId)) throw new CliError(`--folder-id must be "root" or a Media Library folder UUID: ${folderId}`);
  // Media Library names are plain basenames (no folder prefix); the folder is chosen by folder_id.
  const items = files.map((f) => {
    const localPath = resolvePath(f);
    if (!existsSync(localPath) || !statSync(localPath).isFile()) throw new CliError(`Not a file: ${localPath}`);
    const contentType = CONTENT_TYPES[extname(localPath).toLowerCase()];
    if (!contentType) throw new CliError(`Unsupported file type: ${localPath}`);
    const base = basename(localPath);
    return { localPath, mediaName: base, baseName: base, contentType, fileSize: statSync(localPath).size };
  });
  const dupes = items.map((i) => i.mediaName).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) throw new CliError(`Duplicate upload names: ${[...new Set(dupes)].join(", ")}`);

  const addMedia = {};
  for (const i of items) addMedia[i.mediaName] = { content_type: i.contentType, file_size: i.fileSize, ...(args.language ? { language: String(args.language) } : {}) };
  const payload = { folder_id: folderId, add_media: addMedia };
  if (args.callback_url) payload.callback_url = String(args.callback_url);
  if (args.dry_run) return console.log(JSON.stringify(payload, null, 2));

  console.error(`Requesting Media Library upload URLs for ${items.length} file(s) → folder ${folderId}`);
  const importJob = await request("/jobs/import/drive_media", { method: "POST", body: JSON.stringify(payload) });
  await putUploads(items, importJob.upload_urls);
  const assetIds = Object.fromEntries(items.map((i) => [i.mediaName, importJob.upload_urls?.[i.mediaName]?.asset_id ?? null]));
  if (args.wait === false) return console.log(JSON.stringify({ job_id: importJob.job_id, folder_id: folderId, asset_ids: assetIds }, null, 2));

  const done = await waitForJob(importJob.job_id, { intervalSeconds: Number(args.interval || 5), maxAttempts: Number(args.max || 240), quiet: Boolean(args.json) });
  const r = done.result || {};
  const result = {
    job_id: importJob.job_id, job_state: done.job_state, status: r.status, folder_id: done.folder_id || r.folder_id || folderId,
    media_seconds_used: r.media_seconds_used, error_code: r.error_code, stopped_at: done.stopped_at,
    files: items.map((i) => ({ name: i.mediaName, asset_id: assetIds[i.mediaName], ...(r.media_status?.[i.mediaName] || {}) })),
  };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\nMedia Library import ${result.job_id}: ${result.status ?? result.job_state} (media seconds used: ${result.media_seconds_used ?? "?"}) · folder ${result.folder_id}${result.error_code ? ` · error_code ${result.error_code}` : ""}`);
    for (const f of result.files) console.log(`- ${f.name}  ${f.status || "?"}  asset=${f.asset_id || "-"}${f.duration_seconds != null ? `  ${f.duration_seconds}s` : ""}${f.error_message ? `  ${f.error_message}` : ""}`);
  }
  if (result.status !== "success") process.exitCode = EXIT.JOB_FAILED;
}

async function agent(args) {
  const projectId = requireProjectId(args, { allowFromTarget: args.composition });
  let prompt = args.prompt;
  if (args.prompt_file) prompt = readFileSync(resolvePath(args.prompt_file), "utf8");
  if (!prompt || !String(prompt).trim()) throw new CliError("--prompt or --prompt-file is required");
  const payload = { project_id: projectId, prompt: String(prompt).trim() };
  let compName = "(agent chooses)";
  if (args.composition) { const c = await resolveCompositionId(projectId, args.composition); payload.composition_id = c.id; compName = c.name; }
  if (args.model) payload.model = String(args.model);
  if (args.conversation) payload.conversation_id = String(args.conversation);
  if (args.callback_url) payload.callback_url = String(args.callback_url);
  if (args.dry_run) return console.log(JSON.stringify(payload, null, 2));
  if (!args.yes) throw new CliError(`Agent edits consume AI credits (model ${payload.model || "auto"}, composition "${compName}"). Re-run with --yes after confirming with the user, or --dry-run to inspect the payload.`);
  const created = await request("/jobs/agent", { method: "POST", body: JSON.stringify(payload) });
  console.error(`Agent job ${created.job_id} started (model ${created.resolved_model}, conversation ${created.conversation_id})`);
  if (!args.wait) return console.log(JSON.stringify(created, null, 2));
  const done = await waitForJob(created.job_id, { intervalSeconds: Number(args.interval || 10), maxAttempts: Number(args.max || 180), quiet: Boolean(args.json) });
  const summary = { ...created, result: done.result, job_state: done.job_state };
  if (args.out) { mkdirSync(dirname(resolvePath(args.out)), { recursive: true }); writeFileSync(resolvePath(args.out), JSON.stringify(summary, null, 2) + "\n"); console.error(`Saved job result → ${resolvePath(args.out)}`); }
  console.log(JSON.stringify(summary, null, 2));
  if (done.result?.status !== "success") process.exitCode = EXIT.JOB_FAILED;
}

async function publish(args) {
  const projectId = requireProjectId(args, { allowFromTarget: args.composition });
  const payload = { project_id: projectId, media_type: args.media_type || "Video" };
  let compName = "(first with content)";
  if (args.composition) { const c = await resolveCompositionId(projectId, args.composition); payload.composition_id = c.id; compName = c.name; }
  if (args.resolution) payload.resolution = String(args.resolution);
  if (args.access) payload.access_level = String(args.access);
  if (args.callback_url) payload.callback_url = String(args.callback_url);
  if (args.dry_run) return console.log(JSON.stringify(payload, null, 2));
  if (!args.yes) throw new CliError(`Publishing creates a share link for "${compName}" (access ${payload.access_level || "drive default"}). Re-run with --yes after confirming with the user.`);
  let created;
  try {
    created = await request("/jobs/publish", { method: "POST", body: JSON.stringify(payload) });
  } catch (error) {
    if (error.status === 422) error.message += "\nHint: the composition is probably audio-only; re-run with --media-type Audio.";
    throw error;
  }
  console.error(`Publish job ${created.job_id} started`);
  if (!args.wait) return console.log(JSON.stringify(created, null, 2));
  const done = await waitForJob(created.job_id, { intervalSeconds: Number(args.interval || 10), maxAttempts: Number(args.max || 180), quiet: Boolean(args.json) });
  if (!args.json && done.result?.media_type) console.error(`Published as ${done.result.media_type}: ${done.result.share_url || "(no share url)"}`);
  console.log(JSON.stringify({ ...created, result: done.result, job_state: done.job_state, stopped_at: done.stopped_at }, null, 2));
  if (done.result?.status !== "success") process.exitCode = EXIT.JOB_FAILED;
}

// ---------- shared ----------

async function resolveCompositionId(projectId, ref) {
  const p = await getProject(projectId);
  return findComposition(p, ref);
}

async function waitForJob(jobId, { intervalSeconds, maxAttempts, quiet = false }) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await request(`/jobs/${encodeURIComponent(jobId)}`);
    if (!quiet) console.error(`[${attempt}/${maxAttempts}] ${last.job_type} ${last.job_state}${last.progress?.label ? ` — ${last.progress.label}${last.progress.percent != null ? ` ${last.progress.percent}%` : ""}` : ""}`);
    if (last.job_state === "stopped" || last.job_state === "cancelled") {
      if (!quiet && (last.result?.error_code || last.stopped_at)) console.error(`  ${last.job_state}${last.stopped_at ? ` at ${last.stopped_at}` : ""}${last.result?.error_code ? ` · error_code ${last.result.error_code}` : ""}${last.result?.error_message ? ` · ${last.result.error_message}` : ""}`);
      return last;
    }
    await sleep(intervalSeconds * 1000);
  }
  console.log(JSON.stringify(last, null, 2));
  throw new CliError(`Timed out waiting for job ${jobId}`, EXIT.TIMEOUT);
}

// PUT each local file to its signed upload_url (file MIME first, application/octet-stream fallback).
// `items` need {localPath, mediaName, contentType, fileSize}; `uploadUrls` is the job's upload_urls map keyed by mediaName.
async function putUploads(items, uploadUrls) {
  for (const i of items) {
    const u = uploadUrls?.[i.mediaName]?.upload_url;
    if (!u) throw new CliError(`No upload URL returned for ${i.mediaName}`);
    let res = await fetch(u, { method: "PUT", headers: { "Content-Type": i.contentType }, body: readFileSync(i.localPath) });
    if (!res.ok) res = await fetch(u, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: readFileSync(i.localPath) });
    if (!res.ok) throw new CliError(`Upload failed for ${i.mediaName}: ${res.status} ${await res.text()}`);
    console.error(`  uploaded ${i.mediaName} (${(i.fileSize / 1024).toFixed(0)} KB)`);
  }
}

function resolvePath(p) { return isAbsolute(p) ? p : resolve(process.cwd(), p); }
function pad(value, width) { const s = String(value ?? ""); return s.length >= width ? `${s} ` : s.padEnd(width); }
function fmtDuration(seconds) {
  if (typeof seconds !== "number") return "";
  const m = Math.floor(seconds / 60); const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = error.exitCode ?? EXIT.ERROR;
});
