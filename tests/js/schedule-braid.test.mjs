import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

const NOW = new Date(2026, 7, 26, 21, 0, 0);
const app = loadCurrentApp({ now: NOW });
const SECTIONS = app.SECTIONS;

const sector = (title) => {
  const s = SECTIONS.find((x) => x.title === title);
  assert.ok(s, `no sector titled ${title}`);
  return s;
};
const idsOf = (title) => sector(title).rows.map((r) => r.id);
const allIds = SECTIONS.flatMap((s) => s.rows.map((r) => r.id));
const chapterOf = (id) => id.replace(/-p\d+$/, "");

const before = (list, early, late, why) => {
  const i = list.indexOf(early), j = list.indexOf(late);
  assert.ok(i > -1, `${early} is missing from this sector — ${why}`);
  assert.ok(j > -1, `${late} is missing from this sector — ${why}`);
  assert.ok(i < j, why);
};

test("the curriculum is still complete and unduplicated", () => {
  assert.equal(allIds.length, 585);
  assert.equal(new Set(allIds).size, 585);
});

test("the plan still ends where it always did", () => {
  const maxGi = Math.max(...SECTIONS.flatMap((s) => s.rows.map((r) => r.gi)));
  assert.equal(maxGi, 597, "planEnd anchors catch-up and drift — it moves only when the session count does");
});

test("prosthetic valve and cardiac device infection left the endovascular sector", () => {
  const endo = idsOf("Endovascular Infection & Staphylococci");
  assert.ok(!endo.some((id) => chapterOf(id) === "ch83"), "ch83 must not sit here");
  assert.ok(!endo.some((id) => chapterOf(id) === "ch84"), "ch84 must not sit here");
});

test("they land in the hardware sector, after orthopedic implant infection", () => {
  const hw = idsOf("Bone, Joint & Infected Hardware");
  before(hw, "ch26-p1", "ch107-p2", "rifampin comes before the prostheses");
  before(hw, "ch107-p2", "ch83-p1", "prosthetic joint before prosthetic valve");
  before(hw, "ch83-p3", "ch84-p1", "valve before cardiac device");
  before(hw, "ch84-p2", "ch85-p1", "device infection before its prevention");
  assert.equal(hw.indexOf("ch85-p2"), hw.length - 1, "IE prevention closes the sector");
});

test("the atypicals are braided into the pneumonia arc, not left in year 2", () => {
  const pna = idsOf("Pneumonia & the Atypicals");
  for (const id of ["ch189-p1", "ch193-p1", "ch187-p1", "ch173-p1"]) {
    assert.ok(pna.includes(id), `${id} belongs in the pneumonia differential`);
  }
  before(pna, "ch28-p1", "ch189-p1", "macrolides are read before Mycoplasma pays them off");
});

test("the tick-bite differential is one arc", () => {
  const tick = idsOf("Tick-Borne Illness");
  for (const id of ["ch247-p1", "ch197-p1", "ch287-p1", "ch192-p1"]) {
    assert.ok(tick.includes(id), `${id} belongs with the other tick-borne illnesses`);
  }
});

test("no chapter runs four or more sessions back to back in the unread queue", () => {
  // Scoped to unread (gi >= 50) exactly as scripts/resequence.mjs scopes it. The
  // already-read history legitimately holds a 6-run of ch82 from the old order.
  const queue = SECTIONS.flatMap((s) => s.rows).filter((r) => r.gi >= 50);
  let run = 0, prev = null;
  for (const r of queue) {
    const c = chapterOf(r.id);
    run = c === prev ? run + 1 : 1;
    prev = c;
    assert.ok(run < 4, `${c} runs ${run} consecutive sessions at ${r.id}`);
  }
});
