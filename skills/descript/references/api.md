# Descript public API — condensed reference (verified 2026-10-25)

Docs: https://help.descript.com/developers (old docs.descriptapi.com redirects here). OpenAPI: https://help.descript.com/developers/openapi.json
Base URL `https://descriptapi.com/v1`. Auth `Authorization: Bearer <token>`; tokens are personal and scoped to one Drive.
Rate limits: 429 with `Retry-After` (seconds), `X-RateLimit-Remaining`, `X-RateLimit-Consumed`.

| Method | Path | Purpose / key fields |
|---|---|---|
| GET | `/status` | `{drive_id, drive_name, api_version}` — token check |
| GET | `/projects` | query `name` (substring), `folder_path`, `created_by=me`, `sort=name|created_at|updated_at|last_viewed_at`, `direction`, `cursor`, `limit≤100` → `{data[{id,name,created_at,updated_at,folder_path?}], pagination.next_cursor}` |
| GET | `/projects/{id}` | `{id,name,drive_id,drive_name,created_at,updated_at,media_files{ "<path/name>": {type: audio|video|image|sequence|other, duration?} }, compositions[{id,name,duration?,media_type?}], publishes[{share_url,composition_id,access_level,media_type,published_at,updated_at,name}]}` |
| GET | `/search` | `query` (req), `type` (project|video|image|audio|project_folder|media_library_folder|layout_pack, repeatable), `match` (name|content|visual), `sort`, `limit≤100` → `{results[]}` |
| POST | `/jobs/import/project_media` | body: `project_id` (existing) **or** `project_name` (+`team_access`, `folder_name`, `workspace_name`); `add_media{ "<name>": {url,language?} \| {content_type,file_size,language?} \| {tracks[{media,offset}]} }`; `add_compositions[{name,width=1920,height=1080,clips[{media,mute?}]}]`; `callback_url` → 201 `{job_id,drive_id,project_id,project_url,upload_urls{ "<name>": {upload_url,asset_id,artifact_id} }}`. PUT raw bytes to each `upload_url` (3 h expiry; docs say `Content-Type: application/octet-stream`, file MIME also works). 402 = no media minutes. |
| POST | `/jobs/agent` | body: `prompt` (req), `project_id` **or** `project_name`, `composition_id` (UUID \| 5-char short ID \| full web URL), `model` (`auto` default; see `/agent/models`), `conversation_id` (continue), `team_access` (new projects), `callback_url` → 201 `{job_id,project_id,project_url,conversation_id,resolved_model}`. 402 = insufficient AI credits, 403 = agent disabled by admin. |
| GET | `/agent/models` | `{availableModels[{id,cost low|medium|high}], aliases[{id,resolvesTo,cost}]}` — 2026-10: auto(medium), claude-fable-5.1/opus-5.5(high), claude-sonnet-5.5(medium), claude-haiku-5.5(low), gpt-*, gemini-* |
| POST | `/jobs/publish` | `project_id` (req), `composition_id`, `media_type Video|Audio`, `resolution 480p..4K`, `access_level public|unlisted|drive|private`, `callback_url` → job; result `{share_url, download_url, download_url_expires_at}`. Same (project, composition, media_type) republish reuses the share URL. |
| POST | `/export/transcript` | `project_id` (req), `format txt|markdown|html|rtf|docx|srt` (req), `composition_id`, `include_speaker_labels off|changes|every_paragraph`, `include_markers`, `timecodes{frequency_seconds,on_paragraphs,on_speakers,on_markers,offset_seconds}` → raw file (header `X-Composition-Id`) |
| GET | `/jobs` | `project_id`, `type=import/project_media|agent`, `cursor`, `limit`, `created_after/before` (default 7 days, max 30) |
| GET | `/jobs/{id}` | `{job_id,job_type,job_state queued|running|stopped|cancelled,progress{label,percent},result}`. Import result: `status success|partial|error, media_status{name:{status,duration_seconds|error_message}}, media_seconds_used, created_compositions[{id,name}]`. Agent result: `status, agent_response, project_changed, ai_credits_used, media_seconds_used, conversation_id, resolved_model, error_message`. Publish result: `composition_id, share_url, download_url, download_url_expires_at`. |
| DELETE | `/jobs/{id}` | cancel (204) |

Not available via REST: reading/editing the timeline, listing voices, folder tree (MCP only), local export (publish → download_url instead), YouTube URL imports.

## Observed behaviour (from production runs)
- Re-uploading a basename that already exists anywhere in the project yields `name-N.ext` in `media_files` — folder prefix does not prevent it. Use unique basenames.
- Each image import ≈ 1 media second; a 20 s MP4 ≈ 20–28 s.
- Agent runs: building an 8–10 slide lesson from scratch used 50–132 AI credits; splitting an existing 14-min recording into 12 scenes and filling placeholders with `claude-opus-5.5` used 23.5. A failed (402) run can leave partial edits.
- The composition short ID is the first 5 hex chars of the composition UUID; `https://web.descript.com/<project>/<short>` opens it.

## Official CLI (`@descript/platform-cli` 0.12.0, Node ≥ 24)
`descript-api config set api-key | config validate | list-projects | get-project [--json] <id> | list-folders | import -p <id> -m <urls or local files...> [--no-composition] [--language en] | agent -p <id> -c <comp> --prompt "…" [--model] [--conversation-id] [--no-wait] | job-status <id> | list-jobs | job-cancel <id> | publish -p <id> -c <comp> -r 1080p --access-level unlisted | export-transcript -p <id> -c <comp> -f markdown|txt|html|rtf|docx [--timecodes --markers] -o file | update`
Config lives in `~/.descript-cli/config.json` (profiles). The CLI cannot choose the media folder/name on import; use `scripts/descript.mjs upload` for that.

## Descript MCP (optional)
`claude mcp add --transport http descript https://api.descript.com/v2/mcp -s user`, then `/mcp` to sign in (OAuth, one Drive per connection). Adds folder management and project browsing; still no timeline read.
