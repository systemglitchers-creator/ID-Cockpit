# Bank Improvements — App (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bank tab show a real answer for every written question, keep grades safe offline, and surface owed drills on the home screen, in the evening nudge, and in Stats.

**Architecture:** Answer state moves into `public/sync.js` as `IDAnswers`, a local-cache-plus-merge-only-sync twin of the existing `IDServer` progress sync. A pure module `lib/bank.js` decides which chapters are owed a drill and how marks are scored; `public/app.js` carries a whitespace-identical copy (the app has no module loader) and a test pins parity. The service worker stops caching `/api/*`. Everything renders through the existing `render()` switch.

**Tech Stack:** Vanilla browser JS in `public/` (no build step), Node CommonJS in `api/` and `lib/`, `node --test` with the `tests/js/harness.mjs` vm sandbox, Vercel + Upstash Redis. Python 3 for the one bundle rebuild.

**Spec:** `docs/superpowers/specs/2026-09-01-bank-improvements-design.md`, Part A.

**Repo:** `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform` (call it `$APP`). Pipeline workspace for Task 4: `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank` (call it `$PIPE`).

**Read first:** the `id-cockpit` skill (`~/.claude/skills/id-cockpit/SKILL.md`). Two rules from it that matter here: bump `CACHE` in `public/sw.js` or the phone never sees the change; never rename icons by hand.

**Branch:** `git checkout -b bank/improvements` from `main` (main is at `b49b09f`, which already contains the Bank tab and the spec). Merge back to main at the end (Task 11). Note: this machine could not push in the last session (no GitHub credentials in a non-interactive shell); if `git push` fails, tell Tyler to push from a terminal.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `public/sync.js` | modify | add `IDAnswers`: local answer map + merge-only sync |
| `public/sw.js` | modify | never cache `/api/*`; bump `CACHE` to `idcockpit-web-v23` |
| `lib/bank.js` | create | `chapterSessionIds`, `owedChapters`, `marksFor`, `earnedFrom` (pure) |
| `lib/nudge.js` | modify | `compose(sections, progress, now, bank)` gains drill lines |
| `api/nudge.js` | modify | fetch `qbank/index.json` + answers, pass `bank` to `compose` |
| `public/app.js` | modify | Bank tab uses `IDAnswers`; card/reveal rule; flag; review-misses; owed mirror; home drill card; Stats block; flagged list |
| `public/index.html` | modify | `#drillCard`, `#bankStats`, CSS for the above |
| `$PIPE/scripts/build_bundle.py` | modify | index gains `deferred: [cqid]` and `marks: {cqid: n}` |
| `public/qbank/index.json` | regenerate | data only |
| `tests/js/answers-local.test.mjs` | create | `IDAnswers` behaviour |
| `tests/js/sw.test.mjs` | create | service worker bypasses `/api/` |
| `tests/js/bank-owed.test.mjs` | create | owed rule, ordering, parity with app copy |
| `tests/js/bank-marks.test.mjs` | create | marks arithmetic |
| `tests/js/answers-api.test.mjs` | modify | `chosen` + `flag` round-trip |
| `tests/js/nudge.test.mjs` | modify | drill-aware nudge cases |
| `tests/js/bank-view.test.mjs` | create | reveal rule, topic heading, drill card, stats block HTML |

Run the whole suite with `npm test` (that is `node --test "tests/js/*.test.mjs"`). It is green at 119 tests before you start; confirm that first.

---

### Task 1: `IDAnswers` — local answer cache with merge-only sync

**Files:**
- Modify: `public/sync.js` (insert before `var Sync = {` near line 99; export at the bottom)
- Test: `tests/js/answers-local.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/js/answers-local.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./harness.mjs";

/* IDAnswers is the Bank's answer store: localStorage is a cache, /api/answers is
   the truth, one POST both uploads and downloads. Same contract as IDServer. */

const KEY = "idcockpit.v1.answers";
const NOW = new Date(2026, 8, 1, 21, 0, 0);

function load(opts = {}) {
  return loadApp({ files: ["sync.js"], now: NOW, fetch: opts.fetch, storage: opts.storage });
}
const okFetch = (answers) => async (url, init) => ({
  ok: true, status: 200, json: async () => ({ answers }),
  _url: url, _init: init
});

test("set stamps ts, merges the patch into the record, and persists", () => {
  const app = load({ fetch: okFetch({}) });
  const rec = app.IDAnswers.set("Q1", { result: "got" });
  assert.equal(rec.result, "got");
  assert.equal(rec.ts, NOW.getTime());
  const stored = JSON.parse(app.localStorage.getItem(KEY));
  assert.equal(stored.Q1.result, "got");
  app.IDAnswers.set("Q1", { flag: true });
  const again = app.IDAnswers.get().Q1;
  assert.equal(again.result, "got", "a flag-only set keeps the result");
  assert.equal(again.flag, true);
});

test("get returns an empty map for missing or malformed storage", () => {
  assert.deepEqual(Object.keys(load().IDAnswers.get()), []);
  const bad = load({ storage: { [KEY]: "not json" } });
  assert.deepEqual(Object.keys(bad.IDAnswers.get()), []);
});

test("sync posts the whole local map and adopts the server's reply", async () => {
  let seen = null;
  const fetch = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), cache: init.cache };
    return { ok: true, status: 200, json: async () => ({ answers: { Q1: { result: "got", ts: 5 }, Q2: { result: "missed", ts: 7 } } }) };
  };
  const app = load({ fetch, storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  const ok = await app.IDAnswers.sync();
  assert.equal(ok, true);
  assert.equal(seen.url, "/api/answers");
  assert.equal(seen.cache, "no-store");
  assert.deepEqual(Object.keys(seen.body.answers), ["Q1"]);
  assert.equal(app.IDAnswers.get().Q2.result, "missed", "server reply replaces local");
});

test("a failed sync leaves local untouched and resolves false", async () => {
  const app = load({ fetch: async () => { throw new Error("offline"); },
                     storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  assert.equal(await app.IDAnswers.sync(), false);
  assert.equal(app.IDAnswers.get().Q1.result, "got");
  const app2 = load({ fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }),
                      storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  assert.equal(await app2.IDAnswers.sync(), false);
  assert.equal(app2.IDAnswers.get().Q1.result, "got");
});

test("start syncs once and calls refresh after a successful sync", async () => {
  let calls = 0;
  const app = load({ fetch: okFetch({ Q9: { result: "correct", ts: 1 } }) });
  app.IDAnswers.start(() => { calls++; });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(app.IDAnswers.get().Q9.result, "correct");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "$APP" && node --test tests/js/answers-local.test.mjs`
Expected: 5 failing tests, `TypeError: Cannot read properties of undefined (reading 'set')` (there is no `IDAnswers` yet).

- [ ] **Step 3: Add `IDAnswers` to `public/sync.js`**

Insert this block immediately before `var Sync = {` (after the closing `};` of `Server`):

```js
  /* ---- Bank answer-state ---------------------------------------------------
     The same contract as Server, for the question bank: localStorage is a
     cache, /api/answers is the truth, and one merge-only round trip both
     uploads and downloads. A grade is complete the moment it is tapped;
     the network is caught up with later. Records are {result, ts, chosen?,
     flag?}; newest ts wins per question on the server, nothing is ever
     deleted, so an empty phone can never erase anything. */
  var ANSWERS_KEY = "idcockpit.v1.answers";
  var Answers = {
    _t: null, _refresh: null, _inflight: false,

    get: function () {
      try {
        var a = JSON.parse(localStorage.getItem(ANSWERS_KEY));
        if (a && typeof a === "object" && !Array.isArray(a)) return a;
      } catch (e) {}
      return {};
    },
    replace: function (map) { localStorage.setItem(ANSWERS_KEY, JSON.stringify(map || {})); },

    /** Merge `patch` into the record for `cqid`, stamp it now, persist, sync. */
    set: function (cqid, patch) {
      var all = Answers.get(), rec = all[cqid] || {};
      Object.keys(patch || {}).forEach(function (k) { rec[k] = patch[k]; });
      rec.ts = Date.now();
      all[cqid] = rec;
      Answers.replace(all);
      Answers.schedule();
      return rec;
    },

    sync: function () {
      if (typeof fetch !== "function" || Answers._inflight) return Promise.resolve(false);
      Answers._inflight = true;
      return fetch("/api/answers", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: Answers.get() })
      })
        .then(function (r) { if (!r.ok) throw new Error("answers " + r.status); return r.json(); })
        .then(function (d) {
          if (!d || typeof d.answers !== "object" || d.answers === null) return false;
          Answers.replace(d.answers);          // server reply is the union; adopt it
          if (Answers._refresh) Answers._refresh();
          return true;
        })
        .catch(function () { return false; })   // offline: local stands, retry later
        .then(function (ok) { Answers._inflight = false; return ok; });
    },

    schedule: function () {
      clearTimeout(Answers._t);
      Answers._t = setTimeout(function () { Answers.sync(); }, 1200);
    },

    start: function (refresh) {
      Answers._refresh = refresh;
      Answers.sync();
      if (global.addEventListener) {
        global.addEventListener("online", function () { Answers.sync(); });
        global.addEventListener("visibilitychange", function () {
          if (!global.document || global.document.visibilityState === "visible") Answers.sync();
        });
      }
    }
  };

```

Then add the export. Change the bottom of the file from

