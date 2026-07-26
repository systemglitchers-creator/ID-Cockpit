import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, markDone } from "./harness.mjs";

/* ---- the schedule data ---------------------------------------------------- */

test("schedule.js is the single source of the plan", () => {
  const app = loadApp();
  const rows = app.SECTIONS.flatMap((s) => s.rows);
  assert.equal(app.SECTIONS.length, 31);
  assert.equal(rows.length, 584);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "session ids must be unique");
  assert.ok(rows.every((r) => typeof r.gi === "number"), "every row needs a plan day index");
});

/* ---- storage --------------------------------------------------------------- */

test("writes go through to the on-device store", async () => {
  const app = loadApp();
  await app.Backend.setDone("ch20-p1", true);
  assert.equal(app.IDStore.getState().sessions["ch20-p1"].done, true);
  const loaded = await app.Backend.load();
  assert.equal(loaded.done["ch20-p1"].done, true);
});

/* ---- timestamps ------------------------------------------------------------ */
// merge compares these as plain strings, so the shape has to stay put: a stamp
// written without the Z would sort hours away from where it belongs.

test("stored timestamps are UTC with a trailing Z", () => {
  const app = loadApp();
  const e = app.IDStore.setEntry("ch20-p1", true);
  assert.match(e.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(e.doneAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("un-marking clears doneAt but keeps updatedAt", () => {
  const app = loadApp();
  const e = app.IDStore.setEntry("ch20-p1", false);
  assert.equal(e.done, false);
  assert.equal(e.doneAt, null);
  assert.ok(e.updatedAt);
});

/* ---- merge ---------------------------------------------------------------- */

test("merge keeps the newer entry per session", () => {
  const app = loadApp();
  const local = { a: { done: true, updatedAt: "2026-07-26T10:00:00Z" } };
  const remote = { a: { done: false, updatedAt: "2026-07-26T10:30:00Z" } };
  assert.equal(app.mergeSessions(local, remote).a.done, false);
  assert.equal(app.mergeSessions(remote, local).a.done, false);
});

test("merge unions disjoint ids", () => {
  const app = loadApp();
  const out = app.mergeSessions({ a: { updatedAt: "1" } }, { b: { updatedAt: "1" } });
  assert.deepEqual(Object.keys(out).sort(), ["a", "b"]);
});

test("merge falls back to doneAt when updatedAt is absent", () => {
  const app = loadApp();
  const out = app.mergeSessions(
    { a: { done: true, doneAt: "2026-07-05T00:00:00Z" } },
    { a: { done: true, doneAt: "2026-07-03T00:00:00Z" } }
  );
  assert.equal(out.a.doneAt, "2026-07-05T00:00:00Z");
});

/* ---- schedule re-flow ----------------------------------------------------- */

test("remaining sessions are dealt onto consecutive study days in order", () => {
  const app = loadApp();
  const m = app.compute();
  const ids = app.SECTIONS.flatMap((s) => s.rows).map((r) => r.id);
  const idx = ids.map((id) => app.EFF[id]);
  assert.equal(idx[0], m.todayIdx, "first unread session sits on today");
  for (let i = 1; i < idx.length; i++) {
    assert.equal(idx[i], idx[i - 1] + 1, "dates must be consecutive and in curriculum order");
  }
});

test("reading ahead pulls everything after it forward", () => {
  const app = loadApp();
  const rows = app.SECTIONS.flatMap((s) => s.rows);
  const before = app.compute();
  const lastId = rows[rows.length - 1].id;
  const finishBefore = app.EFF[lastId];

  // credit a chapter from deep in year 2, using yesterday so "read today" doesn't
  // also shift the queue and confound the measurement
  const yesterday = new Date(Date.now() - 864e5).toISOString();
  const ahead = rows.slice(300, 303).map((r) => r.id);
  markDone(app, ahead, yesterday);

  const after = app.compute();
  assert.equal(after.remaining, before.remaining - ahead.length);
  assert.equal(app.EFF[lastId], finishBefore - ahead.length, "the finish date moves earlier");
  for (const id of ahead) assert.equal(app.EFF[id], undefined, "completed sessions leave the queue");
});

test("reading today costs today's slot, but only once", () => {
  const app = loadApp();
  const rows = app.SECTIONS.flatMap((s) => s.rows);
  const base = app.compute().todayIdx;

  markDone(app, [rows[0].id]);
  app.compute();
  const afterOne = app.EFF[rows[1].id];

  markDone(app, [rows[1].id, rows[2].id]);
  app.compute();
  const afterThree = app.EFF[rows[3].id];

  assert.equal(afterOne, base + 1, "the queue resumes tomorrow");
  assert.equal(afterThree, base + 1, "reading more in one day buys time back, not less");
});

test("Saturdays after the flex date are skipped when dealing dates", () => {
  const app = loadApp();
  const flexStart = new Date(2026, 6, 18);
  for (let i = 0; i < 60; i++) {
    const d = app.dayDate(i);
    if (d >= flexStart) assert.notEqual(d.getDay(), 6, `day ${i} landed on a flex Saturday`);
  }
});

/* ---- chapter search ------------------------------------------------------- */

test("search matches on title, section, and note text", () => {
  const app = loadApp();
  const hits = app.searchRows().filter((it) => app.matchItem(it, "penicillin"));
  assert.ok(hits.length >= 3, "expected the penicillin chapter's parts");
  assert.ok(hits.every((it) => it.hay.includes("penicillin")));
});

test("parts of one chapter group under a single key", () => {
  const app = loadApp();
  const parts = app.SECTIONS[0].rows.filter((r) => r.id.startsWith("ch20-"));
  assert.equal(new Set(parts.map(app.chapKey)).size, 1);
  assert.ok(!app.chapLabel(parts[0]).includes("Part"), "the group label drops the part suffix");
  assert.match(app.partLabel(parts[1]), /Part 2 of 3/);
});

test("marking a whole chapter credits every part in one pass", () => {
  const app = loadApp();
  const ids = app.SECTIONS[0].rows.filter((r) => r.id.startsWith("ch20-")).map((r) => r.id);
  app.markMany(ids, true);
  assert.ok(ids.every((id) => app.isDone(id)));
  assert.ok(ids.every((id) => app.IDStore.getState().sessions[id].done));
});

test("marking a chapter queues exactly one sync push, not one per part", () => {
  const app = loadApp();
  let pushes = 0;
  app.IDSync.schedulePush = () => { pushes++; };
  const ids = app.SECTIONS[0].rows.filter((r) => r.id.startsWith("ch20-")).map((r) => r.id);
  app.markMany(ids, true);
  assert.equal(pushes, 1);
});
