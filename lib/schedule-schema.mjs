// lib/schedule-schema.js — one validator, used by the push script (before a
// write) and the API (before serving).
//
// Returns collected errors rather than throwing, so the push script can print
// all of them at once instead of one per run.
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
      // Ids key the read-state. A duplicate merges two sessions' progress; a
      // rename orphans it. Neither is recoverable from inside the app.
      if (seen.has(r.id)) errors.push(`${at}: duplicate id: ${r.id}`);
      seen.add(r.id);
      if (typeof r.gi !== "number") errors.push(`${at} (${r.id}): gi must be a number`);
      // `extra: true` pins a session to its own day as a second session — a
      // make-up. Only a boolean means anything; a string would be a typo that
      // silently leaves the session in the queue.
      if (r.extra != null && typeof r.extra !== "boolean") {
        errors.push(`${at} (${r.id}): extra must be a boolean`);
      }
      // pp/ps/pe are null on the Consolidation and Practice Questions sessions —
      // they are review days with no page range. Null is legitimate; a string or
      // an object is not, and would poison the page totals.
      if (r.pp != null && typeof r.pp !== "number") {
        errors.push(`${at} (${r.id}): pp must be a number or null`);
      }
      if (!r.r) errors.push(`${at} (${r.id}): missing title`);
    });
  });
  return { errors };
}
