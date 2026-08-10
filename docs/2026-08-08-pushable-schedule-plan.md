# Pushable Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Tyler's reading plan from a chat and have it appear on his phone
without a git push or a Vercel deploy — the same way the Harvest meal planner
pushes dinners.

**Architecture:** ID Cockpit stays a static site. A single Vercel serverless
function (`/api/schedule`) reads a `cockpit:schedule` key from the Upstash Redis
that Harvest already uses. A Mac-side push script validates and writes that key.
The app boots from the bundled `public/schedule.js` as it does today — instant
render, still fully offline — then fetches `/api/schedule` and swaps in the
server copy if it differs. The bundled file therefore remains a working fallback,
never a dead branch.

**Tech Stack:** Vercel serverless functions (Node, CommonJS), `@upstash/redis`,
`node:test`, no framework and no build step for the client.

---

## Hard prerequisite (Tyler, once — nothing works end to end without it)

In the Vercel dashboard: **id-cockpit project → Storage → Connect Store →** pick
the existing Upstash/KV store Harvest uses. Vercel then injects
`KV_REST_API_URL` and `KV_REST_API_TOKEN` into the project automatically.

Then, locally, once:

```bash
cd "8. Claude/ID Platform" && npx vercel link && npx vercel env pull .env.local
```

Claude must never read, print, or copy those values. Every task below is testable
before this is done, via the fake-KV mode built in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Declares `@upstash/redis`; holds the `push:schedule` script. New — the repo has none today. |
| `api/ping.js` | Throwaway probe proving serverless functions deploy alongside a static site. Deleted in Task 6. |
| `api/_kv.js` | The only place that talks to Redis. Exposes `getSchedule`/`setSchedule` and an in-memory fake for tests. |
| `api/schedule.js` | `GET /api/schedule` — returns the pushed schedule or 204 when none exists. |
| `lib/schedule-schema.js` | Shared validation for a schedule payload. Used by the push script and the API. |
| `scripts/push-schedule.mjs` | Reads `public/schedule.js`, validates, writes to Redis. |
| `public/app.js` | Modified: fetch-and-swap after first render. |
| `tests/js/schedule-api.test.mjs` | Tests for the schema, the handler, and the client swap. |

Keeping `_kv.js` as the single Redis boundary is what makes everything else
testable without credentials — mirrors `lib/kv.ts` in Harvest.

---

### Task 1: Prove serverless functions deploy on this static site

The one genuine unknown. `vercel.json` sets `outputDirectory: public`, and this
repo has no framework. If Vercel does not pick up a root `api/` directory under
that config, the whole approach needs rethinking — so find out first, before
building anything on top of it.

**Files:**
- Create: `api/ping.js`

- [ ] **Step 1: Write the probe endpoint**

```js
// api/ping.js — temporary: proves serverless functions deploy beside the static
// site. Deleted in Task 6 once /api/schedule is live.
module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, at: new Date().toISOString() });
};
```

- [ ] **Step 2: Commit and push**

```bash
git add api/ping.js && git commit -m "chore: probe that api/ deploys on the static site" && git push origin main
```

- [ ] **Step 3: Wait for the deploy, then verify**

```bash
until curl -sf https://id-cockpit.vercel.app/api/ping >/dev/null; do sleep 5; done; curl -s https://id-cockpit.vercel.app/api/ping
```

Expected: `{"ok":true,"at":"2026-…"}`

- [ ] **Step 4: Confirm the app still works**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://id-cockpit.vercel.app/
```

Expected: `200`. If this broke, `vercel.json` needs `"functions"` added — stop
and fix before continuing.

---

### Task 2: The Redis boundary, with a fake for tests

**Files:**
- Create: `package.json`, `api/_kv.js`
- Test: `tests/js/schedule-api.test.mjs`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "id-cockpit",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "test": "node --test \"tests/js/*.test.mjs\"",
    "push:schedule": "node scripts/push-schedule.mjs"
  },
  "dependencies": {
    "@upstash/redis": "^1.34.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/js/schedule-api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.COCKPIT_FAKE_KV = "1";
const kv = await import("../../api/_kv.js");

test("fake KV round-trips a schedule", async () => {
  await kv.setSchedule({ version: "v1", sections: [] });
  assert.deepEqual(await kv.getSchedule(), { version: "v1", sections: [] });
});

test("an unpushed schedule reads as null, not an error", async () => {
  kv.__resetFake();
  assert.equal(await kv.getSchedule(), null);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: FAIL — `Cannot find module '../../api/_kv.js'`

- [ ] **Step 4: Implement the boundary**

```js
// api/_kv.js — the only place that talks to Redis.
// COCKPIT_FAKE_KV=1 swaps in an in-memory store so every other module is
// testable without credentials. Mirrors HARVEST_FAKE_KV in ~/Projects/harvest.
const KEY = "cockpit:schedule";
const fake = new Map();

