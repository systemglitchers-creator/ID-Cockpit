import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

/* The plan reads Sun–Fri; Saturdays from 2026-07-18 on are days off ("flex").
   These tests pin what date the next unread session carries, which is the one
   number the Today tab is built around. */

const SAT_AUG_8 = new Date(2026, 7, 8, 21, 0, 0);   // a flex Saturday
const FRI_AUG_7 = new Date(2026, 7, 7, 21, 0, 0);   // an ordinary study day
const SUN_AUG_9 = new Date(2026, 7, 9, 9, 0, 0);

function nextDate(app) {
  const m = app.IDCockpit.compute();
  const firstOpen = app.SECTIONS.flatMap((s) => s.rows).find((r) => m.EFF[r.id] != null);
  return app.IDCockpit.dayDate(m.EFF[firstOpen.id]);
}

test("on a day off, the next session is dealt onto the next study day", () => {
  // Regression: studyIdx counts days strictly before today, so on a flex
  // Saturday it returned Friday's index and the whole queue was dealt from a
  // date that had already passed.
  const app = loadCurrentApp({ now: SAT_AUG_8 });
  assert.equal(nextDate(app).toDateString(), "Sun Aug 09 2026");
});

test("reading on a day off does not burn the next study day", () => {
  // A flex Saturday has no slot to spend, so an opportunistic read on one must
  // not push tomorrow's session to Monday and leave Sunday empty.
  const app = loadCurrentApp({ now: SAT_AUG_8, done: ["ch20-p1"], doneAt: SAT_AUG_8.toISOString() });
  assert.equal(nextDate(app).toDateString(), "Sun Aug 09 2026");
});

test("on an ordinary day the next session is today", () => {
  const app = loadCurrentApp({ now: FRI_AUG_7 });
  assert.equal(nextDate(app).toDateString(), "Fri Aug 07 2026");
});

test("reading on an ordinary day moves the queue to the next study day", () => {
  // Friday is read, so the next session lands on Sunday — Saturday is off.
  const app = loadCurrentApp({ now: FRI_AUG_7, done: ["ch20-p1"], doneAt: FRI_AUG_7.toISOString() });
  assert.equal(nextDate(app).toDateString(), "Sun Aug 09 2026");
});

test("the queue is never dealt onto a date that has already passed", () => {
  for (const now of [SAT_AUG_8, FRI_AUG_7, SUN_AUG_9]) {
    const app = loadCurrentApp({ now });
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    assert.ok(nextDate(app) >= midnight, `next date is in the past for ${now.toDateString()}`);
  }
});

test("no Saturday after the flex date ever carries a session", () => {
  const app = loadCurrentApp({ now: SAT_AUG_8 });
  const m = app.IDCockpit.compute();
  for (const r of app.SECTIONS.flatMap((s) => s.rows)) {
    if (m.EFF[r.id] == null) continue;
    const d = app.IDCockpit.dayDate(m.EFF[r.id]);
    assert.ok(!app.IDCockpit.isFlex(d), `${r.id} landed on ${d.toDateString()}`);
  }
});

test("existing progress is untouched by the date logic", () => {
  const done = ["ch20-p1", "ch20-p2", "ch20-p3"];
  const app = loadCurrentApp({ now: SAT_AUG_8, done });
  const m = app.IDCockpit.compute();
  assert.equal(m.sessDone, done.length);
  for (const id of done) assert.equal(m.EFF[id], undefined, "read sessions stay out of the queue");
});

/* ---- catch-up ---------------------------------------------------------------
   Missed days are absorbed by doubling up a few later days, so the plan's
   original end date holds instead of sliding. */

function planEndIdx(app) {
  return Math.max(...app.SECTIONS.flatMap((s) => s.rows).map((r) => r.gi));
}
function behind(n) {   // n sessions read, all well in the past
  return loadCurrentApp({ now: SAT_AUG_8, doneAt: "2026-07-20T12:00:00Z",
    done: loadCurrentApp({ now: SAT_AUG_8 }).SECTIONS.flatMap((s) => s.rows).slice(0, n).map((r) => r.id) });
}

