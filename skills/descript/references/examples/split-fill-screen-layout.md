# Worked example — split one Screen-layout scene into 12 and fill the placeholders

Context: a 14:25.9 talking-head lesson recorded in Descript, one scene using the **Screen** layout (large screen
placeholder, black background, camera as a 287x287 rounded picture-in-picture bottom-right). Twelve 1920x1080 slide PNGs
had been uploaded to the media folder `Lesson04/` with `descript.mjs upload`. Placement plan built from the SRT
transcript (cue phrase → first word of the matching sentence). Names and cues below are illustrative; the structure,
rules, and outcome are from a real run.

Run (2026-10-25): `descript.mjs agent --composition <short-id> --prompt-file prompt.md --model claude-opus-5.5 --wait --yes`
Result: `status: success`, 23.5 AI credits, ~4 minutes, runtime unchanged, 12 contiguous scenes with the right slide in
each placeholder and the camera inset present (verified in the Descript scene grid). The agent reported it had not
re-verified word boundaries at the split points and had compared camera framing only in scenes 1 and 12 — hence the
stronger wording in the HARD RULES below (now the default in `plan-slides.mjs --prompt-out`).

## Prompt (IDs replaced with placeholders)

```
Edit ONLY the composition "Lesson04" (composition id <COMPOSITION_UUID>) in project <PROJECT_UUID>. Do not create, duplicate, or modify any other composition, and do not import, rename, duplicate, or delete any media.

CURRENT STATE
- Lesson04 is a finished 14:25.9 talking-head recording. It currently consists of ONE scene that uses the "Screen" layout: a large empty screen/browser-window media placeholder with the speaker camera as a small picture-in-picture in the bottom-right corner.
- The 12 slide images already exist in this project's media under the folder "Lesson04/".

TASK
1. Split that single scene into exactly 12 consecutive scenes at the timecodes below. The scenes must be contiguous: scene N ends exactly where scene N+1 begins, and scene 12 runs to the end of the composition.
2. Every scene must keep the SAME "Screen" layout that the composition already uses — same placeholder geometry, same camera picture-in-picture position and size, same background. Do not change the layout type, do not apply a different layout or template, do not add new layers.
3. Fill the empty screen placeholder of each scene with the image listed for it, fitted inside the placeholder without cropping, static for the whole scene:

| Scene | Start   | End     | Image to put in the Screen placeholder |
|------:|---------|---------|-----------------------------------------|
| 1  | 00:00.0 | 00:39.0 | Lesson04/slide-01-intro.png |
| 2  | 00:39.0 | 01:33.0 | Lesson04/slide-02-definition.png |
| 3  | 01:33.0 | 02:43.0 | Lesson04/slide-03-when-it-fits.png |
| 4  | 02:43.0 | 04:02.0 | Lesson04/slide-04-when-it-does-not.png |
| 5  | 04:02.0 | 05:28.0 | Lesson04/slide-05-options.png |
| 6  | 05:28.0 | 06:40.0 | Lesson04/slide-06-details.png |
| 7  | 06:40.0 | 07:45.0 | Lesson04/slide-07-controls.png |
| 8  | 07:45.0 | 08:56.0 | Lesson04/slide-08-costs.png |
| 9  | 08:56.0 | 10:14.0 | Lesson04/slide-09-risks.png |
| 10 | 10:14.0 | 10:38.0 | Lesson04/slide-10-checklist.png |
| 11 | 10:38.0 | 11:45.0 | Lesson04/slide-11-quiz.png |
| 12 | 11:45.0 | end (14:25.9) | Lesson04/slide-12-wrap-up.png |

Spoken cues at each start, for reference: 1 "Welcome to lesson four" · 2 "Let's start with a definition" · 3 "When is this a good fit?" · 4 "And when is it not a good fit" · 5 "There are four options" · 6 "Now let's look at what it actually does" · 7 "Now let's discuss the controls" · 8 "Every integration has a cost" · 9 "Risk decides the scope" · 10 "Always write the decision down" · 11 "Let's try a quiz" · 12 "Now let's summarize".

HARD RULES
- Keep all audio, all words, all existing cuts, captions, and the total runtime exactly as they are. Do not remove or add speech.
- Do not add transitions, spacer scenes, black frames, gaps, silence, stock media, music, titles, or text overlays.
- Place every split on a word boundary: between two words, preferably at the end of a sentence, never inside a word. Move a split by up to ±1.0 s from the requested time if that is what it takes. Report the final time of every split you made.
- Use only the 12 media names listed above, exactly as written. If one cannot be found, leave that scene's placeholder empty and report it; do not substitute other media.
- Do not touch any media in other folders (e.g. "Lesson04-old/").

REPORT BACK
Return a table with: scene number, final start and end timecodes, the image placed, and — for every scene — confirmation that the layout is still "Screen" with the camera picture-in-picture unchanged. List anything you could not do exactly as specified.
```

## What the first run taught us
- The original prompt said "snap to the nearest word boundary, within ±0.5 s" and the agent placed the splits at the
  literal times instead. The rule above asks for the final times back, which makes skipping it visible.
- Ask for per-scene confirmation of the camera inset, not a single sentence.
- Keep the spoken cues; they are the cheapest insurance against an off-by-one in the plan.
