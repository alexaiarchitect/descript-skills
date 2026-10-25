# Changelog

## 0.2.0 — 2026-10-25

- Renamed plugin and skill to `descript-api` (`skills/descript-api/`, install `descript-api@descript-skills`) so it can
  sit next to Descript's official MCP plugin (`descript@descript`).
- `descript.mjs`: new `library-upload` (Media Library import via `POST /jobs/import/drive_media`, `--folder-id root|UUID`)
  and `published <slug>`; `jobs --type` accepts `import/project_media|import/drive_media|agent|publish` and shows
  `stopped_at`/`error_code`; `search` adds `--sort`, `--owner`, `--updated-after/--updated-before` and prints location,
  duration and `moment` timestamps; `projects` adds created/updated date filters; `publish` hints on 422 (audio-only)
  and prints the result `media_type`; `models` prints alias descriptions; API errors show the `{error}` code; shared
  upload helper for both import paths; MIME types for AVIF/MKV/AVI/MPEG-TS/MXF/Opus.
- `references/api.md` refreshed for OpenAPI v1.2 (new endpoints, job fields, error codes, media URL rules, models,
  CLI 0.12.0 / next 0.14.0, 2026 changelog links). New `references/mcp.md` (official MCP server: OAuth, tools,
  `export_timeline`, install, MCP vs scripts).
- Prompt guidance from Descript's 2026 articles (end-state prompts, no follow-up questions on API runs, explicit
  `--conversation`, Underlord v2 self-review is not verification, credit caps); HARD RULES in both templates and in
  `plan-slides.mjs --prompt-out` now exclude generated music/SFX and layout changes. Placement record gains an optional
  `timeline_export` field.

## 0.1.0 — 2026-10-26

First publishable version.

- `descript.mjs`: zero-dependency client for the Descript REST API v1 (status, projects, project/media listing, URL
  resolution, direct-upload media import with collision checks, transcript export, gated Underlord agent runs with
  `--dry-run`/`--yes`/`--out`, gated publish, jobs/cancel, models, search). Token from env, `.env`,
  `~/.config/descript/.env`, or the official CLI config.
- `render-deck.mjs`: HTML deck → PNG per slide via headless Chrome, with `manifest.json` (titles, on-screen text, notes).
- `plan-slides.mjs`: matches each slide's title/on-screen text/notes against an SRT transcript to propose IN/OUT points,
  writes a reviewable plan (Markdown + JSON) and generates the Underlord prompt (`split-fill` or `overlay` mode).
- References: condensed API/CLI/MCP reference, Underlord prompt templates with lessons from production runs, a worked
  example (12-scene split + placeholder fill, `claude-opus-5.5`, ~24 credits), placement-record template.