```js
  global.IDStore = Store;
  global.IDSync = Sync;
  global.IDServer = Server;
```
to
```js
  global.IDStore = Store;
  global.IDSync = Sync;
  global.IDServer = Server;
  global.IDAnswers = Answers;
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/js/answers-local.test.mjs`
Expected: 5 passing.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test 2>&1 | tail -8` — expected `fail 0`.

```bash
git add public/sync.js tests/js/answers-local.test.mjs
git commit -m "feat: IDAnswers — local answer cache with merge-only sync

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Service worker never caches the API

**Files:**
- Modify: `public/sw.js:2` (CACHE) and the fetch handler (~line 26–31)
- Test: `tests/js/sw.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/js/sw.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/* The service worker must never answer /api/* from its cache: the answers map
   and the pushed schedule have to be current, not one launch stale. Everything
   else keeps cache-first-then-refresh, which is what gives the question bank
   offline-after-first-open. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://id-cockpit.vercel.app";

function loadSw() {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() }
  };
  const cache = { match: () => Promise.resolve(undefined), put: () => {}, add: () => Promise.resolve() };
  const sandbox = {
    self, URL, console, setTimeout, clearTimeout,
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), match: () => Promise.resolve(undefined) },
    fetch: () => Promise.resolve({ status: 200, clone() { return this; } }),
    clients: self.clients, navigator: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8"), sandbox, { filename: "sw.js" });
  return listeners;
}

function fire(listeners, url, method = "GET") {
  let handled = false;
  listeners.fetch({
    request: { method, url, mode: "cors" },
    respondWith() { handled = true; }
  });
  return handled;
}

test("GET /api/answers and /api/schedule go straight to the network", () => {
  const l = loadSw();
  assert.equal(fire(l, ORIGIN + "/api/answers"), false);
  assert.equal(fire(l, ORIGIN + "/api/schedule"), false);
});

test("question files and app code are still handled by the worker", () => {
  const l = loadSw();
  assert.equal(fire(l, ORIGIN + "/qbank/index.json"), true);
  assert.equal(fire(l, ORIGIN + "/qbank/ch82.json"), true);
  assert.equal(fire(l, ORIGIN + "/app.js"), true);
});

test("the cache name was bumped for this change", () => {
  const src = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const m = /var CACHE = "idcockpit-web-v(\d+)"/.exec(src);
  assert.ok(m && Number(m[1]) >= 23, "CACHE must be at least v23");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/js/sw.test.mjs`
Expected: first and third tests fail (`/api/answers` is handled → `true`; CACHE is v22). The second passes already.

- [ ] **Step 3: Edit `public/sw.js`**

Change line 2 from `var CACHE = "idcockpit-web-v22";` to `var CACHE = "idcockpit-web-v23";`.

In the fetch handler, after the line
```js
  if (url.hostname === "api.github.com") return;           // sync traffic: always network
```
add
```js
  // API traffic is never cached. The answers map and the pushed schedule have
  // to be current, not one launch stale — and POSTs were excluded above.
  if (url.origin === self.location.origin && url.pathname.indexOf("/api/") === 0) return;
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/js/sw.test.mjs` — expected 3 passing. Then `npm test 2>&1 | tail -8` — `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js tests/js/sw.test.mjs
git commit -m "fix: service worker bypasses /api/ so answers and schedule are never stale

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `lib/bank.js` — the owed rule and the marks rule

**Files:**
- Create: `lib/bank.js`
- Test: `tests/js/bank-owed.test.mjs`, `tests/js/bank-marks.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/js/bank-owed.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* A chapter is OWED when every one of its schedule sessions is read and at
   least one of its ready (non-deferred) questions has no grade. Catch-alls are
   never owed. Newest-read first. */

const require_ = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chapterSessionIds, owedChapters } = require_("../../lib/bank.js");
const src = fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8");
const SECTIONS = new Function(`${src}; return SECTIONS;`)();

const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
const read = (ids, t) => Object.fromEntries(ids.map((id) => [id, at(t)]));

const CH20 = { chapter: "Chapter 20", id: "ch20", title: "Penicillins", sector: "Drug Foundations — Completed",
               weeks: [1], cqids: ["Q1", "Q2"], deferred: ["Q2"] };
const CH24 = { chapter: "Chapter 24", id: "ch24", title: "Aminoglycosides", sector: "Drug Foundations — Completed",
               weeks: [1], cqids: ["Q3"], deferred: [] };
const CATCH = { chapter: "CATCHALL-LAB", id: "catchall-lab", title: "Lab", sector: "Catch-all",
                weeks: [], cqids: ["Q7"], deferred: [] };

test("chapterSessionIds finds every session of a chapter across sectors", () => {
  const ids = chapterSessionIds(SECTIONS, 20);
  assert.ok(ids.length >= 2, "chapter 20 has at least two sittings");
  assert.ok(ids.every((id) => id.startsWith("ch20-")));
  assert.deepEqual(chapterSessionIds(SECTIONS, 99999), []);
});

test("an unread chapter is not owed", () => {
  assert.deepEqual(owedChapters(SECTIONS, {}, [CH20], {}), []);
});

test("a read chapter with an ungraded ready question is owed, deferred excluded from the count", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  const owed = owedChapters(SECTIONS, p, [CH20], {});
  assert.equal(owed.length, 1);
  assert.equal(owed[0].id, "ch20");
  assert.equal(owed[0].remaining, 1, "Q2 is deferred and does not count");
  assert.equal(owed[0].total, 1);
  assert.equal(owed[0].readAt, new Date("2026-08-01T12:00:00Z").getTime());
});

test("graded ready questions clear the debt even when deferred ones remain", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  assert.deepEqual(owedChapters(SECTIONS, p, [CH20], { Q1: { result: "got", ts: 1 } }), []);
});

test("a flag without a result is not a grade", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  assert.equal(owedChapters(SECTIONS, p, [CH20], { Q1: { flag: true, ts: 1 } }).length, 1);
});

test("a chapter split across sittings is owed only once every sitting is read", () => {
  const ids = chapterSessionIds(SECTIONS, 20);
  const half = read(ids.slice(0, 1), "2026-08-01T12:00:00Z");
  assert.deepEqual(owedChapters(SECTIONS, half, [CH20], {}), []);
});

test("catch-alls are never owed", () => {
  assert.deepEqual(owedChapters(SECTIONS, {}, [CATCH], {}), []);
});

test("owed chapters come newest-read first", () => {
  const p = { ...read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z"),
              ...read(chapterSessionIds(SECTIONS, 24), "2026-08-05T12:00:00Z") };
  const owed = owedChapters(SECTIONS, p, [CH20, CH24], {});
  assert.deepEqual(owed.map((c) => c.id), ["ch24", "ch20"]);
});
```

```js
// tests/js/bank-marks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/* Marks: written = sum of part marks (a null mark counts 1); MCQ = 1.
   got/correct earn everything, partial earns half, missed/incorrect nothing. */

const require_ = createRequire(import.meta.url);
const { marksFor, earnedFrom } = require_("../../lib/bank.js");

test("marksFor sums parts and defaults a null mark to 1", () => {
  assert.equal(marksFor({ kind: "written", parts: [{ marks: 1.5 }, { marks: 1.5 }, { marks: 0.5 }] }), 3.5);
  assert.equal(marksFor({ kind: "written", parts: [{ marks: null }, { marks: 2 }] }), 3);
  assert.equal(marksFor({ kind: "written", parts: [] }), 0);
  assert.equal(marksFor({ kind: "mcq" }), 1);
});

