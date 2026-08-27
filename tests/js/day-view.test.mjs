import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

/* dayPlan feeds the home stream: the whole plan, chronological, one entry
   per calendar day. Read sessions sit on the day they were actually read;
   open ones on the day the deal gives them. */

const FRI_AUG_7 = new Date(2026, 7, 7, 21, 0, 0);
const SAT_AUG_8 = new Date(2026, 7, 8, 21, 0, 0);

function plan(app) { return app.IDCockpit.dayPlan(app.IDCockpit.compute()); }
function flatDays(p) { return p.flatMap((mo) => Array.from(mo.days)); }

test("the day view carries every session exactly once", () => {
  const app = loadCurrentApp({ now: FRI_AUG_7 });
  const rows = flatDays(plan(app)).flatMap((d) => Array.from(d.rows));
  assert.equal(rows.length, 590);
  assert.equal(new Set(rows.map((x) => x.r.id)).size, 590);
});

test("days are chronological and no open session sits on a Saturday off", () => {
  const app = loadCurrentApp({ now: FRI_AUG_7 });
  const days = flatDays(plan(app));
  for (let i = 1; i < days.length; i++) assert.ok(days[i].date >= days[i - 1].date, "out of order at " + i);
  for (const d of days) {
    if (Array.from(d.rows).some((x) => !x.done)) {
      assert.ok(!app.IDCockpit.isFlex(d.date), "open session on " + d.date.toDateString());
    }
  }
});

test("read sessions sit on the day they were read, not the plan's day", () => {
  const doneAt = "2026-07-20T12:00:00Z";
  const app = loadCurrentApp({ now: FRI_AUG_7, done: ["ch20-p1", "ch20-p2"], doneAt });
  const days = flatDays(plan(app));
  const day = days.find((d) => Array.from(d.rows).some((x) => x.r.id === "ch20-p1"));
  assert.equal(day.date.toDateString(), new Date(doneAt).toDateString());
  assert.ok(Array.from(day.rows).every((x) => x.done), "a read day never mixes in open sessions here");
});

test("the home stream folds past days away and rows carry their page range", () => {
  const app = loadCurrentApp({ now: FRI_AUG_7, done: ["ch20-p1"], doneAt: "2026-07-20T12:00:00Z" });
  const html = app._elements.get("homeStream").innerHTML;
  assert.match(html, /data-toggle="ch199-p4"/, "open rows are markable in place");
  assert.match(html, /pp 2392–2398/, "the row tells you what to open the book to");
  assert.doesNotMatch(html, /data-toggle="ch20-p1"/, "read sessions stay folded by default");
  assert.match(html, /1 read · show earlier/, "the fold pill counts what it hides");
});

test("review sessions in the stream say what they are instead of pp null", () => {
  const app = loadCurrentApp({ now: FRI_AUG_7 });
  const html = app._elements.get("homeStream").innerHTML;
  assert.match(html, /Review session/);
  assert.doesNotMatch(html, /pp null/);
});

test("a catch-up double shows as two sessions on one day, never three", () => {
  // 30 read leaves 6 owed at Aug 8 under planEnd 591 — the schedule-dates fixtures.
  const all = loadCurrentApp({ now: SAT_AUG_8 }).SECTIONS.flatMap((s) => s.rows);
  const app = loadCurrentApp({ now: SAT_AUG_8, done: all.slice(0, 30).map((r) => r.id),
                               doneAt: "2026-07-20T12:00:00Z" });
  const counts = flatDays(plan(app))
    .filter((d) => Array.from(d.rows).some((x) => !x.done))
    .map((d) => d.rows.length);
  assert.equal(Math.max(...counts), 2, "no day should carry three sessions");
  assert.equal(counts.filter((c) => c === 2).length, 6, "one double per session owed");
});
