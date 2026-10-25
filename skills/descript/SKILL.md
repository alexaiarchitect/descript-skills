---
name: descript
description: Manage Descript projects and compositions through the public REST API — list projects/compositions, resolve a web.descript.com URL to IDs, render an HTML slide deck to PNG slides, upload slides/media into a project folder, export transcripts with timecodes, plan slide placement against the narration, run gated Underlord (AI agent) edits, publish share links, and track jobs/credits. Use for any request mentioning Descript, Underlord, a Descript composition or project URL, "add slides/media to Descript", Descript transcript export, or Descript publishing.
---

# Descript skill

Zero-dependency Node scripts (Node ≥ 20; 24 recommended) that talk to `https://descriptapi.com/v1`.

Scripts live in `scripts/` next to this file:

| Installed as | Script path prefix |
|---|---|
| plugin | `${CLAUDE_PLUGIN_ROOT}/skills/descript/scripts/` |
| symlink / copy in `~/.claude/skills/descript` | `~/.claude/skills/descript/scripts/` |

If `${CLAUDE_PLUGIN_ROOT}` appears unexpanded, use the second form. Below, `$S` stands for that prefix.

- `descript.mjs` — API client (projects, media upload, transcript, agent, publish, jobs)
- `render-deck.mjs` — HTML deck → one 1920x1080 PNG per slide + `manifest.json`
- `plan-slides.mjs` — manifest + SRT → placement plan (IN/OUT per slide) + ready-to-send Underlord prompt

## 1. Setup check (run first, every session)

```bash
node $S/descript.mjs status        # → "API v1 · drive: <name>"
```
Token sources, in order: `DESCRIPT_TOKEN` env → `DESCRIPT_ENV_FILE` → nearest `.env` (cwd upward, then the plugin root)
→ `~/.config/descript/.env` → `~/.descript-cli/config.json`. Tokens come from Descript → Settings → API.
Never print, paste, or commit the token. On 401, ask the user to refresh it.
Optional extras: official CLI `descript-api` (`npm i -g @descript/platform-cli@latest`, Node 24) and the Descript MCP
(`claude mcp add --transport http descript https://api.descript.com/v2/mcp -s user`) — see `references/api.md`.

## 2. Core workflow: slides onto a recorded lesson

1. **Resolve the target.** `node $S/descript.mjs resolve "https://web.descript.com/<project-uuid>/<5-char>" --json`
   → project id/name, composition UUID/name/duration. Keep the JSON; later steps need the IDs.
2. **Inspect before writing.** `project <project-id> --media --folder <Folder>` shows what already lives in a media
   folder. Any basename that already exists anywhere in the project gets a `-N` suffix on re-upload — pick unique names
   and a fresh folder named after the composition.
3. **Render slides** (HTML deck): `node $S/render-deck.mjs deck.html --out output/<Comp> [--slides 1,3-5]`
   → `slide-NN-<slug>.png` + `manifest.json` (titles, on-screen text, speaker notes when the deck embeds `SCRIPT=[…]`).
   Open 2–3 PNGs with the Read tool and check fonts/clipping before uploading.
4. **Upload.** `upload --project <id> --folder <Comp> output/<Comp>/slide-*.png` (show the file list to the user first;
   `--dry-run` prints the payload). Direct-upload flow, waits for the import job, verifies live names. Images ≈ 1 media
   second each.
5. **Export narration timing.** `transcript --project <id> --composition <ref> --format srt --out records/<proj>/<comp>.srt`
   (a `--format markdown --timecodes 30 --markers` copy is handy for humans).
6. **Plan placement.** `node $S/plan-slides.mjs --manifest output/<Comp>/manifest.json --srt <file>.srt --folder <Comp>
   --project <uuid> --composition <uuid> --composition-name <name> --duration <sec> --out plan.md --json plan.json`
   It finds, in order, the earliest sentence whose words match each slide's title / on-screen text / notes and proposes
   IN/OUT points. **Review every row against the transcript**: fix rows marked `SET MANUALLY` or `weak match` with
   `--pin N=mm:ss`, nudge any IN that landed in the previous section, then re-run with `--prompt-out prompt.md`
   (`--mode split-fill` for a composition that already uses a Screen/placeholder layout, `--mode overlay` to add
   full-frame slide layers over the camera). Show the plan table to the user before spending credits.
