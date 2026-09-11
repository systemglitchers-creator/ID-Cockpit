// lib/plan.js — the study-day calendar and tonight's deal, server-side.
// A CommonJS mirror of the maths in public/app.js compute(), reduced to the
// one question the nudge asks: which session(s) does the deal put on today?
// All dates are resolved in America/Halifax regardless of server timezone.
const TZ = "America/Halifax";
const START = new Date(2026, 5, 22);
const FLEX_START = new Date(2026, 6, 18);
const CATCHUP_FROM = new Date(2026, 7, 23);

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

/** Halifax "today" as a local-frame Date pinned to noon — noon dodges DST
    edges, and the local frame keeps comparisons against START consistent. */
function localToday(now) {
  const [y, m, d] = dayFmt.format(now || new Date()).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
/** The Halifax calendar day an ISO timestamp fell on, as "YYYY-MM-DD". */
function localDayKey(iso) { return dayFmt.format(new Date(iso)); }

function isFlex(d) { return d.getDay() === 6 && d >= FLEX_START; }
function studyIdx(when) {
  const t = new Date(when); t.setHours(0, 0, 0, 0);
  const d = new Date(START); let i = 0;
  while (d < t) { d.setDate(d.getDate() + 1); if (!isFlex(d)) i++; }
  return i;
}

/**
 * Tonight's session(s), or null when no nudge should fire: rest day, already
 * read today, or nothing left to read. Mirrors compute()'s dealing exactly,
 * including the catch-up grace window — tests pin the parity.
 * @param sections  SECTIONS from schedule.js
 * @param progress  id -> {done, doneAt} (the Redis map)
 * @param now       Date (defaults to the real now)
 */
function tonight(sections, progress, now) {
  const today = localToday(now);
  if (isFlex(today)) return null;

  const todayKey = dayFmt.format(today);
  let readToday = false;
  for (const id of Object.keys(progress || {})) {
    const e = progress[id];
    if (e && e.done && e.doneAt && localDayKey(e.doneAt) === todayKey) { readToday = true; break; }
  }

  const done = (id) => { const e = progress && progress[id]; return !!(e && e.done); };
  // Make-up extras (r.extra) are pinned to their own day and never queue.
  const rows = [], extras = [];
  let planEnd = 0;
  sections.forEach((s) => s.rows.forEach((r) => {
    if (r.gi > planEnd) planEnd = r.gi;
    if (!done(r.id)) (r.extra ? extras : rows).push(r);
  }));
  if (!rows.length && !extras.length) return null;

  const k0 = studyIdx(today);
  const slots = planEnd - k0 + 1;
  const doubling = slots >= 1 && rows.length > slots;
  const graced = doubling
    ? Math.max(0, Math.min(studyIdx(CATCHUP_FROM) - k0, slots - 1))
    : 0;
  const packSlots = slots - graced, packCount = rows.length - graced;

  const out = [];
  // Reading today spends today's slot, so the queue rests tonight...
  if (!readToday) {
    for (let i = 0; i < rows.length; i++) {
      const d = (!doubling || i < graced)
        ? k0 + i
        : k0 + graced + Math.floor((i - graced) * packSlots / packCount);
      if (d > k0) break;
      out.push(rows[i]);
    }
  }
  // ...but a make-up pinned to today, or left over from an earlier day, is
  // still due — the point of a make-up day is that two get read.
  extras.forEach((r) => { if (r.gi <= k0) out.push(r); });
  if (!out.length) return null;
  return { sessions: out, makeup: (doubling ? rows.length - slots : 0) + extras.length };
}

module.exports = { tonight, localToday, localDayKey, isFlex, studyIdx, TZ };
