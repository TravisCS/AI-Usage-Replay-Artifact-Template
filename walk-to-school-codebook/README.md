# Walk to School Codebook

Coding 108 eighth graders' survey write-ins into a twelve theme Excel codebook, a blind reliability check, then a reusable skill built and tested from it

A replay of a Claude Code session: drag the timeline and the panes show what Claude Code showed at that moment, the chat, the agents, the Schedule pane, the helpers, the sources read and the commits.

- Project: ~/Library/Application Support/Claude/scratch-workspaces/4e2f5791-bdd2-4a3a-9fed-812783d470de/87753df9-ee49-49ba-b087-434ee7d8008c/scratch-2026-10-25-7beaf0
- Window: Sat Oct 24, 9:23 pm to Wed Oct 28, 2:31 pm, Pacific time
- Session: a3ce8f1e-1c38-4505-98ea-961c1ae4ae1a
- Online copy (private claude.ai artifact): not linked from this public copy

## Open it

Double click `index.html` in Finder. Everything it needs is in this folder (`data.js` holds the data), and it loads nothing from the internet.

## Use it

- Click or drag the timeline, or use the slider under it. Play and Pause run at 1, 10 or 60 minutes of the session per second.
- The marks above the timeline: blue dots are your messages, green bars are workflow starts (hollow for ends), gold diamonds are commits, red marks are times the Schedule pane lost its state. The shaded area shows how many agents were running each minute.
- "Jump to a moment" lists every milestone and every message you typed; the arrow buttons step to the previous or next one.
- Keys: space plays or pauses; the left and right arrows step one minute (hold shift for 10).
- Click a workflow to open or close it, and an agent to see its task, result and numbers.
- On a phone the panes become tabs under the timeline. The page remembers your place in your own browser only.

## Refresh it

Run the same command again (it rewrites this folder for the same sessions and keeps the artifact link):

```
python3 ~/.claude/skills/session-replay/scripts/build_replay.py --cwd '~/Library/Application Support/Claude/scratch-workspaces/4e2f5791-bdd2-4a3a-9fed-812783d470de/87753df9-ee49-49ba-b087-434ee7d8008c/scratch-2026-10-25-7beaf0' --session a3ce8f1e-1c38-4505-98ea-961c1ae4ae1a --title 'Walk to School Codebook' --subtitle 'Coding 108 eighth graders'"'"' survey write-ins into a twelve theme Excel codebook, a blind reliability check, then a reusable skill built and tested from it' --no-git --slug '2026-10-24 Walk to School Codebook'
```

If the replay has an online copy, publish the folder again to the same artifact afterwards (the session-replay skill says how).

## How it was made

Built Wed Oct 28, 2:31 pm by the session-replay skill (`~/.claude/skills/session-replay`). It reads the session's transcript, every workflow and helper agent transcript, the workflow journals and scripts, the Schedule pane and task list calls, the git log and the citation library, and writes the data into `data.js` and `data.json`.

- Tokens are exact: the four usage fields of every assistant message, counted once per message id, over the main transcript and every agent transcript.
- Busy time is the number of distinct clock minutes with any event from the main thread or any agent.
- Workflow start and end times come from their agents' own first and last timestamps.
- The Schedule pane is rebuilt by replaying every update_schedule call through the eta-schedule mod's own code.
- Email addresses, API keys and tokens are removed from every text before the data is written.

### What this run measured

- Window: Sat Oct 24, 9:23 pm to Wed Oct 28, 2:31 pm (Pacific time), 5348.1 minutes on the clock, 204 busy minutes (distinct minutes with any event).
- Session: a3ce8f1e-1c38-4505-98ea-961c1ae4ae1a.
- Model: claude-fable-5-1.
- Tokens (exact, once per message id over the main transcript and every agent transcript, 395 API messages): input 8,694, output 1,359,498, cache read 105,749,473, cache creation 4,438,209; all four together 111,555,874.
- Main thread: output 556,933, all four 89,415,578. Workflow agents: output 0, all four 0. Helpers: output 802,565, all four 22,140,296.
- Workflows: 0 runs, 0 agents. Helpers (Agent tool): 13. Agent-tool helpers found under subagents/.
- Chat: 42 typed user messages, 80 assistant replies, plus next-step boxes and a note where the app condensed the context.
- Schedule pane: 14 update calls; it never lost its state.
- Task list: 54 update calls.
- Citations: 0 web fetches of 0 unique pages on 0 sites; 0 web searches (0 unique queries); 7 URLs reached through shell commands (curl and similar); 8 sources in Sources behind this analysis, added October 28, 2026.
- Commits: no git repository was read.
- Secrets scrubbed from the data: 3 email.

### Checks

- Agents per workflow equal the journal's started count and the number of agent transcripts: no workflows ran.
- Token totals, pass 1 (dedupe by message id) vs pass 2 (separate reader, dedupe by request id) vs sum of per-file counts (each message counted in the first file that has it): all equal (395 vs 395 messages).
- Message ids found in more than one file: 0.
- Broken JSONL lines skipped: 0. Half-written last lines left for the next run: 0 (normal for a log that is still being written).

### What it could not measure, or measures with care

- Workflow start and end come from their agents' own first and last timestamps, not the harness; `launched_at` (the Workflow call in the main thread) and `notified_at` (the completion notice) are given beside them.
- When the window ends before an agent did, the agent shows as running at the end, with its tokens up to that moment. The harness's own per-run numbers (`reported_by_harness`, counted differently and never used) are left out for such a run.
- 'Task' per agent is the first line of its computed task text that no sibling agent in the same run also received word for word; `task_first_line` keeps the literal first line.
- A first message that came from an earlier session's handoff is marked `handoff` and trimmed. Skill bodies, system reminders, task notifications and tool results are left out of the chat. Assistant replies are trimmed to about 1500 characters each; thinking is never included.
- The Schedule pane's state is not logged; the page rebuilds it by replaying the update calls through the eta-schedule mod's own code. Parts that track agents or plan steps move between calls by the agents' own start and end times.
- Busy minutes count any timestamped record (including queue and notice records).
- URLs are cleaned (fragments dropped, key or token values replaced with REDACTED). Email addresses, API keys and tokens are replaced in every text before the data is written, and the written file is checked again for them.
- Helpers (Agent tool) show as done unless the window ends while their transcript is still going.

## Files

- `index.html`: the page and its styles. `app.js`: the replay. `mods.js`: the user's own drawing code from the eta-schedule mod (sprites, ETA bar gags, jungle, schedule math).
- `data.js`: the data for a double-clicked page. `data.json`: the same data for tools. `replay.json`: the summary the shelf reads.

Mods by Cathertinethecat: agent-sprites, agent-helpers, eta-schedule and agent-citations.
