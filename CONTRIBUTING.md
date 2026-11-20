# Contributing

Issues and pull requests are welcome. For anything bigger than a small fix, open an issue first so we can agree on
the shape before you spend time on it.

## Reporting a problem

Use the **Bug report** form. Orca, Claude Code and Pitwall versions help most. Do not attach transcripts or
screenshots of real sessions: they can hold secrets and private code. Demo mode (menu ⋯ → Demo mode) is the safe way
to show a UI problem.

## Making a change

```bash
git clone https://github.com/sonthh/orca-pitwall && cd orca-pitwall
npm install                   # TypeScript and Node types, for the type check only
orca plugin types .
npx tsc -p .                  # type check
orca plugin test .            # unit tests
orca plugin dev load .        # then --approve <fingerprint> as printed
```

There is no build step; Orca runs the TypeScript in `src/` directly. The layout is in the README under Develop.

Ground rules, because they are what users trust Pitwall for:

- **Read-only.** No network calls, no child processes, no writes outside the plugin's own storage, never type into a
  terminal. A change that needs one of these needs an issue first.
- **No wrong numbers.** When Pitwall cannot be sure (an unknown model price, a transcript still loading), it shows
  nothing rather than a guess. Keep it that way, and add a test with synthetic transcript rows (see `test/`).
- **Synthetic data only** in tests, fixtures, screenshots and GIFs.
- Agent-specific code lives in its own folder (`src/worker/claude/`); an adapter for another agent is a sibling folder.

Keep pull requests to one change. A maintainer squashes them on merge.

Look for issues labelled `good first issue` if you want somewhere to start.

By contributing you agree that your work is released under the MIT License of this repository.
