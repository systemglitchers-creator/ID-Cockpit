import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCurrentApp } from "./harness.mjs";

/* The Guidelines tab, the icon badge, and dusk mode. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (f) => fs.readFileSync(path.join(ROOT, "public", f), "utf8");
const GUIDELINES = new Function(`${load("guidelines.js")}; return GUIDELINES;`)();
const SECTIONS = new Function(`${load("schedule.js")}; return SECTIONS;`)();

const THU_AUG_20 = new Date(2026, 7, 20, 21, 0, 0);

test("every guideline entry matches a real schedule tag — no orphans", () => {
  const tags = new Set(SECTIONS.flatMap((s) => s.rows.map((r) => r.g)).filter(Boolean));
  for (const key of Object.keys(GUIDELINES)) {
    assert.ok(tags.has(key), `guidelines.js maps "${key}" but no session carries that tag`);
  }
});

test("every link is https and every entry names its organization", () => {
  for (const [key, v] of Object.entries(GUIDELINES)) {
    assert.match(v.url, /^https:\/\//, key);
    assert.ok(v.org && typeof v.org === "string", key);
  }
});

test("topic labels stay out of the map — only real documents link", () => {
  for (const topic of ["FUO workup", "Chronic pneumonia differential", "Zoonoses overview",
                       "Nocardiosis", "VRE management"]) {
    assert.ok(!(topic in GUIDELINES), `"${topic}" is a topic label, not a document`);
  }
  assert.ok(Object.keys(GUIDELINES).length >= 100, "the map covers the plan broadly");
});

test("a mapped guideline tag renders its chip as a link on the quest card", () => {
  // Read forward until the quest is ch23-p1 — Chapter 23, Antibiotic Allergy —
  // whose tag (penicillin allergy de-labeling) is mapped. The tag sat on ch22
  // (Carbapenems) while the two chapters shared one bundled session; splitting
  // the bundle moved it to the chapter it actually describes.
  const app = loadCurrentApp({ now: THU_AUG_20, done: ["ch20-p1", "ch20-p2", "ch20-p3",
    "ch21-p1", "ch21-p2", "ch21-p3", "ch22-p1"], doneAt: "2026-07-20T12:00:00Z" });
  const quest = app._elements.get("questCard").innerHTML;
  assert.match(quest, /<a class="chip" href="https:\/\//, "the chip links out");
  assert.ok(!/href="undefined"/.test(quest), "no broken hrefs");
});

test("the icon badge count follows the deal", () => {
  const m1 = loadCurrentApp({ now: THU_AUG_20 }).IDCockpit.compute();
  assert.equal(m1.perDay[m1.todayIdx] || 0, 1, "a normal day carries one due session");

  const readToday = loadCurrentApp({
    now: THU_AUG_20, done: ["ch20-p1"], doneAt: THU_AUG_20.toISOString(),
  }).IDCockpit.compute();
  assert.equal(readToday.perDay[readToday.todayIdx] || 0, 0, "reading clears the badge");

  const SAT = new Date(2026, 7, 22, 12, 0, 0);
  const sat = loadCurrentApp({ now: SAT }).IDCockpit.compute();
  assert.equal(sat.perDay[sat.todayIdx] || 0, 0, "rest days carry nothing");

  const app = loadCurrentApp({ now: new Date(2026, 8, 20, 12, 0, 0) });
  const ids = app.SECTIONS.flatMap((s) => s.rows).slice(0, 30).map((r) => r.id);
  const behind = loadCurrentApp({
    now: new Date(2026, 8, 20, 12, 0, 0), done: ids, doneAt: "2026-07-20T12:00:00Z",
  }).IDCockpit.compute();
  assert.equal(behind.perDay[behind.todayIdx] || 0, 2, "a double day badges 2");
});

test("dusk mode follows the clock and the override", () => {
  const dusk = loadCurrentApp({ now: THU_AUG_20 }).IDCockpit.duskActive;
  assert.equal(dusk(new Date(2026, 7, 20, 21, 0), "auto"), true, "9pm is dusk");
  assert.equal(dusk(new Date(2026, 7, 20, 12, 0), "auto"), false, "noon is not");
  assert.equal(dusk(new Date(2026, 7, 20, 5, 0), "auto"), true, "5am still is");
  assert.equal(dusk(new Date(2026, 7, 20, 6, 30), "auto"), false, "6:30am is morning");
  assert.equal(dusk(new Date(2026, 7, 20, 12, 0), "on"), true, "Always wins");
  assert.equal(dusk(new Date(2026, 7, 20, 22, 0), "off"), false, "Off wins");
});
