# descript-skills

A Claude Code plugin with one skill, **`descript`**, that lets Claude manage [Descript](https://www.descript.com) projects
and compositions through the public REST API:

- list projects and compositions, resolve a `web.descript.com` URL to IDs
- render an HTML slide deck to 1920x1080 PNGs with headless Chrome
- upload slides/media into a project folder without name collisions
- export transcripts (SRT, Markdown, …) with timecodes and markers
- plan where each slide belongs by matching its title/notes against the narration
- run Underlord (Descript's AI agent) edits behind an explicit cost gate
- publish share links, track jobs and credits

Zero npm dependencies. Node ≥ 20 (24 recommended). Chrome/Chromium/Edge is needed only for deck rendering.

## Install

As a plugin (recommended):
```bash
claude plugin marketplace add alexaiarchitect/descript-skills
claude plugin install descript@descript-skills
```
Or inside a session: `/plugin marketplace add alexaiarchitect/descript-skills`, then `/plugin install descript@descript-skills`.

Manual (symlink the skill into your user skills):
```bash
git clone https://github.com/alexaiarchitect/descript-skills
ln -sfn "$(pwd)/descript-skills/skills/descript" ~/.claude/skills/descript
```

## Token

Create a token in Descript → Settings → API, then make it available in one of these ways (first match wins):

1. `export DESCRIPT_TOKEN=…`
2. `DESCRIPT_ENV_FILE=/path/to/.env`
3. a `.env` file containing `DESCRIPT_TOKEN=…` in the working directory (or any parent)
4. `~/.config/descript/.env`
5. the official CLI's `~/.descript-cli/config.json`

Check: `node skills/descript/scripts/descript.mjs status` → `API v1 · drive: <your drive>`.

## Typical session

Ask Claude, for example: *"Add the slides from deck.html to https://web.descript.com/<project>/<short> — split the Screen
layout per slide and fill the placeholders."* The skill then:

1. resolves the URL, inspects the project's media folders
2. renders the deck → `output/<Comp>/slide-NN-<slug>.png` + `manifest.json`
3. uploads into a fresh folder `<Comp>/` and verifies the live names
4. exports the SRT transcript and runs `plan-slides.mjs` to propose IN/OUT points per slide (you review the table)
5. shows the Underlord prompt and the expected credit cost, and only runs it after you confirm
6. verifies the result and writes a placement record under `records/`

Direct use of the scripts:
```bash
S=skills/descript/scripts
node $S/descript.mjs resolve "https://web.descript.com/<project>/<short>" --json
node $S/render-deck.mjs input/deck.html --out output/Lesson04
node $S/descript.mjs upload --project <project-id> --folder Lesson04 output/Lesson04/slide-*.png
node $S/descript.mjs transcript --project <project-id> --composition <short> --format srt --out records/p/Lesson04.srt
node $S/plan-slides.mjs --manifest output/Lesson04/manifest.json --srt records/p/Lesson04.srt --folder Lesson04 \
     --project <project-id> --composition <comp-id> --composition-name Lesson04 --duration 865.9 \
     --out records/p/Lesson04-plan.md --json records/p/Lesson04-plan.json --pin 12=11:45 --prompt-out records/p/Lesson04-prompt.md
node $S/descript.mjs agent --project <project-id> --composition <short> --prompt-file records/p/Lesson04-prompt.md \
     --model claude-opus-5.5 --dry-run        # then --wait --yes --out records/p/Lesson04-agent-job.json
```

## Costs and safety

- Media imports consume media minutes (images ≈ 1 s each); Underlord edits consume AI credits (a 12-scene split and
  placeholder fill with `claude-opus-5.5` cost ≈ 24 credits); publishing creates a public or unlisted link.
- `agent` and `publish` refuse to run without `--yes`; the skill instructs Claude to confirm with you first and to
  `--dry-run` before every billable call.
- There is no API to read or edit the timeline deterministically, so Underlord results are always verified in Descript.

## Repository layout

```
.claude-plugin/      plugin.json + marketplace.json
skills/descript/     SKILL.md, scripts/ (descript.mjs, render-deck.mjs, plan-slides.mjs), references/
input/  output/  records/   your decks, rendered slides, transcripts and placement records (gitignored)
.env                 DESCRIPT_TOKEN=… (gitignored)
```

Reference material: `skills/descript/references/api.md` (endpoints, CLI, MCP), `underlord-prompts.md` (prompt
templates and lessons), `placement-record.md` (how to document a finished timeline), `examples/`.

## License

MIT — see `LICENSE`.
