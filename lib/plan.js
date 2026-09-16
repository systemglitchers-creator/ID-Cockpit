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
  const k0 = studyIdx(today);
  const done = (id) => { const e = progress && progress[id]; return !!(e && e.done); };
  const readOn = (id) => { const e = progress && progress[id]; return e && e.done && e.doneAt ? localDayKey(e.doneAt) : null; };

  // Mirrors compute(): a pinned second reading (r.extra) sits on its own day
  // outside the queue; one whose day has passed rejoins the queue in
  // curriculum order. A read today spends the queue's slot unless it was a
  // pinned row for today or later.
  const queue = [], pinnedToday = [];
  let planEnd = 0, queueReadToday = 0;
  sections.forEach((s) => s.rows.forEach((r) => {
    if (r.gi > planEnd) planEnd = r.gi;
    if (done(r.id)) {
      if (readOn(r.id) === todayKey && !(r.extra && r.gi >= k0)) queueReadToday++;
      return;
    }
    if (r.extra && r.gi >= k0) { if (r.gi === k0) pinnedToday.push(r); }
    else queue.push(r);
  }));

  // Sessions owed beyond one a day are paid one per Sunday from CATCHUP_FROM
  // on; a make-up Sunday's second slot stays open until it is used.
  const slots = Math.max(0, planEnd - k0 + 1 - Math.min(1, queueReadToday));   // none past the plan's end
  const owed = Math.max(0, queue.length - slots);
  const makeupDay = k0 >= studyIdx(CATCHUP_FROM) && today.getDay() === 0;
  const cap = 1 + (owed > 0 && makeupDay ? 1 : 0);
  const out = queue.slice(0, Math.max(0, cap - queueReadToday)).concat(pinnedToday);
  if (!out.length) return null;
  return { sessions: out, makeup: owed };
}

module.exports = { tonight, localToday, localDayKey, isFlex, studyIdx, TZ };
