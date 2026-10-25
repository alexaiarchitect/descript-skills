# Changelog

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
