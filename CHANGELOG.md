# Changelog

## Unreleased (fork: feature/agni-crew)

- **Crew section** (optional, off by default; menu ⋯ → Crew): Agni crew tasks with stage timelines and run sheets, tasks waiting on you at the top, seat state and seat lock holder, and the gateway's crew keys against budget and expiry. Read-only, over your own SSH.
- **Crew mascots** in the Crew section: who is working on the running task, as 🐉 🦊 🐙 🦉 🎭 🐎 🧪 with a stage strip, one row each (action, a file-names-only bubble, card temperature and VRAM as — until a source exists), a hand-off, 🎉 at merge-ready and 💥 on failure. Reads the per-seat lines of Agni-crew #42 (`agni.crew.seat_event/1`) when present, stage lines otherwise. Still under prefers-reduced-motion.
- **Crew mode** replaces the Crew section: with Crew on, the whole sidebar is the Crew operations console. It leads with live state (running task, stage, elapsed, the last stage that finished, the seats generating, a queued seat and its holder) and when agnx last answered (live, stale past 45 s, unreachable, connecting). Tasks waiting on you show their recorded cause, the last stage that passed and the next step. The orchestrator map keeps LiteLLM as a routing node and labels what it shows: live, last run (still, not a current incident) or an explicit replay. Seats, gateway problems only when there is one, and folded run history follow. Standard sections, the footer, key budgets and the LiteLLM dashboard link are gone from Crew mode; **‹ Pitwall** in its bar returns to the standard view. Demo mode keeps the standard view.
- **Crew story**: the orchestrator tells the run in words. A headline from the prompt, how it ended, then one row per role with a status word and a sentence grounded in the run's receipts (stage lines, assignments, the recorded decision, `crew status`): an assignment reads as "assigned", never as work done; tests and review say "did not start" when no stage line exists; the runner's ownership check (which author edited outside its assignment) is named as the runner's file check, distinct from a Jev verdict; reserve roles (Codex, Jev, Venice) say what they can do and whether this task called them. Map captions use the same words instead of clipped file names. Files, ids, roots and stage settings sit in a details fold. **Story ›** on a waiting task pins that run in the orchestrator; **Back to the latest run** clears it.
- **Every crew state root**: runs are read from each `~/.local/state/agni-crew*` root on the crew host (bounded), keyed by root and id, with each root's task count and last write under **Runs seen**. Only the default profile's root is checked against `crew status`; others show their records and are labelled. Idle says which roots were checked instead of claiming the crew is idle. A seat lease held by something not in the report is said.
- **Crew development**: Orca agents in Crew workspaces (the agni-crew project, and `crew-` workspaces in other projects), whatever workspace is focused, with their task title, last terminal title and state, kept apart from the model seats. A workspace that does not answer is named as a gap.

## 0.2.0

- **Background** on each agent: background shells and Monitor watches still running, cron jobs and the `/loop` wakeup with their next run. An idle agent's row shows the next run or how many run; the status bar counts them (`2 bg`).
- A cron job or wakeup that runs starts a turn, so its tool calls count in it (`scheduled: …` / `loop: …`).
- Activity lists background shells and monitors as they finish, fail or are stopped.
- A quiet footer with the version and a **Star on GitHub** link (also in the ⋯ menu); it opens your browser only when clicked.
- Cron jobs show the time they run (`23:41 · in 4h27m`, or `Dec 31 23:57` on another day).

## 0.1.0

First release.

- Working agents on a card (state, model, effort, context, cost, prompt, running subagents, latest tool calls); idle agents one line each with their context.
- Needs-you alerts for agents waiting on a permission prompt, with the command they want to run and a Go to terminal button.
- Jump to any agent's terminal from the panel; show only one agent.
- No partial numbers while a transcript is first read; local slash commands keep the last turn; Orca-style scrollbars.
- New-since-you-looked dots, idle agents sorted by what needs a look, a heads-up before a working agent's context fills.
- Tool calls with outcome and family filters, activity list, status bar summary, demo mode.
- Follows Orca's theme (light and dark); keyboard friendly.
- Credential masking in every tool summary and prompt.
