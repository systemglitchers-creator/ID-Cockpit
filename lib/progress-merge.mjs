// lib/progress-merge.mjs — how two copies of read-state become one.
//
// The safety property that matters: a client with an empty or partial view must
// never be able to delete what the server holds. Progress is only ever unioned,
// and per session the newer timestamp wins. There is no path that removes a
// session id from the merged result.
//
// This is the same rule the retired Mac server used, and it exists because the
// failure mode is silent and permanent: open the app on a fresh browser, it
// saves its empty state, and a year of reading is gone.

/** Sort key for one session entry. Timestamps are UTC ISO strings. */
function stamp(entry) {
  return (entry && (entry.updatedAt || entry.doneAt)) || "";
}

/**
 * Union two session maps, newest wins per id.
 * @param {Record<string, object>} a
 * @param {Record<string, object>} b
 * @returns {Record<string, object>}
 */
export function mergeProgress(a, b) {
  a = a || {};
  b = b || {};
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id];
    const y = b[id];
    if (!x) { out[id] = y; continue; }
    if (!y) { out[id] = x; continue; }
    out[id] = stamp(y) > stamp(x) ? y : x;
  }
  return out;
}

/** Reject anything that isn't a plausible session map, before it reaches the store. */
export function validateProgress(sessions) {
  const errors = [];
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    return { errors: ["sessions must be an object"] };
  }
  for (const [id, e] of Object.entries(sessions)) {
    if (!e || typeof e !== "object") { errors.push(`${id}: not an object`); continue; }
    if (typeof e.done !== "boolean") errors.push(`${id}: done must be a boolean`);
    for (const k of ["doneAt", "updatedAt"]) {
      if (e[k] != null && typeof e[k] !== "string") errors.push(`${id}: ${k} must be a string or null`);
    }
  }
  return { errors };
}
