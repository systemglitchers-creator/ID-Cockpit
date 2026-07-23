# ID Cockpit Phone PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable, offline, self-contained phone build of the ID Cockpit skill-tree dashboard, with progress persisted on-device and synced Mac↔phone through a private GitHub Gist.

**Architecture:** A new `phone/` folder is a static PWA (served by GitHub Pages). It reuses the existing `dashboard.html` UI verbatim, swapping the 3 Python-server calls for a `localStorage` layer (`sync.js`) that also pulls/merges/pushes a shared Gist. The Mac app (`serve.py`/`platform_core.py`) gains additive, backward-compatible Gist sync so it shares the same source of truth. Merge is conflict-free: per session id, newest timestamp wins, keys union.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Service Worker + Web App Manifest, GitHub Gist REST API (`fetch` on client, `urllib` on Mac), Python 3 stdlib + Pillow (icon generation), pytest (existing).

**Branch:** `phone-pwa` (already created; spec committed).

---

## File Structure

```
ID Platform/
  phone/                       # CREATE — the deployable PWA (GitHub Pages serves this subpath)
    index.html                 # copy of dashboard.html + PWA head tags + local api() + SW register
    sync.js                    # Store (localStorage) + mergeSessions + Sync (Gist) + Settings wiring
    sw.js                      # service worker: precache shell, cache fonts, offline
    manifest.webmanifest       # installable metadata
    make_icons.py              # one-shot Pillow script that writes icons/*.png
    icons/
      icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon-180.png
  platform_core.py             # MODIFY — add merge_sessions + remote pull/push + config loader; updatedAt on toggle
  serve.py                     # MODIFY — pull-on-start, push-after-write (non-fatal, opt-in via config)
  tests/test_sync.py           # CREATE — unit tests for merge_sessions + config loader
  .gitignore                   # MODIFY — ignore sync.json (Mac token config)
  README.md                    # MODIFY — add "Phone app (PWA) + Gist sync" setup section
```

Responsibilities:
- **`phone/index.html`** — presentation + app bootstrap. Owns nothing about persistence beyond calling `Store`/`Sync`.
- **`phone/sync.js`** — all persistence + sync + settings state. Single source of storage truth on the client.
- **`phone/sw.js`** — offline caching only.
- **`platform_core.py`** — pure state logic + pure `merge_sessions` + thin remote I/O helpers.
- **`serve.py`** — HTTP + wiring sync into the existing endpoints.

---

## Task 1: Scaffold the `phone/` build (non-destructive copy)

**Files:**
- Create: `phone/index.html` (copied from `dashboard.html`)
- Modify: `.gitignore`

