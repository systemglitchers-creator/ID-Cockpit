import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadApp } from "./harness.mjs";

/* Make-up Sundays (spec: docs/superpowers/specs/2026-09-10-pinned-readings-design.md,
   "Make-up days" revision of 2026-09-16).

   When the queue runs behind, the debt is paid one session per Sunday — the
   first study day after the Saturday off — never by stacking today. A pinned
   second reading whose day has passed simply rejoins the queue in curriculum
   order. Fixtures reproduce Tyler's real state on Wed Sep 16 2026: Coxiella
   and S. pneumoniae read Fri Sep 11, nothing Sun–Mon, Macrolides and
   Mycoplasma read Tue night. The app was dealing four rows onto Wednesday. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);

const WED_SEP_16 = new Date(2026, 8, 16, 9, 0, 0);
const THU_SEP_17 = new Date(2026, 8, 17, 9, 0, 0);
const FRI_SEP_18 = new Date(2026, 8, 18, 9, 0, 0);
const SUN_SEP_20 = new Date(2026, 8, 20, 9, 0, 0);
const PAST = "2026-09-05T15:00:00Z";
const SEP_10_IDX = 72;
const IDX = { wed16: 77, thu17: 78, fri18: 79, sun20: 80, mon21: 81, sun27: 86 };

const READS = {                                  // the live progress on Sep 16
  "ch193-p1": "2026-09-11T20:48:51.320Z",
  "ch204-p3": "2026-09-12T01:45:42.785Z",
  "ch28-p3":  "2026-09-16T01:16:59.466Z",        // Tue Sep 15, 10:16 pm ADT
  "ch189-p1": "2026-09-16T02:10:42.623Z",        // Tue Sep 15, 11:10 pm ADT
};

function load(now, extraStamps = {}) {
  const base = loadApp({ dir: "public", files: ["schedule.js"], now });
  const sessions = {};
  for (const r of base.SECTIONS.flatMap((s) => s.rows)) {
    if (r.gi < SEP_10_IDX) sessions[r.id] = { done: true, doneAt: PAST, updatedAt: PAST };
  }
  sessions["ch141-p1"] = { done: true, doneAt: "2026-08-25T12:41:05.355Z", updatedAt: "2026-08-25T12:41:05.355Z" };
  for (const [id, iso] of Object.entries({ ...READS, ...extraStamps })) {
    sessions[id] = { done: true, doneAt: iso, updatedAt: iso };
  }
  return loadApp({
    dir: "public",
    files: ["schedule.js", "guidelines.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now,
    storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) },
  });
}
const doubled = (m) => Object.keys(m.perDay).filter((d) => m.perDay[d] > 1).map(Number).sort((a, b) => a - b);

/* ---- Wed Sep 16: two rows today, not four ------------------------------- */

test("a slip does not stack today: Wednesday carries its own row and its pinned reading only", () => {
  const app = load(WED_SEP_16);
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch34-p1", "the queue's next row leads");
  assert.equal(m.EFF["ch34-p1"], IDX.wed16);
  assert.equal(m.EFF["ch190-p1"], IDX.wed16, "today's pinned reading stays");
  assert.equal(m.dueToday, 2);
  assert.equal(m.perDay[IDX.wed16], 2);
  assert.equal(m.EFF["ch34-p2"], IDX.thu17, "the next queue row waits for tomorrow");
  assert.equal(m.EFF["ch187-p1"], IDX.fri18);
});