7. **Place** — either the user does it in Descript, or run Underlord:
   `agent --project <id> --composition <ref> --prompt-file prompt.md --model claude-opus-5.5 --dry-run`, then after the
   user confirms the cost, the same command with `--wait --yes --out records/<proj>/<comp>-agent-job.json`.
   Prompt patterns and the review checklist: `references/underlord-prompts.md`.
8. **Verify.** `resolve` again (duration unchanged?), re-export the transcript with `--markers`, and open the composition
   in Chrome (Claude in Chrome) in the scene/grid view to confirm scene count, slide order, and the camera inset.
   Underlord's own report is not proof: it may not re-check word boundaries or every scene.
9. **Record.** Write `records/<project-slug>/<composition>-final-state.md` + `.json` (template:
   `references/placement-record.md`) with job IDs, credits, media names, and the timeline. Job history expires after 30 days.

Other tasks map onto the same commands: `projects`/`project` to browse, `transcript` alone for exports, `publish` for
share links, `jobs`/`job`/`cancel` for monitoring, `search` to find media by name.

## 3. Cost and safety gates

- `upload` of audio/video consumes **media minutes** (images ≈ 1 s each). Always show the file list first.
- `agent` consumes **AI credits**. Observed: 12-scene split + placeholder fill on an existing recording with
  `claude-opus-5.5` ≈ 24 credits; legacy build-a-lesson-from-scratch runs 50–130. Requires `--yes`; confirm with the user
  every time, quoting model and composition. One comprehensive prompt beats several small ones; follow-ups reuse
  `--conversation <uuid>`. A 402 mid-run leaves the composition half-edited — inspect before re-running.
- `publish` creates an outward-facing share link; requires `--yes`. Default to `--access unlisted`.
- Never run an agent edit while another job on the same composition is `running` (`jobs --project <id>`).
- Before the first agent edit of a valuable composition, ask the user to duplicate it in Descript as a backup.
- Never commit `.env`, tokens, signed upload URLs, or the user's recordings/transcripts to a public repo.

## 4. Naming rules

- One media folder per composition, named after it (`Lesson04/`). Never reuse a folder that already holds the same basenames.
- Slides: `slide-NN-<slug>.png` (render-deck does this). Videos: `<Comp>-<purpose>.mp4` via `--name-map src=dst`.
- Composition refs accept UUID, 5-char short ID (first 5 hex chars of the UUID), exact name, or the web URL.

## 5. Known limits (verified 2026-10-26)

- No REST endpoint reads or edits the timeline deterministically; placement = Underlord prompt or manual work.
  To document a timeline, combine transcript export (`--markers`) with Claude in Chrome on the web.descript.com URL.
- Underlord is non-deterministic: it may compress runtime, loop/freeze short videos, insert spacer scenes, cut mid-word,
  or skip verification it was asked for. State explicit rules in the prompt and verify in Descript before publishing.
- `GET /jobs` keeps 30 days; `callback_url` exists on import/agent/publish if polling is undesirable.
- Rate limits: honour `Retry-After` on 429 (the script retries 3×).
- `render-deck.mjs` needs a local Chrome/Chromium/Edge (`--chrome <path>` or `CHROME_PATH`); Google Fonts load over the network.

## 6. Command cheat-sheet

```bash
D="node $S/descript.mjs"
$D status
$D projects --name "Prep"
$D project <project-id>                      # compositions + media folder summary
$D project <project-id> --media --folder Lesson04
$D resolve "https://web.descript.com/<project>/<short>" --json
$D upload --project <id> --folder Lesson04 output/Lesson04/slide-*.png [--dry-run] [--json]
$D transcript --project <id> --composition <short|name> --format srt --out file.srt
$D jobs --project <id>          |  $D job <job-id> --wait   |  $D cancel <job-id>
$D models                        |  $D search --query "slide-04" --type image
$D agent --project <id> --composition <ref> --prompt-file prompt.md --model claude-opus-5.5 --dry-run
$D agent --project <id> --composition <ref> --prompt-file prompt.md --model claude-opus-5.5 --wait --yes --out job.json
$D publish --project <id> --composition <ref> --resolution 1080p --access unlisted --wait --yes
node $S/render-deck.mjs deck.html --out output/<Comp> --width 1920 --height 1080
node $S/plan-slides.mjs --manifest output/<Comp>/manifest.json --srt file.srt --folder <Comp> --out plan.md --json plan.json
node $S/plan-slides.mjs ... --pin 12=11:45 --prompt-out prompt.md --mode split-fill
```
