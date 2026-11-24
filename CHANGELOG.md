# Changelog

## Unreleased (fork: feature/agni-crew)

- **Crew section** (optional, off by default; menu ⋯ → Crew): Agni crew tasks with stage timelines and run sheets, tasks waiting on you at the top, seat state and seat lock holder, and the gateway's crew keys against budget and expiry. Read-only, over your own SSH.
- **Crew mascots, optimised** (`feature/agni-crew-optimise`): the mascots sit inside each running task's own card (one set per running task), merged with its prompt, stage bar and stages (folded while it runs). One line of faces, the working ones moving with their action word; a row only for a seat at work, with its output file and size; everyone else folded into one dimmed row with 💤. No dashes: fields without data are left out. Card temperature and VRAM read over SSH with `rocm-smi` (agni1) and `nvidia-smi` (agni2), only while the section is on screen and a task runs, at most every 20 s, mapped to seats from `crew.toml`; amber at 85 °C, red at 95 °C. The agnx event logs are tailed from a cursor instead of reread. The panel redraws only the task cards and seat rows that changed (clocks tick in place), and the faces pause while the panel is hidden or the section is out of view.
- **Crew mascots** in the Crew section: who is working on the running task, as 🐉 🦊 🐙 🦉 🎭 🐎 🧪 with a stage strip, one row each (action, a file-names-only bubble, card temperature and VRAM as — until a source exists), a hand-off, 🎉 at merge-ready and 💥 on failure. Reads the per-seat lines of Agni-crew #42 (`agni.crew.seat_event/1`) when present, stage lines otherwise. Still under prefers-reduced-motion.

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
