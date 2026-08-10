# Premium Polish — Plan 3: Hierarchy and Motion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quest genuinely dominant with the numbers demoted to a thin
strip, then make the app move — entry animations, and a mark-as-read that feels
like something.

**Architecture:** Task 1 restructures the Today tab (markup + `renderToday`).
Task 2 adds `public/motion.mjs` + `public/motion.js` — the same two-file pattern
`copy` uses, pinned by a drift test. Tasks 3–4 apply motion and build the
mark-as-read moment. Nothing touches `compute()`, `sync.js` or the API.

**Tech Stack:** Vanilla ES5 in the browser, `node:test` via the vm harness, CSS
animations. No build step.

**Scope:** Stage 1 (hierarchy) and stage 4 (motion) of
`docs/2026-08-09-premium-polish-design.md`. Launch images, the icon, safe-area
work and gestures are plan 4. Dark mode is undecided and not here.

---

### Task 1: Hierarchy — one thing is the hero

Today the quest card and the Up Next list carry similar weight, and there is no
at-a-glance sense of standing. The approved mockup made the quest large and
collapsed the numbers into one thin strip of three.

**Files:** Modify `public/index.html`, `public/app.js`

- [ ] **Step 1: Add the stat strip markup**

In `public/index.html`, inside `#v-today`, between the quest card and the
`seclabel`:

```html
      <div id="questCard"></div>
      <div class="strip" id="statStrip"></div>
      <div class="seclabel">Up next</div>
```

- [ ] **Step 2: Style it**

Add above the `/* ---- tab bar ---- */` marker:

```css
/* ---- today: the strip ----------------------------------------------------
   Three numbers, deliberately quiet. This is where the level ring and XP bar
   used to be; the point is that it no longer competes with the quest. */
.strip{display:flex;background:var(--card);border:var(--edge);border-radius:16px;
       box-shadow:var(--sh-1);overflow:hidden;margin:14px 0 18px}
.strip .cell{flex:1;padding:12px 8px;text-align:center}
.strip .cell + .cell{border-left:var(--edge)}
.strip .cv{font-family:var(--serif);font-size:21px;line-height:1;
           font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.strip .ck{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
           color:var(--faint);margin-top:4px;font-weight:700}
.strip .cv.behind{color:var(--behind)}
```

- [ ] **Step 3: Render it**

In `renderToday()` in `public/app.js`, after the `questCard` if/else block and
before the `$("upNext")` assignment:

```js
    // Three numbers, no more. The middle one is the only thing that changes
    // character: it is the debt, and it earns colour when it is non-zero.
    $("statStrip").innerHTML =
      '<div class="cell"><div class="cv">' + m.sessDone + '</div>'
      +   '<div class="ck">Read</div></div>'
      + '<div class="cell"><div class="cv' + (m.makeup > 0 ? " behind" : "") + '">'
      +   (m.makeup > 0 ? m.makeup : "—") + '</div>'
      +   '<div class="ck">' + (m.makeup > 0 ? "To make up" : "On plan") + '</div></div>'
      + '<div class="cell"><div class="cv">' + m.pctAll + '%</div>'
      +   '<div class="ck">Complete</div></div>';
```

- [ ] **Step 4: Grow the quest, since it is now the hero**

In `public/index.html`, replace the `.quest .qt` size:

```css
.quest .qt{font-family:var(--serif);font-size:27px;font-weight:450;line-height:1.1;
           margin-top:4px;text-wrap:pretty;letter-spacing:-.02em}
```

- [ ] **Step 5: Verify**

```bash
python3 -m http.server 8797 --directory public
```
At 375px width, the Today tab should read: date, headline, large quest card,
thin three-number strip, Up next. Check the strip with `makeup > 0` (shows the
number in ochre) and seed a state where `makeup` is 0 to confirm it reads
`— / On plan` rather than `0`.

- [ ] **Step 6: Run tests and commit**

```bash
node --test "tests/js/*.test.mjs"
git add public/index.html public/app.js
git commit -m "feat: quest as hero, numbers demoted to a strip

Three numbers in a thin strip where the level ring and XP bar used to be.
The debt cell earns colour only when non-zero; at zero it reads em-dash and
'On plan' rather than a meaningless 0."
```

Expected: 77 pass. `renderToday` is not directly covered, so the browser check
in Step 5 is the real verification.

---

### Task 2: `motion.mjs` — the tween with a memory

