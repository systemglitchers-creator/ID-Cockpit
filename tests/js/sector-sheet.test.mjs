import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

const NOW = new Date(2026, 7, 9, 21, 0, 0);
const app = loadCurrentApp({ now: NOW });
const { groupByChapter } = app.IDCockpit;

test("parts of one chapter collapse into a single group", () => {
  const rows = [
    { id: "a1", r: "Chapter 89 — Acute Meningitis  ·  Part 1 of 5", ps: 1115, pe: 1122, pp: 8 },
    { id: "a2", r: "Chapter 89 — Acute Meningitis  ·  Part 2 of 5", ps: 1123, pe: 1130, pp: 8 },
    { id: "b1", r: "Chapter 91 — Encephalitis  ·  Part 1 of 3", ps: 1160, pe: 1166, pp: 7 }
  ];
  const g = groupByChapter(rows);
  assert.equal(g.length, 2, "two chapters, not three rows");
  assert.equal(g[0].parts.length, 2);
  assert.equal(g[1].parts.length, 1);
});

test("a group carries the chapter title once, without the part suffix", () => {
  const g = groupByChapter([
    { id: "a1", r: "Chapter 89 — Acute Meningitis  ·  Part 1 of 5", ps: 1, pe: 8, pp: 8 },
    { id: "a2", r: "Chapter 89 — Acute Meningitis  ·  Part 2 of 5", ps: 9, pe: 16, pp: 8 }
  ]);
  assert.equal(g[0].title, "Acute Meningitis");
  assert.doesNotMatch(g[0].title, /Part/);
  assert.equal(g[0].chapter, "89");
});

test("page range spans every part", () => {
  const g = groupByChapter([
    { id: "a1", r: "Chapter 89 — X  ·  Part 1 of 3", ps: 1115, pe: 1122, pp: 8 },
    { id: "a2", r: "Chapter 89 — X  ·  Part 2 of 3", ps: 1123, pe: 1130, pp: 8 },
    { id: "a3", r: "Chapter 89 — X  ·  Part 3 of 3", ps: 1131, pe: 1138, pp: 8 }
  ]);
  assert.equal(g[0].ps, 1115);
  assert.equal(g[0].pe, 1138);
  assert.equal(g[0].pp, 24, "pages sum across parts");
});

test("curriculum order is preserved", () => {
  const g = groupByChapter([
    { id: "b", r: "Chapter 91 — B", ps: 5, pe: 6, pp: 2 },
    { id: "a", r: "Chapter 89 — A", ps: 1, pe: 2, pp: 2 }
  ]);
  // Array.from: values crossing the vm realm are not prototype-identical.
  assert.deepEqual(Array.from(g, (x) => x.chapter), ["91", "89"],
    "order follows the plan, not chapter number");
});

test("a chapter with no number still groups without merging", () => {
  const g = groupByChapter([
    { id: "x1", r: "Re-read — antimicrobial principles", ps: null, pe: null, pp: null },
    { id: "x2", r: "Practice questions — core syndromes", ps: null, pe: null, pp: null }
  ]);
  assert.equal(g.length, 2, "unnumbered sessions must not collapse into one another");
});

test("the real curriculum collapses 585 rows into 319 groups", () => {
  const all = app.SECTIONS.flatMap((s) => s.rows);
  assert.equal(all.length, 585);
  const groups = groupByChapter(all);
  assert.equal(groups.length, 319);
  assert.equal(groups.filter((g) => !g.chapter).length, 21,
    "sessions with no leading chapter number, grouped by title");
});

test("no two groups share a title", () => {
  // The whole point is that a title appears once. Keying unnumbered sessions on
  // id instead of title split one multi-chapter session into three identical
  // rows, which is the repetition this replaces.
  const groups = groupByChapter(app.SECTIONS.flatMap((s) => s.rows));
  assert.equal(new Set(Array.from(groups, (g) => g.title)).size, groups.length);
});

test("every session survives grouping", () => {
  const all = app.SECTIONS.flatMap((s) => s.rows);
  const back = groupByChapter(all).flatMap((g) => g.parts);
  assert.equal(back.length, all.length, "no session may be dropped");
  assert.deepEqual(Array.from(back, (r) => r.id).sort(), Array.from(all, (r) => r.id).sort());
});
