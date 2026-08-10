import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.COCKPIT_FAKE_KV = "1";
const require_ = createRequire(import.meta.url);
const kv = require_("../../api/_kv.js");

test("fake KV round-trips a schedule", async () => {
  kv.__resetFake();
  await kv.setSchedule({ version: "v1", sections: [] });
  assert.deepEqual(await kv.getSchedule(), { version: "v1", sections: [] });
});

test("an unpushed schedule reads as null, not an error", async () => {
  kv.__resetFake();
  assert.equal(await kv.getSchedule(), null);
});

/* ---- validation ------------------------------------------------------------
   Session ids are the keys progress is stored against, so a duplicate or a
   rename silently orphans read-state. Nothing invalid may reach the store. */
import { validateSchedule } from "../../lib/schedule-schema.mjs";

const good = { version: "2026-08-08", sections: [
  { title: "S", rows: [{ id: "ch1-p1", r: "Chapter 1", pp: 5, ps: 1, pe: 5, wk: 1, gi: 0 }] }
] };

test("a well-formed schedule validates", () => {
  assert.deepEqual(validateSchedule(good).errors, []);
});

test("duplicate session ids are rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { id: "dup", r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 },
    { id: "dup", r: "B", pp: 1, ps: 2, pe: 2, wk: 1, gi: 1 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /duplicate id: dup/);
});

test("a missing id is rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /missing id/);
});

test("a non-numeric plan day is rejected", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].gi = "nope";
  assert.match(validateSchedule(bad).errors.join(), /gi must be a number/);
});

test("a null page count is allowed", () => {
  // The Consolidation and Practice Questions sessions are review days with no
  // page range: pp/ps/pe are null by design. 20 of the 584 look like this.
  const ok = JSON.parse(JSON.stringify(good));
  ok.sections[0].rows[0].pp = null;
  assert.deepEqual(validateSchedule(ok).errors, []);
});

test("a garbage page count is still rejected", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].pp = "six";
  assert.match(validateSchedule(bad).errors.join(), /pp must be a number or null/);
});

test("an empty schedule is rejected", () => {
  assert.match(validateSchedule({ version: "v", sections: [] }).errors.join(), /no sections/);
});

test("the real schedule in the repo is valid", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/schedule.js", import.meta.url), "utf8");
  const g = {};
  new Function("g", src + "\ng.SECTIONS = SECTIONS;")(g);
  assert.deepEqual(validateSchedule({ version: "x", sections: g.SECTIONS }).errors, []);
});