**Why a module rather than inline CSS:** `render()` rebuilds panels with
`innerHTML`, destroying nodes. A CSS transition cannot run on an element that
did not exist a frame ago. Entry animations work regardless, but *value* changes
(35 → 36 sessions, 6% → 7%) need the previous number remembered in JS.

**Files:** Create `public/motion.mjs`, `public/motion.js`; test
`tests/js/motion.test.mjs`; modify `tests/js/harness.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/js/motion.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { easeOutCubic, tweenFrames, remember, recall, reduced } from "../../public/motion.mjs";

test("the easing starts fast and settles", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, "eased midpoint is past halfway");
  for (let i = 1; i <= 10; i++) {
    assert.ok(easeOutCubic(i / 10) >= easeOutCubic((i - 1) / 10), "monotonic");
  }
});

test("a tween starts at from and ends exactly at to", () => {
  const f = tweenFrames(4, 9, 5);
  assert.equal(f[0], 4);
  assert.equal(f[f.length - 1], 9, "must land exactly, not near");
});

test("a tween never overshoots its endpoints", () => {
  for (const v of tweenFrames(4, 9, 20)) { assert.ok(v >= 4 && v <= 9); }
  for (const v of tweenFrames(9, 4, 20)) { assert.ok(v >= 4 && v <= 9); }
});

test("recall returns the last remembered value for a key", () => {
  remember("pct", 4);
  assert.equal(recall("pct", 99), 4);
  remember("pct", 6);
  assert.equal(recall("pct", 99), 6);
});

test("recall falls back on a key it has never seen", () => {
  assert.equal(recall("never-set-" + Math.floor(1), 42), 42);
});

test("reduced motion collapses a tween to a single final frame", () => {
  assert.deepEqual(tweenFrames(4, 9, 20, true), [9]);
});

test("reduced() reads the media query and defaults to false without one", () => {
  assert.equal(reduced(null), false);
  assert.equal(reduced({ matches: true }), true);
  assert.equal(reduced({ matches: false }), false);
});
```

- [ ] **Step 2: Run and watch fail**

Run: `node --test "tests/js/motion.test.mjs"`
Expected: FAIL — cannot find `public/motion.mjs`

- [ ] **Step 3: Implement**

```js
// public/motion.mjs — the maths behind the movement.
//
// render() rebuilds panels with innerHTML, so nodes are destroyed and recreated
// on every state change. A CSS transition cannot animate an element that did not
// exist a frame ago — which is why this app has had transition rules and no
// visible motion. Entry animations are unaffected; changing *values* need the
// previous number kept here, outside the DOM.

const memory = new Map();

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Remember a value against a key, so the next render can animate from it. */
export function remember(key, value) { memory.set(key, value); }

/** The last remembered value, or `fallback` the first time a key is seen. */
export function recall(key, fallback) {
  return memory.has(key) ? memory.get(key) : fallback;
}

/** True when the user has asked for less motion. */
export function reduced(mq) { return !!(mq && mq.matches); }

/**
 * The values a tween passes through. Returned as an array rather than driven by
 * a timer so the maths is testable without a clock.
 * Always lands exactly on `to` — a near-miss shows as an off-by-one on screen.
 */
export function tweenFrames(from, to, steps, isReduced) {
  if (isReduced || steps <= 1) return [to];
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push(from + (to - from) * easeOutCubic(i / (steps - 1)));
  }
  out[out.length - 1] = to;
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/js/motion.test.mjs"` — expected 7 pass.

- [ ] **Step 5: Write the browser shim**

```js
/* public/motion.js — browser shim over motion.mjs, plus the DOM driver.
   Same two-file arrangement as copy.js; a test pins them together. */
(function (global) {
  "use strict";
  var memory = {};

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function remember(k, v) { memory[k] = v; }
  function recall(k, fb) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : fb; }
  function reduced() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * Count an element from its remembered value to `to`, then remember `to`.
   * fmt turns a number into the text shown.
   */
  function countTo(el, key, to, fmt, ms) {
    if (!el) return;
    var from = recall(key, to);
    remember(key, to);
    fmt = fmt || function (v) { return Math.round(v); };
    if (from === to || reduced()) { el.textContent = fmt(to); return; }
    var t0 = null, dur = ms || 620;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      el.textContent = fmt(from + (to - from) * easeOutCubic(k));
      if (k < 1) global.requestAnimationFrame(step);
      else el.textContent = fmt(to);
    }
    global.requestAnimationFrame(step);
  }

  /** Replay a CSS animation on an element that may already carry the class. */
  function pulse(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;              // forces reflow so the animation restarts
    el.classList.add(cls);
  }

  global.IDMotion = { easeOutCubic: easeOutCubic, remember: remember, recall: recall,
                      reduced: reduced, countTo: countTo, pulse: pulse };
})(window);
```

