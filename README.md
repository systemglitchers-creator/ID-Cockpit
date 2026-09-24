# ID Cockpit

> **Front end frozen 2026-09-24.** Culture (`8. Claude/ID Culture/`,
> <https://id-culture.vercel.app>) is the daily app and gets all UI work. This
> repo stays deployed because it is Culture's backend: `api/`, `lib/`,
> `public/schedule.js`, `public/guidelines.js` and `public/qbank/` are live and
> still edited here. `public/app.js`, `index.html`, `copy.*`, `motion.*`,
> `sync.js`, `sw.js` and the icons are frozen — `app.js` is now the reference
> Culture's parity test runs against. Plan: move the backend into Culture, then
> retire this app.

Tyler's two-year Mandell reading schedule — 584 sessions across 38 sectors — as
an installable phone app. Tick off what you've read; the remaining sessions
re-deal themselves onto the days ahead. Five tabs: **Today** (the day's quest,
streak, level), **Path** (the sector trail), **Guides** (the guideline shelf),
**Find** (search any chapter), and **Stats** (standing, badges, per-sector bars).

It is static files. No server, no build step, no dependencies. Card and question
generation happen in the Claude Code skills (`id-anki-cards`), not here.

## Layout

```
8. Claude/ID Platform/
  public/              # the app — apothecary, deployed on Vercel
    index.html         # markup + CSS
    app.js             # all app logic (Today / Path / Find / Stats / sector sheet)
    schedule.js        # the reading plan (generated data, one line per session)
    sync.js            # device store + gist sync
    sw.js              # offline shell — bump CACHE when app files change
    manifest.webmanifest, icons/
  vercel.json          # static deploy config (outputDirectory: public)
  mac-progress.json    # progress exported from the retired Mac server
  tests/js/            # node tests
  docs/                # design notes
```

Editing the schedule means editing `public/schedule.js` — one line per session,
so changes stay reviewable. Session `id` values are the keys progress is stored
against: changing one silently orphans that session's read-state.

## Deploy

Vercel → New Project → import this repo. It is a static site: no framework, no
build command, and `vercel.json` points the output at `public/`. Every push to
`main` redeploys. Open the deployment in Safari → Share → **Add to Home Screen**.


To preview locally: `python3 -m http.server 8797 --directory public`, then
<http://127.0.0.1:8797/>.

## Pushing a schedule change without a deploy

The plan bundled in `public/schedule.js` renders first and is the offline copy.
A pushed copy in Redis overrides it at runtime, so reordering, inserting or
editing sessions reaches the phone on next open with no git push and no deploy:

```bash
npm run push:schedule
```

It validates first and **refuses** to push a schedule with duplicate or missing
session ids — those are the keys progress is stored against, so a duplicate
merges two sessions' read-state and a rename orphans it. Fix the source rather
than working around the validator.

`GET /api/schedule` returns 204 when nothing has been pushed, and the app simply
keeps its bundled copy. An empty store, a dead network, or a malformed payload
are all non-events.

App *behaviour* changes (anything in `app.js`) still need a normal push and
deploy — the store carries content, not code.

**One-time setup:** Vercel dashboard → id-cockpit → Storage → connect the
existing Upstash/KV store, then `npx vercel link && npx vercel env pull .env.local`.

## Progress and sync

Progress is stored on the device and shared between devices through a **private**
GitHub Gist. It works fully offline and syncs when back online.

1. **Create the store:** a private Gist with one file `state.json` containing
   `{"sessions":{}}`. Note the Gist ID from its URL.
2. **Create a token:** GitHub → Settings → Developer settings → Fine-grained
   tokens → **Gist: read and write**.
3. **Connect:** in the app, **⚙ Sync** → paste token + Gist ID → **Save**.

Merge is conflict-free: newest timestamp wins per session, keys union. Both
devices write UTC timestamps (`toISOString`), which is what makes that comparison
sound — a stamp written in local time would sort hours away from where it belongs.

Import/export live in the same **⚙ Sync** panel. Anything shaped
`{"sessions": {...}}` imports and merges.

The token is stored only on your devices and is Gist-scoped. Never commit it.
Anyone holding it can read and write that gist, so treat it like a password and
revoke it on GitHub if a device is lost.

## Tests

```bash
node --test "tests/js/*.test.mjs"
```

The tests load the real browser files in a `node:vm` sandbox with a stub DOM — no
build step, so the app stays plain `<script>` tags. They cover the store, the
merge, timestamp shape, the schedule re-flow, and chapter search.

## History

This began as a Python server serving a dashboard on the Mac, with the phone app
added later; the Mac half was retired on 2026-07-26 once the PWA did everything
it did. See `docs/` for the design notes, including what the two-copy era cost.

## Not yet built

In-app PDF upload and card/question generation (SP2/SP3), and a question bank /
self-test mode (SP4). Today that work runs through the Claude Code skills.
