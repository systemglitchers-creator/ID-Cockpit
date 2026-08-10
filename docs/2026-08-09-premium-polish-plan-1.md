# Premium Polish — Plan 1: Deletion and Voice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the gamification out of the Today screen, then make every word the
app says depend on the actual situation instead of being hardcoded.

**Architecture:** Two independent commits. The first is pure deletion — code and
markup come out, nothing is added. The second introduces `public/copy.js`, a
dependency-free module of pure functions that take the computed model and return
strings, so the wording is properly testable for the first time.

**Tech Stack:** Vanilla ES5 browser JS, `node:test` via the existing vm harness,
no build step.

**Scope:** Stages 1 and 2 of `docs/2026-08-09-premium-polish-design.md`. Depth,
type, hierarchy, motion, launch, icon and gestures are stages 3–6 and get their
own plans. This plan is shippable and worth shipping on its own: it removes the
clutter and kills the "Good morning at 9pm" bug.

---

### Task 1: Remove gamification

Pure deletion. `level`, `intoLevel`, `rankName`, `streak`, `readDays`, the rank
list and the level constant all go, along with the two Today-screen elements
they feed and the Stats row.

Sector completion (`earned`, `secs[].pct`) **stays** — that is curriculum
progress, not a game layer.

There are 18 references in `app.js` and none in the tests, so nothing will catch
a mistake here. That is exactly why it is its own commit.

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`

- [ ] **Step 1: Confirm the blast radius before touching anything**

Run:
```bash
cd "8. Claude/ID Platform" && grep -n "RANKS\|PAGES_PER_LEVEL\|rankName\|intoLevel\|\blevel\b\|streak\|readDays" public/app.js | wc -l
```
Expected: `18`. If it is not 18, the file has moved on from this plan — re-read
before continuing.

- [ ] **Step 2: Delete the constants**

In `public/app.js`, remove these three lines (currently 12–14):

```js
  var RANKS = ["Initiate", "Junior Resident", "Senior Resident", "ID Fellow",
               "Senior Fellow", "Chief Fellow", "Attending", "Consultant"];
  var PAGES_PER_LEVEL = 200;
```

- [ ] **Step 3: Delete the streak computation**

In `compute()`, remove the whole block (currently 145–156):

```js
    // streak — consecutive study days back from today with at least one read
    var readDays = {};
    SECS.forEach(function (s) { s.rows.forEach(function (r) {
      var d = doneAt(r.id); if (d) readDays[dayKey(d)] = true;
    }); });
    var streak = 0, cur = new Date(now);
    if (!readDays[dayKey(cur)]) cur.setDate(cur.getDate() - 1);
    while (true) {
      if (isFlex(cur)) { cur.setDate(cur.getDate() - 1); continue; }
      if (!readDays[dayKey(cur)]) break;
      streak++; cur.setDate(cur.getDate() - 1);
    }
```

- [ ] **Step 4: Delete the level computation**

Remove (currently 169–170):

```js
    var level = Math.floor(pagesDone / PAGES_PER_LEVEL) + 1;
    var intoLevel = pagesDone % PAGES_PER_LEVEL;
```

- [ ] **Step 5: Trim the returned model**

Replace these three lines in the `return {...}`:

```js
      remaining: remaining, drift: drift, streak: streak, readDays: readDays,
      makeup: makeup, perDay: perDay,
      level: level, intoLevel: intoLevel,
      rankName: RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))],
```

with:

```js
      remaining: remaining, drift: drift,
      makeup: makeup, perDay: perDay,