test("earnedFrom maps results onto a full mark", () => {
  assert.equal(earnedFrom(3, "got"), 3);
  assert.equal(earnedFrom(3, "partial"), 1.5);
  assert.equal(earnedFrom(3, "missed"), 0);
  assert.equal(earnedFrom(1, "correct"), 1);
  assert.equal(earnedFrom(1, "incorrect"), 0);
  assert.equal(earnedFrom(3, undefined), 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/bank-owed.test.mjs tests/js/bank-marks.test.mjs`
Expected: every test fails with `Cannot find module '.../lib/bank.js'`.

- [ ] **Step 3: Create `lib/bank.js`**

```js
// lib/bank.js — which chapters are owed a drill, and how a drill is scored.
//
// Pure: schedule + progress + bank index + answers in, a list out. Used by
// api/nudge.js. public/app.js carries a copy of every function here with the
// same body (the app has no module loader); tests/js/bank-owed.test.mjs pins
// the two copies equal, so change them together.

/** Every session id whose title starts "Chapter <n>", across all sectors. */
function chapterSessionIds(sections, chapterNumber) {
  var num = String(chapterNumber), ids = [];
  (sections || []).forEach(function (s) {
    (s.rows || []).forEach(function (r) {
      var m = /^Chapter\s+(\d+)/.exec(r.r || "");
      if (m && m[1] === num) ids.push(r.id);
    });
  });
  return ids;
}

/**
 * Chapters that are read but not yet drilled, newest-read first.
 * @param sections  SECTIONS from schedule.js
 * @param progress  id -> {done, doneAt}
 * @param index     qbank/index.json chapters (with `deferred: [cqid]`)
 * @param answers   cqid -> {result, ts, ...}
 * @returns [{chapter, id, title, sector, remaining, total, readAt}]
 */
function owedChapters(sections, progress, index, answers) {
  progress = progress || {}; answers = answers || {};
  var out = [];
  (index || []).forEach(function (c) {
    if (!c.weeks || !c.weeks.length) return;           // catch-alls: available, never demanded
    var ids = chapterSessionIds(sections, String(c.chapter || "").replace(/^Chapter\s+/, ""));
    if (!ids.length) return;
    var readAt = 0;
    for (var i = 0; i < ids.length; i++) {
      var e = progress[ids[i]];
      if (!e || !e.done) return;
      var t = e.doneAt ? new Date(e.doneAt).getTime() : 0;
      if (t > readAt) readAt = t;
    }
    var deferred = {};
    (c.deferred || []).forEach(function (q) { deferred[q] = 1; });
    var ready = (c.cqids || []).filter(function (q) { return !deferred[q]; });
    var remaining = ready.filter(function (q) { var a = answers[q]; return !(a && a.result); });
    if (!remaining.length) return;
    out.push({ chapter: c.chapter, id: c.id, title: c.title, sector: c.sector,
               remaining: remaining.length, total: ready.length, readAt: readAt });
  });
  out.sort(function (a, b) { return b.readAt - a.readAt; });
  return out;
}

/** Marks available for a question: MCQ 1; written = sum of parts, null = 1. */
function marksFor(q) {
  if (q.kind === "mcq") return 1;
  return (q.parts || []).reduce(function (s, p) {
    return s + (p.marks == null ? 1 : Number(p.marks));
  }, 0);
}

/** Marks earned from a full mark and a result string. */
function earnedFrom(full, result) {
  if (result === "got" || result === "correct") return full;
  if (result === "partial") return full / 2;
  return 0;
}

module.exports = { chapterSessionIds, owedChapters, marksFor, earnedFrom };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/js/bank-owed.test.mjs tests/js/bank-marks.test.mjs` — expected 10 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/bank.js tests/js/bank-owed.test.mjs tests/js/bank-marks.test.mjs
git commit -m "feat: lib/bank.js — owed-chapter rule and marks arithmetic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Index gains `deferred` and `marks` (data only)

The app and the nudge need, per chapter, which cqids are deferred and how many marks each question carries, without loading 277 chapter files. Both come from the bundle builder.

**Files:**
- Modify: `$PIPE/scripts/build_bundle.py` (the `index.append({...})` call near the bottom)
- Regenerate: `$APP/public/qbank/index.json`

- [ ] **Step 1: Edit the index record in `build_bundle.py`**

Change
```python
    index.append({"chapter": ch, "id": meta["id"], "title": meta["title"],
                  "sector": meta["sector"], "weeks": meta["weeks"],
                  "n_total": len(out),
                  "n_mcq": sum(1 for r in out if r["kind"] == "mcq"),
                  "n_written": sum(1 for r in out if r["kind"] == "written"),
                  "n_deferred": sum(1 for r in out if r["needs"]),
                  "cqids": [r["cqid"] for r in out]})
```
to
```python
    def marks_for(r):
        if r["kind"] == "mcq":
            return 1
        return sum(1 if p.get("marks") is None else float(p["marks"]) for p in r["parts"])
    index.append({"chapter": ch, "id": meta["id"], "title": meta["title"],
                  "sector": meta["sector"], "weeks": meta["weeks"],
                  "n_total": len(out),
                  "n_mcq": sum(1 for r in out if r["kind"] == "mcq"),
                  "n_written": sum(1 for r in out if r["kind"] == "written"),
                  "n_deferred": sum(1 for r in out if r["needs"]),
                  "cqids": [r["cqid"] for r in out],
                  "deferred": [r["cqid"] for r in out if r["needs"]],
                  "marks": {r["cqid"]: marks_for(r) for r in out}})
```

- [ ] **Step 2: Rebuild and confirm only the index changed**

Run:
```bash
cd "$PIPE" && python3 scripts/build_bundle.py
cd "$APP" && git status --short public/qbank | wc -l
python3 -c "
import json; c=json.load(open('public/qbank/index.json'))['chapters']
ch=[x for x in c if x['id']=='ch20'][0]; print(len(ch['deferred']), ch['n_deferred'], list(ch['marks'].items())[:2])"
```
Expected: the builder prints `276 chapters, 4034 placements`; `wc -l` prints `1` (only `index.json` differs — chapter files are byte-identical); the python line prints `22 22 [('Q0016', <n>), ...]` where the two counts are equal.

If `wc -l` is more than 1, stop: the chapter files changed, which means the pipeline data moved under you. Diff one and find out why before continuing.

- [ ] **Step 3: Log and commit**

Append to `$PIPE/data/PIPELINE_LOG.md`:
```
## 2026-09-01 — index.json gains `deferred` and `marks`

build_bundle.py now writes, per chapter, `deferred: [cqid]` (the list behind the
existing n_deferred count) and `marks: {cqid: marks available}`. Needed by the
Cockpit's owed-chapter rule and Stats without loading chapter files. Rebuilt;
only index.json changed.
```

```bash
cd "$APP" && git add public/qbank/index.json
git commit -m "data: index carries deferred cqids and marks per question

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Bank tab runs on `IDAnswers` (chosen letter, flag, honest review pass)

Replace the in-memory `bkAnswers` map with the store. This task changes behaviour only; the card and reveal visuals are Task 6.

**Files:**
- Modify: `public/app.js` — the Bank section (from `// ---- Bank: the question bank` to the end of the delegated click listener) and the boot lines near the bottom
- Test: `tests/js/bank-view.test.mjs` (created here, extended in later tasks)

- [ ] **Step 1: Write the failing test**

```js
// tests/js/bank-view.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

/* The Bank tab's logic, driven through the functions app.js exposes on
   window.IDCockpit. Rendering is checked as HTML strings on the fake DOM. */

const NOW = new Date(2026, 8, 1, 21, 0, 0);
const KEY = "idcockpit.v1.answers";

const CHAPTER = {
  chapter: "Chapter 101", id: "ch101", title: "Acute Dysentery Syndromes",
  sector: "Enteric", weeks: [9], mandell: "pp. 1–2",
  questions: [
    { cqid: "W1", kind: "written", needs: [], recurrence: ["AB 2018", "MB 2018"], source: "AB 2018, MB 2018",
      question: "A patient presents with bloody diarrhea. Diagnosed with E. coli O157.",
      parts: [{ text: "What is the pathogenesis? (1.5)", marks: 1.5 }, { text: "Three risk factors for HUS (1.5)", marks: 1.5 }],
      model_answer: null, cites: null, beyond_mandell: null, uncertain: false,
      cohort_answer: { text: "Shiga toxin…", source: "AB 2018 (answer slide)" } },
    { cqid: "W2", kind: "written", needs: [], recurrence: [], source: "MB 2016",
      question: "HPV", parts: [{ text: "Two serotypes causing 70–90% of malignancies", marks: null }],
      model_answer: "16 and 18.", cites: "Mandell pp. 1–2", beyond_mandell: null, uncertain: false,
      cohort_answer: { text: "HPV 16, 18", source: "H-decks" } },
    { cqid: "M1", kind: "mcq", needs: [], recurrence: [], source: "Comprehensive Review of ID · Quiz 1 Q1",
      stem: "A 24-year-old man…", lead_in: "Best regimen?", correct: "D",
      options: [{ letter: "A", text: "x" }, { letter: "D", text: "y" }], explanation: "Because." },
    { cqid: "W3", kind: "written", needs: ["Chapter 130 — HIV"], recurrence: [], source: "MB 2013",
      question: "Deferred one", parts: [{ text: "Part", marks: 1 }],
      model_answer: null, cites: null, beyond_mandell: null, uncertain: false, cohort_answer: null }
  ]
};
const INDEX = { chapters: [{ chapter: "Chapter 101", id: "ch101", title: "Acute Dysentery Syndromes", sector: "Enteric",
  weeks: [9], n_total: 4, n_mcq: 1, n_written: 3, n_deferred: 1,
  cqids: ["W1", "W2", "M1", "W3"], deferred: ["W3"], marks: { W1: 3, W2: 1, M1: 1, W3: 1 } }] };

function fetchFor(answers = {}) {
  return async (url, init) => {
    if (url === "qbank/index.json") return { ok: true, status: 200, json: async () => INDEX };
    if (url === "qbank/ch101.json") return { ok: true, status: 200, json: async () => CHAPTER };
    if (url === "/api/answers") return { ok: true, status: 200, json: async () => ({ answers: { ...answers, ...JSON.parse(init.body).answers } }) };
    if (url === "/api/schedule") return { ok: true, status: 204, json: async () => null };
    if (url === "/api/progress") return { ok: true, status: 200, json: async () => ({ sessions: {} }) };
    throw new Error("unexpected " + url);
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function openChapter(app) {
  app.IDCockpit.bankOpen("ch101");
  await tick(); await tick();
}

test("grading writes to IDAnswers with the chosen letter and moves on", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);
  const B = app.IDCockpit.bank;
  assert.equal(B().queue.length, 3, "deferred W3 is hidden by default");
  assert.equal(B().at, 0);
  app.IDCockpit.bankGrade("got");
  assert.equal(app.IDAnswers.get().W1.result, "got");
  assert.equal(B().at, 1);
  app.IDCockpit.bankPick("D"); app.IDCockpit.bankGrade("correct");   // W2 is at 1; skip to M1 by grading W2 first
});

test("opening a chapter skips questions that already have a result but not flag-only ones", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 }, W2: { flag: true, ts: 1 } }) });
  await tick(); await tick();                     // IDAnswers.start pulls the server map
  await openChapter(app);
  assert.equal(app.IDCockpit.bank().queue[app.IDCockpit.bank().at].cqid, "W2");
});

test("flagging stores a flag without touching the result", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "partial", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);
  app.IDCockpit.bankFlag("W1");
  const rec = app.IDAnswers.get().W1;
  assert.equal(rec.flag, true);
  assert.equal(rec.result, "partial");
  app.IDCockpit.bankFlag("W1");
  assert.equal(app.IDAnswers.get().W1.flag, false);
});

test("review misses re-queues without deleting grades; regrading writes a newer ts", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "missed", ts: 1 }, W2: { result: "got", ts: 1 }, M1: { result: "incorrect", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);
  assert.equal(app.IDCockpit.bank().at, 3, "everything graded lands on the summary");
  app.IDCockpit.bankReviewMisses();
  const b = app.IDCockpit.bank();
  assert.deepEqual(Array.from(b.queue.map((q) => q.cqid)), ["W1", "M1"]);
  assert.equal(b.at, 0);
  assert.equal(app.IDAnswers.get().W1.result, "missed", "nothing deleted");
  app.IDCockpit.bankGrade("got");
  assert.equal(app.IDAnswers.get().W1.result, "got");
  assert.equal(app.IDAnswers.get().W1.ts, NOW.getTime());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/js/bank-view.test.mjs`
Expected: 4 failures, `TypeError: app.IDCockpit.bankOpen is not a function`.

- [ ] **Step 3: Rewrite the Bank state and grading in `public/app.js`**

Replace the state line
```js
  var bkIndex = null, bkChapter = null, bkQueue = [], bkAt = 0,
      bkPicked = null, bkShown = false, bkDeferred = false, bkAnswers = {};
```
with
```js
  var bkIndex = null, bkIndexFailed = false, bkLoading = false,
      bkChapter = null, bkQueue = [], bkAt = 0,
      bkPicked = null, bkShown = false, bkDeferred = false,
      bkReview = false,      // a "review misses" pass: don't skip graded questions
      bkFlagList = false;    // the cross-chapter flagged list is showing

  /** The answer map. localStorage is the cache; IDAnswers syncs it. */
  function bankAnswers() { return window.IDAnswers.get(); }
  function graded(a) { return !!(a && a.result); }

  /** Load qbank/index.json once. On success re-renders; on failure only marks
      the failure (a render here would loop forever offline with no cache). */
  function bankLoadIndex() {
    if (bkIndex || bkLoading) return;
    bkLoading = true;
    bankFetch("qbank/index.json").then(function (d) {
      bkLoading = false;
      if (d && d.chapters) { bkIndex = d.chapters; bkIndexFailed = false; render(); }
      else { bkIndexFailed = true; if (tab === "bank") $("v-bank").innerHTML = '<div class="bkdef">Question bank not available.</div>'; }
    });
  }
```

Replace the loading branch at the top of `renderBank`
```js
    if (!bkIndex) {
      $("v-bank").innerHTML = '<div class="bkdef">Loading question bank…</div>';
      bankFetch("qbank/index.json").then(function (d) {
        if (!d) { $("v-bank").innerHTML = '<div class="bkdef">Question bank not available.</div>'; return; }
        bkIndex = d.chapters;
        bankFetch("/api/answers").then(function (a) {
          if (a && a.answers) bkAnswers = a.answers;
          if (tab === "bank") renderBank();
        });
      });
      return;
    }
    if (bkChapter) return bkAt >= bkQueue.length ? bankSummary() : bankQuestion();
```
with
```js
    if (!bkIndex) {
      $("v-bank").innerHTML = '<div class="bkdef">' +
        (bkIndexFailed ? "Question bank not available." : "Loading question bank…") + "</div>";
      if (!bkIndexFailed) bankLoadIndex();
      return;
    }
    if (bkFlagList) return bankFlagged();
    if (bkChapter) return bkAt >= bkQueue.length ? bankSummary() : bankQuestion();
```

In the chapter-list loop of `renderBank`, change
```js
        var done = c.cqids.filter(function (q) { return bkAnswers[q]; }).length;
```
to
```js
        var A = bankAnswers();
        var done = c.cqids.filter(function (q) { return graded(A[q]); }).length;
```

Replace `bankOpen` and `bankStart` with
```js
  /** Open a chapter; `focus` (a cqid) starts at that question, showing deferred
      ones if it is one of them. */
  function bankOpen(id, focus) {
    bankFetch("qbank/" + encodeURIComponent(id) + ".json").then(function (d) {
      if (!d) return;
      bkChapter = d; bkDeferred = false; bkFlagList = false;
      if (focus) {
        var fq = null;
        d.questions.forEach(function (q) { if (q.cqid === focus) fq = q; });
        if (fq && fq.needs.length) bkDeferred = true;
      }
      bankStart(focus);
    });
  }

  function bankStart(focus) {
    bkQueue = bkChapter.questions.filter(function (q) { return bkDeferred || !q.needs.length; });
    bkAt = 0; bkReview = false;
    var A = bankAnswers();
    if (focus) {
      bkQueue.forEach(function (q, i) { if (q.cqid === focus) bkAt = i; });
    } else {
      while (bkAt < bkQueue.length && graded(A[bkQueue[bkAt].cqid])) bkAt++;
    }
    bkPicked = null; bkShown = false;
    setBankAccent(sectorAccent(bkChapter.sector));
    render();
  }
```

Replace `bankGrade` with
```js
  function bankGrade(result) {
    var q = bkQueue[bkAt];
    var patch = { result: result };
    if (q.kind === "mcq") patch.chosen = bkPicked;
    window.IDAnswers.set(q.cqid, patch);      // local now, server when it can
    bkAt++; bkPicked = null; bkShown = false;
    render();
  }

  /** Toggle the flag on a question; re-paints the button in place. */
  function bankFlag(cqid) {
    var rec = bankAnswers()[cqid] || {};
    window.IDAnswers.set(cqid, { flag: !rec.flag });
    var b = $("bkflag"); if (b && b.classList) b.classList.toggle("on", !rec.flag);
  }

  /** Re-queue this chapter's missed, incorrect and partial questions. Grades
      are kept: a re-grade is a newer entry, never a deletion. */
  function bankReviewMisses() {
    var A = bankAnswers();
    var m = bkQueue.filter(function (q) {
      var a = A[q.cqid];
      return a && (a.result === "missed" || a.result === "incorrect" || a.result === "partial");
    });
    if (!m.length) { bankExit(); return; }
    bkReview = true; bkQueue = m; bkAt = 0; bkPicked = null; bkShown = false;
    render();
  }

  function bankPick(letter) {
    bkPicked = letter;
    Array.prototype.forEach.call($("v-bank").querySelectorAll(".bkopt"), function (el) {
      el.classList.toggle("sel", el.dataset.opt === bkPicked);
    });
    $("bkacts").innerHTML = '<button class="go" id="bksubmit">Submit answer</button>';
  }
```

In `bankExit`, change `bkPicked = null; bkShown = false; bkDeferred = false;` to
`bkPicked = null; bkShown = false; bkDeferred = false; bkReview = false; bkFlagList = false;`.

In `bankSummary`, change
```js
    var got = 0, part = 0, miss = 0;
    bkQueue.forEach(function (q) {
      var a = bkAnswers[q.cqid]; if (!a) return;
```
to
```js
    var got = 0, part = 0, miss = 0, A = bankAnswers();
    bkQueue.forEach(function (q) {
      var a = A[q.cqid]; if (!graded(a)) return;
```

In the delegated click listener, replace the option branch
```js
    var opt = t.closest && t.closest(".bkopt");
    if (opt && !bkShown && bkChapter) {
      bkPicked = opt.dataset.opt;
      Array.prototype.forEach.call($("v-bank").querySelectorAll(".bkopt"), function (el) {
        el.classList.toggle("sel", el.dataset.opt === bkPicked);
      });
      $("bkacts").innerHTML = '<button class="go" id="bksubmit">Submit answer</button>';
      return;
    }
```
with
```js
    var opt = t.closest && t.closest(".bkopt");
    if (opt && !bkShown && bkChapter) { bankPick(opt.dataset.opt); return; }
    if (t.closest && t.closest("#bkflag") && bkChapter) { bankFlag(bkQueue[bkAt].cqid); return; }
```
and replace the whole `#bkmiss` branch
```js
    if (t.closest && t.closest("#bkmiss")) {
      var m = bkQueue.filter(function (q) {
        ...
      });
      if (!m.length) { bkChapter = null; setBankAccent(null); render(); return; }
      m.forEach(function (q) { delete bkAnswers[q.cqid]; });
      bkQueue = m; bkAt = 0; bkPicked = null; bkShown = false; render();
      return;
    }
```
with
```js
    if (t.closest && t.closest("#bkmiss")) { bankReviewMisses(); return; }
```

Also in that listener, change
```js
    var bankTab = t.closest && t.closest('[data-tab="bank"]');
    if (bankTab && tab === "bank" && bkChapter) { bankExit(); return; }
```
to
```js
    var bankTab = t.closest && t.closest('[data-tab="bank"]');
    if (bankTab) {
      if (!bkIndex) bkIndexFailed = false;      // a fresh tap retries a failed index load
      window.IDAnswers.schedule();              // catch up with the other device
      if (tab === "bank" && (bkChapter || bkFlagList)) { bankExit(); return; }
    }
```

Add a stub `bankFlagged` (filled in Task 9) right after `bankSummary`:
```js
  function bankFlagged() { $("v-bank").innerHTML = ""; }
```

At the boot section, after `window.IDServer.start(refresh);` add
```js
  // Bank answers: same shape of sync as progress. Don't repaint mid-question —
  // a reveal panel that vanishes under the thumb is worse than a stale ring.
  window.IDAnswers.start(function () { if (tab === "bank" && bkChapter) return; render(); });
  bankLoadIndex();   // the home card needs the index before the Bank tab is ever opened
```

Extend the exposed test surface at the very bottom:
```js
  window.IDCockpit = { compute: compute, cleanTitle: cleanTitle, partOf: partOf,
                       groupByChapter: groupByChapter, dayPlan: dayPlan, weekView: weekView,
                       duskActive: duskActive,
                       chapNum: chapNum, dayDate: dayDate, studyIdx: studyIdx, isFlex: isFlex,
                       bankOpen: bankOpen, bankGrade: bankGrade, bankFlag: bankFlag, bankPick: bankPick,
                       bankReviewMisses: bankReviewMisses,
                       bank: function () { return { queue: bkQueue, at: bkAt, chapter: bkChapter, index: bkIndex }; } };
```

- [ ] **Step 4: Run the new tests, then the suite**

Run: `node --test tests/js/bank-view.test.mjs` — expected 4 passing.
Run: `npm test 2>&1 | tail -8` — expected `fail 0`. If an older test now hits `unexpected network call` for `qbank/index.json`, it is because `bankLoadIndex()` runs at boot: `bankFetch` catches rejections, so this should not happen, but if it does, the harness's default `fetch` rejects with a promise and `bankFetch` swallows it — check `bankFetch` still wraps `.catch`.

- [ ] **Step 5: Commit**

```bash
git add public/app.js tests/js/bank-view.test.mjs
git commit -m "feat: Bank tab keeps answers in IDAnswers — chosen letter, flags, honest review pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The question card and the reveal rule

**Files:**
- Modify: `public/app.js` — `bankQuestion`, `bankReveal`
- Modify: `public/index.html` — Bank CSS block
- Test: `tests/js/bank-view.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

```js
test("the card shows marks per part, strips the trailing '(1.5)', and counts recurrences", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /Asked 2 times · AB 2018, MB 2018/);
  assert.match(html, /class="bkmk">1\.5 marks</);
  assert.doesNotMatch(html, /\(1\.5\)/, "the bracketed mark is not repeated in the text");
  assert.match(html, /id="bkflag"/);
});

test("a bare topic stem renders as a heading, not the big serif stem", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);                       // lands on W2 ("HPV")
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /class="bktopic">HPV</);
  assert.doesNotMatch(html, /class="bkstem">HPV</);
});

test("reveal: cohort-only questions show the documented answer as the primary box", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);                       // W1: no model answer, cohort present
  app.IDCockpit.bankReveal();
  const html = app._elements.get("bkrev").innerHTML;
  assert.match(html, /Documented answer · AB 2018 \(answer slide\)/);
  assert.match(html, /class="bkans">Shiga toxin…</);
  assert.doesNotMatch(html, /Prior cohort answer/, "not repeated as secondary");
  assert.doesNotMatch(html, /class="bkans"><\/div>/, "no empty box");
});

test("reveal: a Mandell draft is primary with the cohort answer secondary", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);                       // W2
  app.IDCockpit.bankReveal();
  const html = app._elements.get("bkrev").innerHTML;
  assert.match(html, /Model answer · Mandell pp\. 1–2/);
  assert.match(html, /class="bkans">16 and 18\.</);
  assert.match(html, /Prior cohort answer · H-decks/);
});

test("reveal: neither answer says so instead of drawing a blank", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 }, W2: { result: "got", ts: 1 }, M1: { result: "correct", ts: 1 } }) });
  await tick(); await tick();
  app.IDCockpit.bankOpen("ch101", "W3");        // deferred, no answers at all
  await tick(); await tick();
  app.IDCockpit.bankReveal();
  assert.match(app._elements.get("bkrev").innerHTML, /No answer on file/);
});
```

Add `bankReveal: bankReveal,` to the `window.IDCockpit` export.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/bank-view.test.mjs` — expected the 5 new tests fail (no `bkmk`, no `bktopic`, `bankReveal` not exported).

- [ ] **Step 3: Rewrite `bankQuestion` and the written branch of `bankReveal`**

Add these helpers just above `bankQuestion`:
```js
  /** "HPV", "Enterococcus IE", "" — a topic label, not a stem. */
  function isTopic(t) {
    t = String(t || "").trim();
    if (!t) return true;
    return t.replace(/[.:]$/, "").length < 25 && t.split(/\s+/).length <= 4 && !/\?/.test(t);
  }
  function partText(p) { return String(p.text || "").replace(/\s*\(\s*[\d.]+\s*\)\s*$/, ""); }
  function marksPill(n) {
    return n == null ? "" : '<span class="bkmk">' + esc(n) + (Number(n) === 1 ? " mark" : " marks") + "</span>";
  }
  function askedLine(q) {
    var n = (q.recurrence || []).length;
    if (!n) return esc(q.source || "");
    return "Asked " + n + (n === 1 ? " time" : " times") + " · " + esc(q.recurrence.slice(0, 3).join(", "));
  }
```

Replace `bankQuestion` with
```js
  function bankQuestion() {
    var q = bkQueue[bkAt], h = "", rec = bankAnswers()[q.cqid] || {};
    // Mid-chapter escape hatch. Without this the only way out of a chapter was to
    // answer every question to reach the summary.
    h += '<button class="bkexit" id="bkback">← All chapters</button>';
    h += '<div class="bkq"><div class="bkhead"><div><div class="qk">' +
         (q.kind === "mcq" ? "Multiple choice" : "Written · Royal College") + "</div>" +
         '<div class="qp">' + askedLine(q) + "</div></div>" +
         '<button class="bkflagbtn' + (rec.flag ? " on" : "") + '" id="bkflag" title="Flag for later">⚑</button></div>';
    if (q.kind === "mcq") {
      h += '<div class="bkstem">' + esc(q.stem) + "</div>";
      if (q.lead_in) h += '<div class="bkparts" style="padding:0;font-weight:700;margin-top:12px">' +
                          esc(q.lead_in) + "</div>";
      h += '<ul class="bkopts">' + q.options.map(function (o) {
        return '<li class="bkopt" data-opt="' + esc(o.letter) + '"><span class="bkltr">' +
               esc(o.letter) + '</span><span class="t">' + esc(o.text) + "</span></li>";
      }).join("") + "</ul>";
    } else {
      h += isTopic(q.question)
        ? (q.question ? '<div class="bktopic">' + esc(q.question) + "</div>" : "")
        : '<div class="bkstem">' + esc(q.question) + "</div>";
      h += '<ol class="bkparts">' + (q.parts || []).map(function (p, i) {
        return '<li><span class="tx">' + String.fromCharCode(97 + i) + ") " + esc(partText(p)) + "</span>" +
               marksPill(p.marks) + "</li>";
      }).join("") + "</ol>";
    }
    h += '<div class="bkacts" id="bkacts"></div></div><div id="bkrev"></div>';
    var nDef = bkChapter.questions.filter(function (x) { return x.needs.length; }).length;
    if (!bkDeferred && nDef) {
      h += '<div class="bkdef">' + nDef + ' question' + (nDef > 1 ? "s need" : " needs") +
           ' a chapter you haven’t read yet. <button id="bkshowdef">Show anyway</button></div>';
    }
    $("v-bank").innerHTML = h;
    if (q.kind === "written") {
      $("bkacts").innerHTML = '<button class="go" id="bkreveal">Reveal answer</button>';
    }
  }

  /** The written-answer block: which answer is primary, and what sits under it. */
  function answerBlock(q) {
    var h = "", co = q.cohort_answer && q.cohort_answer.text ? q.cohort_answer : null;
    if (q.model_answer) {
      h += '<div class="chip">Model answer · ' + esc(q.cites || "Mandell") + "</div>";
      h += '<div class="bkans">' + esc(q.model_answer) + "</div>";
    } else if (co) {
      h += '<div class="chip">Documented answer · ' + esc(co.source || "prior cohort") + "</div>";
      h += '<div class="bkans">' + esc(co.text) + "</div>";
    } else {
      h += '<div class="chip">No answer on file</div>';
    }
    if (q.beyond_mandell) h += '<div class="bkgold"><b>Beyond Mandell.</b> ' + esc(q.beyond_mandell) + "</div>";
    if (q.model_answer && co) h += '<div class="bkcohort"><b>Prior cohort answer · ' + esc(co.source) +
                                   "</b> — " + esc(co.text) + "</div>";
    if (q.uncertain) h += '<div class="bkflag">⚠ Flagged uncertain — verify this one.</div>';
    return h;
  }
```

In `bankReveal`, replace the written `else` branch
```js
    } else {
      h += '<div class="chip">Model answer</div>';
      h += '<div class="bkans">' + esc(q.model_answer || "") + "</div>";
      if (q.beyond_mandell) h += '<div class="bkgold"><b>Beyond Mandell.</b> ' + esc(q.beyond_mandell) + "</div>";
      if (q.cohort_answer) h += '<div class="bkcohort"><b>Prior cohort answer</b> (' +
        esc(q.cohort_answer.source) + ") — " + esc(q.cohort_answer.text) + "</div>";
      if (q.uncertain) h += '<div class="bkflag">⚠ Flagged uncertain — verify this one.</div>';
    }
    if (q.cites) h += '<div class="bkcite">' + esc(q.cites) + "</div>";
```
with
```js
    } else {
      h += answerBlock(q);
    }
    if (q.kind === "mcq" && q.cites) h += '<div class="bkcite">' + esc(q.cites) + "</div>";
```
(the citation now lives in the chip for written questions).

- [ ] **Step 4: Add the CSS**

In `public/index.html`, inside the Bank CSS block, after the `.bkmarks{...}` line add:
```css
.bkhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.bkflagbtn{flex:none;width:32px;height:32px;border:1.5px solid var(--line);border-radius:10px;
  background:var(--card);font:inherit;font-size:14px;color:var(--mut)}
.bkflagbtn.on{background:var(--gold-bg);border-color:var(--gold-bd);color:var(--gold-txt)}
.bktopic{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-top:12px}
.bkparts{list-style:none;padding-left:0}
.bkparts li{display:flex;gap:8px;align-items:baseline}
.bkparts li .tx{flex:1;min-width:0}
.bkmk{flex:none;font-size:10px;font-weight:800;color:var(--acc);background:var(--soft);
  border-radius:99px;padding:2px 8px;white-space:nowrap}
```
and change the existing `.bkparts{margin:12px 0 0;padding-left:18px}` to `.bkparts{margin:12px 0 0}` (the new rule sets the padding).

- [ ] **Step 5: Run the tests and commit**

Run: `node --test tests/js/bank-view.test.mjs` — 9 passing. `npm test 2>&1 | tail -8` — `fail 0`.

```bash
git add public/app.js public/index.html tests/js/bank-view.test.mjs
git commit -m "feat: Bank card shows marks per part, topic stems, flag; reveal picks the real answer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The owed rule in the app, and the home "To drill" card

**Files:**
- Modify: `public/app.js` — add the mirror of `lib/bank.js`, `renderDrill`, wire into `renderToday` and the click listener
- Modify: `public/index.html` — `#drillCard` and CSS
- Test: `tests/js/bank-owed.test.mjs` (parity), `tests/js/bank-view.test.mjs` (card)

- [ ] **Step 1: Append the failing tests**

To `tests/js/bank-owed.test.mjs`:
```js
import { loadCurrentApp } from "./harness.mjs";
const { marksFor, earnedFrom } = require_("../../lib/bank.js");

test("public/app.js carries the same owed and marks functions as lib/bank.js", () => {
  const app = loadCurrentApp({ now: new Date(2026, 8, 1, 21, 0, 0) });
  const norm = (fn) => fn.toString().replace(/\s+/g, " ").trim();
  assert.equal(norm(app.IDCockpit.chapterSessionIds), norm(chapterSessionIds));
  assert.equal(norm(app.IDCockpit.owedChapters), norm(owedChapters));
  assert.equal(norm(app.IDCockpit.marksFor), norm(marksFor));
  assert.equal(norm(app.IDCockpit.earnedFrom), norm(earnedFrom));
});
```
(Put the `import` at the top of the file with the others; the `require_` line replaces the earlier destructure so all four names are in scope.)

To `tests/js/bank-view.test.mjs`:
```js
test("the home screen shows a To-drill card only when a read chapter has ungraded questions", async () => {
  // Chapter 101's sessions, whatever they are called in the current schedule.
  const src = (await import("node:fs")).readFileSync(new URL("../../public/schedule.js", import.meta.url), "utf8");
  const SECTIONS = new Function(`${src}; return SECTIONS;`)();
  const ids = SECTIONS.flatMap((s) => s.rows).filter((r) => /^Chapter 101\b/.test(r.r)).map((r) => r.id);
  assert.ok(ids.length, "schedule has chapter 101");

  const unread = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await tick(); await tick();
  unread.IDCockpit.render();
  assert.equal(unread._elements.get("drillCard").innerHTML, "");

  const read = loadCurrentApp({ now: NOW, fetch: fetchFor(), done: ids, doneAt: "2026-08-30T12:00:00Z" });
  await tick(); await tick();
  read.IDCockpit.render();
  const html = read._elements.get("drillCard").innerHTML;
  assert.match(html, /To drill/);
  assert.match(html, /data-drill="ch101"/);
  assert.match(html, /3 of 3 left/, "W3 is deferred and not counted");
});
```
Add `render: render,` and the four function names to the `window.IDCockpit` export.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/bank-owed.test.mjs tests/js/bank-view.test.mjs` — parity test fails (`undefined`), card test fails (`drillCard` empty / `render` missing).

- [ ] **Step 3: Add the mirror and the card to `public/app.js`**

Directly above `function bankHeader()` insert, verbatim (bodies must match `lib/bank.js` up to whitespace):
```js
  // ---- owed chapters + marks: a copy of lib/bank.js -------------------------
  // The app has no module loader; tests/js/bank-owed.test.mjs pins these equal
  // to the server-side originals. Edit both or the parity test fails.
  function chapterSessionIds(sections, chapterNumber) {
    var num = String(chapterNumber), ids = [];
    (sections || []).forEach(function (s) {
      (s.rows || []).forEach(function (r) {
        var m = /^Chapter\s+(\d+)/.exec(r.r || "");
        if (m && m[1] === num) ids.push(r.id);
      });
    });
    return ids;
  }
  function owedChapters(sections, progress, index, answers) {
    progress = progress || {}; answers = answers || {};
    var out = [];
    (index || []).forEach(function (c) {
      if (!c.weeks || !c.weeks.length) return;           // catch-alls: available, never demanded
      var ids = chapterSessionIds(sections, String(c.chapter || "").replace(/^Chapter\s+/, ""));
      if (!ids.length) return;
      var readAt = 0;
      for (var i = 0; i < ids.length; i++) {
        var e = progress[ids[i]];
        if (!e || !e.done) return;
        var t = e.doneAt ? new Date(e.doneAt).getTime() : 0;
        if (t > readAt) readAt = t;
      }
      var deferred = {};
      (c.deferred || []).forEach(function (q) { deferred[q] = 1; });
      var ready = (c.cqids || []).filter(function (q) { return !deferred[q]; });
      var remaining = ready.filter(function (q) { var a = answers[q]; return !(a && a.result); });
      if (!remaining.length) return;
      out.push({ chapter: c.chapter, id: c.id, title: c.title, sector: c.sector,
                 remaining: remaining.length, total: ready.length, readAt: readAt });
    });
    out.sort(function (a, b) { return b.readAt - a.readAt; });
    return out;
  }
  function marksFor(q) {
    if (q.kind === "mcq") return 1;
    return (q.parts || []).reduce(function (s, p) {
      return s + (p.marks == null ? 1 : Number(p.marks));
    }, 0);
  }
  function earnedFrom(full, result) {
    if (result === "got" || result === "correct") return full;
    if (result === "partial") return full / 2;
    return 0;
  }

  /** The home card: chapters read but not yet drilled. Empty when nothing is owed. */
  function renderDrill() {
    var el = $("drillCard");
    var owed = bkIndex ? owedChapters(SECS, sessions, bkIndex, bankAnswers()) : [];
    if (!owed.length) { el.innerHTML = ""; return; }
    var rows = owed.slice(0, 3).map(function (c) {
      var col = sectorAccent(c.sector) || "var(--ind)";
      return '<button class="drow" data-drill="' + esc(c.id) + '"><i style="background:' + esc(col) + '"></i>' +
        '<span class="t">' + esc(String(c.chapter).replace(/^Chapter\s+/, "Ch ")) + " · " + esc(c.title) + "</span>" +
        '<span class="n">' + c.remaining + " of " + c.total + " left</span></button>";
    }).join("");
    var more = owed.length > 3 ? '<div class="dmore">+' + (owed.length - 3) + " more</div>" : "";
    el.innerHTML = '<div class="drill"><div class="qk">To drill</div>' + rows + more + "</div>";
  }
```

In `renderToday`, right before the comment `// Three numbers, no more.` add a line:
```js
    renderDrill();
```

In the delegated Bank click listener, add as the first branch after `var t = e.target;`:
```js
    var drill = t.closest && t.closest("[data-drill]");
    if (drill) { tab = "bank"; sheetSi = null; $("body").scrollTop = 0; bankOpen(drill.dataset.drill); return; }
```

Add to the `window.IDCockpit` export: `render: render, chapterSessionIds: chapterSessionIds, owedChapters: owedChapters, marksFor: marksFor, earnedFrom: earnedFrom,`.

- [ ] **Step 4: Markup and CSS in `public/index.html`**

Change
```html
      <div id="questCard"></div>
      <div class="strip" id="statStrip"></div>
```
to
```html
      <div id="questCard"></div>
      <div id="drillCard"></div>
      <div class="strip" id="statStrip"></div>
```

After the `.qacts .alt:hover{...}` line add:
```css
/* ---- today: to-drill card. Read chapters whose questions are still owed. ---- */
.drill{background:var(--card);border:var(--edge);border-radius:18px;padding:13px 16px 6px;
       box-shadow:var(--sh-2);margin-top:10px;animation:idrise .3s ease both}
.drill .qk{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ind);margin-bottom:4px}
.drow{display:flex;align-items:center;gap:10px;width:100%;background:none;border:none;
      border-top:1px solid var(--hair);padding:10px 0;font:inherit;color:var(--txt);text-align:left}
.drow:first-of-type{border-top:0}
.drow i{width:9px;height:9px;border-radius:99px;flex:none}
.drow .t{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.25;text-wrap:pretty}
.drow .n{flex:none;font-size:11px;font-weight:700;color:var(--mut)}
.dmore{font-size:11px;font-weight:700;color:var(--mut);padding:8px 0 6px;border-top:1px solid var(--hair)}
```

- [ ] **Step 5: Run the tests and commit**

Run: `npm test 2>&1 | tail -8` — `fail 0`.

```bash
git add public/app.js public/index.html tests/js/bank-owed.test.mjs tests/js/bank-view.test.mjs
git commit -m "feat: home 'To drill' card — read chapters whose questions are still owed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The evening nudge knows about drills

**Files:**
- Modify: `lib/nudge.js`
- Modify: `api/nudge.js`
- Test: `tests/js/nudge.test.mjs` (append)

- [ ] **Step 1: Append failing tests to `tests/js/nudge.test.mjs`**

Place these after the `"a finished curriculum never nudges"` test and before the `/* ---- the subscription endpoint ---- */` line:
```js
/* ---- drills ride the nudge ---- */
const { owedChapters, chapterSessionIds } = require_("../../lib/bank.js");
const IDX = [{ chapter: "Chapter 20", id: "ch20", title: "Penicillins and β-Lactamase Inhibitors",
               sector: "Drug Foundations — Completed", weeks: [1], cqids: ["Q1", "Q2"], deferred: ["Q2"] }];
const owedFor = (progress, answers) => ({ owed: owedChapters(SECTIONS, progress, IDX, answers || {}) });

test("reading tonight plus an owed chapter appends a drill line and adds to the badge", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");   // includes every ch20 sitting
  assert.ok(chapterSessionIds(SECTIONS, 20).every((id) => progress[id]), "fixture assumption");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress));
  assert.equal(msg.title, "Tonight's reading");
  assert.match(msg.body, /\nCh 20 Penicillins and β-Lactamase Inhibitors · 1 to drill$/);
  assert.equal(msg.badge, 2);
});

