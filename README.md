# AI Usage Replay: Walk to School Codebook

An interactive replay of one Claude Code session: coding 108 eighth graders' write-in survey answers into a twelve-theme codebook for PPD 542 (Policy and Program Evaluation), checking the coding with a blind second coder, revising one theme, and then turning the method into a reusable skill. The replay was made for Option B of the course's content-analysis assignment, "code with AI", so that the AI's work can be examined minute by minute rather than taken on trust.

## Open it

- Live page (GitHub Pages): https://traviscs.github.io/AI-Usage-Replay-Artifact-Template/
- Or download this repository and double-click `index.html`. Nothing needs a server; every page here is plain HTML and JavaScript with its data beside it.

The first page is the shelf, one card per replay. "Open the replay" leads to the replay itself.

## What the replay shows

Drag the timeline, press Play, or jump between milestones, and the panes show what the session looked like at that moment:

- **Chat**: every message typed and every reply, plus the "next step" boxes Claude Code showed, and a note where the app condensed its context.
- **Agents** and **Helpers**: the subagents that were sent off (for example the blind second coder and the critic that attacked the codebook), what each was asked, how long it ran and what it cost.
- **Schedule**: the Schedule pane as it stood at that minute.
- **Citations**: the sources behind the analysis, including the course handouts and Cohen (1960) for the agreement statistic.
- **Refinement**: the nine review questions Claude asked after the first test runs of the skill, and the answers given.

Token counts are exact, summed from the session's own transcripts, not estimated.

## How it was made

The page is produced by a session-replay tool that reads the Claude Code transcripts (the main session and every agent it started), the Schedule pane and task list calls, and a citation library, and writes the data into `data.js` (for a double-clicked page) and `data.json` (for tools). Each replay folder's `README.md` records the exact command that built it. The pixel sprites and the jungle strip come from the author's own Claude Code mods.

## What was removed for this public copy

The author's email address and home-folder paths were taken out. A few links in the chat point to private claude.ai pages (the online copies of this replay, its shelf and the review page); those will not open for visitors. The review page's questions and answers are copied into the Refinement tab, so nothing needed for reading the replay is behind them.

## Adding another replay

Copy a replay folder from `~/Documents/Claude Replays` into this repository and rebuild the shelf from the repository folder:

```
python3 ~/.claude/skills/session-replay/scripts/shelf.py --root <this folder>
```

Then remove `shelf_online.html` and `shelf.json` (they belong to the private online shelf) and commit.
