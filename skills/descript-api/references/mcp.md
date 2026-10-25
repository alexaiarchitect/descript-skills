# Descript MCP server — reference (verified 2026-10-29)

Source: https://github.com/descriptinc/descript-mcp (official Claude Code plugin, plugin name `descript`, 5 bundled skills).
This skill (`descript-api`) does not install or wrap it; both can be installed side by side because the names differ.

## Install (official plugin — preferred over a hand-added server)
```
/plugin marketplace add descriptinc/descript-mcp
/plugin install descript@descript
```
The plugin registers the MCP server itself. Its README warns against also adding a second Descript MCP server by hand
(`claude mcp add … descript …`): duplicate servers expose every tool twice and split the OAuth session.

## Auth
OAuth with PKCE via `auth.descript.com`; sign in from `/mcp`. One Drive per connection. Connections are listed and
revoked in the Descript app under Settings → Descript MCP. No API token is involved (the REST token is separate).

## Tools
| Tool | Purpose |
|---|---|
| `search_drive` | Search projects/media/folders (same engine as `GET /search`) |
| `list_projects`, `get_project` | Browse projects, compositions, media |
| `list_folders`, `get_drive_info` | Folder tree and Drive metadata (no REST equivalent for the tree) |
| `import_media`, `import_drive_media` | Import into a project / into the Media Library |
| `file_upload_ui`, `report_upload_status` | Upload widget for local files and its status callback |
| `prompt_project_agent` | Underlord edit; continues the previous conversation by default |
| `publish_project` | Share link + download URL |
| `export_transcript` | Same formats as `POST /export/transcript` |
| `export_timeline` | Async timeline export: `edl`, `sesx`, `fcp`, `premiere`, `davinci_resolve`, `aaf` → `download_url` |
| `wait_for_job`, `list_jobs`, `cancel_job` | Job control |

`export_timeline` is the only route to Premiere / DaVinci Resolve / Final Cut / EDL / AAF / Audition — there is no REST
endpoint for it. Use it to document a finished timeline (see `placement-record.md`, field `timeline_export`).

## Still not possible (MCP or REST)
- Reading timeline or layout contents as structured data (scenes, layers, placeholder fills) — export files only.
- DOCX export of anything but transcripts; media export without publishing (publish → `download_url`).

## MCP vs this skill
- Prefer **MCP** for interactive work in a session: folder browsing, the upload widget, timeline export, quick agent
  turns where conversation continuity is wanted.
- Prefer **`descript-api` scripts** for repeatable, gated automation: deck → PNG rendering, collision-checked uploads into
  a named folder, SRT-based placement planning, generated Underlord prompts, `--dry-run`/`--yes` cost gates, saved job
  records. API agent runs continue a conversation only with an explicit `--conversation <uuid>`.
