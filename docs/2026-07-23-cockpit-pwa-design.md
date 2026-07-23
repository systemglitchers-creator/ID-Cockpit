# ID Cockpit → Self-Contained Phone PWA

**Date:** 2026-07-23
**Status:** Design — approved for planning

## Goal

Make the ID Cockpit skill-tree dashboard usable as an **installable, offline, self-contained
app on Tyler's phone**. Add it to the home screen, open it fullscreen like a native app, tick
off reading sessions, and have that progress persist on the device — with no Python server and
no network required after first load.

## Constraints & decisions (from brainstorming)

- **Approach:** Installable PWA, fully self-contained. Progress stored on the phone.
- **Non-destructive:** The existing Mac app (`serve.py` + `dashboard.html` + `state.json`) must
  keep working exactly as-is. Anything that reads `state.json` (skills, imports) is untouched.
  The phone build is therefore a **separate build**, not an edit to the served `dashboard.html`.
- **Separate progress:** Phone and Mac keep independent state (accepted). A manual JSON
  export/import is the bridge between them — no cloud sync in this iteration (YAGNI).
- **Hosting:** GitHub Pages. The repo is currently local-only (no remote). A one-time push +
  Pages enable gives the https origin required for service-worker registration and
  "Add to Home Screen".

## Current architecture (what exists)

Single-file dark "skill tree" dashboard, ~368 lines, all logic + schedule data embedded:

- **Schedule data** — `const SECTIONS = [...]` at line 196 (chapters split into parts, each a
  session with `id` like `ch20-p1`, page range, week, global day-index `gi`). Static. Untouched.
- **Rendering** — `compute()` / `render()` / `openPanel()` build the tree, HUD, quest banner,
  and per-sector session lists from `SECTIONS` + `STATUS`. Untouched.
- **Server touchpoints — the only things that block phone use:**
  1. `GET /api/status` → `{done: {id: {done, doneAt}}}` (loaded in `boot()`)
  2. `POST /api/session/{id}/done {done}` → persists a toggle (`toggle()`)
  3. `POST /api/import {ids}` → one-time seed (not used by phone UI)
  All go through one wrapper: `function api(p,o){return fetch(p,o).then(r=>r.json());}`
- **External dependency** — Google Fonts (Chakra Petch / Rajdhani / Space Mono) via CDN
  `<link>`. CSS already declares `system-ui`/monospace fallbacks.

State shape (`state.json` today → localStorage on phone):
`{ "sessions": { "ch20-p1": { "done": true, "doneAt": "2026-07-13T07:46:24" }, ... } }`
Note: the server's `/api/status` returns `{done: <sessions map>}`, and the client reads
`STATUS.done[id]`. The shim must preserve this `{done: {...}}` envelope.

## Design of the phone build

Output lives in a new subfolder so the Mac build is never touched:

```
ID Platform/
  phone/                 # the entire deployable PWA (this is what GitHub Pages serves)
    index.html           # dashboard.html with the storage shim + PWA head tags
    manifest.webmanifest
    sw.js                # service worker (offline shell + font caching)
    icons/
      icon-192.png
      icon-512.png
      icon-maskable-512.png
      apple-touch-icon-180.png
```

### 1. Storage shim (replaces the server)

Swap the network `api()` for a localStorage-backed one with the **same signature and return
shapes**, so `boot()`, `toggle()`, and everything downstream stay byte-for-byte identical:

- Key: `idcockpit.v1.state`, value `{ "sessions": { id: {done, doneAt} } }`.
- `api("/api/status")` → resolves `{done: <sessions>}` from localStorage (empty map if unset).
- `api("/api/session/{id}/done", {..done})` → read-modify-write the sessions map, resolve the
  updated entry `{done, doneAt}`.
- `api("/api/import", {ids})` → union-seed (parity with server), resolve `{imported: n}`.
- Returns Promises so the existing `.then()/.catch()` call sites are unchanged. Writes are
  synchronous, so the "Sync failed" toast path effectively never fires.

### 2. Export / Import (manual Mac↔phone bridge)

- **Export:** a HUD button dumps `localStorage[idcockpit.v1.state]` as a downloaded
  `id-cockpit-state.json` (same schema as the Mac's `state.json` — directly interchangeable).
- **Import:** file-picker reads a JSON file, validates it has a `sessions` object, replaces
  local state, re-renders. This lets Tyler seed the phone from his Mac's `state.json` once.

### 3. Offline (service worker)

- `sw.js` precaches the app shell (`index.html`, `manifest.webmanifest`, icons) on install.
- Runtime cache-on-fetch for the Google Fonts stylesheet + font files, so fonts survive offline
  after the first online visit. Stale-while-revalidate for the shell.
- Registered from `index.html` with a scope-relative path so it works under a GitHub Pages
  project subpath (`/<repo>/`). All asset paths are **relative** for the same reason.

### 4. Installability

- `<link rel="manifest">`; manifest: `name`/`short_name` "ID Cockpit", `display: standalone`,
  `theme_color`/`background_color` matching the dark violet UI (`#070510`), `start_url: "."`,
  icons list incl. a `maskable` icon.
- iOS tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `apple-touch-icon`, `apple-mobile-web-app-title`.

### 5. Icon

On-brand generated PNG set: a violet orb / "ID" mark echoing the tree nodes, on the `#070510`
background. 192, 512, maskable-512 (with safe padding), and 180 apple-touch.

### 6. Mobile layout polish (phone-only CSS, additive)

- **HUD** (`.hud .in`): allow wrap / shrink so the level badge + XP bar + stat trio fit a ~390px
  phone instead of overflowing.
- **Skill tree**: the tree is a fixed `width:720px` inside `.treewrap{overflow-x:auto}`. On
  phones, scale it to viewport width (CSS transform / responsive width) so the full serpentine
  path is visible without horizontal panning; keep pinch-zoom available.
- **Touch targets**: enlarge the `.chk` checkbox and node hit areas to ≥44px for tapping.
- **Safe area**: honor `env(safe-area-inset-*)` (notch/home indicator); `viewport-fit=cover`
  is already set.
- All of this is added under `@media (max-width:640px)` / additive rules — desktop view of the
  same file is unaffected.

## Deployment (GitHub Pages)

One-time, done by Tyler with commands I provide (I can't push to his account):
1. Create a GitHub repo, add it as remote, push.
2. Settings → Pages → serve from `main` branch, `/` root (or set the Pages source to the
   `phone/` folder via an action, or move `phone/*` to repo root of a dedicated Pages repo).
3. Open the resulting `https://<user>.github.io/<repo>/` URL on the phone → Share →
   Add to Home Screen. Import his Mac `state.json` once via the Import button.

## Explicitly out of scope (YAGNI)

- Cloud sync / real-time Mac↔phone state (manual export/import instead).
- Rewriting or touching the Mac server, `state.json`, or the schedule data.
- Native (App Store) packaging.
- Push notifications / reminders.

## Testing / verification

- Load `phone/index.html` in a mobile-emulated browser: tree renders, quest banner correct,
  toggling a session persists across reload (localStorage), export downloads valid JSON,
  import restores it.
- Lighthouse/PWA check: manifest valid, installable, service worker controls the page, offline
  reload works.
- Confirm the Mac app (`serve.py` → `dashboard.html`) still behaves identically (unchanged file).
