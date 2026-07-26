# One app, and sync that doesn't lose writes — 2026-07-26

## Why

Two problems had grown together.

**The app had forked.** `dashboard.html` and `phone/index.html` each carried a
byte-identical 115,590-character `SECTIONS` literal and ~15 identical functions.
The phone had since gained chapter search, schedule re-flow, done-dates, tree
zoom and bulk marking; the Mac page had none of it. The uncommitted change
sitting in the tree at the time was a hand-backport of the flex-Saturday logic
from one file to the other — exactly the tax this duplication charges. And
because `SECTIONS` was a single line, any schedule edit produced a ~240KB diff.

**Sync could lose a write, two ways.**

1. *Timestamp mismatch.* `platform_core._now_iso()` wrote naive local time
   (`2026-07-26T09:00:00`); `sync.js` wrote `toISOString()` (`…T12:00:00Z`).
   `merge_sessions` compares these as **strings**. At UTC−3 every Mac stamp
   sorted as three hours older than it really was, so a phone edit made up to
   three hours *earlier* silently beat a newer Mac edit.
2. *Boot-only merge.* The server pulled and merged once at startup, then pushed
   the full local state after every write. With auto-start the server runs all
   day, so anything marked on the phone was overwritten by the next Mac click.

The push also ran inline in the request handler with a 10-second timeout and a
bare `except: pass` — a flaky network stalled every click and failed invisibly.

## What changed

**One app.** `phone/` now holds the only copy: `index.html` (markup + CSS),
`schedule.js` (the plan, one line per session), `cockpit.js` (all logic),
`sync.js`. `serve.py` serves that folder; `dashboard.html` is deleted. The Mac
gains search and re-flow by construction, and the schedule has one home.

The two homes differ in exactly one place — a `Backend` object with four methods
(`load`, `setDone`, `setDoneMany`, `syncConfigurable`), chosen at load time by
origin. `ServerBackend` talks to the API; `LocalBackend` talks to `IDStore`.
Detection is hostname *and* path: serve.py mounts at `/`, every other host serves
under `/phone/`, so previewing the PWA from a local static server doesn't make it
think it's talking to Python.

This also fixed a latent bug: `markMany` wrote `IDStore` directly, so on the Mac
marking a whole chapter was never persisted anywhere.

**Sync.** `_now_iso()` emits UTC with `Z`, and `load_state` normalizes legacy
naive stamps on read, so existing state and the gist heal themselves on next
write. A new `sync_state(cfg, path)` does pull → merge → save → push, and every
write goes through it. `Syncer` in `serve.py` runs it on a 1.5s debounce off the
request thread, so a burst of toggles is one round-trip and a dead network never
blocks a click. `_STATE_LOCK` guards the read-modify-write now that the sync
worker writes from its own thread.

## Tests

31 Python tests, 20 JS. The JS tests load the real browser files in a `node:vm`
sandbox with a stub DOM — no build step and no dependencies, so the app stays
plain `<script>` tags. They cover both backends, the merge, the schedule re-flow
(including that reading ahead pulls the finish date earlier, and that reading
several chapters in one day buys time back rather than pushing the tail along),
and chapter search grouping.

The timestamp shape is asserted on **both** sides — `ISO_Z` in `test_sync.py`,
a regex in `cockpit.test.mjs` — because that's the contract the merge depends on
and it has no other enforcement.

Tests are hermetic: `make_server` takes `cfg_dir`, and a conftest fixture clears
`ID_GIST_*`, so a run can never reach the real gist.

## Then: PWA-only (same day)

Tyler's call, made straight after: he only wants the phone app. So the Mac half
went — `serve.py`, `platform_core.py`, the three `.command` launchers, the
launchd plist, `ID Cockpit.app`, and the whole Python test suite. `Backend`
collapsed from two implementations plus origin-detection to one plain object,
and the merge now exists once instead of twice.

The migration risk was real and specific: there was no `sync.json`, so the Mac
had **never** pushed to the gist — those 28 completed sessions existed nowhere
else. They are preserved as `mac-progress.json` (tracked in git, unlike the old
`state.json`), which is already in the shape the app's import accepts. Verified
end to end: importing it into a fresh app reproduces LVL 3, 2/31 sectors cleared,
556 remaining — matching what the Mac showed.

What this costs: the Mac no longer has a local copy of anything. Progress lives
on the phone and in the gist. If both the phone and the gist are lost on the same
day, `mac-progress.json` is a floor, not a backup — export from **⚙ Sync**
occasionally if that matters.
