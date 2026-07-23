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

## Phone app (PWA) + Mac↔phone sync

The `phone/` folder is a self-contained installable web app — the same cockpit UI,
but with no Python server: progress is stored on the device and synced between Mac
and phone through a private GitHub Gist (conflict-free: newest timestamp wins per
session, keys union). Works fully offline; syncs when back online.

### One-time setup
1. **Create the shared store:** make a **private** Gist with one file `state.json`
   containing your current Mac progress (copy the contents of `state.json`, or
   `{"sessions":{}}` to start). Note the Gist ID (the hash in its URL).
2. **Create a token:** GitHub → Settings → Developer settings → Fine-grained tokens →
   new token with **Gist: read and write**. Copy it.
3. **Publish the app:** push this repo to GitHub and enable Pages:
   ```bash
   git push -u origin main            # after merging the phone-pwa branch
   ```
   GitHub → repo → Settings → Pages → Source: Deploy from branch → `main` / `/root`.
   Your app URL is `https://<user>.github.io/<repo>/phone/`.
4. **Install on phone:** open that URL in Safari/Chrome → Share → **Add to Home Screen**.
5. **Connect sync:** open **⚙ Sync** in the app, paste the token + Gist ID, **Save**.
6. **Mac:** create `ID Platform/sync.json` = `{"token":"…","gist_id":"…"}` (gitignored).
   Restart `serve.py`. Both devices now share progress.

Regenerate the app icons (only needed if you change the design) with
`python3 phone/make_icons.py` (requires `pip install pillow`).

### Notes
- The token is stored only on your devices and is Gist-scoped (low risk). Never commit it.
- Sync is opt-in on the Mac: with no `sync.json`/env vars, `serve.py` runs exactly as before.

## Not yet built (later slices)

PDF upload + card/question generation in-app (SP2/SP3), and a question
bank / self-test mode (SP4). Today those steps run through Claude Code skills,
launched via the copy-a-prompt buttons.