test("the debt is paid one session per Sunday, in curriculum order", () => {
  const app = load(WED_SEP_16);
  const m = app.IDCockpit.compute();
  assert.equal(m.makeup, 2, "two behind once the two read early are counted");
  assert.deepEqual(doubled(m), [IDX.wed16, IDX.sun20, IDX.sun27],
    "Wednesday (pinned) and the next two Sundays — nothing else doubles");
  assert.equal(m.EFF["ch188-p1"], IDX.sun20, "the skipped pinned row rejoined the queue and lands on Sunday");
  assert.equal(m.EFF["ch238-p1"], IDX.sun20, "with the row the plan had for that day");
  assert.equal(m.EFF["ch173-p1"], IDX.mon21);
  assert.equal(Math.max(...Object.values(m.perDay)), 2, "never three");
  assert.equal(m.drift, 0, "the end date holds");
  for (const d of doubled(m)) {
    if (d === IDX.wed16) continue;
    assert.equal(app.IDCockpit.dayDate(d).getDay(), 0, "a make-up double only ever lands on a Sunday");
  }
});

test("the first make-up Sunday does not recede as the week passes", () => {
  for (const now of [WED_SEP_16, THU_SEP_17, FRI_SEP_18]) {
    const m = load(now).IDCockpit.compute();
    const first = doubled(m).find((d) => d !== IDX.wed16);
    assert.equal(first, IDX.sun20, "still Sun Sep 20 on " + now.toDateString());
  }
});

test("reading the pinned reading first does not spend the queue's slot", () => {
  const app = load(WED_SEP_16, { "ch190-p1": WED_SEP_16.toISOString() });
  const m = app.IDCockpit.compute();
  assert.equal(m.readToday, true);
  assert.equal(m.EFF["ch34-p1"], IDX.wed16, "Wednesday's own row is still today's");
  assert.equal(m.dueToday, 1);
  assert.notEqual(app.IDCopy.headline(m), "Done for today.");
});

test("reading the queue's row first moves the queue on but leaves the pinned reading due", () => {
  const app = load(WED_SEP_16, { "ch34-p1": WED_SEP_16.toISOString() });
  const m = app.IDCockpit.compute();
  assert.equal(m.EFF["ch34-p2"], IDX.thu17, "no second queue row is pulled onto today");
  assert.equal(m.EFF["ch190-p1"], IDX.wed16);
  assert.equal(m.dueToday, 1);
});

/* ---- Sunday: the double is sticky ---------------------------------------- */

const throughFri = {
  "ch34-p1": "2026-09-16T23:00:00Z", "ch190-p1": "2026-09-16T23:30:00Z",
  "ch34-p2": "2026-09-17T23:00:00Z", "ch187-p1": "2026-09-18T23:00:00Z",
};

