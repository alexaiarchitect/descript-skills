# Descript public API — condensed reference (OpenAPI v1.2, verified 2026-10-29)

Docs: https://help.descript.com/developers (old docs.descriptapi.com redirects here). OpenAPI: https://help.descript.com/developers/openapi.json
Base URL `https://descriptapi.com/v1`. Auth `Authorization: Bearer <token>`; tokens are personal and scoped to one Drive.
Rate limits: 429 with `Retry-After` (seconds), `X-RateLimit-Remaining`, `X-RateLimit-Consumed`.

| Method | Path | Purpose / key fields |
|---|---|---|
| GET | `/status` | `{drive_id, drive_name, api_version}` — token check |
| GET | `/projects` | query `name` (substring), `folder_path`, `created_by=me`, `created_after/before`, `updated_after/before` (ISO 8601), `sort=name|created_at|updated_at|last_viewed_at` (default `created_at`), `direction`, `cursor`, `limit≤100` (default 20) → `{data[{id,name,created_at,updated_at,folder_path?}], pagination.next_cursor}` |
| GET | `/projects/{id}` | `{id,name,drive_id,created_at,updated_at,media_files{ "<path/name>": {type: audio|video|image|sequence|other, duration?} }, compositions[{id,name,duration?,media_type?}], publishes[{share_url,composition_id,access_level public|unlisted|drive|private|password,media_type video|audio|audiogram,published_at,updated_at,name}]}` (no `drive_name`) |
| GET | `/search` | `query` (req), `type` (project|video|image|audio|project_folder|media_library_folder|layout_pack, repeatable), `match` (name|content|visual), `owner[]` (user UUIDs), `updated_after/before`, `sort=relevance|newest|oldest`, `limit≤100` → `results[{type,name,url,owner,updated_at,project_id?,asset_id?,folder_id?,location media_library|project|brand_studio,thumbnail_url?,duration?,moment{start_time_sec,end_time_sec}?}]`. `moment` (content matches) = where the phrase occurs in the recording. |
| POST | `/jobs/import/project_media` | body: `project_id` (existing) **or** `project_name` (+`team_access edit|comment|view|none`, `folder_name` (nested `a/b` allowed), `workspace_name`); `add_media{ "<name>": {url,language?} \| {content_type,file_size,language?} \| {tracks[{media,offset}]} }`; `add_compositions[{name,width=1920,height=1080,fps (WIP, ignored),clips[{media,mute?}]}]`; `callback_url` → 201 `{job_id,drive_id,project_id,project_url,upload_urls{ "<name>": {upload_url,asset_id,artifact_id} }}`. PUT raw bytes to each `upload_url` (3 h expiry; docs say `Content-Type: application/octet-stream`, file MIME also works). 402 = no media minutes. |
| POST | `/jobs/import/drive_media` | Media Library import (not a project). body: `folder_id` (Media Library folder UUID or `root`), `add_media{ "<basename>": {url,language?} \| {content_type,file_size,language?} }` (plain names, no folder prefix), `callback_url` → 201 `{job_id, upload_urls{name:{upload_url,asset_id}}}`; same PUT flow. Job carries `folder_id`, `drive_id` at top level; result `status success|error`, `media_status{name:{status,duration_seconds}}`, `media_seconds_used`. No REST delete. |
| POST | `/jobs/agent` | body: `prompt` (req), `project_id` **or** `project_name`, `composition_id` (UUID \| 5-char short ID \| full web URL), `model` (`auto` default; id or family alias, e.g. `claude-opus` → `claude-opus-5.5`), `conversation_id` (continue), `team_access` (new projects), `callback_url` → 201 `{job_id,project_id,project_url,conversation_id,resolved_model}`. 402 = insufficient AI credits, 403 = agent disabled by admin. |
| GET | `/agent/models` | `{availableModels[{id,cost low|medium|high}], aliases[{id,resolvesTo,cost,description}]}` — see "Models" |
| POST | `/jobs/publish` | `project_id` (req), `composition_id`, `media_type Video|Audio`, `resolution 480p..4K`, `access_level public|unlisted|drive|private`, `callback_url` → job; result `{share_url, download_url, download_url_expires_at, media_type}`. **422** = Video requested on an audio-only composition. Same (project, composition, media_type) republish reuses the share URL. |
| GET | `/published_projects/{slug}` | slug = last segment of the share URL → `download_url`, expiry, `publish_type`, privacy, metadata |
| POST | `/edit_in_descript/schema` | Partner-only "Edit in Descript" import schema; not usable with a personal token. |
| POST | `/export/transcript` | `project_id` (req), `format txt|markdown|html|rtf|docx|srt` (req), `composition_id`, `include_speaker_labels off|changes|every_paragraph`, `include_markers`, `timecodes{frequency_seconds,on_paragraphs,on_speakers,on_markers,offset_seconds}` → raw file (header `X-Composition-Id`). Subtitle exports carry word-level timestamps. |
| GET | `/jobs` | `project_id`, `type=import/project_media|import/drive_media|agent|publish`, `cursor`, `limit`, `created_after/before` (default 7 days, max 30) |
| GET | `/jobs/{id}` | job object (below). Import result: `status success|partial|error, media_status{name:{status,duration_seconds|error_message}}, media_seconds_used, created_compositions[{id,name}]`. Agent result: `status, agent_response, project_changed, ai_credits_used, media_seconds_used, conversation_id, resolved_model, error_message`. Publish result: `composition_id, share_url, download_url, download_url_expires_at, media_type`. |
| DELETE | `/jobs/{id}` | cancel (204) |

Not available via REST: reading/editing the timeline, timeline export (MCP `export_timeline` only, see `mcp.md`), listing voices, folder tree (MCP only), local export (publish → download_url instead), YouTube URL imports.

