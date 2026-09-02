import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* A chapter is OWED when every one of its schedule sessions is read and at
   least one of its ready (non-deferred) questions has no grade. Catch-alls are
   never owed. Newest-read first. */

const require_ = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chapterSessionIds, owedChapters } = require_("../../lib/bank.js");
const src = fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8");
const SECTIONS = new Function(`${src}; return SECTIONS;`)();

const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
const read = (ids, t) => Object.fromEntries(ids.map((id) => [id, at(t)]));

const CH20 = { chapter: "Chapter 20", id: "ch20", title: "Penicillins", sector: "Drug Foundations — Completed",
               weeks: [1], cqids: ["Q1", "Q2"], deferred: ["Q2"] };
const CH24 = { chapter: "Chapter 24", id: "ch24", title: "Aminoglycosides", sector: "Drug Foundations — Completed",
               weeks: [1], cqids: ["Q3"], deferred: [] };
const CATCH = { chapter: "CATCHALL-LAB", id: "catchall-lab", title: "Lab", sector: "Catch-all",
                weeks: [], cqids: ["Q7"], deferred: [] };

test("chapterSessionIds finds every session of a chapter across sectors", () => {
  const ids = chapterSessionIds(SECTIONS, 20);
  assert.ok(ids.length >= 2, "chapter 20 has at least two sittings");
  assert.ok(ids.every((id) => id.startsWith("ch20-")));
  assert.deepEqual(chapterSessionIds(SECTIONS, 99999), []);
});

test("an unread chapter is not owed", () => {
  assert.deepEqual(owedChapters(SECTIONS, {}, [CH20], {}), []);
});

test("a read chapter with an ungraded ready question is owed, deferred excluded from the count", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  const owed = owedChapters(SECTIONS, p, [CH20], {});
  assert.equal(owed.length, 1);
  assert.equal(owed[0].id, "ch20");
  assert.equal(owed[0].remaining, 1, "Q2 is deferred and does not count");
  assert.equal(owed[0].total, 1);
  assert.equal(owed[0].readAt, new Date("2026-08-01T12:00:00Z").getTime());
});

test("graded ready questions clear the debt even when deferred ones remain", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  assert.deepEqual(owedChapters(SECTIONS, p, [CH20], { Q1: { result: "got", ts: 1 } }), []);
});

test("a flag without a result is not a grade", () => {
  const p = read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z");
  assert.equal(owedChapters(SECTIONS, p, [CH20], { Q1: { flag: true, ts: 1 } }).length, 1);
});

test("a chapter split across sittings is owed only once every sitting is read", () => {
  const ids = chapterSessionIds(SECTIONS, 20);
  const half = read(ids.slice(0, 1), "2026-08-01T12:00:00Z");
  assert.deepEqual(owedChapters(SECTIONS, half, [CH20], {}), []);
});

test("catch-alls are never owed", () => {
  assert.deepEqual(owedChapters(SECTIONS, {}, [CATCH], {}), []);
});

test("owed chapters come newest-read first", () => {
  const p = { ...read(chapterSessionIds(SECTIONS, 20), "2026-08-01T12:00:00Z"),
              ...read(chapterSessionIds(SECTIONS, 24), "2026-08-05T12:00:00Z") };
  const owed = owedChapters(SECTIONS, p, [CH20, CH24], {});
  assert.deepEqual(owed.map((c) => c.id), ["ch24", "ch20"]);
});