test("read today but a chapter is owed: a drill-only nudge", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  progress[ROWS[30].id] = at("2026-08-21T14:00:00-03:00");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress));
  assert.equal(msg.title, "Ready to drill");
  assert.match(msg.body, /Ch 20 .* · 1 to drill/);
  assert.equal(msg.badge, 1);
});

test("a rest Saturday stays silent even with drills owed", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  assert.equal(compose(SECTIONS, progress, SAT_EVE, owedFor(progress)), null);
});

test("nothing owed leaves the nudge exactly as it was", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const plain = compose(SECTIONS, progress, FRI_EVE);
  const withBank = compose(SECTIONS, progress, FRI_EVE, owedFor(progress, { Q1: { result: "got", ts: 1 } }));
  assert.deepEqual(withBank, plain);
});

test("more than two owed chapters collapse to a '+N more' line", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const many = [1, 2, 3, 4].map((n) => ({ chapter: "Chapter " + n, id: "ch" + n, title: "T" + n, sector: "S", remaining: n, total: n, readAt: n }));
  const msg = compose(SECTIONS, progress, FRI_EVE, { owed: many });
  assert.match(msg.body, /\+2 more chapters to drill$/);
  assert.equal(msg.badge, 5);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/nudge.test.mjs` — the 5 new tests fail (no drill line, badge 1, `null` for read-today).

- [ ] **Step 3: Extend `lib/nudge.js`**

Change the `require` line to
```js
const { tonight, localToday, isFlex } = require("./plan.js");
```
Add after `function line(r) {...}`:
```js
/** One line per owed chapter, at most two, then a "+N more". */
function drillLines(owed) {
  const lines = owed.slice(0, 2).map((c) =>
    String(c.chapter).replace(/^Chapter\s+/, "Ch ") + " " + c.title + " · " + c.remaining + " to drill");
  if (owed.length > 2) lines.push("+" + (owed.length - 2) + " more chapters to drill");
  return lines;
}
```
Replace `compose` with
```js
/**
 * The nudge for tonight, or null (rest day / nothing to read and nothing owed).
 * @param bank  optional {owed: [...]} from lib/bank.js owedChapters
 */
function compose(sections, progress, now, bank) {
  const owed = (bank && Array.isArray(bank.owed)) ? bank.owed : [];
  const t = tonight(sections, progress, now);
  if (!t) {
    // Reading is done (or finished) — but a read chapter still owes its questions.
    if (!owed.length || isFlex(localToday(now))) return null;
    return { title: "Ready to drill", body: drillLines(owed).join("\n"), badge: owed.length };
  }
  let msg;
  if (t.sessions.length === 1) {
    msg = { title: "Tonight's reading", body: line(t.sessions[0]), badge: 1 };
  } else {
    msg = {
      title: t.sessions.length + " tonight clears the debt",
      body: t.sessions.map((r, i) => (i + 1) + ") " + line(r)).join("\n"),
      badge: t.sessions.length,
    };
  }
  if (owed.length) {
    msg.body += "\n" + drillLines(owed).join("\n");
    msg.badge += owed.length;
  }
  return msg;
}

module.exports = { compose, line, drillLines };
```

- [ ] **Step 4: Feed the bank into `api/nudge.js`**

Change the requires to
```js
const { getPushSub, delPushSub, getProgress, getSchedule, getAnswers } = require("./_kv.js");
const { compose } = require("../lib/nudge.js");
const { owedChapters } = require("../lib/bank.js");
```
Add after `liveSections`:
```js
/** The bank's owed chapters, or undefined when the index or the store is
    unreachable — a bank outage must never silence the reading nudge. */
async function bankState(req, sections, progress) {
  try {
    const r = await fetch("https://" + req.headers.host + "/qbank/index.json");
    if (!r.ok) return undefined;
    const idx = await r.json();
    return { owed: owedChapters(sections, progress, idx.chapters, await getAnswers()) };
  } catch (e) {
    console.error("bank state unavailable", e);
    return undefined;
  }
}
```
Replace
```js
    const msg = compose(await liveSections(req), await getProgress(), new Date());
```
with
```js
    const sections = await liveSections(req), progress = await getProgress();
    const msg = compose(sections, progress, new Date(), await bankState(req, sections, progress));
```

- [ ] **Step 5: Run the tests and commit**

Run: `node --test tests/js/nudge.test.mjs` — all passing. `npm test 2>&1 | tail -8` — `fail 0`.

```bash
git add lib/nudge.js api/nudge.js tests/js/nudge.test.mjs
git commit -m "feat: evening nudge names chapters ready to drill, fires drill-only when reading is done

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Stats block, marks on the chapter summary, flagged list

**Files:**
- Modify: `public/app.js` — `bankSummary`, `bankFlagged`, new `renderBankStats`, `renderStats`
- Modify: `public/index.html` — `#bankStats` markup and CSS
- Test: `tests/js/bank-view.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

```js
test("the chapter summary reports marks as well as the tally", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "partial", ts: 1 }, W2: { result: "got", ts: 1 }, M1: { result: "incorrect", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /2\.5 of 5 marks/, "W1 3 marks × ½ + W2 1 + M1 0, of 3 + 1 + 1");
});

