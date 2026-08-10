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
  assert.equal(recall("never-set-key", 42), 42);
});

test("reduced motion collapses a tween to a single final frame", () => {
  assert.deepEqual(tweenFrames(4, 9, 20, true), [9]);
});

test("reduced() reads the media query and defaults to false without one", () => {
  assert.equal(reduced(null), false);
  assert.equal(reduced({ matches: true }), true);
  assert.equal(reduced({ matches: false }), false);
});

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

test("a value is correct before any animation runs", async () => {
  // Regression: the strip's markup ships with empty cells and countTo filled
  // them from a rAF callback. With no frame loop the numbers stayed blank.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/motion.js", import.meta.url), "utf8");
  const el = { textContent: "" };

  const never = { matchMedia: null, requestAnimationFrame: () => {} };  // never calls back
  new Function("global", src.replace("})(window);", "})(global);"))(never);
  never.IDMotion.remember("k", 0);
  never.IDMotion.countTo(el, "k", 42);
  assert.equal(el.textContent, 42, "correct value must be present without a single frame");

  const absent = { matchMedia: null };                                  // no rAF at all
  const el2 = { textContent: "" };
  new Function("global", src.replace("})(window);", "})(global);"))(absent);
  absent.IDMotion.remember("k2", 0);
  absent.IDMotion.countTo(el2, "k2", 7);
  assert.equal(el2.textContent, 7, "and without requestAnimationFrame existing");
});