- [ ] **Step 6: Pin the two files together**

Append to `tests/js/motion.test.mjs`:

```js
test("the browser shim matches the module", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/motion.js", import.meta.url), "utf8");
  const g = { matchMedia: null, requestAnimationFrame: () => {} };
  new Function("global", src.replace("})(window);", "})(global);"))(g);

  for (let i = 0; i <= 10; i++) {
    assert.equal(g.IDMotion.easeOutCubic(i / 10), easeOutCubic(i / 10), "ease at " + i);
  }
  g.IDMotion.remember("k", 3);
  assert.equal(g.IDMotion.recall("k", 9), 3);
  assert.equal(g.IDMotion.recall("unset", 9), 9);
  assert.equal(g.IDMotion.reduced(), false, "no matchMedia means no reduced-motion claim");
});
```

- [ ] **Step 7: Load it in the page and the harness**

`public/index.html`, after `copy.js`:
```html
<script src="motion.js"></script>
```

`tests/js/harness.mjs` — add to the `files` array in `loadCurrentApp`, and add
`matchMedia` and `requestAnimationFrame` to the sandbox:

```js
    files: ["schedule.js", "sync.js", "copy.js", "motion.js", "app.js"],
```
```js
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
```

Without those two the app throws on load, exactly as it did when `copy.js` was
added without updating the harness.

- [ ] **Step 8: Run everything and commit**

```bash
node --test "tests/js/*.test.mjs"
git add public/motion.js public/motion.mjs public/index.html tests/js/motion.test.mjs tests/js/harness.mjs
git commit -m "feat: motion module — tweens that remember

render() destroys and recreates nodes, so CSS transitions never fire on
changing values. motion remembers the previous number outside the DOM and
counts from it, which is why the ring appears to ease even though the element
is one frame old.

Reduced motion collapses every tween to its final frame."
```
Expected: 85 pass.

---

### Task 3: Entry animations

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add the stagger keyframe and rules**

```css
/* ---- motion --------------------------------------------------------------
   Entry animations only. These run on mount, so they are unaffected by
   render() rebuilding the panel. */
@keyframes idfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.view.on > *{animation:idfade .32s cubic-bezier(.2,.8,.3,1) both}
.view.on > *:nth-child(1){animation-delay:.02s}
.view.on > *:nth-child(2){animation-delay:.06s}
.view.on > *:nth-child(3){animation-delay:.10s}
.view.on > *:nth-child(4){animation-delay:.14s}
.unrow{animation:idfade .3s cubic-bezier(.2,.8,.3,1) both}
.unrow:nth-child(2){animation-delay:.04s}
.unrow:nth-child(3){animation-delay:.08s}
.qacts button{transition:transform .12s cubic-bezier(.2,.8,.3,1),filter .2s}
.qacts button:active{transform:scale(.97)}

@media (prefers-reduced-motion:reduce){
  .view.on > *,.unrow,.quest{animation:none !important}
  .qacts button{transition:none}
}
```

- [ ] **Step 2: Confirm the visible-pane class (already verified)**

```bash
grep -n 'classList.toggle("on"' public/app.js
```
Expected: a hit at roughly line 371 — `$("v-" + t).classList.toggle("on", t === tab)`.
So `.view.on` in Step 1 is correct, checked against the real file while writing
this plan rather than assumed. Re-run the grep anyway: if it misses, the app has
moved on and the selectors need updating before continuing.

- [ ] **Step 3: Verify, including with reduced motion**

