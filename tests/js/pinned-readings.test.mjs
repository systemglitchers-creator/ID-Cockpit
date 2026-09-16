import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadApp, loadCurrentApp } from "./harness.mjs";

/* Pinned second readings (spec: docs/superpowers/specs/2026-09-10-pinned-readings-design.md).
   The week of Sep 6 2026 went unread. Its 51 pages were folded into the
   pneumonia sector's remaining days — longer readings, same calendar. Three of
   those days carry two short chapters; the second row is flagged `extra`,
   dealt on its own day, and never enters the queue. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);

const THU_SEP_10 = new Date(2026, 8, 10, 21, 0, 0);
const FRI_SEP_11 = new Date(2026, 8, 11, 9, 0, 0);
const SAT_SEP_12 = new Date(2026, 8, 12, 9, 0, 0);
const SUN_SEP_13 = new Date(2026, 8, 13, 9, 0, 0);
const PAST = "2026-09-05T15:00:00Z";
const SEP_10_IDX = 72;   // studyIdx(Thu Sep 10 2026)

// The sector's tail after the re-cut: [id, gi, day, ps, pe, pinned].
const PLAN = [
  ["ch193-p1", 72, "Thu Sep 10 2026", 2333, 2342, false],
  ["ch28-p3",  73, "Fri Sep 11 2026",  387,  392, false],
  ["ch204-p3", 73, "Fri Sep 11 2026", 2469, 2473, true],
  ["ch34-p1",  74, "Sun Sep 13 2026",  445,  456, false],
  ["ch34-p2",  75, "Mon Sep 14 2026",  457,  467, false],
  ["ch187-p1", 76, "Tue Sep 15 2026", 2293, 2295, false],
  ["ch188-p1", 76, "Tue Sep 15 2026", 2296, 2304, true],
  ["ch189-p1", 77, "Wed Sep 16 2026", 2305, 2312, false],
  ["ch190-p1", 77, "Wed Sep 16 2026", 2313, 2316, true],
  ["ch238-p1", 78, "Thu Sep 17 2026", 2799, 2811, false],
  ["ch173-p1", 79, "Fri Sep 18 2026", 2152, 2160, false],
  ["ch307-p1", 80, "Sun Sep 20 2026", 3600, 3609, false],
  ["ch71-p1",  81, "Mon Sep 21 2026",  873,  878, false],
  ["ch70-p1",  82, "Tue Sep 22 2026",  860,  872, false],
];
const GONE = ["ch193-p2", "ch34-p3", "ch238-p2", "ch307-p2", "ch70-p2"];   // merged away, never read
const WHOLE = ["ch193-p1", "ch238-p1", "ch307-p1", "ch70-p1"];              // now single-sitting chapters

const rowsOf = (app) => app.SECTIONS.flatMap((s) => s.rows);
const rowById = (app, id) => rowsOf(app).find((r) => r.id === id);

/** Everything the plan dated before Sep 10 — the sessions actually read by then. */
const readBefore = (app) => rowsOf(app).filter((r) => r.gi < SEP_10_IDX).map((r) => r.id);

/** Load with per-session doneAt stamps (loadCurrentApp takes only one). */
function loadStamped(now, stamps) {
  const sessions = {};
  for (const [id, iso] of Object.entries(stamps)) sessions[id] = { done: true, doneAt: iso, updatedAt: iso };
  return loadApp({
    dir: "public",
    files: ["schedule.js", "guidelines.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now,
    storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) },
  });
}
const stamp = (ids, iso) => Object.fromEntries(ids.map((id) => [id, iso]));
function app0() { return loadCurrentApp({ now: THU_SEP_10 }); }

/* ---- the data --------------------------------------------------------- */

test("the pneumonia sector's tail is re-cut onto its original days: 119 pages over 11 days", () => {
  const app = app0();
  const pna = app.SECTIONS.find((s) => s.title === "Pneumonia & the Atypicals");
  const tail = pna.rows.filter((r) => r.gi >= SEP_10_IDX);
  assert.deepEqual(Array.from(tail, (r) => r.id), PLAN.map((p) => p[0]), "order is the reading order");
  let pages = 0;
  for (const [id, gi, day, ps, pe, pinned] of PLAN) {
    const r = rowById(app, id);
    assert.equal(r.gi, gi, id + " day index");
    assert.equal(app.IDCockpit.dayDate(r.gi).toDateString(), day, id + " date");
    assert.equal(r.ps, ps, id + " first page");
    assert.equal(r.pe, pe, id + " last page");
    assert.equal(r.pp, pe - ps + 1, id + " page count agrees with its range");
    assert.equal(!!r.extra, pinned, id + (pinned ? " is pinned" : " is a queue row"));
    pages += r.pp;
  }
  assert.equal(pages, 119, "51 missed pages plus the 68 that were already there");
  assert.equal(new Set(PLAN.map((p) => p[1])).size, 11, "eleven study days, Sep 10 – Sep 22");
  for (const id of GONE) assert.equal(rowById(app, id), undefined, id + " was merged away");
  for (const id of WHOLE) assert.doesNotMatch(rowById(app, id).r, /Part \d/, id + " is a whole chapter now");
  assert.match(rowById(app, "ch34-p1").r, /Part 1 of 2/);
  assert.match(rowById(app, "ch34-p2").r, /Part 2 of 2/);
  assert.match(pna.sub, /Aug 24 – Sep 22, 2026/, "the sector still ends Sep 22");
});

test("the plan's only pinned rows are the three second readings", () => {
  const app = app0();
  assert.deepEqual(Array.from(rowsOf(app).filter((r) => r.extra), (r) => r.id), ["ch204-p3", "ch188-p1", "ch190-p1"]);
});

