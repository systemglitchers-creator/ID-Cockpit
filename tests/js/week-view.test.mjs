import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp, loadApp } from "./harness.mjs";

/* Momentum in weeks, not streaks: the ring is this plan-week (Mon–Sun,
   Saturday off, target 6), dots are the last 7 calendar days, and perfect
   weeks count only from the first full week after the 2026-08-14 rebase. */

const THU_AUG_20 = new Date(2026, 7, 20, 21, 0, 0);

function wv(app) { return app.IDCockpit.weekView(app.IDCockpit.compute()); }

/** Load the app with per-session doneAt stamps (loadCurrentApp only takes one). */
function loadStamped(stamps, now) {
  const sessions = {};
  for (const [id, iso] of Object.entries(stamps)) {
    sessions[id] = { done: true, doneAt: iso, updatedAt: iso };
  }
  return loadApp({
    dir: "public",
    files: ["schedule.js", "guidelines.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now,
    storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) },
  });
}

test("the ring counts only this plan-week", () => {
  const app = loadCurrentApp({
    now: THU_AUG_20,
    done: ["ch20-p1", "ch20-p2", "ch20-p3"],
    doneAt: "2026-08-18T21:00:00-03:00",          // Tuesday of this week
  });
  const v = wv(app);
  assert.equal(v.weekTarget, 6);
  assert.equal(v.weekRead, 3);
});

test("reads from last week do not inflate this week's ring", () => {
  const app = loadCurrentApp({
    now: THU_AUG_20,
    done: ["ch20-p1", "ch20-p2"],
    doneAt: "2026-08-11T21:00:00-03:00",          // Tuesday of LAST week
  });
  assert.equal(wv(app).weekRead, 0);
});

test("dots classify read, double, rest, missed, and today", () => {
  const app = loadCurrentApp({
    now: THU_AUG_20,
    done: ["ch20-p1", "ch20-p2"],
    doneAt: "2026-08-18T21:00:00-03:00",
  });
  const dots = wv(app).dots;
  assert.equal(dots.length, 7);
  assert.equal(dots[dots.length - 1].st, "today", "today is pending, not missed");
  const byKey = Object.fromEntries(dots.map((d) => [d.k, d.st]));
  assert.equal(byKey["2026-7-18"], "double", "two reads on Tue Aug 18");
  assert.equal(byKey["2026-7-15"], "rest", "Sat Aug 15 is a flex day");
  assert.equal(byKey["2026-7-17"], "missed", "Mon Aug 17 had no read");
});

test("perfect weeks ignore the bulk re-entry noise before the rebase", () => {
  const ids = loadCurrentApp({ now: THU_AUG_20 }).SECTIONS
    .flatMap((s) => s.rows).slice(0, 40).map((r) => r.id);
  const stamps = Object.fromEntries(ids.map((id) => [id, "2026-08-09T21:00:00-03:00"]));
  const app = loadStamped(stamps, new Date(2026, 8, 3, 21, 0, 0));   // Thu Sep 3
  assert.equal(wv(app).perfect, 0, "40 reads bulk-entered Aug 9 count no perfect weeks");
});

test("a full week after the rebase counts as perfect", () => {
  // Six sessions across the Aug 17-23 study days (Mon-Fri + Sun, Sat off),
  // viewed from the following week.
  const ids = loadCurrentApp({ now: THU_AUG_20 }).SECTIONS
    .flatMap((s) => s.rows).slice(0, 6).map((r) => r.id);
  const days = ["17", "18", "19", "20", "21", "23"];
  const stamps = Object.fromEntries(
    ids.map((id, i) => [id, "2026-08-" + days[i] + "T21:00:00-03:00"]));
  const app = loadStamped(stamps, new Date(2026, 7, 27, 21, 0, 0));  // Thu Aug 27
  assert.equal(wv(app).perfect, 1);
});

test("a five-read week is not perfect", () => {
  const ids = loadCurrentApp({ now: THU_AUG_20 }).SECTIONS
    .flatMap((s) => s.rows).slice(0, 5).map((r) => r.id);
  const days = ["17", "18", "19", "20", "21"];
  const stamps = Object.fromEntries(
    ids.map((id, i) => [id, "2026-08-" + days[i] + "T21:00:00-03:00"]));
  const app = loadStamped(stamps, new Date(2026, 7, 27, 21, 0, 0));
  assert.equal(wv(app).perfect, 0);
});

test("the quest card frames the session in minutes", () => {
  const app = loadCurrentApp({ now: THU_AUG_20 });
  const html = app._elements.get("questCard").innerHTML;
  assert.match(html, /· ~\d+ min/);
});
