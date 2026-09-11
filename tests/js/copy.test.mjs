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

test("a make-up still due today is not called done", () => {
  // Sunday: the regular session is read, the pinned extra is still today's.
  // "Done for today." over a quest card that says otherwise is a contradiction.
  assert.equal(headline(model({ readToday: true, dueToday: 0 })), "Done for today.");
  assert.notEqual(headline(model({ readToday: true, dueToday: 1 })), "Done for today.");
  assert.equal(headline(model({ readToday: true, dueToday: 1 })), "Good morning");
});

test("a completed curriculum is not treated as an ordinary day", () => {
  assert.match(headline(model({ remaining: 0, firstOpen: null })), /finish|complete|done|every page/i);
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

test("the browser shim matches the module", async () => {
  // Two copies of the same logic is a maintenance trap. Pin them together so
  // drift fails the suite rather than shipping different words to the phone.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/copy.js", import.meta.url), "utf8");
  const g = {};
  new Function("global", src.replace("})(window);", "})(global);"))(g);

  const cases = [
    { now: new Date(2026, 7, 9, 21, 0, 0), remaining: 5, firstOpen: { id: "x" }, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, dayOff: true, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, readToday: true, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, readToday: true, dueToday: 1, makeup: 8 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 0, firstOpen: null, makeup: 0 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, makeup: 6 },
    { now: new Date(2026, 7, 9, 9, 0, 0), remaining: 5, firstOpen: { id: "x" }, justCleared: "Sepsis", makeup: 0 }
  ];
  for (const c of cases) {
    assert.equal(g.IDCopy.headline(c), headline(c), "headline " + JSON.stringify(c));
    assert.equal(g.IDCopy.meta(c), meta(c), "meta " + JSON.stringify(c));
  }
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 7, 9, h, 0, 0);
    assert.equal(g.IDCopy.greeting(d), greeting(d), "greeting hour " + h);
  }
});
