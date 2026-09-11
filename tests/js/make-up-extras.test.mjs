import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadApp, loadCurrentApp } from "./harness.mjs";

/* Make-up extras (spec: docs/superpowers/specs/2026-09-10-make-up-extras-design.md).
   The week of Sep 6 2026 went unread. Rather than a double every day until the
   debt clears, the eight missed sessions are pinned as a second session on the
   next eight Sundays, and everything else keeps the day the plan gave it. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);

const THU_SEP_10 = new Date(2026, 8, 10, 21, 0, 0);
const SAT_SEP_12 = new Date(2026, 8, 12, 9, 0, 0);
const SUN_SEP_13 = new Date(2026, 8, 13, 9, 0, 0);
const MON_SEP_14 = new Date(2026, 8, 14, 9, 0, 0);
const SAT_SEP_19 = new Date(2026, 8, 19, 9, 0, 0);
const PAST = "2026-09-05T15:00:00Z";

// In curriculum (schedule.js) order.
const EXTRAS = {
  "ch204-p3": "Sun Oct 04 2026",
  "ch189-p1": "Sun Oct 11 2026",
  "ch190-p1": "Sun Oct 18 2026",
  "ch34-p1":  "Sun Sep 20 2026",
  "ch34-p2":  "Sun Sep 27 2026",
  "ch238-p1": "Sun Oct 25 2026",
  "ch238-p2": "Sun Nov 01 2026",
  "ch193-p1": "Sun Sep 13 2026",
};
const EXTRA_IDS = Object.keys(EXTRAS);

const rowsOf = (app) => app.SECTIONS.flatMap((s) => s.rows);
const SEP_10_IDX = 72;   // studyIdx(Thu Sep 10 2026)

/** Everything the plan dated before Sep 10 that is not one of the eight. */
function readBefore(app) {
  return rowsOf(app).filter((r) => r.gi < SEP_10_IDX && !EXTRA_IDS.includes(r.id)).map((r) => r.id);
}

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

/* ---- the data --------------------------------------------------------- */

test("the eight sessions missed in early September are the plan's only extras, one per Sunday", () => {
  const app = loadCurrentApp({ now: THU_SEP_10 });
  const extras = rowsOf(app).filter((r) => r.extra);
  // Array.from: the rows come from the vm realm and are not prototype-identical.
  assert.deepEqual(Array.from(extras, (r) => r.id), EXTRA_IDS);
  for (const r of extras) {
    assert.equal(r.extra, true, r.id + " carries a boolean flag");
    assert.equal(app.IDCockpit.dayDate(r.gi).toDateString(), EXTRAS[r.id], r.id);
  }
});

/* ---- Sep 10: caught up, rest unchanged ---------------------------------- */

test("with the eight pinned, today's quest is the session the plan dated Sep 10", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch193-p2");
  assert.equal(m.EFF["ch193-p2"], SEP_10_IDX, "dealt onto today");
});

test("every queued session lands on the day the plan gave it", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  for (const r of rowsOf(app)) {
    if (m.EFF[r.id] == null || r.extra) continue;
    assert.equal(m.EFF[r.id], r.gi, r.id + " moved off its planned day");
  }
  assert.equal(m.drift, 0);
});