function isFake() {
  return process.env.COCKPIT_FAKE_KV === "1";
}

function client() {
  const { Redis } = require("@upstash/redis");
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

/** The pushed schedule, or null when nothing has been pushed yet. */
async function getSchedule() {
  if (isFake()) return fake.has(KEY) ? fake.get(KEY) : null;
  if (!process.env.KV_REST_API_URL) return null;   // store not connected yet
  return (await client().get(KEY)) ?? null;
}

async function setSchedule(payload) {
  if (isFake()) { fake.set(KEY, payload); return; }
  await client().set(KEY, payload);
}

function __resetFake() { fake.clear(); }

module.exports = { getSchedule, setSchedule, __resetFake, KEY };
```

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: PASS (2 tests)

- [ ] **Step 6: Ignore node_modules, then commit**

```bash
printf 'node_modules/\n.env.local\n.vercel/\n' >> .gitignore
git add package.json api/_kv.js tests/js/schedule-api.test.mjs .gitignore
git commit -m "feat(api): Redis boundary with an in-memory fake for tests"
```

---

### Task 3: Validation shared by the API and the push script

A bad schedule must be impossible to push. The killer case is a **duplicate or
renamed session id** — ids are the key progress is stored against, so a rename
silently orphans read-state.

**Files:**
- Create: `lib/schedule-schema.js`
- Test: `tests/js/schedule-api.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
import { validateSchedule } from "../../lib/schedule-schema.js";

const good = { version: "2026-08-08", sections: [
  { title: "S", rows: [{ id: "ch1-p1", r: "Chapter 1", pp: 5, ps: 1, pe: 5, wk: 1, gi: 0 }] }
] };

test("a well-formed schedule validates", () => {
  assert.deepEqual(validateSchedule(good).errors, []);
});

test("duplicate session ids are rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { id: "dup", r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 },
    { id: "dup", r: "B", pp: 1, ps: 2, pe: 2, wk: 1, gi: 1 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /duplicate id: dup/);
});

test("a missing id is rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /missing id/);
});

test("a non-numeric plan day is rejected", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].gi = "nope";
  assert.match(validateSchedule(bad).errors.join(), /gi must be a number/);
});

