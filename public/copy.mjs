// public/copy.mjs — every user-facing sentence, and the decisions behind them.
//
// Pure: takes the computed model, returns a string. No DOM, no globals, so the
// wording is testable — which it needs to be, because the bug that started this
// was a greeting that said "Good morning" at half nine at night.
//
// public/copy.js mirrors this for the page, which loads plain scripts. A test
// pins the two together; change one, change both.

/** Time-of-day greeting. The floor: never wrong about the hour. */
export function greeting(now) {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The large line. Names the situation when there is one worth naming, and falls
 * back to the greeting on an ordinary day. Order is priority: finishing the
 * curriculum outranks clearing a sector, which outranks a rest day.
 */
export function headline(m) {
  if (m.remaining === 0 || !m.firstOpen) return "Every page read.";
  if (m.justCleared) return m.justCleared + " cleared.";
  if (m.dayOff) return "Rest day. Back at it tomorrow.";
  // A make-up pinned to today is still due after the regular session is read;
  // "done" over a quest card that disagrees would be a contradiction.
  if (m.readToday && !m.dueToday) return "Done for today.";
  return greeting(m.now);
}

/** The small line top-right. The debt matters more than the total. */
export function meta(m) {
  if (m.makeup > 0) return "Catching up · " + m.makeup + " to make up";
  if (m.remaining === 0) return "Curriculum complete";
  return m.remaining + " sessions left";
}