test("the extras sit on their Sundays as a second session, and are the whole debt", () => {
  const app = loadCurrentApp({ now: THU_SEP_10, done: readBefore(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  for (const id of EXTRA_IDS) {
    const r = rowsOf(app).find((x) => x.id === id);
    assert.equal(m.EFF[id], r.gi, id + " is dealt on its own day");
    assert.equal(m.perDay[r.gi], 2, id + " shares its Sunday with the regular session");
  }
  assert.equal(Object.values(m.perDay).filter((c) => c > 1).length, 8, "no other day doubles");
  assert.equal(Math.max(...Object.values(m.perDay)), 2, "never three");
  assert.equal(m.makeup, 8, "the home line counts the extras as the make-up");
  assert.equal(m.remaining, 534, "remaining still counts every unread session");
});

/* ---- a make-up Sunday ---------------------------------------------------- */

const throughSep11 = (app) => readBefore(app).concat(["ch193-p2", "ch28-p3"]);

test("on a make-up Sunday the regular session is the quest and the day says two", () => {
  const app = loadCurrentApp({ now: SUN_SEP_13, done: throughSep11(app0()), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch34-p3", "the plan's own session leads");
  assert.equal(m.perDay[m.todayIdx], 2);
  assert.equal(m.dueToday, 2);
  assert.match(app._elements.get("questCard").innerHTML, /Today's quest · 2 sessions/);
});

test("reading the regular session leaves the extra as today's quest, not pushed to tomorrow", () => {
  const stamps = stamp(throughSep11(app0()), PAST);
  stamps["ch34-p3"] = SUN_SEP_13.toISOString();          // read this morning
  const app = loadStamped(SUN_SEP_13, stamps);
  const m = app.IDCockpit.compute();
  assert.equal(m.readToday, true);
  assert.equal(m.firstOpen.id, "ch193-p1");
  assert.equal(m.EFF["ch193-p1"], m.todayIdx, "still today");
  assert.equal(m.dueToday, 1);
  assert.notEqual(app.IDCopy.headline(m), "Done for today.", "the header must not contradict the quest");
});

test("the stream labels a make-up row so a Sunday's second session explains itself", () => {
  const app = loadCurrentApp({ now: SUN_SEP_13, done: throughSep11(app0()), doneAt: PAST });
  const html = app._elements.get("homeStream").innerHTML;
  // One chunk per row: from its data-toggle up to the next row's.
  const rowOf = (id) => html.split('data-toggle="').find((c) => c.startsWith(id + '"'));
  assert.match(rowOf("ch193-p1"), /Make-up/, "the extra's meta line says what it is");
  assert.doesNotMatch(rowOf("ch34-p3"), /Make-up/, "the regular row does not");
});

/* ---- an extra left unread ------------------------------------------------ */

test("an extra left unread rolls to the next study day and stays due", () => {
  const app = loadCurrentApp({ now: MON_SEP_14, done: throughSep11(app0()).concat(["ch34-p3"]), doneAt: PAST });
  const m = app.IDCockpit.compute();
  assert.equal(m.EFF["ch193-p1"], m.todayIdx, "Monday now");
  assert.equal(m.perDay[m.todayIdx], 2);
  assert.equal(m.firstOpen.id, "ch187-p1", "Monday's own session still leads");
});

test("an overdue extra never lands on a Saturday off", () => {
  for (const now of [SAT_SEP_12, SAT_SEP_19]) {
    const app = loadCurrentApp({ now, done: throughSep11(app0()), doneAt: PAST });
    const m = app.IDCockpit.compute();
    for (const id of EXTRA_IDS) {
      const d = app.IDCockpit.dayDate(m.EFF[id]);
      assert.ok(!app.IDCockpit.isFlex(d), id + " landed on " + d.toDateString());
      assert.ok(d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()), id + " is in the past");
    }
  }
});

/* ---- the evening nudge mirrors the deal ---------------------------------- */

const { tonight } = require_("../../lib/plan.js");
const SECTIONS = new Function(fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8") + "; return SECTIONS;")();
const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
const progressOf = (ids, iso) => Object.fromEntries(ids.map((id) => [id, at(iso)]));
const SUN_EVE = new Date("2026-09-13T20:30:00-03:00");

test("Sunday's nudge names the regular session and the make-up, in that order", () => {
  const t = tonight(SECTIONS, progressOf(throughSep11(app0()), PAST), SUN_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch34-p3", "ch193-p1"]);
  assert.equal(t.makeup, 8);
});

test("once the regular session is read, the nudge still names the make-up", () => {
  const progress = progressOf(throughSep11(app0()), PAST);
  progress["ch34-p3"] = at("2026-09-13T14:00:00-03:00");
  const t = tonight(SECTIONS, progress, SUN_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch193-p1"]);
});

test("both read means silence", () => {
  const progress = progressOf(throughSep11(app0()), PAST);
  progress["ch34-p3"] = at("2026-09-13T14:00:00-03:00");
  progress["ch193-p1"] = at("2026-09-13T16:00:00-03:00");
  assert.equal(tonight(SECTIONS, progress, SUN_EVE), null);
});

/* helper: a bare load just to read the schedule */
function app0() { return loadCurrentApp({ now: THU_SEP_10 }); }