/* ---- Sep 10: caught up, rest unchanged ---------------------------------- */

test("today's quest is the whole Q fever chapter and nothing is owed", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch193-p1");
  assert.equal(m.EFF["ch193-p1"], SEP_10_IDX, "dealt onto today");
  assert.equal(m.makeup, 0, "a pinned reading on a day still to come is the plan, not debt");
  assert.equal(m.extras, 3);
  assert.equal(m.drift, 0);
  assert.equal(app.IDCopy.meta(m), m.remaining + " sessions left");
  assert.match(app._elements.get("questCard").innerHTML, /pp 2333–2342 · 10 pages/);
});

test("every queued session lands on the day the plan gave it, and Upper Airway still starts Sep 23", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  for (const r of rowsOf(app)) {
    if (m.EFF[r.id] == null || r.extra) continue;
    assert.equal(m.EFF[r.id], r.gi, r.id + " moved off its planned day");
  }
  assert.equal(app.IDCockpit.dayDate(m.EFF["ch61-p1"]).toDateString(), "Wed Sep 23 2026");
});

test("a pinned row shares its day as a second reading, and only those three days carry two", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  for (const [id, gi, , , , pinned] of PLAN) {
    if (!pinned) continue;
    assert.equal(m.EFF[id], gi, id + " sits on its own day");
    assert.equal(m.perDay[gi], 2, id + " shares the day with the plan's row");
  }
  assert.deepEqual(Object.keys(m.perDay).filter((d) => m.perDay[d] > 1).map(Number).sort((a, b) => a - b), [73, 76, 77]);
  assert.equal(Math.max(...Object.values(m.perDay)), 2, "never three");
});

/* ---- a two-reading day --------------------------------------------------- */

const throughSep10 = (app) => readBefore(app).concat(["ch193-p1"]);

test("on a two-reading day the plan's own row leads and the quest says two", () => {
  const app = loadCurrentApp({ now: FRI_SEP_11, done: throughSep10(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch28-p3");
  assert.equal(m.dueToday, 2);
  assert.match(app._elements.get("questCard").innerHTML, /Today's quest · 2 sessions/);
});

test("reading the first leaves the pinned reading as today's quest, not pushed to tomorrow", () => {
  const stamps = stamp(throughSep10(app0()), PAST);
  stamps["ch28-p3"] = FRI_SEP_11.toISOString();          // read this morning
  const app = loadStamped(FRI_SEP_11, stamps);
  const m = app.IDCockpit.compute();
  assert.equal(m.readToday, true);
  assert.equal(m.firstOpen.id, "ch204-p3");
  assert.equal(m.EFF["ch204-p3"], m.todayIdx, "still today");
  assert.equal(m.dueToday, 1);
  assert.equal(m.makeup, 0);
  assert.notEqual(app.IDCopy.headline(m), "Done for today.", "the header must not contradict the quest");
});

/* ---- a pinned reading left unread ---------------------------------------- */

const throughSep11 = (app) => throughSep10(app).concat(["ch28-p3"]);   // ch204-p3 skipped

test("a pinned reading left unread rejoins the queue in curriculum order and is paid on a Sunday", () => {
  const app = loadCurrentApp({ now: SUN_SEP_13, done: throughSep11(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.EFF["ch204-p3"], m.todayIdx, "Sunday is a make-up day, so it lands today");
  assert.equal(m.perDay[m.todayIdx], 2);
  assert.equal(m.firstOpen.id, "ch204-p3", "it sits before Quinolones in the curriculum, so it leads");
  assert.equal(m.makeup, 1);
  assert.equal(app.IDCopy.meta(m), "Catching up · 1 to make up");
});

test("an overdue pinned reading never lands on a Saturday off", () => {
  const app = loadCurrentApp({ now: SAT_SEP_12, done: throughSep11(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  const d = app.IDCockpit.dayDate(m.EFF["ch204-p3"]);
  assert.equal(d.toDateString(), "Sun Sep 13 2026");
  assert.ok(!app.IDCockpit.isFlex(d));
});

/* ---- the evening nudge mirrors the deal ---------------------------------- */

const { tonight } = require_("../../lib/plan.js");
const SECTIONS = new Function(fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8") + "; return SECTIONS;")();
const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
const progressOf = (ids, iso) => Object.fromEntries(ids.map((id) => [id, at(iso)]));
const FRI_EVE = new Date("2026-09-11T20:30:00-03:00");
const SUN_EVE = new Date("2026-09-13T20:30:00-03:00");

test("Friday's nudge names the plan's row and the pinned reading, in that order", () => {
  const t = tonight(SECTIONS, progressOf(throughSep10(app0()), PAST), FRI_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch28-p3", "ch204-p3"]);
  assert.equal(t.makeup, 0);
});

test("once the first is read, the nudge still names the pinned reading", () => {
  const progress = progressOf(throughSep10(app0()), PAST);
  progress["ch28-p3"] = at("2026-09-11T14:00:00-03:00");
  const t = tonight(SECTIONS, progress, FRI_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch204-p3"]);
});

test("both read means silence", () => {
  const progress = progressOf(throughSep10(app0()), PAST);
  progress["ch28-p3"] = at("2026-09-11T14:00:00-03:00");
  progress["ch204-p3"] = at("2026-09-11T16:00:00-03:00");
  assert.equal(tonight(SECTIONS, progress, FRI_EVE), null);
});

test("an overdue pinned reading rides Sunday's nudge as the make-up", () => {
  const t = tonight(SECTIONS, progressOf(throughSep11(app0()), PAST), SUN_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch204-p3", "ch34-p1"]);
  assert.equal(t.makeup, 1);
});
