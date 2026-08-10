// public/motion.mjs — the maths behind the movement.
//
// render() rebuilds panels with innerHTML, so nodes are destroyed and recreated
// on every state change. A CSS transition cannot animate an element that did not
// exist a frame ago — which is why this app carried transition rules for months
// and never visibly moved. Entry animations are unaffected; changing *values*
// need the previous number kept here, outside the DOM.
//
// public/motion.js mirrors this for the page and adds the DOM driver. A test
// pins the two together.

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
 * a timer, so the maths is testable without a clock.
 *
 * Always lands exactly on `to`: computing the last frame from the easing curve
 * can leave a floating-point near-miss, which shows on screen as a counter that
 * stops one short.
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