test("the Stats block counts answered, the split, marks, drilled chapters and flags", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../public/schedule.js", import.meta.url), "utf8");
  const SECTIONS = new Function(`${src}; return SECTIONS;`)();
  const ids = SECTIONS.flatMap((s) => s.rows).filter((r) => /^Chapter 101\b/.test(r.r)).map((r) => r.id);
  const app = loadCurrentApp({ now: NOW, done: ids, doneAt: "2026-08-30T12:00:00Z",
    fetch: fetchFor({ W1: { result: "got", ts: 1 }, M1: { result: "incorrect", ts: 1, chosen: "A" }, W2: { flag: true, ts: 1 } }) });
  await tick(); await tick();
  app.IDCockpit.setTab("stats");
  const html = app._elements.get("bankStats").innerHTML;
  assert.match(html, /Answered<\/span><span class="v">2 \/ 3</);
  assert.match(html, /Marks<\/span><span class="v">3 of 4</, "got W1 (3) + incorrect M1 (0), of the 4 answered marks");
  assert.match(html, /Chapters drilled<\/span><span class="v">0 \/ 1</);
  assert.match(html, /data-flagged.*Flagged · 1/);
});

test("the flagged list shows every flagged question and opens its chapter at that question", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W2: { flag: true, ts: 1 }, W3: { flag: true, result: "missed", ts: 1 } }) });
  await tick(); await tick();
  app.IDCockpit.showFlagged();
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /data-open="ch101" data-cqid="W2"/);
  assert.match(html, /data-open="ch101" data-cqid="W3"/);
  app.IDCockpit.bankOpen("ch101", "W3");
  await tick(); await tick();
  const b = app.IDCockpit.bank();
  assert.equal(b.queue[b.at].cqid, "W3", "a deferred question is reachable from the flag list");
});
```
Add `setTab: function (t) { tab = t; render(); }, showFlagged: showFlagged,` to the `window.IDCockpit` export.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/bank-view.test.mjs` — 3 new failures.

