import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/* Marks: written = sum of part marks (a null mark counts 1); MCQ = 1.
   got/correct earn everything, partial earns half, missed/incorrect nothing. */

const require_ = createRequire(import.meta.url);
const { marksFor, earnedFrom } = require_("../../lib/bank.js");

test("marksFor sums parts and defaults a null mark to 1", () => {
  assert.equal(marksFor({ kind: "written", parts: [{ marks: 1.5 }, { marks: 1.5 }, { marks: 0.5 }] }), 3.5);
  assert.equal(marksFor({ kind: "written", parts: [{ marks: null }, { marks: 2 }] }), 3);
  assert.equal(marksFor({ kind: "written", parts: [] }), 0);
  assert.equal(marksFor({ kind: "mcq" }), 1);
});

test("earnedFrom maps results onto a full mark", () => {
  assert.equal(earnedFrom(3, "got"), 3);
  assert.equal(earnedFrom(3, "partial"), 1.5);
  assert.equal(earnedFrom(3, "missed"), 0);
  assert.equal(earnedFrom(1, "correct"), 1);
  assert.equal(earnedFrom(1, "incorrect"), 0);
  assert.equal(earnedFrom(3, undefined), 0);
});