test("a make-up Sunday carries two queue rows and says so", () => {
  const app = load(SUN_SEP_20, throughFri);
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch188-p1");
  assert.equal(m.EFF["ch238-p1"], IDX.sun20);
  assert.equal(m.dueToday, 2);
  assert.equal(m.makeup, 2);
  assert.match(app._elements.get("questCard").innerHTML, /Today's quest · 2 sessions/);
});

test("on a make-up Sunday, reading one leaves the second due today", () => {
  const app = load(SUN_SEP_20, { ...throughFri, "ch188-p1": SUN_SEP_20.toISOString() });
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch238-p1");
  assert.equal(m.EFF["ch238-p1"], IDX.sun20, "still today");
  assert.equal(m.dueToday, 1);
  assert.equal(m.makeup, 2, "the debt clears only when the second is read");
  assert.notEqual(app.IDCopy.headline(m), "Done for today.");
});

test("reading both on the make-up Sunday pays one off and moves the queue on", () => {
  const app = load(SUN_SEP_20, { ...throughFri, "ch188-p1": SUN_SEP_20.toISOString(), "ch238-p1": SUN_SEP_20.toISOString() });
  const m = app.IDCockpit.compute();
  assert.equal(m.dueToday, 0);
  assert.equal(m.makeup, 1);
  assert.equal(m.EFF["ch173-p1"], IDX.mon21);
  assert.equal(app.IDCopy.headline(m), "Done for today.");
  assert.deepEqual(doubled(m), [IDX.sun27], "one Sunday of debt left");
});

/* ---- the evening nudge mirrors it ---------------------------------------- */

const { tonight } = require_("../../lib/plan.js");
const SECTIONS = new Function(fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8") + "; return SECTIONS;")();
const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
function progress(extra = {}) {
  const p = {};
  for (const r of SECTIONS.flatMap((s) => s.rows)) if (r.gi < SEP_10_IDX) p[r.id] = at(PAST);
  p["ch141-p1"] = at("2026-08-25T12:41:05.355Z");
  for (const [id, iso] of Object.entries({ ...READS, ...extra })) p[id] = at(iso);
  return p;
}
const WED_EVE = new Date("2026-09-16T20:30:00-03:00");
const SUN_EVE = new Date("2026-09-20T20:30:00-03:00");

test("Wednesday's nudge names two, not four", () => {
  const t = tonight(SECTIONS, progress(), WED_EVE);
  assert.deepEqual(t.sessions.map((r) => r.id), ["ch34-p1", "ch190-p1"]);
  assert.equal(t.makeup, 2);
});

test("Sunday's nudge names the make-up pair, and the second alone once the first is read", () => {
  assert.deepEqual(tonight(SECTIONS, progress(throughFri), SUN_EVE).sessions.map((r) => r.id), ["ch188-p1", "ch238-p1"]);
  const p = progress({ ...throughFri, "ch188-p1": "2026-09-20T14:00:00-03:00" });
  assert.deepEqual(tonight(SECTIONS, p, SUN_EVE).sessions.map((r) => r.id), ["ch238-p1"]);
  p["ch238-p1"] = at("2026-09-20T16:00:00-03:00");
  assert.equal(tonight(SECTIONS, p, SUN_EVE), null);
});

/* ---- after the plan's last day --------------------------------------------- */

test("past the plan's end the debt is what is unread, never more", () => {
  // Found by review: with today beyond planEnd the slot count went negative,
  // so three unread sessions read as "8 to make up" in both app and nudge.
  const MON_MAY_22_2028 = new Date(2028, 4, 22, 9, 0, 0);
  const base = loadApp({ dir: "public", files: ["schedule.js"], now: MON_MAY_22_2028 });
  const rows = base.SECTIONS.flatMap((s) => s.rows);
  const last3 = rows.filter((r) => r.gi >= 595).map((r) => r.id);
  const sessions = {};
  for (const r of rows) if (!last3.includes(r.id)) sessions[r.id] = { done: true, doneAt: PAST, updatedAt: PAST };
  const app = loadApp({ dir: "public", files: ["schedule.js", "guidelines.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now: MON_MAY_22_2028, storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) } });
  const m = app.IDCockpit.compute();
  assert.equal(m.remaining, 3);
  assert.ok(m.makeup <= m.remaining, "makeup " + m.makeup + " exceeds the " + m.remaining + " left");
  assert.equal(m.dueToday, 1, "still one a day");
  const t = tonight(SECTIONS, Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, at(v.doneAt)])),
                    new Date("2028-05-22T20:30:00-03:00"));
  assert.ok(t.makeup <= 3, "the nudge agrees");
});

test("no pinned row sits on a Sunday, so a make-up Sunday never carries three", () => {
  // Review hardening: a pinned row on a make-up Sunday would sit beside two
  // queue rows. Keep pinned days off Sundays when re-cutting a sector.
  const app = loadApp({ dir: "public", files: ["schedule.js"], now: WED_SEP_16 });
  const START = new Date(2026, 5, 22), FLEX = new Date(2026, 6, 18);
  const dayDate = (gi) => { const d = new Date(START); let n = gi; while (n > 0) { d.setDate(d.getDate() + 1); if (!(d.getDay() === 6 && d >= FLEX)) n--; } return d; };
  for (const r of app.SECTIONS.flatMap((s) => s.rows)) {
    if (r.extra) assert.notEqual(dayDate(r.gi).getDay(), 0, r.id + " is pinned to a Sunday");
  }
});