- [ ] **Step 3: Marks on the summary**

In `bankSummary`, after the tally loop add:
```js
    var avail = 0, earned = 0;
    bkQueue.forEach(function (q) {
      var full = marksFor(q), a = A[q.cqid];
      avail += full; if (graded(a)) earned += earnedFrom(full, a.result);
    });
```
and in the HTML, right after the closing `</div>` of `.bktally` insert
```js
      '<div class="bkmarksum">' + earned + " of " + avail + " marks</div>" +
```

- [ ] **Step 4: The flagged list**

Replace the stub `bankFlagged` with:
```js
  function showFlagged() { tab = "bank"; bkChapter = null; bkFlagList = true; setBankAccent(null); render(); }

  /** Every flagged question, across chapters. Rows open the chapter at that question. */
  function bankFlagged() {
    var A = bankAnswers(), byQ = {};
    (bkIndex || []).forEach(function (c) { c.cqids.forEach(function (q) { byQ[q] = c; }); });
    var flagged = Object.keys(A).filter(function (q) { return A[q].flag && byQ[q]; });
    var h = '<button class="bkexit" id="bkback">← All chapters</button>';
    if (!flagged.length) h += '<div class="bkdef">Nothing flagged. Tap ⚑ on a question to keep it here.</div>';
    flagged.forEach(function (q) {
      var c = byQ[q], col = sectorAccent(c.sector) || "var(--ind)";
      h += '<button class="bkfl" data-open="' + esc(c.id) + '" data-cqid="' + esc(q) + '">' +
           '<i style="background:' + esc(col) + '"></i><span class="t">' +
           esc(String(c.chapter).replace(/^Chapter\s+/, "Ch ")) + " · " + esc(c.title) + "</span>" +
           '<span class="n">' + esc(q) + (graded(A[q]) ? " · " + esc(A[q].result) : "") + "</span></button>";
    });
    $("v-bank").innerHTML = h;
  }
```
In the delegated click listener add, after the `[data-drill]` branch:
```js
    var fl = t.closest && t.closest("[data-open]");
    if (fl) { bankOpen(fl.dataset.open, fl.dataset.cqid); return; }
    if (t.closest && t.closest("[data-flagged]")) { showFlagged(); $("body").scrollTop = 0; return; }
```
`bankHeader` should name the list: change its first line to
```js
    if (bkFlagList) return { e: "Question bank", t: "Flagged", r: "" };
    if (!bkChapter) return { e: "Question bank", t: "Bank",
```