- [ ] **Step 1: Create the folder and copy the dashboard verbatim**

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p phone/icons
cp dashboard.html phone/index.html
```

- [ ] **Step 2: Ignore the Mac sync-config secret**

Append to `.gitignore` (create the line if absent):

```
sync.json
```

- [ ] **Step 3: Verify the copy renders unchanged in a browser**

Open `phone/index.html` via the preview browser. Expected: the skill tree renders, but the console shows failed `fetch` to `/api/status` (that's fine — fixed in Task 2). The tree + HUD are visible (falls back to empty progress).

- [ ] **Step 4: Commit**

```bash
git add phone/index.html .gitignore
git commit -m "chore: scaffold phone/ PWA build from dashboard.html"
```

---

## Task 2: Client persistence layer (`sync.js`) + wire local `api()`

Replaces the Python server with `localStorage`, keeping the existing `api()` call sites unchanged. Sync (Gist) functions are defined here too but are inert until configured (Task 7 wires the UI; the functions are complete now).

**Files:**
- Create: `phone/sync.js`
- Modify: `phone/index.html` (add `<script src="sync.js">`, replace `api()`, add `refreshFromStore`, register SW in `boot`, add `applyTreeZoom` hook)

- [ ] **Step 1: Create `phone/sync.js` with Store + merge + Sync**

```javascript
/* ID Cockpit — client persistence + Gist sync. No dependencies. */
(function (global) {
  "use strict";
  var STATE_KEY = "idcockpit.v1.state";
  var GIST_KEY  = "idcockpit.v1.gist";

  function ts(e) { return (e && (e.updatedAt || e.doneAt)) || ""; }

  // Conflict-free union merge: newest timestamp wins per session id.
  function mergeSessions(local, remote) {
    local = local || {}; remote = remote || {};
    var out = {}, ids = {};
    Object.keys(local).forEach(function (k) { ids[k] = 1; });
    Object.keys(remote).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (id) {
      var a = local[id], b = remote[id];
      if (!a) { out[id] = b; }
      else if (!b) { out[id] = a; }
      else { out[id] = ts(b) > ts(a) ? b : a; }
    });
    return out;
  }

  var Store = {
    getState: function () {
      try { var s = JSON.parse(localStorage.getItem(STATE_KEY)); if (s && s.sessions) return s; }
      catch (e) {}
      return { sessions: {} };
    },
    save: function (st) { localStorage.setItem(STATE_KEY, JSON.stringify(st)); },
    setEntry: function (id, done) {
      var st = Store.getState(), now = new Date().toISOString();
      st.sessions[id] = { done: !!done, doneAt: done ? now : null, updatedAt: now };
      Store.save(st);
      return st.sessions[id];
    },
    mergeRemote: function (remoteSessions) {
      var st = Store.getState();
      st.sessions = mergeSessions(st.sessions, remoteSessions || {});
      Store.save(st);
      return st;
    },
    replace: function (sessions) { Store.save({ sessions: sessions || {} }); }
  };

  var Sync = {
    _t: null, _refresh: null,
    cfg: function () { try { return JSON.parse(localStorage.getItem(GIST_KEY)) || {}; } catch (e) { return {}; } },
    setCfg: function (c) { localStorage.setItem(GIST_KEY, JSON.stringify(c)); },
    configured: function () { var c = Sync.cfg(); return !!(c.token && c.gistId); },
    _headers: function (c) { return { Authorization: "Bearer " + c.token, Accept: "application/vnd.github+json" }; },
    pull: function () {
      var c = Sync.cfg(); if (!c.token || !c.gistId) return Promise.resolve(false);
      return fetch("https://api.github.com/gists/" + c.gistId, { headers: Sync._headers(c) })
        .then(function (r) { if (!r.ok) throw new Error("gist " + r.status); return r.json(); })
        .then(function (g) {
          var f = g.files && g.files["state.json"];
          if (!f || !f.content) return false;
          var data = JSON.parse(f.content);
          Store.mergeRemote(data.sessions || {});
          return true;
        });
    },
    push: function () {
      var c = Sync.cfg(); if (!c.token || !c.gistId) return Promise.resolve(false);
      var body = { files: { "state.json": { content: JSON.stringify(Store.getState(), null, 2) } } };
      var h = Sync._headers(c); h["Content-Type"] = "application/json";
      return fetch("https://api.github.com/gists/" + c.gistId, { method: "PATCH", headers: h, body: JSON.stringify(body) })
        .then(function (r) { return r.ok; });
    },
    schedulePush: function () {
      if (!Sync.configured()) return;
      clearTimeout(Sync._t);
      Sync._t = setTimeout(function () { Sync.push().catch(function () {}); }, 1500);
    },
    syncNow: function () {
      if (!Sync.configured()) return Promise.resolve(false);
      return Sync.pull().then(function () { if (Sync._refresh) Sync._refresh(); return Sync.push(); });
    },
    start: function (refresh) {
      Sync._refresh = refresh;
      if (!Sync.configured()) return;
      Sync.pull().then(function (ok) { if (ok && refresh) refresh(); }).catch(function () {});
      global.addEventListener("online", function () {
        Sync.pull().then(function (ok) { if (ok && refresh) refresh(); return Sync.push(); }).catch(function () {});
      });
    }
  };

  global.IDStore = Store;
  global.IDSync = Sync;
  global.mergeSessions = mergeSessions;
})(window);
```

- [ ] **Step 2: Load `sync.js` before the inline script in `phone/index.html`**

In `phone/index.html`, find the final `<script>` block (the inline app script begins right after the `</svg>`/markup and contains `function api(`). Immediately BEFORE that `<script>` opening tag, insert:

```html
<script src="sync.js"></script>
```

- [ ] **Step 3: Replace the network `api()` with the local one**

In `phone/index.html`, replace this exact line:

```javascript
function api(p,o){return fetch(p,o).then(function(r){return r.json();});}
```

with:

```javascript
function api(p,o){
  return new Promise(function(resolve){
    if(p==="/api/status"){ resolve({done: IDStore.getState().sessions}); return; }
    var m=/^\/api\/session\/(.+)\/done$/.exec(p);
    if(m){
      var id=decodeURIComponent(m[1]); var body={};
      try{ body=JSON.parse((o&&o.body)||"{}"); }catch(e){}
      var entry=IDStore.setEntry(id, !!body.done);
      IDSync.schedulePush();
      resolve(entry); return;
    }
    if(p==="/api/import"){
      var b={}; try{ b=JSON.parse((o&&o.body)||"{}"); }catch(e){}
      resolve({imported:(b.ids||[]).length}); return;
    }
    resolve({});
  });
}
```

- [ ] **Step 4: Add `refreshFromStore` + `applyTreeZoom`, and register SW / start Sync in `boot()`**

In `phone/index.html`, replace this exact `boot()` definition and its call:

```javascript
function boot(){
  api("/api/status").then(function(s){STATUS=s;}).catch(function(){STATUS={done:{}};})
    .then(function(){
      document.body.classList.remove("loading");
      render();
      setTimeout(warpToActive,500);
    });
}
boot();
```

with:

```javascript
function refreshFromStore(){
  STATUS={done: IDStore.getState().sessions};
  render();
  if(openSi!==null) openPanel(openSi);
}
function applyTreeZoom(){
  var t=document.getElementById("tree"); if(!t) return;
  var vw=document.documentElement.clientWidth;
  if(vw<=640){ t.style.zoom=Math.max(0.4, Math.min(1,(vw-16)/720)); }
  else { t.style.zoom=""; }
}
window.addEventListener("resize", applyTreeZoom);
function boot(){
  api("/api/status").then(function(s){STATUS=s;}).catch(function(){STATUS={done:{}};})
    .then(function(){
      document.body.classList.remove("loading");
      render();
      applyTreeZoom();
      setTimeout(warpToActive,500);
      if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(function(){}); }
      IDSync.start(refreshFromStore);
    });
}
boot();
```

- [ ] **Step 5: Verify persistence in the preview browser**

Open `phone/index.html`. Expected: no `/api/status` fetch error now. Tick a session in a sector panel; reload the page; the tick persists (localStorage). Console clean.

- [ ] **Step 6: Commit**

```bash
git add phone/sync.js phone/index.html
git commit -m "feat(phone): localStorage persistence + Gist sync layer (inert until configured)"
```

---

## Task 3: PWA installability + offline (manifest + service worker)

**Files:**
- Create: `phone/manifest.webmanifest`, `phone/sw.js`
- Modify: `phone/index.html` (head tags)

- [ ] **Step 1: Create `phone/manifest.webmanifest`**

```json
{
  "name": "ID Cockpit",
  "short_name": "ID Cockpit",
  "description": "Infectious Disease study skill-tree schedule.",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#070510",
  "theme_color": "#070510",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Add PWA head tags to `phone/index.html`**

In `phone/index.html`, immediately AFTER the existing `<meta name="color-scheme" content="dark">` line, insert:

```html
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#070510">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ID Cockpit">
<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
```

- [ ] **Step 3: Create `phone/sw.js`**

```javascript
/* ID Cockpit service worker — offline shell + font caching. */
var CACHE = "idcockpit-v1";
var SHELL = [
  "./", "./index.html", "./sync.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () {}); // tolerate a missing optional asset
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       // never cache API writes
  var url = new URL(req.url);
  if (url.hostname === "api.github.com") return;           // sync traffic: always network

  var isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  var sameOrigin = url.origin === self.location.origin;

  if (isFont || sameOrigin) {
    // cache-first, refresh in background (stale-while-revalidate)
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
```

- [ ] **Step 4: Verify installability + offline in the preview browser**

Serve `phone/` over http (the preview browser uses an http origin). Load the page, then:
- Check console/application: a service worker is registered and activated.
- `navigator.serviceWorker.controller` is non-null after a reload.
- Toggle offline (or stop the server) and reload: the page still loads from cache.

Expected: page renders offline; manifest is detected as installable.

- [ ] **Step 5: Commit**

```bash
git add phone/manifest.webmanifest phone/sw.js phone/index.html
git commit -m "feat(phone): installable PWA + offline service worker"
```

---

## Task 4: App icons

**Files:**
- Create: `phone/make_icons.py`, `phone/icons/*.png`

- [ ] **Step 1: Create `phone/make_icons.py`**

```python
"""Generate ID Cockpit PWA icons. Run once: python phone/make_icons.py
Requires Pillow (pip install pillow). Draws a violet orb with 'ID' on the app bg."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BG = (7, 5, 16, 255)         # #070510
VIO = (123, 92, 255, 255)    # #7b5cff
VIO2 = (171, 151, 255, 255)  # #ab97ff
CYAN = (55, 230, 207, 255)   # #37e6cf

def _font(px):
    for name in ("Chakra Petch", "HelveticaNeue-Bold", "Arial Bold", "Arial"):
        try: return ImageFont.truetype(name, px)
        except Exception: pass
    return ImageFont.load_default()

def draw(size, pad_frac, apple=False):
    img = Image.new("RGBA", (size, size), BG if apple else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_frac)
    box = [pad, pad, size - pad, size - pad]
    # ring
    d.ellipse(box, fill=BG, outline=VIO, width=max(4, size // 24))
    # inner glow ring
    g = int(size * 0.06)
    d.ellipse([box[0] + g, box[1] + g, box[2] - g, box[3] - g], outline=CYAN, width=max(2, size // 60))
    # "ID"
    txt = "ID"
    f = _font(int(size * 0.34))
    tb = d.textbbox((0, 0), txt, font=f)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.text(((size - tw) / 2 - tb[0], (size - th) / 2 - tb[1]), txt, font=f, fill=VIO2)
    return img

draw(192, 0.10).save(OUT / "icon-192.png")
draw(512, 0.10).save(OUT / "icon-512.png")
draw(512, 0.20).save(OUT / "icon-maskable-512.png")   # extra safe-area padding
draw(180, 0.10, apple=True).save(OUT / "apple-touch-icon-180.png")
print("icons written to", OUT)
```

- [ ] **Step 2: Generate the icons**

```bash
cd "$(git rev-parse --show-toplevel)"
python3 -m pip install --quiet pillow
python3 phone/make_icons.py
ls phone/icons
```

Expected: `apple-touch-icon-180.png  icon-192.png  icon-512.png  icon-maskable-512.png`

- [ ] **Step 3: Eyeball the icons**

Open `phone/icons/icon-512.png` in the preview/Read tool. Expected: a violet ring with cyan inner ring and "ID" centered on the dark background.

- [ ] **Step 4: Commit**

```bash
git add phone/make_icons.py phone/icons
git commit -m "feat(phone): generated app icon set"
```

---

## Task 5: Mobile layout polish (phone-only CSS)

All rules are additive and gated on `@media (max-width:640px)`, so the desktop view of the same file is unchanged. `applyTreeZoom()` (Task 2) already fits the 720px tree to the viewport; this task fixes the HUD and tap targets.

**Files:**
- Modify: `phone/index.html` (append a `<style>` media block; safe-area on `.hud .in`)

- [ ] **Step 1: Append the mobile stylesheet**

In `phone/index.html`, immediately BEFORE the closing `</style>` of the main stylesheet, insert:

```css
/* ---- phone ---- */
@media (max-width:640px){
  .hud .in{flex-wrap:wrap;gap:12px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));padding-top:calc(10px + env(safe-area-inset-top,0px))}
  .xpwrap{order:3;flex-basis:100%}
  .hstats{gap:12px}
  .hstat .v{font-size:16px}
  .jbtn{padding:7px 10px}
  .quest{padding:0 14px}
  .qcard{flex-direction:column;align-items:flex-start;gap:10px}
  .qcard .qacts{margin-left:0}
  .treewrap{padding:20px 0 28px}
  /* larger tap targets in the sector panel */
  .chk{width:26px;height:26px}
  .q{padding-top:10px;padding-bottom:10px}
}
html{-webkit-text-size-adjust:100%}
```

- [ ] **Step 2: Verify on a mobile viewport**

In the preview browser, resize to mobile (375×812). Expected: the HUD wraps cleanly (XP bar on its own row), no horizontal page scroll, the full serpentine tree is visible (zoomed to fit), quest banner stacks, and the checkboxes are comfortably tappable. Also check 768px (tablet) is unaffected badly.

- [ ] **Step 3: Commit**

```bash
git add phone/index.html
git commit -m "feat(phone): responsive HUD, fitted tree, larger tap targets"
```

---

## Task 6: Settings panel — sync config, Sync now, Export/Import

Adds a self-contained overlay (independent of the existing sector panel) reachable from a HUD gear button.

**Files:**
- Modify: `phone/index.html` (HUD button + overlay markup + CSS + wiring)

- [ ] **Step 1: Add a gear button to the HUD**

In `phone/index.html`, find the existing jump button in the HUD markup:

```html
<button class="jbtn" id="jump">◎ Warp to active</button>
```

Immediately AFTER it, insert:

```html
<button class="jbtn" id="cfgBtn" title="Settings">⚙ Sync</button>
```

- [ ] **Step 2: Add the settings overlay markup**

In `phone/index.html`, immediately BEFORE the closing `</body>` tag, insert:

```html
<div id="cfgScrim" class="cfg-scrim"></div>
<div id="cfgModal" class="cfg-modal" role="dialog" aria-label="Sync settings">
  <div class="cfg-h">Sync &amp; Backup <button id="cfgClose" class="cfg-x">✕</button></div>
  <label class="cfg-l">GitHub token (gist scope)</label>
  <input id="cfgToken" class="cfg-i" type="password" autocomplete="off" placeholder="github_pat_…">
  <label class="cfg-l">Gist ID</label>
  <input id="cfgGist" class="cfg-i" type="text" autocomplete="off" placeholder="e.g. 3f9a…">
  <div class="cfg-row">
    <button id="cfgSave" class="qbtn go">Save</button>
    <button id="cfgSync" class="qbtn ghost">Sync now</button>
  </div>
  <div id="cfgStatus" class="cfg-s"></div>
  <div class="cfg-sep"></div>
  <div class="cfg-row">
    <button id="cfgExport" class="qbtn ghost">Export JSON</button>
    <button id="cfgImport" class="qbtn ghost">Import JSON</button>
    <input id="cfgFile" type="file" accept="application/json" hidden>
  </div>
</div>
```

- [ ] **Step 3: Add overlay CSS**

In `phone/index.html`, immediately BEFORE the closing `</style>` of the main stylesheet (after the phone media block from Task 5), insert:

```css
.cfg-scrim{position:fixed;inset:0;background:rgba(3,2,10,.72);opacity:0;pointer-events:none;transition:opacity .2s;z-index:90}
.cfg-scrim.on{opacity:1;pointer-events:auto}
.cfg-modal{position:fixed;z-index:91;left:50%;top:50%;transform:translate(-50%,-46%) scale(.98);opacity:0;pointer-events:none;transition:all .2s;width:min(420px,92vw);background:var(--panel2);border:1px solid var(--line);border-radius:16px;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 20px 60px rgba(0,0,0,.6)}
.cfg-modal.open{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}
.cfg-h{font-family:var(--disp);font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.cfg-x{background:none;border:0;color:var(--dim);font-size:16px;cursor:pointer}
.cfg-l{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:10px 0 5px}
.cfg-i{width:100%;background:#0b0820;border:1px solid var(--line);border-radius:9px;color:var(--txt);font-family:var(--mono);font-size:13px;padding:10px 11px}
.cfg-row{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}
.cfg-s{font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:10px;min-height:14px}
.cfg-sep{height:1px;background:var(--line);margin:16px 0 2px}
```

- [ ] **Step 4: Wire the overlay**

In `phone/index.html`, immediately BEFORE the `function boot(){` line, insert:

```javascript
(function setupSettings(){
  var scrim=document.getElementById("cfgScrim"), modal=document.getElementById("cfgModal");
  var status=document.getElementById("cfgStatus");
  function open(){
    var c=IDSync.cfg();
    document.getElementById("cfgToken").value=c.token||"";
    document.getElementById("cfgGist").value=c.gistId||"";
    status.textContent=IDSync.configured()?"Sync configured.":"Not configured — progress stays on this device.";
    scrim.classList.add("on"); modal.classList.add("open");
  }
  function close(){ scrim.classList.remove("on"); modal.classList.remove("open"); }
  document.getElementById("cfgBtn").onclick=open;
  document.getElementById("cfgClose").onclick=close;
  scrim.onclick=close;
  document.getElementById("cfgSave").onclick=function(){
    IDSync.setCfg({token:document.getElementById("cfgToken").value.trim(), gistId:document.getElementById("cfgGist").value.trim()});
    status.textContent="Saved. Syncing…";
    IDSync.syncNow().then(function(ok){ status.textContent=ok?"Synced ✓":"Saved (sync unavailable)."; })
      .catch(function(){ status.textContent="Saved, but sync failed — check token/gist."; });
  };
  document.getElementById("cfgSync").onclick=function(){
    status.textContent="Syncing…";
    IDSync.syncNow().then(function(ok){ status.textContent=ok?"Synced ✓":"Nothing to sync."; })
      .catch(function(){ status.textContent="Sync failed — check token/gist."; });
  };
  document.getElementById("cfgExport").onclick=function(){
    var blob=new Blob([JSON.stringify(IDStore.getState(),null,2)],{type:"application/json"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="id-cockpit-state.json"; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  };
  document.getElementById("cfgImport").onclick=function(){ document.getElementById("cfgFile").click(); };
  document.getElementById("cfgFile").onchange=function(e){
    var f=e.target.files[0]; if(!f) return;
    var rd=new FileReader();
    rd.onload=function(){
      try{
        var data=JSON.parse(rd.result);
        if(!data||typeof data.sessions!=="object") throw new Error("bad");
        IDStore.mergeRemote(data.sessions);
        refreshFromStore(); IDSync.schedulePush();
        status.textContent="Imported ✓";
      }catch(err){ status.textContent="Import failed — not a valid state file."; }
    };
    rd.readAsText(f); e.target.value="";
  };
})();
```

- [ ] **Step 5: Verify the settings flow**

In the preview browser: click **⚙ Sync** → overlay opens. Export downloads `id-cockpit-state.json`. Edit that file (flip one session to done) and Import it → the tree updates. Save with empty token → status says "stays on this device" and no errors.

- [ ] **Step 6: Commit**

```bash
git add phone/index.html
git commit -m "feat(phone): settings overlay — Gist config, sync now, export/import"
```

---

## Task 7: End-to-end Gist sync smoke test (client)

No new code — validates Task 2 + Task 6 against a real Gist. If you don't have a test Gist yet, create a private one with a single file `state.json` containing `{"sessions":{}}` and a fine-grained token with **Gist** read/write.

- [ ] **Step 1: Configure and push**

In the preview browser, open ⚙ Sync, paste token + gist id, Save. Tick a session. Wait ~2s. Expected: `cfgStatus` shows "Synced ✓" and the Gist's `state.json` now contains that session id with `done:true` + `updatedAt`.

- [ ] **Step 2: Pull merges remote → local**

Manually edit the Gist to add another session id as done. In the app, click **Sync now**. Expected: the tree gains that session's progress (merged), and the panel reflects it.

- [ ] **Step 3: No regression when offline/unconfigured**

Clear config (blank the fields, Save). Confirm ticking still works locally and reload persists. No console errors.

(No commit — verification only.)

---

## Task 8: Mac merge logic + config loader (TDD)

Pure functions first, with tests, mirroring the client merge exactly.

**Files:**
- Modify: `platform_core.py`
- Create: `tests/test_sync.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sync.py`:

```python
import json
import platform_core as core


def test_merge_prefers_newer_updatedat():
    local = {"a": {"done": True, "doneAt": "2026-07-01T00:00:00", "updatedAt": "2026-07-01T00:00:00"}}
    remote = {"a": {"done": False, "doneAt": None, "updatedAt": "2026-07-02T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert out["a"]["done"] is False  # remote is newer


def test_merge_unions_disjoint_keys():
    local = {"a": {"done": True, "updatedAt": "2026-07-01T00:00:00"}}
    remote = {"b": {"done": True, "updatedAt": "2026-07-01T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert set(out) == {"a", "b"}


def test_merge_falls_back_to_doneat_when_no_updatedat():
    local = {"a": {"done": True, "doneAt": "2026-07-05T00:00:00"}}
    remote = {"a": {"done": True, "doneAt": "2026-07-03T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert out["a"]["doneAt"] == "2026-07-05T00:00:00"  # local newer


def test_load_sync_config_from_file(tmp_path):
    (tmp_path / "sync.json").write_text(json.dumps({"token": "t", "gist_id": "g"}))
    cfg = core.load_sync_config(tmp_path)
    assert cfg == {"token": "t", "gist_id": "g"}


def test_load_sync_config_absent_returns_none(tmp_path, monkeypatch):
    monkeypatch.delenv("ID_GIST_TOKEN", raising=False)
    monkeypatch.delenv("ID_GIST_ID", raising=False)
    assert core.load_sync_config(tmp_path) is None


def test_toggle_writes_updatedat(tmp_path):
    sp = tmp_path / "state.json"
    entry = core.toggle_done(sp, "x1", True)
    assert entry["done"] is True and entry.get("updatedAt")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_sync.py -v`
Expected: FAIL — `AttributeError: module 'platform_core' has no attribute 'merge_sessions'` (and `load_sync_config`).

- [ ] **Step 3: Implement in `platform_core.py`**

Add these imports at the top of `platform_core.py` (alongside the existing `import json`):

```python
import json
import os
import urllib.request
from pathlib import Path
```

Update `toggle_done` to stamp `updatedAt` — replace its `entry = {...}` line:

```python
    now = _now_iso()
    entry = {"done": bool(done), "doneAt": now if done else None, "updatedAt": now}
```

Append these functions to `platform_core.py`:

```python
def _sync_ts(e):
    e = e or {}
    return e.get("updatedAt") or e.get("doneAt") or ""


def merge_sessions(local, remote):
    """Conflict-free union: newest timestamp wins per session id."""
    local = local or {}
    remote = remote or {}
    out = {}
    for i in set(local) | set(remote):
        a, b = local.get(i), remote.get(i)
        if a is None:
            out[i] = b
        elif b is None:
            out[i] = a
        else:
            out[i] = b if _sync_ts(b) > _sync_ts(a) else a
    return out


def load_sync_config(platform_dir):
    """Return {'token','gist_id'} from sync.json or env, else None."""
    p = Path(platform_dir) / "sync.json"
    if p.exists():
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            c = {}
        if c.get("token") and c.get("gist_id"):
            return {"token": c["token"], "gist_id": c["gist_id"]}
    tok, gid = os.environ.get("ID_GIST_TOKEN"), os.environ.get("ID_GIST_ID")
    if tok and gid:
        return {"token": tok, "gist_id": gid}
    return None


def _gist_request(cfg, data=None, method="GET"):
    req = urllib.request.Request(
        "https://api.github.com/gists/" + cfg["gist_id"],
        data=data, method=method,
        headers={
            "Authorization": "Bearer " + cfg["token"],
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "id-cockpit",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read()


def pull_remote(cfg):
    """Return the remote sessions map (or {} if unavailable)."""
    _, raw = _gist_request(cfg)
    g = json.loads(raw)
    f = (g.get("files") or {}).get("state.json")
    if not f or not f.get("content"):
        return {}
    return json.loads(f["content"]).get("sessions", {})


def push_remote(cfg, state):
    """Write the full state dict to the gist's state.json. Returns True on 2xx."""
    body = json.dumps({"files": {"state.json": {"content": json.dumps(state, indent=2)}}}).encode("utf-8")
    status, _ = _gist_request(cfg, data=body, method="PATCH")
    return 200 <= status < 300
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_sync.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add platform_core.py tests/test_sync.py
git commit -m "feat(sync): merge_sessions + gist pull/push + config loader (TDD)"
```

---

## Task 9: Wire sync into the Mac server (additive, non-fatal)

Sync is opt-in: with no `sync.json`/env, the server behaves exactly as before.

**Files:**
- Modify: `serve.py`

- [ ] **Step 1: Add a sync helper on the handler and pull-on-start**

In `serve.py`, add near the top (after `import platform_core as core`):

```python
def _sync_cfg():
    return core.load_sync_config(PLATFORM_DIR)
```

In `make_server(...)`, after `httpd.base_dir = ...`, insert a best-effort startup pull:

```python
    cfg = core.load_sync_config(PLATFORM_DIR)
    if cfg:
        try:
            state_path = Path(httpd.base_dir) / PLATFORM_DIR.name / "state.json"
            local = core.load_state(state_path)
            merged = {"sessions": core.merge_sessions(local["sessions"], core.pull_remote(cfg))}
            core._save_state(state_path, merged)
        except Exception:
            pass  # offline / bad token: keep local
```

- [ ] **Step 2: Push after each write**

In `serve.py` `do_POST`, after the `toggle_done` call and before `self._send_json(entry)`, insert:

```python
            cfg = _sync_cfg()
            if cfg:
                try: core.push_remote(cfg, core.load_state(self._state_path()))
                except Exception: pass
```

And after the `import_ids` call, before its `self._send_json(...)`, insert the same 3-line best-effort push block.

- [ ] **Step 3: Verify backward compatibility (no config)**

Run the existing suite: `python3 -m pytest -q`
Expected: all pass. Start the server with no `sync.json`: `python3 serve.py` prints the URL and serves `dashboard.html` as before; toggling still writes `state.json`.

- [ ] **Step 4: Verify with config (manual, optional)**

Create `sync.json` (`{"token":"…","gist_id":"…"}`), start the server, toggle a session in the Mac dashboard, and confirm the Gist updates; restart the server and confirm a remote-only change is pulled into local `state.json`.

- [ ] **Step 5: Commit**

```bash
git add serve.py
git commit -m "feat(sync): Mac server pulls on start + pushes after writes (opt-in)"
```

---

## Task 10: Publish docs (GitHub Pages + Gist setup)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a setup section to `README.md`**

Append:

```markdown
## Phone app (PWA) + Mac↔phone sync

The `phone/` folder is a self-contained installable web app. Progress is stored on the
device and synced through a private GitHub Gist.

### One-time setup
1. **Create the shared store:** make a **private** Gist with one file `state.json` containing
   your current Mac progress (copy the contents of `state.json`, or `{"sessions":{}}` to start).
   Note the Gist ID (the hash in its URL).
2. **Create a token:** GitHub → Settings → Developer settings → Fine-grained tokens → new token
   with **Gist: read and write**. Copy it.
3. **Publish the app:** push this repo to GitHub and enable Pages:
   ```bash
   git push -u origin main            # or your phone-pwa branch, then merge
   ```
   GitHub → repo → Settings → Pages → Source: Deploy from branch → `main` / `/root`.
   Your app URL is `https://<user>.github.io/<repo>/phone/`.
4. **Install on phone:** open that URL in Safari/Chrome → Share → **Add to Home Screen**.
5. **Connect sync:** open **⚙ Sync** in the app, paste the token + Gist ID, **Save**.
6. **Mac:** create `ID Platform/sync.json` = `{"token":"…","gist_id":"…"}` (gitignored).
   Restart `serve.py`. Both devices now share progress.

### Notes
- Works fully offline; syncs when back online.
- The token is stored only on your devices and is Gist-scoped (low risk). Never commit it.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: phone PWA + Gist sync setup instructions"
```

---

## Self-Review

- **Spec coverage:** storage shim (T2) ✓; export/import (T6) ✓; offline SW (T3) ✓; installable manifest/icons (T3,T4) ✓; mobile layout (T5, plus `applyTreeZoom` in T2) ✓; Gist sync client (T2,T6,T7) ✓; Mac-side sync additive + backward compatible (T8,T9) ✓; conflict-free merge with `updatedAt` (T8 tests, T2 mirror) ✓; GitHub Pages `/phone/` subpath via relative paths (T1–T3) ✓; security/gitignore (T1, T8 config, T10) ✓.
- **Type/name consistency:** client globals `IDStore`/`IDSync`/`mergeSessions`; store key `idcockpit.v1.state`, gist key `idcockpit.v1.gist`; Gist file name `state.json`; Python `merge_sessions`/`load_sync_config`/`pull_remote`/`push_remote`, config keys `token`/`gist_id`. Client cfg uses `gistId`, Python uses `gist_id` (different layers, intentional) — consistent within each.
- **Placeholders:** none; every code step is complete.
```