Reload and switch tabs — content should rise in with a slight stagger. Then in
the browser device toolbar enable "prefers-reduced-motion: reduce" and confirm
everything appears instantly with no movement.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: entry animations with a reduced-motion escape"
```

---

### Task 4: The mark-as-read moment

The action performed once a day, which currently produces nothing.

**Files:** Modify `public/app.js`, `public/index.html`

- [ ] **Step 1: Add the pulse keyframe**

```css
@keyframes idpop{0%{transform:scale(1)}38%{transform:scale(1.05)}100%{transform:scale(1)}}
.strip.pop{animation:idpop .42s cubic-bezier(.2,.8,.3,1)}
```

- [ ] **Step 2: Animate the strip's numbers instead of writing them**

In `renderToday()`, replace the `$("statStrip").innerHTML = ...` assignment from
Task 1 with markup that leaves the values empty, then fill them by tween:

```js
    $("statStrip").innerHTML =
      '<div class="cell"><div class="cv" id="cvRead"></div><div class="ck">Read</div></div>'
      + '<div class="cell"><div class="cv' + (m.makeup > 0 ? " behind" : "") + '" id="cvOwed"></div>'
      +   '<div class="ck">' + (m.makeup > 0 ? "To make up" : "On plan") + '</div></div>'
      + '<div class="cell"><div class="cv" id="cvPct"></div><div class="ck">Complete</div></div>';

    window.IDMotion.countTo($("cvRead"), "read", m.sessDone);
    window.IDMotion.countTo($("cvOwed"), "owed", m.makeup,
      function (v) { return m.makeup > 0 ? Math.round(v) : "—"; });
    window.IDMotion.countTo($("cvPct"), "pct", m.pctAll, function (v) { return Math.round(v) + "%"; });
```

- [ ] **Step 3: Pulse the strip when something is marked**

In `setDone()` in `public/app.js`, immediately after `render();`:

```js
    if (done) window.IDMotion.pulse($("statStrip"), "pop");
```

- [ ] **Step 4: Verify the whole moment**

Reload, seed some progress, and press **Mark as read**. Expected: the button
compresses under the press, the numbers count up rather than jumping, and the
strip gives one small pulse. Then enable reduced motion and confirm the numbers
change instantly with no pulse.

- [ ] **Step 5: Confirm the counting is real, not a jump**

In the console, watch a value mid-tween:

```js
IDMotion.remember("pct", 0);
IDMotion.countTo(document.getElementById("cvPct"), "pct", 50, v => Math.round(v) + "%");
setTimeout(() => console.log("mid-tween:", document.getElementById("cvPct").textContent), 200);
```
Expected: a value between 0% and 50%, not `50%`.

- [ ] **Step 6: Run tests, ship**

```bash
node --test "tests/js/*.test.mjs"
sed -i '' 's/idcockpit-web-v8/idcockpit-web-v9/' public/sw.js
git add -A
git commit -m "feat: the mark-as-read moment

Numbers count from their previous value, the strip pulses once, the button
compresses under the finger. The single action performed daily now
acknowledges itself.

No haptic: iOS Safari has no Vibration API, so motion carries it alone."
git push origin main
```

- [ ] **Step 7: Verify live**

```bash
until curl -s https://id-cockpit.vercel.app/sw.js | grep -q "idcockpit-web-v9"; do sleep 6; done
curl -s -o /dev/null -w "app:%{http_code}\n" https://id-cockpit.vercel.app/
curl -s https://id-cockpit.vercel.app/api/progress | head -c 60
```
Then open the deployed app at mobile viewport, mark a session, confirm the
motion and a clean console — and **un-mark it again**, since this is Tyler's
real progress and the plan should not silently spend one of his sessions.

---

## Self-review notes

- **Spec coverage:** stages 1 and 4. Launch images, icon, safe-area work and
  gestures are plan 4; dark mode is undecided.
- **Task 2 Step 7 is the lesson from plan 1.** Adding a script to `index.html`
  without updating the harness turned 24 tests red. The harness needs
  `matchMedia` and `requestAnimationFrame` as well as the file, and the step
  says so rather than leaving it to be discovered.
- **Task 3's selector was verified, not guessed.** `.view.on` is what
  `app.js:371` actually toggles. The step still re-greps, so a future drift
  fails loudly instead of producing silently dead CSS — the same failure mode as
  the orphaned `.streak` rules plan 1 left behind.
- **`.strip` does not already exist** in the stylesheet — checked, so Task 1
  introduces it without colliding.
- **Naming consistency:** `remember`/`recall`/`tweenFrames`/`easeOutCubic`/
  `reduced` are defined in Task 2 Step 3 and used unchanged in Steps 5–6;
  `countTo`/`pulse` are defined in Step 5 and used in Task 4 Steps 2–3.
- **Known risk:** `countTo` writes `textContent` on a node captured before the
  tween starts. If a re-render replaces that node mid-tween the update lands on
  an orphan — visible as a number that stops partway. Acceptable, because a
  re-render immediately re-runs `countTo` with the correct memory; noted so it
  is not mistaken for a bug.