- [ ] **Step 5: The Stats block**

Add after `renderStats`'s `$("sectorBars").innerHTML = ...` statement (inside the function) the call `renderBankStats();`, and add the function:
```js
  /** Stats: the question bank in five lines. Unlocked = read chapters + catch-alls. */
  function renderBankStats() {
    var el = $("bankStats");
    if (!bkIndex) { el.innerHTML = '<div class="card bkstat"><span class="l">Loading question bank…</span></div>'; bankLoadIndex(); return; }
    var A = bankAnswers(), total = 0, answered = 0, got = 0, part = 0, miss = 0,
        drilled = 0, avail = 0, earned = 0, flagged = 0;
    bankReady().forEach(function (c) {
      var def = {}; (c.deferred || []).forEach(function (q) { def[q] = 1; });
      var ready = c.cqids.filter(function (q) { return !def[q]; }), done = 0;
      total += ready.length;
      ready.forEach(function (q) {
        var a = A[q]; if (!graded(a)) return;
        done++;
        var full = (c.marks && c.marks[q] != null) ? Number(c.marks[q]) : 1;
        avail += full; earned += earnedFrom(full, a.result);
        if (a.result === "got" || a.result === "correct") got++;
        else if (a.result === "partial") part++;
        else miss++;
      });
      answered += done;
      if (ready.length && done === ready.length) drilled++;
    });
    Object.keys(A).forEach(function (q) { if (A[q].flag) flagged++; });
    el.innerHTML =
      '<div class="card bkstat">' +
      '<div class="baseline"><span class="l">Answered</span><span class="v">' + answered + " / " + total + "</span></div>" +
      '<div class="bktally small"><div><span class="n">' + got + '</span><span class="l">Got</span></div>' +
      '<div><span class="n">' + part + '</span><span class="l">Partial</span></div>' +
      '<div><span class="n">' + miss + '</span><span class="l">Missed</span></div></div>' +
      '<div class="baseline"><span class="l">Marks</span><span class="v">' + earned + " of " + avail + "</span></div>" +
      '<div class="baseline"><span class="l">Chapters drilled</span><span class="v">' + drilled + " / " + bankReady().length + "</span></div>" +
      '<div class="baseline"><span class="l">Flagged</span><span class="v"><button data-flagged>Flagged · ' + flagged + "</button></span></div>" +
      "</div>";
  }
```