## Job object fields
`job_id, job_type, job_state queued|running|stopped|cancelled, created_at, stopped_at?, drive_id?, folder_id? (drive_media), progress{label,percent,last_update_at}, result{…, error_code?}`. `callback_url` receives a POST with the same payload as `GET /jobs/{id}`; it is unsigned, so treat it as a hint and re-fetch the job.

## Error codes
Body `{error, message}`: `invalid_input` 400 · `payment_required` 402 · `forbidden` 403 · `not_found` 404 · `unprocessable_entity` 422 · `rate_limit_exceeded` 429. `descript.mjs` prints `<code>: <message>`.

## Media URL rules
URL imports must support HTTP Range requests; signed URLs must stay valid 12–48 h (import can be queued). Formats added in 2026: MXF, MPEG-TS, AVI, MKV, AVIF, Opus, WebM.

## Models (live `/agent/models`, 2026-10-29)
auto (medium) · claude-fable-5.1 (high) · claude-opus-5.5 (high) · claude-sonnet-5.5 (medium) · claude-haiku-5.5 (low) · gpt-6-astra (high) · gpt-6-astra-pro (high) · gpt-6.1-sol (medium) · gpt-6-luna (low) · gemini-4-argon (high) · gemini-3.8-flash (medium). Aliases: claude-fable, claude-opus, claude-sonnet, claude-haiku, gpt, gemini-flash. Enterprise drives default to claude-opus-5.5.

## Observed behaviour (from production runs)
- Re-uploading a basename that already exists anywhere in the project yields `name-N.ext` in `media_files` — folder prefix does not prevent it. Use unique basenames.
- Each image import ≈ 1 media second; a 20 s MP4 ≈ 20–28 s.
- Import status enums differ: Media Library (`drive_media`) `success|error`; project import per-file `success|failed` (job `success|partial|error`).
- Agent runs: building an 8–10 slide lesson from scratch used 50–132 AI credits; splitting an existing 14-min recording into 12 scenes and filling placeholders with `claude-opus-5.5` used 23.5. A failed (402) run can leave partial edits.
- The composition short ID is the first 5 hex chars of the composition UUID; `https://web.descript.com/<project>/<short>` opens it.

## Official CLI (`@descript/platform-cli` latest 0.12.0, `next` 0.14.0, Node ≥ 24)
`descript-api config set api-key | config validate | list-projects | get-project [--json] <id> | list-folders | import -p <id> -m <urls or local files...> [--no-composition] [--language en] | agent -p <id> -c <comp> --prompt "…" [--model] [--conversation-id] [--no-wait] | job-status <id> | list-jobs | job-cancel <id> | publish -p <id> -c <comp> -r 1080p --access-level unlisted | export-transcript -p <id> -c <comp> -f markdown|txt|html|rtf|docx [--timecodes --markers] -o file | update`
0.14.0 (`npm i -g @descript/platform-cli@next`) adds `edit --new --prompt "…"` (create a project and run the agent in one step).
Config lives in `~/.descript-cli/config.json` (profiles). The CLI cannot choose the media folder/name on import; use `scripts/descript.mjs upload` for that.

## Descript MCP
Official server + Claude Code plugin, OAuth, adds `export_timeline` and folder tools — see `references/mcp.md`.

## Changelog highlights 2026 (Descript's own posts; index https://descript.canny.io/changelog)
- 2026-01-06 Underlord v2: better planning/self-correction, ~20% fewer credits per full edit — https://descript.canny.io/changelog/announcingunderlord-v2
- 2026-03-17 Scene-level generation and layout actions; Underlord links to compositions/markers/scenes/timestamps — https://descript.canny.io/changelog/release-roundupmarch-17th-2026
- 2026-04-16 API beta open to all users (tokens) + MCP; resumable uploads — https://descript.canny.io/changelog/release-roundupapril-16th-2026
- 2026-05-14 Direct uploads, publish, project search, folders, composition targeting; Underlord runs an automatic review pass after every editing turn; MKV/AVIF/Opus/AAC/WebM imports — https://descript.canny.io/changelog/the-descript-telethon-begins-but-first-releases
- 2026-06-11 CLI 0.11 (`export-transcript`, `list-folders`, `list-projects`); MCP listed in the Claude and ChatGPT directories; subtitle exports with word-level timestamps — https://descript.canny.io/changelog/release-round-upjune-11th-2026
- 2026-06-23 Blog "Don't ship your API as an MCP": one agentic endpoint by design; API runs never ask follow-ups; describe the end state with exact specs — https://www.descript.com/blog/article/dont-ship-your-api-as-an-mcp
- 2026-08-05 Claude Fable 5 / Sonnet 5 added; per-turn thinking ceiling raised 100 → 200 credits — https://descript.canny.io/changelog/release-round-upaugust-5th-2026
- 2026-09-17 Zapier parity with the API; Underlord music/SFX generation; jump-cut smoothing 0.5 credits/s audio, 1.0/s video; faster AAF/SESX export — https://descript.canny.io/changelog/release-roundupseptember-17-2026
- 2026-10-12 Search API/MCP return direct links + thumbnails; Underlord finds layout packs; Gemini 3.8 Flash; Enterprise default model Claude Opus 5.5 — https://descript.canny.io/changelog/release-roundupoctober-12-2026
- Billing: credit cost depends on model and amount of work; Studio Sound / filler-word removal capped at 30 credits per file; credits do not roll over — https://help.descript.com/billing-payments-plans/track-and-understand-your-media-minutes-and-ai-credits
- MCP server + Claude Code plugin (`export_timeline`) — https://github.com/descriptinc/descript-mcp
