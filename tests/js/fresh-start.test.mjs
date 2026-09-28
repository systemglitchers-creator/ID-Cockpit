import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadApp } from "./harness.mjs";

/* The 2026-09-27 fresh start. Tyler was 8 sessions behind going into Mon Sep 28
   (Legionnaires' onward) and did not want them paid back as doubled Sundays.
   Every unread session was re-dated one a day from Mon Sep 28, so the plan's end
   moved 8 study days (gi 597 -> 605) and nothing is owed. These tests run the
   live plan against his real read-state from that evening. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const READS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/progress-2026-09-27.json"), "utf8"));
const at = (t) => ({ done: true, doneAt: t, updatedAt: t });

const MON_SEP_28 = new Date(2026, 8, 28, 9, 0, 0);
const MON_IDX = 87;
const WEEK = ["ch238-p1", "ch173-p1", "ch307-p1", "ch71-p1", "ch70-p1", "ch61-p1"];   // Mon to Sun, Saturday off

function load(now, extra = {}) {
  const sessions = {};
  for (const [id, iso] of Object.entries({ ...READS, ...extra })) sessions[id] = at(iso);
  return loadApp({
    dir: "public",
    files: ["schedule.js", "guidelines.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now,
    storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) },
  });
}
const doubled = (m) => Object.keys(m.perDay).filter((d) => m.perDay[d] > 1);

test("Monday Sep 28 starts fresh: Legionnaires' today, nothing owed, no doubled day", () => {
  const app = load(MON_SEP_28);
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, "ch238-p1");
  assert.equal(m.todayIdx, MON_IDX);
  assert.equal(m.makeup, 0);
  assert.equal(m.drift, 0);
  assert.deepEqual(doubled(m), []);
  assert.equal(m.planEnd, 605);
});

test("the unread sessions carry the dates the deal gives them, one a day from Monday", () => {
  const app = load(MON_SEP_28);
  const m = app.IDCockpit.compute();
  for (const r of app.SECTIONS.flatMap((s) => s.rows)) {
    if (READS[r.id]) continue;
    assert.equal(m.EFF[r.id], r.gi, `${r.id} is dealt on its own day`);
  }
});

test("a week read one a day reaches Sunday Oct 4 with a single session, not a make-up pair", () => {
  const stamps = {};
  const days = [28, 29, 30, 1, 2];
  WEEK.slice(0, 5).forEach((id, i) => {
    stamps[id] = new Date(2026, days[i] >= 28 ? 8 : 9, days[i], 20, 0, 0).toISOString();
  });
  const app = load(new Date(2026, 9, 4, 9, 0, 0), stamps);
  const m = app.IDCockpit.compute();
  assert.equal(m.firstOpen.id, WEEK[5]);
  assert.equal(m.dueToday, 1);
  assert.equal(m.makeup, 0);
  assert.deepEqual(doubled(m), []);
});

test("Sunday Oct 4's nudge names one session", () => {
  const { tonight } = require_("../../lib/plan.js");
  const SECTIONS = new Function(fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8") + "; return SECTIONS;")();
  const progress = Object.fromEntries(Object.entries(READS).map(([k, v]) => [k, at(v)]));
  WEEK.slice(0, 5).forEach((id) => { progress[id] = at("2026-10-02T23:00:00Z"); });
  const t = tonight(SECTIONS, progress, new Date("2026-10-04T20:30:00-03:00"));
  assert.deepEqual(t.sessions.map((r) => r.id), [WEEK[5]]);
});
