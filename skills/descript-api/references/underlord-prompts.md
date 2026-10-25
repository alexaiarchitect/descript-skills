# Underlord (agent) prompt patterns

Underlord is powerful but non-deterministic. Give it: exact IDs, exact media names, an ordered mapping with timestamps,
explicit "do not" rules, and ask for a structured report. Run `--dry-run` first; confirm credits with the user; `--wait`.

`scripts/plan-slides.mjs --prompt-out` generates both templates below from a reviewed placement plan. Edit the generated
file only when the composition differs from the assumptions (layout, folder, extra rules).

## Template A: split an existing placeholder-layout scene and fill the placeholders (`--mode split-fill`)

Use when the recording already uses a Descript layout with an empty media placeholder (e.g. "Screen": screen placeholder
+ camera picture-in-picture). Proven on a 14-minute lesson (12 scenes, `claude-opus-5.5`, ~24 credits, success first try).
Full worked example with the exact prompt and the agent's report: `references/examples/split-fill-screen-layout.md`.

Structure that worked:
1. **Scope line** — edit ONLY composition <name> (<uuid>) in project <uuid>; no other compositions; no media import/rename/delete.
2. **CURRENT STATE** — one scene, which layout, where the media already lives (`<Folder>/`).
3. **TASK** — (a) split into N contiguous scenes at the listed timecodes, last scene to the end; (b) keep the SAME layout on
   every scene, no layout/template change, no new layers; (c) fill each placeholder with the named image (fit, no crop, static).
4. **Table** — scene #, start, end, exact media name, plus the spoken cue at each start so the agent can check the transcript.
5. **HARD RULES** — keep audio/words/cuts/captions/runtime; no transitions, spacers, black frames, gaps, music, titles;
   no generated music, sound effects, or layout changes (no layout packs);
   every split on a word boundary (sentence end preferred, ±1 s allowed) and **report the final split times**; use only the
   listed names, leave empty + report rather than substitute; do not touch other folders.
6. **REPORT BACK** — table of final scene timings + placed media + per-scene layout/camera confirmation + anything not done.

## Template B: overlay slides on a plain camera recording (`--mode overlay`)

```
Edit ONLY composition "<NAME>" (id <UUID>) in project <PROJECT_UUID>. Do not create or modify other compositions.
The composition is a finished <mm:ss> talking-head recording with narration. Keep all existing audio, cuts, and
captions exactly as they are. Do not change runtime, do not remove or add speech, do not add silence, spacer scenes,
black frames, transitions, or stock media.

Add these project media images as full-frame visual layers over the recording, each shown from IN to OUT:
1. <Folder>/slide-01-intro.png   in 00:00.0  out 00:40.0   (cue: "Welcome to lesson four")
2. ...
Rules:
- Slides fill the 16:9 canvas edge to edge (no letterboxing); keep the speaker visible as a picture-in-picture in the
  bottom-right corner, about 25% width  |  or: hide the camera while a slide is visible.
- Place IN/OUT points on word boundaries in the transcript; never overlap two slides.
- Between slides, show the camera recording as-is.
- Do not rename, duplicate, or re-import media. Use only the names listed above.
- No generated music, sound effects, or layout changes: do not generate or add music or SFX, and do not search for or
  apply layout packs.
Return a summary table: slide name, final in/out timecodes, layout used, and anything you could not do.
```

## Template C: build a slide lesson from scratch with an AI voice (legacy pattern)

Rules that avoided past failures:
- "Use the existing Descript AI voice named <Voice> for all narration; keep it continuous and consistent."
- "Do not add gap clips, spacer scenes, black screens, inserted silence, or artificial pauses."
- "Script labels Slide N map to media <folder>/slide-NN-*.png; keep that visual visible across consecutive blocks."
- "Use video assets as muted visual-only footage; prefer freeze-frame fill on readable frames; loop only to avoid black frames."
- "Treat timestamp labels, Markdown fences, and command blocks as editorial markup; do not narrate them."
- "Do not show local file paths or repository names in on-screen text."
- "Return a concise summary of what changed and any manual review items."

## Descript's own guidance (2026)
- Describe the **end state**, with exact specs: fonts, hex colours, positions, durations, canvas size, media names.
- API agent runs never ask follow-up questions; they assume and finish. Resolve every ambiguity in the prompt.
- MCP `prompt_project_agent` continues the conversation by default; the API continues only with `conversation_id`
  (`--conversation <uuid>`). Without it every job starts fresh.
- Underlord v2 runs an automatic review pass after every turn. That is not verification — still run the checklist below.
- Underlord can generate music and sound effects and look up layout packs. In "keep as is" prompts exclude them
  explicitly (the HARD RULES of both templates and of `plan-slides.mjs --prompt-out` do).
- Thinking is capped at 200 AI credits per turn; jump-cut smoothing costs 0.5 credits/s of audio, 1.0/s of video.

## Follow-ups
Reuse `--conversation <uuid>` from the previous job so Underlord sees the earlier turns ("move the split between scenes 4
and 5 to 02:43.0", "split scene 12 at 12:27 and leave the new scene's placeholder empty"). Each turn is a separate
billable job; name exact scenes and times.

## Lessons from production runs
- The agent follows the requested times literally. If you want word-boundary snapping you must ask for it AND ask for the
  final times back; even then, verify in Descript — in one run it reported "did not re-verify word boundaries".
- Ask for per-scene confirmation; a report that only checked scenes 1 and 12 is otherwise indistinguishable from a full check.
- Give the spoken cue at each timecode. It costs nothing and lets the agent catch an off-by-one in your plan.
- Unique basenames + a fresh folder per composition avoid `-N` suffix confusion in the prompt.

## Review checklist after any agent job
runtime unchanged (or as requested) · scene count · no spacer/black scenes · slide order and in/out points · splits not
mid-word · camera PiP present and unchanged in every scene · captions intact · no duplicated narration · media names
resolved (no `-N` suffix confusion) · job id, model, credits, conversation id recorded.