test("an empty schedule is rejected", () => {
  assert.match(validateSchedule({ version: "v", sections: [] }).errors.join(), /no sections/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: FAIL — cannot find `lib/schedule-schema.js`

- [ ] **Step 3: Implement**

```js
// lib/schedule-schema.js — one validator, used by the push script (before a
// write) and the API (before serving). Returns collected errors rather than
// throwing, so the push script can print all of them at once.
export function validateSchedule(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return { errors: ["not an object"] };
  if (!payload.version) errors.push("missing version");
  const sections = payload.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push("no sections");
    return { errors };
  }
  const seen = new Set();
  sections.forEach((s, si) => {
    if (!s || !Array.isArray(s.rows)) { errors.push(`section ${si}: no rows`); return; }
    s.rows.forEach((r, ri) => {
      const at = `section ${si} row ${ri}`;
      if (!r || !r.id) { errors.push(`${at}: missing id`); return; }
      if (seen.has(r.id)) errors.push(`${at}: duplicate id: ${r.id}`);
      seen.add(r.id);
      if (typeof r.gi !== "number") errors.push(`${at} (${r.id}): gi must be a number`);
      if (typeof r.pp !== "number") errors.push(`${at} (${r.id}): pp must be a number`);
      if (!r.r) errors.push(`${at} (${r.id}): missing title`);
    });
  });
  return { errors };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/schedule-schema.js tests/js/schedule-api.test.mjs
git commit -m "feat: schedule validation, rejecting duplicate and missing ids"
```

---

### Task 4: `GET /api/schedule`

**Files:**
- Create: `api/schedule.js`
- Test: `tests/js/schedule-api.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

test("serves the pushed schedule", async () => {
  kv.__resetFake();
  await kv.setSchedule(good);
  const handler = require_("../../api/schedule.js");
  const r = res();
  await handler({ method: "GET" }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.version, "2026-08-08");
});

test("204 when nothing has been pushed, so the app keeps its bundled copy", async () => {
  kv.__resetFake();
  const handler = require_("../../api/schedule.js");
  const r = res();
  await handler({ method: "GET" }, r);
  assert.equal(r.code, 204);
});

test("a corrupt stored schedule is refused rather than served", async () => {
  kv.__resetFake();
  await kv.setSchedule({ version: "v", sections: [] });
  const handler = require_("../../api/schedule.js");
  const r = res();
  await handler({ method: "GET" }, r);
  assert.equal(r.code, 500);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: FAIL — cannot find `api/schedule.js`

- [ ] **Step 3: Implement**

```js
// api/schedule.js — GET only. 204 means "nothing pushed"; the app then keeps the
// schedule bundled in public/schedule.js, so an empty store is not an outage.
const { getSchedule } = require("./_kv.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  let payload;
  try {
    payload = await getSchedule();
  } catch (e) {
    console.error("schedule read failed", e);
    res.status(502).json({ error: "store unavailable" });
    return;
  }
  if (!payload) { res.status(204).end(); return; }

  const { validateSchedule } = await import("../lib/schedule-schema.js");
  const { errors } = validateSchedule(payload);
  if (errors.length) {
    // Serving a broken schedule would corrupt the app's view of the plan.
    console.error("stored schedule is invalid", errors);
    res.status(500).json({ error: "stored schedule is invalid" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.status(200).json(payload);
};
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add api/schedule.js tests/js/schedule-api.test.mjs
git commit -m "feat(api): GET /api/schedule, 204 when unpushed"
```

---

### Task 5: The push script

**Files:**
- Create: `scripts/push-schedule.mjs`

- [ ] **Step 1: Implement**

```js
// scripts/push-schedule.mjs — read the schedule the repo already has, validate
// it, write it to Redis. Refuses to push anything invalid; fix the source, never
// work around the validator.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { validateSchedule } from "../lib/schedule-schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "public/schedule.js"), "utf8");

// schedule.js is a plain script assigning `var SECTIONS = [...]`.
const sandbox = {};
new Function("g", src + "\ng.SECTIONS = SECTIONS;")(sandbox);

const payload = { version: new Date().toISOString().slice(0, 10), sections: sandbox.SECTIONS };
const { errors } = validateSchedule(payload);
if (errors.length) {
  console.error("schedule.js is invalid — NOT pushing:\n  " + errors.join("\n  "));
  process.exit(1);
}

const { setSchedule } = createRequire(import.meta.url)("../api/_kv.js");
await setSchedule(payload);
const rows = payload.sections.reduce((n, s) => n + s.rows.length, 0);
console.log(`Pushed schedule ${payload.version}: ${payload.sections.length} sections, ${rows} sessions.`);
```

- [ ] **Step 2: Verify it refuses bad input**

```bash
cp public/schedule.js /tmp/sched.bak
sed -i '' '0,/"id": "ch20-p2"/s//"id": "ch20-p1"/' public/schedule.js
COCKPIT_FAKE_KV=1 node scripts/push-schedule.mjs; echo "exit=$?"
cp /tmp/sched.bak public/schedule.js
```

Expected: prints `duplicate id: ch20-p1` and `exit=1`

- [ ] **Step 3: Verify it accepts the real schedule**

```bash
COCKPIT_FAKE_KV=1 node scripts/push-schedule.mjs
```

Expected: `Pushed schedule 2026-08-08: 31 sections, 584 sessions.`

- [ ] **Step 4: Commit**

```bash
git add scripts/push-schedule.mjs && git commit -m "feat: push-schedule script with refuse-on-invalid"
```

---

### Task 6: Client fetch-and-swap

The app must render instantly from the bundled copy and stay fully usable
offline. The server copy is an upgrade applied afterwards, never a dependency.

**Files:**
- Modify: `public/app.js`
- Modify: `public/sw.js` (bump `CACHE`)
- Delete: `api/ping.js`
- Test: `tests/js/schedule-api.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

```js
import { loadCurrentApp } from "./harness.mjs";

test("a pushed schedule replaces the bundled one after boot", async () => {
  const served = { version: "2026-09-01", sections: [
    { title: "Only sector", accent: "#333", year: 1, rows: [
      { id: "ch1-p1", r: "Chapter 1 — Test", pp: 4, ps: 1, pe: 4, wk: 1, gi: 0 }] }] };
  const app = loadCurrentApp({
    now: new Date(2026, 7, 8, 21, 0, 0),
    fetch: (url) => url.indexOf("/api/schedule") === 0
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(served) })
      : Promise.reject(new Error("unexpected " + url))
  });
  assert.equal(app.SECTIONS.length, 31, "boots on the bundled schedule");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(app.SECTIONS.length, 1, "swapped to the pushed schedule");
});

test("an offline or unpushed fetch leaves the bundled schedule in place", async () => {
  for (const f of [() => Promise.reject(new Error("offline")),
                   () => Promise.resolve({ ok: true, status: 204, json: () => Promise.reject() })]) {
    const app = loadCurrentApp({ now: new Date(2026, 7, 8, 21, 0, 0), fetch: f });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(app.SECTIONS.length, 31);
  }
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test "tests/js/schedule-api.test.mjs"`
Expected: FAIL — second assert sees 31, the swap does not happen yet

- [ ] **Step 3: Implement the swap in `public/app.js`**

Immediately before the existing `loadFromStore(); render();` at the bottom of the
IIFE, add:

```js
  // The bundled schedule.js renders instantly and is the offline copy. If a
  // newer plan has been pushed, swap it in and re-render — so a schedule change
  // reaches the phone without a deploy, and a dead network changes nothing.
  function refreshSchedule() {
    if (typeof fetch !== "function") return;
    fetch("/api/schedule", { cache: "no-store" })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (p) {
        if (!p || !Array.isArray(p.sections) || !p.sections.length) return;
        if (JSON.stringify(p.sections) === JSON.stringify(SECTIONS)) return;
        SECTIONS = p.sections;
        SECS = SECTIONS;
        render();
      })
      .catch(function () {});   // offline: the bundled copy stands
  }
```

and call `refreshSchedule();` on the line after `render();`.

- [ ] **Step 4: Confirm `SECTIONS` and `SECS` are reassignable**

```bash
grep -n "SECTIONS\b" public/schedule.js | head -1
grep -n "var SECS\|const SECS\|SECS =" public/app.js | head
```

Expected: `schedule.js` declares `var SECTIONS`, and `SECS` is a `var`. If either
is `const`, change that declaration to `var` — a `const` cannot be swapped.

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/js/*.test.mjs"`
Expected: PASS — all previous tests plus the two new ones

- [ ] **Step 6: Bump the service worker cache and drop the probe**

```bash
sed -i '' 's/idcockpit-web-v3/idcockpit-web-v4/' public/sw.js
git rm api/ping.js
```

- [ ] **Step 7: Commit and push**

```bash
git add -A && git commit -m "feat: app swaps in a pushed schedule, bundled copy as offline fallback" && git push origin main
```

- [ ] **Step 8: Verify live**

```bash
until curl -sf https://id-cockpit.vercel.app/api/schedule -o /dev/null -w "%{http_code}" | grep -qE "20[04]"; do sleep 5; done
curl -s -o /dev/null -w "api:%{http_code}\n" https://id-cockpit.vercel.app/api/schedule
curl -s -o /dev/null -w "app:%{http_code}\n" https://id-cockpit.vercel.app/
```

Expected: `api:204` before the store is connected (or `api:200` after a real
push), and `app:200` regardless. Then open the app in the browser pane, confirm
584 sessions still render and the console is clean.

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`, `~/.claude/skills/id-cockpit/SKILL.md`

- [ ] **Step 1: Add a README section**

````markdown
## Pushing a schedule change without a deploy

The plan bundled in `public/schedule.js` is the offline copy and the fallback.
A pushed copy in Redis overrides it at runtime:

```bash
npm run push:schedule
```

Validates first and refuses to push a schedule with duplicate or missing session
ids — those are the keys progress is stored against. `GET /api/schedule` returns
204 when nothing has been pushed, and the app keeps its bundled copy.

Requires the Upstash store connected to the Vercel project and `.env.local`
pulled via `npx vercel env pull .env.local`.
````

- [ ] **Step 2: Add to the skill's "Making a change" section**

```markdown
**Schedule content** (reordering, inserting, editing sessions) does NOT need a
deploy: edit `public/schedule.js`, run `npm run push:schedule`, and it is on his
phone on next open. App *behaviour* still needs the normal push-and-deploy.
```

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: how to push a schedule without deploying"
```

---

## Follow-on, deliberately not in this plan

**Server-side progress.** The same store could hold `cockpit:progress`, which
would give Tyler an off-device backup with no token to paste — the thing he
declined the gist setup for. It is a separate subsystem with its own risks
(an unauthenticated write endpoint, an offline write queue, and a careful
one-time migration of the 38 sessions that currently exist only in his phone's
`localStorage`). It gets its own spec and plan.

## Self-review notes

- **Spec coverage:** the ask was "change the plan without a deploy" — Tasks 3–6
  deliver it end to end; Tasks 1–2 de-risk and enable.
- **Unknown surfaced first:** Task 1 exists solely because `api/` on a
  static-output Vercel project is unverified. If it fails, stop.
- **Naming consistency:** `getSchedule`/`setSchedule`/`__resetFake` are defined in
  Task 2 and used unchanged in Tasks 4 and 5; `validateSchedule` is defined in
  Task 3 and used in Tasks 4 and 5.
- **Known risk:** Task 6 reassigns `SECTIONS`, which the tests currently treat as
  fixed. Step 4 checks the declarations before the swap is relied on.
