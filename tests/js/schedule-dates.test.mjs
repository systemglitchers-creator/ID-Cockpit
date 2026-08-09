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
