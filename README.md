# ID Study Platform — Cockpit (SP0 + SP1)

A free, local "cockpit" for Tyler's Infectious Disease study: it serves the
two-year Mandell reading schedule and, for each session, shows whether it's been
read and how many Anki cards / practice questions exist for that chapter. It
hands work off to Claude Code via copy-a-prompt buttons — it never runs the AI
itself, so it costs nothing to run.

This is the first slice of a larger platform. See `docs/` for the full design
and the five-sub-project plan.

## Run it

```bash
cd "8. Claude/ID Platform"
python3 serve.py
```

Then open <http://127.0.0.1:8756/>. Python 3.9+ standard library only — no
`pip install` needed. Stop with Ctrl+C.

## What it does

- **Reading plan** — the existing `ID Study Schedule` HTML, served as the
  dashboard with its look preserved.
- **Status badges** — each session row shows `◆ N` Anki cards and `● N` practice
  questions for its chapter, counted live from the artifact folders.
- **Read-state** — clicking a row marks it read; state is saved server-side in
  `state.json` and survives reloads. On first run it imports your existing
  browser `localStorage` progress once.
- **Copy-a-prompt** — click a row's `ⓘ` to open a panel with "Copy: make Anki
  cards" / "Copy: make RC questions" buttons. Paste the copied prompt into
  Claude Code to generate; the new artifacts show up as badges on next reload.

## Folder contract

```
8. Claude/
  ID Anki Cards/<NN - Chapter Title>/<date>.json        # cards (id-anki-cards skill)
  ID Practice Questions/<NN - Chapter Title>/<date>.json # questions (future SP3 skill)
  ID Platform/
    serve.py           # the server
    platform_core.py   # pure logic (state, counting, prompts)
    dashboard.html     # schedule copy + injected cockpit
    cockpit.js         # client layer
    prompts.json       # copy-a-prompt templates (editable)
    state.json         # read-state (git-ignored, created on first write)
```

## Tests

```bash
python3 -m pytest tests/ -v
```

Covers `platform_core` (parsing, counting, state, prompts) and the server
endpoints over real HTTP.

## Not yet built (later slices)

PDF upload + card/question generation in-app (SP2/SP3), and a question
bank / self-test mode (SP4). Today those steps run through Claude Code skills,
launched via the copy-a-prompt buttons.
