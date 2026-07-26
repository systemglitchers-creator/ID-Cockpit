# ID Cockpit

A skill-tree view of Tyler's two-year Mandell reading schedule — 584 sessions
across 31 sectors — as an installable phone app. Tick off what you've read; the
remaining sessions re-deal themselves onto the days ahead.

It is static files. No server, no build step, no dependencies. Card and question
generation happen in the Claude Code skills (`id-anki-cards`), not here.

## Layout

```
8. Claude/ID Platform/
  phone/
    index.html         # markup + CSS
    schedule.js        # the reading plan (generated data, one line per session)
    cockpit.js         # all app logic
    sync.js            # device store + gist sync
    sw.js              # offline shell — bump CACHE when app files change
    manifest.webmanifest, icons/
  mac-progress.json    # progress exported from the retired Mac server
  tests/js/            # node tests
  docs/                # design notes
```

Editing the schedule means editing `phone/schedule.js` — one line per session, so
changes stay reviewable.

## Deploy

Push, then GitHub → Settings → Pages → Deploy from branch → `main` / `/root`.
The app is at `https://<user>.github.io/<repo>/phone/`. Open it in Safari →
Share → **Add to Home Screen**.

To preview locally: `python3 -m http.server 8795`, then
<http://127.0.0.1:8795/phone/>.

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