- [ ] **Step 6: Markup and CSS**

In `public/index.html`, in `#v-stats`, change
```html
      <div id="statSummary"></div>
      <div class="seclabel" id="badgeLabel"></div>
```
to
```html
      <div id="statSummary"></div>
      <div class="seclabel">Question bank</div>
      <div id="bankStats"></div>
      <div class="seclabel" id="badgeLabel"></div>
```
In the Bank CSS block add:
```css
.bkmarksum{font-size:12.5px;font-weight:700;color:var(--mut);margin:-8px 2px 16px}
.bkfl{display:flex;align-items:center;gap:10px;width:100%;background:var(--card);border:var(--edge);
  border-radius:14px;padding:11px 13px;font:inherit;color:var(--txt);text-align:left;margin-bottom:8px;box-shadow:var(--sh-1)}
.bkfl i{width:9px;height:9px;border-radius:99px;flex:none}
.bkfl .t{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.25}
.bkfl .n{flex:none;font-size:10.5px;font-weight:700;color:var(--mut)}
.bkstat{padding:14px 16px}
.bkstat .baseline{margin-bottom:9px}
.bkstat .l{font-size:11px;font-weight:600;color:var(--mut)}
.bkstat .v{font-size:13px;font-weight:700}
.bkstat button{background:none;border:none;padding:0;font:inherit;font-weight:800;color:var(--acc);text-decoration:underline}
.bktally.small{margin:6px 2px 12px;gap:22px}
.bktally.small .n{font-size:22px}
```

- [ ] **Step 7: Run the tests and commit**

Run: `npm test 2>&1 | tail -8` — `fail 0`.

```bash
git add public/app.js public/index.html tests/js/bank-view.test.mjs
git commit -m "feat: Stats question-bank block, marks on the chapter summary, flagged list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `chosen` and `flag` survive the API; browser verification

**Files:**
- Test: `tests/js/answers-api.test.mjs` (append)
- Verify: browser

- [ ] **Step 1: Append the API test**

```js
test("chosen letter and flag round-trip untouched", async () => {
  kv.__resetFake && kv.__resetFake();
  await handler(req("POST", { answers: { M1: { result: "incorrect", chosen: "A", flag: true, ts: 3 } } }), res());
  const r = res();
  await handler(req("GET"), r);
  assert.deepEqual(r.body.answers.M1, { result: "incorrect", chosen: "A", flag: true, ts: 3 });
});
```
Run: `node --test tests/js/answers-api.test.mjs` — 5 passing (no code change needed; this pins the contract).

- [ ] **Step 2: Preview in the browser**

Start the dev server with the Browser pane: `preview_start {name: "cockpit"}` (from `.claude/launch.json`, port 8799). In the tab:
1. `read_console_messages` — no errors on load.
2. Open the Bank tab, open any unlocked chapter, reveal a written question: the primary box has text and a "Documented answer · …" or "Model answer · Mandell pp. …" chip. Screenshot.
3. Tap ⚑, reload the page, reopen: the flag is still on (localStorage). Grade one question, reload: it is skipped.
4. Mark every session of a short chapter read on the home screen (Chapter 100 is one session): the "To drill" card appears under the quest card. Tap its row: the Bank opens on that chapter. Screenshot.
5. Stats tab: the Question bank block renders with counts; tap "Flagged · N": the list opens.
6. `resize_window {colorScheme: "dark"}` and repeat step 2 for the dusk theme. Screenshot.

The local server has no `/api/*`, so syncs fail and are retried; that is the offline path being exercised, not a bug. Fix anything found, re-run `npm test`, then `git commit` the fixes.

- [ ] **Step 3: Send the screenshots to Tyler** with `SendUserFile` — the reveal, the drill card, and the Stats block.

---

### Task 11: Merge, push, verify the deploy

- [ ] **Step 1: Merge**

```bash
cd "$APP" && npm test 2>&1 | tail -3
git checkout main && git merge --ff-only bank/improvements && git log --oneline -1
```

- [ ] **Step 2: Push**

```bash
git push origin main
```
If this fails with `could not read Username`, stop and tell Tyler to run `git push origin main` from a terminal in the repo; do not retry with stored tokens.

- [ ] **Step 3: Verify it shipped (after the push)**

```bash
sleep 90
curl -s https://id-cockpit.vercel.app/sw.js | grep -o 'idcockpit-web-v[0-9]*'
curl -s https://id-cockpit.vercel.app/app.js | grep -c "renderDrill"
curl -s https://id-cockpit.vercel.app/qbank/index.json | python3 -c "import json,sys; c=json.load(sys.stdin)['chapters'][0]; print('deferred' in c, 'marks' in c)"
```
Expected: `idcockpit-web-v23`, a count of at least `1`, and `True True`. If the deployed sw.js is still v22 after two minutes, the Vercel git integration is not on `main` — check the Vercel dashboard (Tyler) or deploy with `npx vercel --prod` from the repo.

- [ ] **Step 4: Tell Tyler** to open the app on wifi once so the new service worker installs, and that the evening nudge will start naming owed chapters from tonight's cron.

---

## Self-review against the spec

- **A1 reveal rule** → Task 6 (`answerBlock`, four-row table covered by three tests plus the "no answer" case). Topic heading, marks pill, "Asked N times", flag button → Task 6. The topic rule allows a trailing period (e.g. "Enterovirus.") — a deliberate loosening of the spec's "no sentence punctuation", noted in `isTopic`.
- **A2 IDAnswers** → Task 1; server contract pinned in Task 10; review-misses without deletion → Task 5; service worker bypass + CACHE bump → Task 2; chosen letter → Task 5; flags in the same record → Tasks 5, 6.
- **A3 owed rule** shared → Task 3 + Task 7 mirror + parity test; `deferred` list in the index → Task 4; home card → Task 7; nudge (append, drill-only, rest-day silence, +N more, outage-safe) → Task 8; Stats block, marks rule, chapter-summary marks, flagged list → Task 9.
- **A4 tests** → every listed file exists in a task; the sw test replaces the spec's description with a real handler-level check.
- **A5 ship** → Task 11.
- Names used consistently: `IDAnswers.{get,set,replace,sync,schedule,start}`, `graded()`, `bankAnswers()`, `owedChapters`, `chapterSessionIds`, `marksFor`, `earnedFrom`, `renderDrill`, `renderBankStats`, `bankFlagged`, `showFlagged`, `bankReviewMisses`, `bankPick`, `bankFlag`, `bankOpen(id, focus)`.
