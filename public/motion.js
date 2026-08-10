/* public/motion.js — browser shim over motion.mjs, plus the DOM driver.
   Same two-file arrangement as copy.js; a test pins them together. Keep the
   pure functions here a mirror of the module. */
(function (global) {
  "use strict";
  var memory = {};

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function remember(k, v) { memory[k] = v; }
  function recall(k, fb) {
    return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : fb;
  }
  function reduced() {
    return !!(global.matchMedia &&
              global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * Count an element from its remembered value to `to`, then remember `to`.
   * fmt turns a number into the text shown.
   *
   * The node is captured before the tween starts. If a re-render replaces it
   * mid-flight the writes land on an orphan and the visible number stops — but
   * that re-render immediately calls countTo again with the correct memory, so
   * it self-corrects within a frame.
   */
  function countTo(el, key, to, fmt, ms) {
    if (!el) return;
    var from = recall(key, to);
    remember(key, to);
    fmt = fmt || function (v) { return Math.round(v); };
    if (from === to || reduced() || !global.requestAnimationFrame) {
      el.textContent = fmt(to);
      return;
    }
    // Write the true value first. The tween is an enhancement: if rAF never
    // fires — a backgrounded tab, a throttled frame loop — the correct number is
    // already on screen rather than an empty box. Caught in verification, where
    // marking a session left the whole strip blank.
    el.textContent = fmt(to);

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