```

- [ ] **Step 6: Delete the two Today elements**

In `renderToday()`, remove everything from `var pips = "";` through the end of
the `$("levelCard").innerHTML = ...` assignment — the weekday pip loop, the
`$("streakRow")` write, `var intoPct`, and the whole level card. The function
should now begin:

```js
  function renderToday() {
    var m = M;

    var q = m.firstOpen;
```

- [ ] **Step 7: Delete their markup**

In `public/index.html`, remove these two lines (currently 240–241):

```html
      <div class="streak" id="streakRow"></div>
      <div id="levelCard"></div>
```

- [ ] **Step 8: Delete the Stats streak row**

In `renderStats()`, remove this line:

```js
      +   '<div class="baseline"><span class="l">Current streak</span><span class="v' + (m.streak > 0 ? " streak" : "") + '">' + m.streak + (m.streak === 1 ? " day" : " days") + '</span></div>'
```

- [ ] **Step 9: Fix the header, which still reads `m.streak`**

That line is the last reference and would now render `undefined-day streak`.
Replace it with the plain greeting for now — Task 2 replaces it properly:

```js
    else h = { e: fmtD(m.now).toUpperCase(),
               t: "Good morning",
               r: m.makeup > 0 ? "Catching up · " + m.makeup + " to make up"
                               : m.remaining + " sessions left" };
```

- [ ] **Step 10: Verify nothing is left behind**

Run:
```bash
grep -n "RANKS\|PAGES_PER_LEVEL\|rankName\|intoLevel\|streak\|readDays\|levelCard\|streakRow" public/app.js public/index.html
```
Expected: **no output.** Any hit is a dangling reference that will throw at
runtime.

- [ ] **Step 11: Run the tests**

Run: `node --test "tests/js/*.test.mjs"`
Expected: 66 pass, 0 fail. These do not cover the deleted code, so green here
means "nothing else broke", not "the deletion is correct".

- [ ] **Step 12: Verify in a browser, because the tests cannot**

```bash
python3 -m http.server 8797 --directory public
```
Open `http://127.0.0.1:8797/`, check the console is clean and the Today screen
shows the date, greeting, quest card and Up Next — with no dots, ring or XP bar.
Check the Stats tab still renders without the streak row.

- [ ] **Step 13: Commit**

```bash
git add public/app.js public/index.html
git commit -m "refactor: remove gamification

Levels, ranks, XP, streak dots and the streak stat are gone on Tyler's call.
Sector completion stays — curriculum progress, not a game layer.

Deletion only, in its own commit: 18 references in app.js and none in the
tests, so nothing here is covered and it needs to be revertible alone."
```

---

### Task 2: `copy.js` — words that know the situation

The greeting says "Good morning" at 9pm. Beyond fixing that, the app should say
something true about the state rather than one fixed string.

Pure functions taking the model, returning strings. No DOM, so it is genuinely
testable — the first user-facing text in this app that will be.

**Files:**
- Create: `public/copy.js`
- Modify: `public/index.html` (script tag), `public/app.js` (call it)
- Test: `tests/js/copy.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/js/copy.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { greeting, headline, meta } from "../../public/copy.mjs";

/* greeting is the bug that started this: a hardcoded "Good morning" that
   greeted Tyler at 9:29pm. */

test("the greeting follows the clock", () => {
  const at = (h) => greeting(new Date(2026, 7, 9, h, 0, 0));
  assert.equal(at(0), "Still up");
  assert.equal(at(4), "Still up");
  assert.equal(at(5), "Good morning");
  assert.equal(at(11), "Good morning");
  assert.equal(at(12), "Good afternoon");
  assert.equal(at(17), "Good evening");
  assert.equal(at(23), "Good evening");
});

test("every hour of the day produces a greeting", () => {
  for (let h = 0; h < 24; h++) {
    const g = greeting(new Date(2026, 7, 9, h, 0, 0));
    assert.ok(g && g.length > 0, `hour ${h}`);
  }
});

/* headline replaces the greeting when the situation is worth naming. */

const model = (over) => Object.assign({
  now: new Date(2026, 7, 9, 9, 0, 0),
  dayOff: false, readToday: false, makeup: 0, remaining: 500,
  justCleared: null, firstOpen: { id: "x" }
}, over);

test("a rest day says so instead of greeting you", () => {
  const h = headline(model({ dayOff: true }));
  assert.match(h, /rest|off|tomorrow/i);
  assert.doesNotMatch(h, /Good morning/);
});

test("finishing the day's reading is acknowledged", () => {
  assert.match(headline(model({ readToday: true })), /done|clear|tomorrow/i);
});

test("a completed curriculum is not treated as an ordinary day", () => {
  assert.match(headline(model({ remaining: 0, firstOpen: null })), /finish|complete|done/i);
});

test("an ordinary morning falls back to the greeting", () => {
  assert.equal(headline(model({})), "Good morning");
});

test("clearing a sector is called out", () => {
  assert.match(headline(model({ justCleared: "Endocarditis" })), /Endocarditis/);
});

/* meta is the small line top-right. */

test("meta leads with the debt when behind", () => {
  assert.match(meta(model({ makeup: 6 })), /6/);
});

test("meta falls back to sessions remaining", () => {
  assert.match(meta(model({ makeup: 0, remaining: 500 })), /500/);
});

test("no copy function ever returns empty", () => {
  for (const over of [{}, { dayOff: true }, { readToday: true }, { makeup: 3 },
                      { remaining: 0, firstOpen: null }, { justCleared: "X" }]) {
    assert.ok(headline(model(over)).length > 0, JSON.stringify(over));
    assert.ok(meta(model(over)).length > 0, JSON.stringify(over));
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test "tests/js/copy.test.mjs"`
Expected: FAIL — `Cannot find module '../../public/copy.mjs'`

- [ ] **Step 3: Write the module**

The browser needs a plain script and the tests need an ES module. Rather than a
build step, `copy.mjs` holds the logic and `copy.js` is a two-line wrapper the
page loads. Create `public/copy.mjs`:

```js
// public/copy.mjs — every user-facing sentence, and the decisions behind them.
//
// Pure: takes the computed model, returns a string. No DOM, no globals, so the
// wording is testable — which it needs to be, because the bug that started this
// was a greeting that said "Good morning" at half nine at night.

/** Time-of-day greeting. The floor: never wrong about the hour. */
export function greeting(now) {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The large line. Names the situation when there is one worth naming, and
 * falls back to the greeting on an ordinary day.
 */
export function headline(m) {
  if (m.remaining === 0 || !m.firstOpen) return "Every page read.";
  if (m.justCleared) return m.justCleared + " cleared.";
  if (m.dayOff) return "Rest day. Back at it tomorrow.";
  if (m.readToday) return "Done for today.";
  return greeting(m.now);
}

/** The small line top-right. The debt matters more than the total. */
export function meta(m) {
  if (m.makeup > 0) return "Catching up · " + m.makeup + " to make up";
  if (m.remaining === 0) return "Curriculum complete";
  return m.remaining + " sessions left";
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/js/copy.test.mjs"`
Expected: PASS (10 tests)

- [ ] **Step 5: Create the browser wrapper**

Create `public/copy.js`:

```js
/* public/copy.js — browser shim over copy.mjs.
   The page loads plain scripts; the tests import the module. Same source of
   truth, no build step. Keep this file a mirror of copy.mjs's exports. */
(function (global) {
  "use strict";
  function greeting(now) {
    var h = now.getHours();
    if (h < 5) return "Still up";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }
  function headline(m) {
    if (m.remaining === 0 || !m.firstOpen) return "Every page read.";
    if (m.justCleared) return m.justCleared + " cleared.";
    if (m.dayOff) return "Rest day. Back at it tomorrow.";
    if (m.readToday) return "Done for today.";
    return greeting(m.now);
  }
  function meta(m) {
    if (m.makeup > 0) return "Catching up · " + m.makeup + " to make up";
    if (m.remaining === 0) return "Curriculum complete";
    return m.remaining + " sessions left";
  }
  global.IDCopy = { greeting: greeting, headline: headline, meta: meta };
})(window);
```

- [ ] **Step 6: Add a test that the two copies cannot drift**

Two files with the same logic is a maintenance trap. Pin it. Append to
`tests/js/copy.test.mjs`:

```js
test("the browser shim matches the module", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/copy.js", import.meta.url), "utf8");
  const g = {};
  new Function("global", src.replace("})(window);", "})(global);"))(g);

  const cases = [
    { now: new Date(2026, 7, 9, 21, 0, 0), remaining: 5, firstOpen: { id: "x" }, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, dayOff: true, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 0, firstOpen: null, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, makeup: 6 }
  ];
  for (const c of cases) {
    assert.equal(g.IDCopy.headline(c), headline(c), "headline " + JSON.stringify(c.now));
    assert.equal(g.IDCopy.meta(c), meta(c), "meta");
  }
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 7, 9, h, 0, 0);
    assert.equal(g.IDCopy.greeting(d), greeting(d), "greeting hour " + h);
  }
});
```

- [ ] **Step 7: Run it**

Run: `node --test "tests/js/copy.test.mjs"`
Expected: PASS (11 tests)

- [ ] **Step 8: Expose what the copy needs from `compute()`**

`headline` needs `dayOff` and `readToday`, which `compute()` calculates but does
not return. In `public/app.js`, add them to the returned object alongside
`makeup`:

```js
      makeup: makeup, perDay: perDay, dayOff: dayOff, readToday: readToday,
```

- [ ] **Step 9: Load the script**

In `public/index.html`, add before `app.js`:

```html
<script src="copy.js"></script>
```

- [ ] **Step 10: Use it**

In `public/app.js`, replace the Today branch of the header:

```js
    else h = { e: fmtD(m.now).toUpperCase(),
               t: "Good morning",
               r: m.makeup > 0 ? "Catching up · " + m.makeup + " to make up"
                               : m.remaining + " sessions left" };
```

with:

```js
    else h = { e: fmtD(m.now).toUpperCase(),
               t: window.IDCopy.headline(m),
               r: window.IDCopy.meta(m) };
```

- [ ] **Step 11: Run everything**

Run: `node --test "tests/js/*.test.mjs"`
Expected: 77 pass, 0 fail.

- [ ] **Step 12: Verify the actual bug is dead**

```bash
python3 -m http.server 8797 --directory public
```

In the browser console, confirm the greeting tracks the clock rather than the
string being fixed:

```js
[0,9,14,21].map(h => IDCopy.greeting(new Date(2026,7,9,h,0,0)))
```
Expected: `["Still up","Good morning","Good afternoon","Good evening"]`

Then check the rendered header. On a Saturday after 18 July it should read
**"Rest day. Back at it tomorrow."**, not a greeting.

- [ ] **Step 13: Commit**

```bash
git add public/copy.js public/copy.mjs public/index.html public/app.js tests/js/copy.test.mjs
git commit -m "feat: copy that knows the time and the situation

Kills the hardcoded greeting that said Good morning at 9:29pm, and lets the
headline name the day: rest day, done for today, sector cleared, complete.

copy.mjs holds the logic and copy.js mirrors it for the page, since the app
has no build step. A test pins the two together across all 24 hours and every
state, because duplicated logic drifts."
```

- [ ] **Step 14: Bump the service worker and ship**

```bash
sed -i '' 's/idcockpit-web-v5/idcockpit-web-v6/' public/sw.js
git add public/sw.js && git commit -m "chore: bump sw cache for the copy and deletion work"
git push origin main
```

- [ ] **Step 15: Verify live**

```bash
until curl -s https://id-cockpit.vercel.app/sw.js | grep -q "idcockpit-web-v6"; do sleep 6; done
curl -s -o /dev/null -w "app:%{http_code}\n" https://id-cockpit.vercel.app/
curl -s https://id-cockpit.vercel.app/api/progress | head -c 80
```

Expected: `app:200`, and progress still returning the stored sessions. Then open
the deployed app in the browser pane, confirm a clean console and that progress
is intact — this plan touches `compute()`'s return value, which the sync path
reads.

---

## Self-review notes

- **Spec coverage:** stages 1 and 2 of the design doc. Stages 3–6 (depth/type/
  hierarchy, motion, launch/icon/iOS fit, gestures) are deliberately excluded and
  get their own plans.
- **Naming consistency:** `greeting`/`headline`/`meta` are defined in Task 2 Step
  3 and used unchanged in Steps 6, 10 and 12. `dayOff` and `readToday` already
  exist as locals in `compute()` (added during the catch-up work) — Step 8 only
  exposes them.
- **The real risk is Task 1.** It deletes untested code, so Steps 10 and 12 are
  the safety net: a grep proving no dangling references, and a human look at both
  affected tabs. Green tests prove nothing about the deletion itself.
- **Known duplication:** `copy.js` and `copy.mjs` hold the same logic, which is a
  deliberate trade to avoid introducing a build step into an app whose whole
  virtue is not having one. Step 6 pins them together so drift fails the suite.