test("a slip no longer pushes the finish date out", () => {
  const app = behind(38);                       // 6 study days short
  const m = app.IDCockpit.compute();
  const last = Math.max(...Object.values(m.EFF));
  assert.equal(last, planEndIdx(app), "last session must land on the plan's original end");
  assert.equal(m.drift, 0);
});

test("the debt surfaces as sessions owed, not days lost", () => {
  const m = behind(38).IDCockpit.compute();
  assert.equal(m.makeup, 6);
});

test("catch-up doubles up, never triples, and only where needed", () => {
  const m = behind(38).IDCockpit.compute();
  const counts = Object.values(m.perDay);
  assert.equal(Math.max(...counts), 2, "no day should carry three sessions");
  assert.equal(counts.filter((c) => c === 2).length, 6, "one double per session owed");
});

test("the first two study weeks stay single", () => {
  // Coming back from time away shouldn't come due the next morning.
  const app = behind(38);
  const m = app.IDCockpit.compute();
  const doubles = Object.keys(m.perDay).filter((d) => m.perDay[d] > 1).map(Number).sort((a, b) => a - b);
  const first = app.IDCockpit.dayDate(doubles[0]);
  assert.equal(first.toDateString(), "Sun Aug 23 2026", "first double is two weeks out");
});

test("on track, the schedule is exactly one a day", () => {
  const app = behind(44);                       // caught up
  const m = app.IDCockpit.compute();
  assert.equal(m.makeup, 0);
  assert.equal(Math.max(...Object.values(m.perDay)), 1, "no doubling when not behind");
});

test("reading ahead dissolves the catch-up on its own", () => {
  assert.equal(behind(38).IDCockpit.compute().makeup, 6);
  assert.equal(behind(41).IDCockpit.compute().makeup, 3);
  assert.equal(behind(44).IDCockpit.compute().makeup, 0);
});

test("sessions stay in curriculum order regardless of doubling", () => {
  const app = behind(38);
  const m = app.IDCockpit.compute();
  const open = app.SECTIONS.flatMap((s) => s.rows).filter((r) => m.EFF[r.id] != null);
  for (let i = 1; i < open.length; i++) {
    assert.ok(m.EFF[open[i].id] >= m.EFF[open[i - 1].id], "order must never go backwards");
  }
});

test("the first double does not recede as days pass", () => {
  // The grace window is anchored to a date, not "today + 2 weeks". If it were
  // relative, the make-up would be pushed back one day per day, forever.
  const on = (now, n) => {
    const all = loadCurrentApp({ now }).SECTIONS.flatMap((s) => s.rows);
    const app = loadCurrentApp({ now, done: all.slice(0, n).map((r) => r.id),
                                 doneAt: "2026-07-20T12:00:00Z" });
    const m = app.IDCockpit.compute();
    const d = Object.keys(m.perDay).filter((k) => m.perDay[k] > 1).map(Number).sort((a, b) => a - b);
    return app.IDCockpit.dayDate(d[0]).toDateString();
  };
  assert.equal(on(SAT_AUG_8, 38), "Sun Aug 23 2026");
  assert.equal(on(new Date(2026, 7, 12, 9, 0, 0), 38), "Sun Aug 23 2026", "still Aug 23 four days later");
  assert.equal(on(new Date(2026, 7, 20, 9, 0, 0), 38), "Sun Aug 23 2026", "still Aug 23 the week of");
});

test("once the grace date passes, catch-up starts immediately", () => {
  const now = new Date(2026, 8, 14, 9, 0, 0);   // well past Aug 23
  const all = loadCurrentApp({ now }).SECTIONS.flatMap((s) => s.rows);
  const app = loadCurrentApp({ now, done: all.slice(0, 38).map((r) => r.id),
                               doneAt: "2026-07-20T12:00:00Z" });
  const m = app.IDCockpit.compute();
  const first = Object.keys(m.perDay).filter((k) => m.perDay[k] > 1).map(Number).sort((a, b) => a - b)[0];
  assert.equal(first, Math.min(...Object.values(m.EFF)), "first open day carries the first double");
  assert.equal(m.drift, 0, "the end date still holds");
});
