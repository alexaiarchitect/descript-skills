# Placement record template

Save as `records/<project-slug>/<composition>-final-state.md` (+ `.json` with the same table). This is the source a
future Underlord prompt is generated from, so capture exactly what the finished composition looks like. Keep `records/`
out of public repos — it holds the user's project IDs and transcripts.

```markdown
# <Composition name> — <project name> (final state after slide placement)
- Project: <uuid> · Composition: <uuid> (short <xxxxx>) · URL: https://web.descript.com/<project>/<short>
- Canvas: 1920x1080 · Duration: mm:ss.s · Verified: <date> (how: Descript scene grid in Chrome / transcript markers)
- Media folder: <Folder>/ · Import job: <job id> (<media seconds>)
- Agent job: <job id> · model <id> · <credits> AI credits · conversation <uuid> · prompt: <file> · raw result: <file>
- Backup composition: <name/uuid> (pre-edit state)
- Timeline export (optional, MCP `export_timeline`): <format edl|sesx|fcp|premiere|davinci_resolve|aaf> · <file>

## Layout conventions observed
- Layout type per scene (e.g. Descript "Screen": slide in placeholder, camera PiP bottom-right 287x287 rounded)
- Scenes contiguous or camera-only gaps · transitions · captions on/off · markers/chapters

## Timeline
| # | Media name | In | Out | Layout | Cue phrase (transcript) |
|---|---|---|---|---|---|
| 1 | <Folder>/slide-01-intro.png | 00:00.0 | 00:39.0 | Screen + cam PiP | "Welcome to lesson four…" |

## Open items
- splits to re-check, scenes to re-split, not yet published, …
```

JSON shape (same as `plan-slides.mjs --json`, so a reviewed plan can be promoted to the record; `timeline_export` is
optional and only present when the record was cross-checked against an MCP `export_timeline` file):
```json
{ "project_id": "...", "composition_id": "...", "composition_name": "...", "canvas": [1920, 1080], "duration": 865.9,
  "media_folder": "Lesson04", "layout": "Screen: slide in placeholder, camera PiP bottom-right",
  "clips": [ { "index": 1, "media": "Lesson04/slide-01-intro.png", "in": 0.0, "out": 39.0, "cue": "Welcome to lesson four" } ],
  "jobs": { "import": "...", "agent": "...", "conversation_id": "...", "ai_credits_used": 23.5 },
  "timeline_export": { "format": "fcp", "file": "Lesson04-timeline.fcpxml" } }
```
