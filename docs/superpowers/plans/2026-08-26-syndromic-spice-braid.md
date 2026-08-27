# Syndromic Spice Braid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move prosthetic-valve endocarditis and CIED infection out of the front of the reading queue, and braid ~40 niche/short chapters forward from year 2 so each lands inside the syndrome differential it belongs to.

**Architecture:** This is a pure content reordering. `scripts/redesign-2026-08-structure.mjs` holds `STRUCTURE` — an ordered list of sectors, each naming its session ids. `scripts/resequence.mjs` reads it plus the current `public/schedule.js`, re-derives every positional field (`num`, `gi`, `wk`, `fow`) and the sector date ranges, validates hard invariants, and rewrites `public/schedule.js`. No session id, title, guideline tag, or page range changes — so no read-state is orphaned. No app code changes.

**Tech Stack:** Plain ES modules, `node --test`, Upstash Redis via `npm run push:schedule`, Vercel static hosting.

---

## Why this shape

**The complaint.** The next six unread sessions were Ch 83 Prosthetic Valve Endocarditis ×3 and Ch 84 Nonvalvular CV Device Infections + Ch 85 IE Prevention ×3 — more endocarditis on top of the six sessions of Ch 82 already read.

**The move.** Those six go to a new **Bone, Joint & Infected Hardware** sector, landing after Ch 26 rifamycins and Ch 107 orthopedic implant infection. The arc becomes bone → rifampin → prosthetic joint → prosthetic valve → cardiac device → IE prevention: one biofilm-and-rifampin block instead of an orphan. They land mid-January 2027 instead of this week.

**The side effect worth knowing about.** With Ch 83/84 gone, every remaining session in *Endovascular Infection & Staphylococci* is already read. That sector goes fully green the moment the schedule is pushed, and the next unread session is Ch 69 Acute Pneumonia.

**The braid.** ~40 sessions move forward from year 2 into the syndrome that owns them. The rule applied throughout: an exotic lands as the weird member of the differential currently open, never as a random interruption. Short self-contained chapters ("snappers") are placed to break up three-part slogs.

| Arc | Braided in | Why it belongs there |
|---|---|---|
| Pneumonia & the Atypicals | Mycoplasma (189/190), Q fever (193), psittacosis + C. pneumoniae (187/188), hantavirus (173) | Mycoplasma sitting in March 2028 while reading CAP was the single clearest gap in the plan. All four are CAP differential; Q fever doubles as culture-negative IE. |
| Upper Airway & Respiratory Viruses | epiglottitis (65), laryngitis (62), bronchitis + AECOPD (67/68), pertussis (236), common cold (60), adenovirus (149) | Cough and airway syndromes were parked in a year-2 "Head, Neck & Eye" bin. Epiglottitis is a can't-miss airway emergency that was 14 months out. |
| Central Nervous System | enteroviruses + polio (176/177), free-living amebae (279), prions (185) | Viral meningitis without enteroviruses was a real hole. Naegleria/Acanthamoeba and prions close the sector on two genuine mimics. |
| Skin & Soft Tissue | bites (320), Pasteurella (233), Capnocytophaga (239), rat-bite fever (237), lymphadenitis (97), Bartonella (240), tularemia (232), sporotrichosis (265) | One bite-scratch-lymphocutaneous differential. Four snappers are interleaved among the core chapters rather than appended, so the rhythm alternates. |
| Gastrointestinal | esophagitis (99), Giardia (285), Whipple bundle (213/214/215) | Giardia is the classic non-febrile chronic diarrhea and was 15 months out. The Ch 213 bundle is B. cereus + Erysipelothrix + Whipple — two of its three chapters are GI, so it moves here rather than to skin. |
| Tick-Borne Illness (new sector) | Lyme (247), Anaplasma (197), Babesia (287), RMSF (192), relapsing fever (246) | Lyme was alone in a "Spirochetes" sector while its co-infections sat in November 2027. Consolidated into one tick-bite differential landing March 2027, just ahead of Nova Scotia tick season. Syphilis and the treponematoses split off into their own sector. |

**Sector splits.** Three long sectors become six shorter ones (Pneumonia / Upper Airway; Skin / Bone & Hardware; Tick-Borne / Syphilis). Sector count goes 36 → 38. Shorter sectors clear more often, which is the visible progress beat in the app.

**What is deliberately *not* changed.** `REBASE_K0` (50) and the frozen `READ` set (42 ids, the 2026-08-14 snapshot) stay exactly as they are. They are the anchor that fixes the plan's original end date at `gi` 591 → Mon 8 May 2028, which is what catch-up and drift are measured against. Because `unread.length` is derived from that frozen set and reordering cannot change its size, `planEnd` stays 591 automatically. Updating `READ` to today's server truth would move the finish date and manufacture a fake catch-up debt. Do not touch them.

**Verified before this plan was written.** The structure below was installed, `resequence.mjs --write` was run, the full suite passed 108/108, the day-by-day flow was reviewed, and the working tree was restored. The reported result was: `valid: 584 sessions, 38 sectors, 542 unread, planEnd gi 591 → finishes Mon May 08 2028`.

---

## File Structure

- `scripts/redesign-2026-08-structure.mjs` — **rewritten.** The ordered curriculum: sector titles, subtitles, year, accent, and the id list per sector. The only file where reading order is decided.
- `scripts/resequence.mjs` — **two header lines edited.** Regenerates `public/schedule.js`. Its validation logic is unchanged.
- `public/schedule.js` — **regenerated, never hand-edited.** Output of the above.
- `public/sw.js` — **one line.** `CACHE` bump so installed devices pick up the new bundled `schedule.js`.
- `tests/js/schedule-braid.test.mjs` — **new.** Pins the intent of this change so a future reorder cannot silently undo it.

---

## Task 1: Pin the new reading order with a regression test

**Files:**
- Create: `tests/js/schedule-braid.test.mjs`

This test is written *first* and must fail against the current schedule. It asserts the intent of the change, not incidental positions.

- [ ] **Step 1: Write the failing test**

Create `tests/js/schedule-braid.test.mjs`:

```js
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

// indexOf returns -1 for a missing id, and -1 < N is true — so a bare
// `at(a) < at(b)` passes vacuously when a is gone. Assert presence first.
const before = (list, early, late, why) => {
  const i = list.indexOf(early), j = list.indexOf(late);
  assert.ok(i > -1, `${early} is missing from this sector — ${why}`);
  assert.ok(j > -1, `${late} is missing from this sector — ${why}`);
  assert.ok(i < j, why);
};

test("the curriculum is still complete and unduplicated", () => {
  assert.equal(allIds.length, 584);
  assert.equal(new Set(allIds).size, 584);
});

test("the plan still ends where it always did", () => {
  const maxGi = Math.max(...SECTIONS.flatMap((s) => s.rows.map((r) => r.gi)));
  assert.equal(maxGi, 591, "planEnd anchors catch-up and drift — it must not move");
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
  assert.equal(hw.indexOf("ch84-p3"), hw.length - 1, "IE prevention closes the sector");
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
```

- [ ] **Step 2: Run the test and confirm it fails for the right reasons**

```bash
node --test tests/js/schedule-braid.test.mjs
```

Expected: FAIL, with 4 of 7 failing. The failures must be exactly: `no sector titled Bone, Joint & Infected Hardware`, `no sector titled Pneumonia & the Atypicals`, `no sector titled Tick-Borne Illness`, and `ch83 must not sit here`.

The other three — "still complete and unduplicated", "still ends where it always did", and "no chapter runs four or more in the unread queue" — must PASS against the *current* schedule. They are guardrails on invariants this change must not break, so a failure there means the test itself is wrong, not the schedule.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/js/schedule-braid.test.mjs
git commit -m "test: pin the syndromic braid reading order"
```

---

## Task 2: Rewrite the curriculum structure

**Files:**
- Modify: `scripts/redesign-2026-08-structure.mjs` (whole file replaced)

- [ ] **Step 1: Replace the file with the new structure**

Overwrite `scripts/redesign-2026-08-structure.mjs` with exactly this content:

```js
/* The reading order — every session, in the sequence Tyler reads them.
   Consumed by scripts/resequence.mjs, which regenerates public/schedule.js.
   public/schedule.js is GENERATED; this file is where order is decided.

   ids never change. Only order, sector membership and labels move — a changed
   id silently orphans that session's read-state in Redis.

   Two design passes are layered here.

   The 2026-08-14 redesign
   (docs/superpowers/specs/2026-08-14-mandell-schedule-redesign-design.md):
   - No chapter runs more than 3 consecutive unread sessions; braid partners
     always share a theme (vary the chapter, keep the theme).
   - Flagship syndrome first, drugs braided behind first contact.
   - Complications live with their parents; integrative chapters land right
     after their prerequisites complete (the post-fungal capstone).
   - Year 2 is themed arcs (exposure/presentation), not taxonomy bins.

   The 2026-08-26 syndromic spice braid
   (docs/superpowers/plans/2026-08-26-syndromic-spice-braid.md):
   - Niche chapters are pulled forward out of year 2 into the syndrome arc
     that owns their differential, so an exotic lands as the weird member of
     the DDx already open — never as a random interruption. Marked ← braided.
   - Short self-contained chapters ("snappers") are placed to break up
     three-part slogs; a snapper is a day you finish a whole topic.
   - Prosthetic valve (ch83) and cardiac device (ch84) infection left the
     endovascular arc for Bone, Joint & Infected Hardware, behind rifampin
     and prosthetic joint infection — one biofilm block.
   - Long sectors split (Pneumonia/Upper Airway, Skin/Bone, Tick/Syphilis):
     shorter sectors mean more frequent completion beats in the app. */

/* Session-title edits that ride along with the redesign (ids unchanged).
   FUO/mimics and Lyme were absent from the exam-prep tail — a verified gap
   for a Royal College candidate. */
export const TITLE_OVERRIDES = {
  "x-re-read-endocarditis-sepsis-pneumonia-uti-skin-s-p1":
    "Re-read — endocarditis, sepsis, FUO & fever-and-rash, pneumonia, UTI, skin & soft tissue; durations & de-escalation",
  "x-guideline-review-aasld-hepatitis-b-c-idsa-influe-p1":
    "Guideline review — AASLD hepatitis B/C, IDSA influenza, CDC STI, CDC malaria, IDSA/AAN Lyme",
};
function P(ch, from, to){const o=[];for(let i=from;i<=to;i++)o.push(`${ch}-p${i}`);return o;}
const one=(ch)=>[`${ch}-p1`];

export const STRUCTURE = [
/* ===== YEAR 1 ===== */
{ title:"Drug Foundations — Completed", year:1, accent:"#3d7a5a",
  sub:"The β-lactam and aminoglycoside spine you have already read.",
  ids:[...P("ch20",1,3),...P("ch21",1,3),...P("ch22",1,3),...P("ch24",1,3)] },

{ title:"Foundations & Sepsis", year:1, accent:"#b0413e",
  sub:"The septic patient, and the FUO consult you will field from week one.",
  ids:[...P("ch75",1,3),...P("ch58",1,2)] },

{ title:"Endovascular Infection & Staphylococci", year:1, accent:"#a8432f",
  sub:"Endocarditis, catheter infection, and the staphylococci — complete.",
  ids:[...P("ch29",1,3),...P("ch30",1,2),...P("ch82",1,6),...P("ch306",1,3),
       ...P("ch199",1,3),                           // read
       "ch199-p4","ch200-p1","ch199-p5","ch199-p6","ch200-p2"] },  // read — sector complete

{ title:"Pneumonia & the Atypicals", year:1, accent:"#9a5a2f",
  sub:"Community pneumonia and its organisms, drugs braided behind first contact.",
  ids:[...P("ch69",1,3),                            // CAP — the flagship
       ...P("ch28",1,2), ...P("ch204",1,3),         // macrolides, then the pneumococcus
       ...P("ch189",1,2),                           // ← braided: Mycoplasma, the macrolide payoff
       ...P("ch34",1,2), ...P("ch238",1,2),         // quinolones, then Legionella
       ...P("ch193",1,2),                           // ← braided: Q fever — atypical + culture-negative IE
       "ch28-p3","ch34-p3",                         // finish the drugs
       ...P("ch187",1,2),                           // ← braided: psittacosis + C. pneumoniae
       one("ch173")[0],                             // ← braided snapper: hantavirus pulmonary syndrome
       ...P("ch307",1,2), one("ch71")[0], ...P("ch70",1,2)] },  // HAP/VAP, abscess, empyema

{ title:"Upper Airway & Respiratory Viruses", year:1, accent:"#b07a35",
  sub:"Throat to sinus and ear, the cough syndromes, then the winter viruses.",
  ids:[one("ch61")[0],                              // pharyngitis
       one("ch65")[0],                              // ← braided snapper: epiglottitis — a can't-miss airway
       ...P("ch64",1,2),
       one("ch62")[0],                              // ← braided snapper: laryngitis (3pp)
       ...P("ch63",1,2),
       ...P("ch67",1,2), ...P("ch236",1,2),         // ← braided: the cough syndromes + pertussis
       one("ch60")[0],                              // ← braided snapper: the common cold
       ...P("ch165",1,2), one("ch163")[0], one("ch166")[0],
       one("ch149")[0],                             // ← braided snapper: adenovirus
       ...P("ch172",1,3), ...P("ch48",1,2)] },      // influenza before the season, drugs behind it

{ title:"Central Nervous System Infection", year:1, accent:"#3f5a8a",
  sub:"Meningitis to encephalitis, collections and shunts — with the great mimics.",
  ids:[one("ch88")[0],
       ...P("ch89",1,3), one("ch211")[0], ...P("ch89",4,5),  // Listeria braided into meningitis
       ...P("ch91",1,3),
       ...P("ch176",1,2),                           // ← braided: enteroviruses — the aseptic meningitis payoff
       ...P("ch92",1,2), ...P("ch93",1,2), ...P("ch94",1,2), ...P("ch216",1,3),
       ...P("ch279",1,2),                           // ← braided: Naegleria, Acanthamoeba, Balamuthia
       ...P("ch185",1,2)] },                        // ← braided: prions close the sector on a mimic

{ title:"Genitourinary & STI Syndromes", year:1, accent:"#6a5aa0",
  sub:"UTI and CA-UTI, then the sexually transmitted syndromes and Chlamydia.",
  ids:[...P("ch74",1,3),"ch33-p1",...P("ch308",1,2),"ch33-p2",one("ch36")[0],
       one("ch109")[0],...P("ch110",1,2),...P("ch111",1,3),
       ...P("ch108",1,2),one("ch286")[0],...P("ch186",1,3)] },

{ title:"Skin & Soft Tissue", year:1, accent:"#8a5a3f",
  sub:"Cellulitis and myonecrosis, the bite differential braided in, then the lymphocutaneous nodule.",
  ids:[...P("ch95",1,3),
       one("ch320")[0], one("ch233")[0],            // ← braided snappers: bites, then Pasteurella
       ...P("ch96",1,2), one("ch53")[0],            // myonecrosis with hyperbaric beside it
       one("ch239")[0], one("ch237")[0],            // ← braided snappers: Capnocytophaga, rat-bite fever
       ...P("ch202",1,3),
       ...P("ch97",1,2),                            // ← braided: lymphadenitis — anchors what follows
       ...P("ch240",1,3), ...P("ch232",1,2),        // ← braided: cat-scratch, tularemia
       ...P("ch265",1,2)] },                        // ← braided: sporotrichosis — the lymphocutaneous nodule

{ title:"Bone, Joint & Infected Hardware", year:1, accent:"#a8432f",
  sub:"Native joint and bone, rifampin, then every prosthesis — orthopedic, valve and device.",
  ids:[...P("ch105",1,3),                           // read
       ...P("ch106",1,2), ...P("ch26",1,3),         // osteomyelitis, then rifampin
       ...P("ch107",1,2),                           // read — prosthetic joint
       ...P("ch83",1,3),                            // ← moved here: prosthetic valve endocarditis
       ...P("ch84",1,3)] },                         // ← moved here: cardiac device + IE prevention

{ title:"Gastrointestinal & Intra-Abdominal", year:1, accent:"#5a6a3a",
  sub:"Gut syndromes and their toxins, C. difficile, the abdomen itself, then the anaerobes.",
  ids:[...P("ch98",1,2),
       one("ch99")[0],                              // ← braided snapper: esophagitis
       ...P("ch100",1,2),
       one("ch285")[0],                             // ← braided snapper: Giardia — the non-febrile diarrhea
       ...P("ch213",1,2),                           // ← braided: B. cereus, Erysipelothrix, Whipple
       one("ch101")[0],
       ...P("ch249",1,3), ...P("ch76",1,3), ...P("ch77",1,2), ...P("ch78",1,3),
       ...P("ch248",1,2), one("ch253")[0], one("ch252")[0], one("ch254")[0]] },

{ title:"Enterococci & Streptococci", year:1, accent:"#3d7a5a",
  sub:"Enterococcus and Group B streptococcus.",
  ids:[...P("ch205",1,2), one("ch206")[0]] },

{ title:"Gram-Negatives & Resistance", year:1, accent:"#2f6f7a",
  sub:"Enterobacterales to Acinetobacter, drugs braided behind the organisms.",
  ids:[...P("ch223",1,3),...P("ch25",1,2),...P("ch224",1,2),...P("ch31",1,2),
       one("ch227")[0],"ch25-p3",...P("ch228",1,2),...P("ch230",1,2),...P("ch217",1,3)] },

{ title:"Tick-Borne Illness", year:1, accent:"#7a6a2a",
  sub:"The tick-bite differential in one arc — Lyme, Anaplasma, Babesia, spotted fever.",
  ids:[...P("ch247",1,2),                           // Lyme
       one("ch191")[0], ...P("ch197",1,2),          // ← braided: Anaplasma, the Ixodes co-infection
       ...P("ch287",1,2),                           // ← braided: Babesia, the other co-infection
       ...P("ch192",1,2), one("ch246")[0]] },       // ← braided: RMSF, relapsing fever

{ title:"Syphilis & the Treponematoses", year:1, accent:"#6a5aa0",
  sub:"Syphilis stage by stage, then the endemic treponematoses.",
  ids:[...P("ch243",1,2), one("ch244")[0], ...P("ch243",3,4)] },  // endemic trep breaks the ch243 run

{ title:"Wounds, Burns & Toxin-Mediated Disease", year:1, accent:"#7a5a2f",
  sub:"Tetanus and botulism, burns, and post-traumatic infection.",
  ids:[...P("ch250",1,2), ...P("ch318",1,3)] },

{ title:"Mycobacteria, Nocardia & Actinomyces", year:1, accent:"#5a4a6a",
  sub:"TB with its drugs braided in, NTM, and the filamentous bacteria.",
  ids:[...P("ch255",1,3),"ch38-p1",...P("ch255",4,5),"ch38-p2",
       ...P("ch257",1,2),one("ch258")[0],...P("ch259",1,2),...P("ch260",1,2)] },

{ title:"HIV Medicine", year:1, accent:"#b0413e",
  sub:"Virology and diagnosis through ART and opportunistic infections.",
  ids:[...P("ch120",1,2),...P("ch123",1,3),...P("ch125",1,3),...P("ch130",1,3),...P("ch131",1,3)] },

{ title:"Invasive Fungal Disease", year:1, accent:"#7a6a2a",
  sub:"Yeasts, moulds, and the endemic trio, antifungals braided behind them.",
  ids:[one("ch261")[0],...P("ch262",1,3),"ch40-p1",...P("ch263",1,2),"ch40-p2",
       ...P("ch268",1,3),"ch40-p3",...P("ch275",1,3),...P("ch269",1,2),
       ...P("ch270",1,2),...P("ch271",1,2),...P("ch264",1,2)] },

{ title:"Chronic Syndromes — The Capstone", year:1, accent:"#a8432f",
  sub:"Chronic pneumonia and chronic meningitis — the payoff for the TB and fungal arcs.",
  ids:[...P("ch72",1,2), one("ch90")[0]] },

{ title:"Herpesviruses & Exanthems", year:1, accent:"#3f5a8a",
  sub:"The herpes family with its antivirals braided in, then the exanthems.",
  ids:[...P("ch142",1,3),one("ch47")[0],one("ch143")[0],...P("ch144",1,3),
       ...P("ch49",1,2),...P("ch145",1,3),"ch49-p3",
       one("ch167")[0],one("ch164")[0],one("ch159")[0],...P("ch150",1,2)] },

{ title:"Malaria, Toxoplasma & Amebiasis", year:2, accent:"#5a6a3a",
  sub:"The core protozoa, antiparasitic drugs braided behind the diseases.",
  ids:[...P("ch280",1,2),"ch44-p1","ch280-p3",...P("ch44",2,3),
       ...P("ch284",1,2),"ch278-p1",...P("ch284",3,4),"ch278-p2"] },

{ title:"Immunization & Travel Medicine", year:2, accent:"#2f6f7a",
  sub:"Vaccination braided with the traveller, before and after the trip.",
  ids:[one("ch321")[0],...P("ch322",1,2),...P("ch323",1,2),
       ...P("ch322",3,4),...P("ch324",1,2),...P("ch322",5,7)] },

{ title:"Prevention & Stewardship", year:2, accent:"#6a5aa0",
  sub:"Stewardship, OPAT, infection control, and the surgical site.",
  ids:[one("ch54")[0],...P("ch56",1,2),...P("ch304",1,2),...P("ch317",1,2)] },

/* ===== YEAR 2 ===== */
{ title:"Immunocompromised & Transplant ID", year:2, accent:"#8a5a3f",
  sub:"The compromised host, immunomodulators braided through the transplant chapters.",
  ids:[...P("ch310",1,2),...P("ch311",1,3),"ch52-p1",...P("ch312",1,3),"ch52-p2",
       ...P("ch313",1,3),...P("ch52",3,4),...P("ch309",1,2),...P("ch315",1,2),
       ...P("ch316",1,3),...P("ch314",1,2)] },

{ title:"HIV & COVID — Completing", year:2, accent:"#b0413e",
  sub:"HIV prevention to cure research; SARS-CoV-2 from virology to treatment.",
  ids:[...P("ch122",1,3),...P("ch126",1,2),...P("ch128",1,3),...P("ch124",1,3),
       ...P("ch129",1,2),...P("ch121",1,2),...P("ch132",1,2),...P("ch134",1,3),
       ...P("ch135",1,3),...P("ch136",1,3),...P("ch133",1,2),...P("ch162",1,2)] },

{ title:"Viral Hepatitis", year:2, accent:"#5a4a6a",
  sub:"The hepatitis viruses braided, their drugs behind them.",
  ids:[one("ch119")[0],...P("ch152",1,3),...P("ch161",1,3),one("ch153")[0],
       ...P("ch161",4,5),...P("ch180",1,3),one("ch184")[0],...P("ch50",1,3)] },

{ title:"The Undifferentiated Patient", year:2, accent:"#b0413e",
  sub:"Fever physiology, fever-and-rash, and the great mimics — integration chapters.",
  ids:[...P("ch57",1,2),...P("ch59",1,3),...P("ch86",1,2),one("ch303")[0],...P("ch137",1,2)] },

{ title:"Head, Neck & Eye", year:2, accent:"#9a5a2f",
  sub:"The oral cavity to the mediastinum, cystic fibrosis, and the eye.",
  ids:[...P("ch66",1,3),...P("ch87",1,2),...P("ch73",1,3),one("ch225")[0],
       ...P("ch113",1,2),...P("ch115",1,2),...P("ch116",1,2),...P("ch117",1,2),one("ch118")[0]] },

{ title:"Enteric & Foodborne — Completing", year:2, accent:"#5a6a3a",
  sub:"Every diarrhea consult — bacteria, parasites, and viruses in one arc.",
  ids:[...P("ch102",1,2),...P("ch103",1,3),...P("ch221",1,2),one("ch229")[0],one("ch235")[0],
       ...P("ch219",1,2),...P("ch222",1,2),...P("ch288",1,2),...P("ch289",1,3),
       ...P("ch181",1,3),...P("ch155",1,3)] },

{ title:"Zoonoses, Rickettsioses & Ectoparasites", year:2, accent:"#7a5a2f",
  sub:"Organized by the exposure you would elicit — farm, water, louse, and mite.",
  ids:[...P("ch325",1,2),one("ch231")[0],one("ch234")[0],...P("ch325",3,4),
       one("ch245")[0],...P("ch212",1,3),...P("ch168",1,2),
       ...P("ch301",1,2),...P("ch194",1,2),...P("ch301",3,4)] },

{ title:"Arboviruses & Hemorrhagic Fevers", year:2, accent:"#3f5a8a",
  sub:"Mosquito-borne viruses through rabies and the viral hemorrhagic fevers.",
  ids:[...P("ch160",1,3),...P("ch158",1,2),...P("ch170",1,3),...P("ch174",1,3)] },

{ title:"Tropical Medicine & Helminths", year:2, accent:"#5a6a3a",
  sub:"The returning traveller completed — protozoa, worms, and their drugs.",
  ids:[one("ch277")[0],...P("ch226",1,2),...P("ch256",1,2),...P("ch281",1,3),
       one("ch45")[0],...P("ch282",1,2),...P("ch276",1,2),
       ...P("ch292",1,3),"ch46-p1",...P("ch294",1,2),...P("ch295",1,2),"ch46-p2",
       ...P("ch296",1,3),...P("ch299",1,2)] },

{ title:"Fungal — Completing", year:2, accent:"#7a6a2a",
  sub:"Paracocci, dermatophytes, and the uncommon fungi.",
  ids:[...P("ch273",1,2),...P("ch272",1,2),...P("ch274",1,3)] },

{ title:"Viral Foundations & Completion", year:2, accent:"#3f5a8a",
  sub:"Virology foundations, the remaining herpesviruses, pox, entero, and the polyomaviruses.",
  ids:[...P("ch138",1,2),one("ch141")[0],...P("ch146",1,3),...P("ch151",1,2),
       one("ch154")[0],...P("ch139",1,2),...P("ch178",1,3),one("ch51")[0]] },

{ title:"Bacteria — Completing", year:2, accent:"#2f6f7a",
  sub:"The remaining streptococci, coryneforms, and fastidious organisms.",
  ids:[one("ch198")[0],one("ch201")[0],...P("ch203",1,2),...P("ch207",1,2),
       ...P("ch209",1,3),one("ch218")[0],...P("ch241",1,3)] },

{ title:"Stewardship Systems & Future Therapeutics", year:2, accent:"#6a5aa0",
  sub:"Study design, sterilization, and the therapies still arriving.",
  ids:[...P("ch55",1,2),...P("ch305",1,2),...P("ch37",1,2),...P("ch39",1,2),...P("ch35",1,2)] },

{ title:"Consolidation & Guideline Review", year:2, accent:"#3d7a5a",
  sub:"Re-read the core, then the guidelines, syndrome by syndrome.",
  ids:["x-re-read-antimicrobial-principles-spectra-empiric-p1",
       "x-re-read-endocarditis-sepsis-pneumonia-uti-skin-s-p1",
       "x-re-read-cns-bone-joint-intra-abdominal-empiric-c-p1",
       "x-re-read-hiv-art-oi-prophylaxis-tuberculosis-late-p1",
       "x-re-read-invasive-fungal-disease-transplant-immun-p1",
       "x-re-read-c-difficile-healthcare-associated-infect-p1",
       "x-guideline-review-idsa-endocarditis-cap-hap-vap-s-p1",
       "x-guideline-review-idsa-meningitis-osteomyelitis-p-p1",
       "x-guideline-review-candidiasis-aspergillosis-crypt-p1",
       "x-guideline-review-aasld-hepatitis-b-c-idsa-influe-p1",
       "x-guideline-review-dhhs-art-oi-prophylaxis-ast-tra-p1",
       "x-guideline-review-stewardship-clabsi-cauti-opat-p1"] },

{ title:"Practice Questions & Final Review", year:2, accent:"#b0413e",
  sub:"Question banks, weak areas, and the taper before the exam.",
  ids:["x-practice-questions-antimicrobials-core-syndromes-p1",
       "x-practice-questions-organisms-bacteria-fungi-viru-p1",
       "x-practice-questions-mixed-sets-at-exam-pace-log-y-p1",
       "x-final-review-weak-area-first-pass-from-your-ques-p1",
       "x-final-review-guideline-recommendation-tables-ant-p1",
       "x-final-review-high-yield-organisms-syndromes-rapi-p1",
       "x-final-review-second-weak-area-pass-p1",
       "x-taper-rest-before-the-royal-college-exam-light-r-p1"] },
];
```

- [ ] **Step 2: Dry-run the resequencer to validate**

```bash
node scripts/resequence.mjs
```

Expected output, exactly:

```
valid: 584 sessions, 38 sectors, 542 unread, planEnd gi 591 → finishes Mon May 08 2028
first unread in order: ch58-p1  ch58-p2  ch199-p4  ch200-p1  ch199-p5  ch199-p6  ch200-p2  ch69-p1
(dry run — pass --write to regenerate public/schedule.js)
```

If it prints `INVALID — refusing to write:` instead, do not work around it. The three checks that can fail are: a dropped/repeated/unknown id, a 4+ consecutive same-chapter run in the unread queue, and `planEnd` drifting off 591. Fix the id list; never edit the validator.

> `ch58-p1`, `ch58-p2`, `ch199-p4`, `ch200-p1`, `ch199-p5`, `ch199-p6`, `ch200-p2` appear at the head of the "unread" list because the frozen `READ` set is the 2026-08-14 snapshot and those seven were read after it. They are done on the server, so the app deals from `ch69-p1`. This is expected — it is the same read-ahead situation that exists today.

- [ ] **Step 3: Commit the structure**

```bash
git add scripts/redesign-2026-08-structure.mjs
git commit -m "feat: braid niche chapters into their syndrome arcs, move PVE and CIED to the hardware sector"
```

---

## Task 3: Regenerate the schedule

**Files:**
- Modify: `scripts/resequence.mjs:110-112` (the emitted header comment)
- Modify: `public/schedule.js` (generated — do not hand-edit)

- [ ] **Step 1: Update the header comment the resequencer emits**

In `scripts/resequence.mjs`, find these three lines (110–112) inside the emit section:

```js
lines.push(`   Regenerated 2026-08-14 by scripts/resequence.mjs from`);
lines.push(`   scripts/redesign-2026-08-structure.mjs — braided order, reunified`);
lines.push(`   sectors, and the plan rebased to "on plan" as of Sun 2026-08-16. */`);
```

Replace those three lines with these five:

```js
lines.push(`   Regenerated 2026-08-26 by scripts/resequence.mjs from`);
lines.push(`   scripts/redesign-2026-08-structure.mjs — syndromic spice braid:`);
lines.push(`   niche chapters pulled into the differential that owns them, and`);
lines.push(`   prosthetic valve / cardiac device infection moved to the hardware`);
lines.push(`   sector. The 2026-08-16 rebase anchor is unchanged. */`);
```

- [ ] **Step 2: Regenerate**

```bash
node scripts/resequence.mjs --write
```

Expected: the same `valid: 584 sessions, 38 sectors, 542 unread, planEnd gi 591 → finishes Mon May 08 2028` line, followed by `wrote .../public/schedule.js`.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: `ℹ tests 115`, `ℹ pass 115`, `ℹ fail 0`. (108 existing + 7 from Task 1.) The existing suite passed unchanged during verification of this plan — if anything in `schedule-dates`, `day-view` or `nudge` fails, stop and report it rather than editing the assertion.

- [ ] **Step 4: Commit the regenerated schedule**

```bash
git add scripts/resequence.mjs public/schedule.js
git commit -m "feat: regenerate the reading plan with the braided order"
```

---

## Task 4: Bump the service worker cache

**Files:**
- Modify: `public/sw.js:2`

`public/sw.js` caches `./schedule.js` in its offline shell. Without a `CACHE` bump, an installed device keeps serving the old bundled copy.

- [ ] **Step 1: Bump the cache key**

In `public/sw.js` line 2, change:

```js
var CACHE = "idcockpit-web-v18";
```

to:

```js
var CACHE = "idcockpit-web-v19";
```

- [ ] **Step 2: Confirm the bump and that tests still pass**

```bash
grep -o 'idcockpit-web-v[0-9]*' public/sw.js
```

Expected: `idcockpit-web-v19`

```bash
npm test
```

Expected: `ℹ pass 115`, `ℹ fail 0`

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "chore: bump sw cache to v19 for the braided schedule"
```

---

## Task 5: Eyeball the day-by-day flow

**Files:**
- None modified. This is a read-only sanity check on generated output.

- [ ] **Step 1: Print the first eight weeks as they will actually be dealt**

```bash
node -e 'const fs=require("fs");const S=new Function(`${fs.readFileSync("public/schedule.js","utf8")}; return SECTIONS;`)();const done=new Set();const isFlex=d=>d.getDay()===6&&d>=new Date(2026,6,18);let d=new Date(2026,7,27);const MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],DY=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];let n=0,sec=null;outer:for(const s of S){for(const r of s.rows){if(r.gi<50)continue;while(isFlex(d))d.setDate(d.getDate()+1);if(s.title!==sec){sec=s.title;console.log("\n### "+sec);}console.log(`${DY[d.getDay()]} ${MO[d.getMonth()]} ${String(d.getDate()).padStart(2)}  ${String(r.pp).padStart(2)}pp  ${r.r}`);d.setDate(d.getDate()+1);if(++n>=55)break outer;}}'
```

Expected: after the seven already-read carry-over rows, the stream opens on `Chapter 69 — Acute Pneumonia · Part 1 of 3`, reaches `Chapter 189 — Mycoplasma pneumoniae` about ten sessions later, and enters `### Upper Airway & Respiratory Viruses` at `Chapter 61 — Pharyngitis`.

- [ ] **Step 2: Confirm the endovascular sector is fully read**

```bash
curl -s https://id-cockpit.vercel.app/api/progress > /tmp/prog.json && node -e 'const fs=require("fs");const S=new Function(`${fs.readFileSync("public/schedule.js","utf8")}; return SECTIONS;`)();const done=new Set(Object.entries(JSON.parse(fs.readFileSync("/tmp/prog.json","utf8")).sessions).filter(([k,v])=>v.done).map(([k])=>k));const s=S.find(x=>x.title==="Endovascular Infection & Staphylococci");const open=s.rows.filter(r=>!done.has(r.id));console.log(open.length===0?"CLEAR — sector fully read":"still open: "+open.map(r=>r.id).join(" "));'
```

Expected: `CLEAR — sector fully read`

If it lists open sessions instead, that is not a failure of this plan — it means the server progress differs from what was checked on 2026-08-26. Report the list rather than changing the structure.

---

## Task 6: Preview in the browser

**Files:**
- None modified.

- [ ] **Step 1: Serve the app locally**

```bash
python3 -m http.server 8797 --directory public
```

- [ ] **Step 2: Open http://localhost:8797 and confirm, with a clean console**

- The home screen's next session reads `Chapter 69 — Acute Pneumonia · Part 1 of 3`.
- The Path tab lists 38 sectors, including `Pneumonia & the Atypicals`, `Upper Airway & Respiratory Viruses`, `Skin & Soft Tissue`, `Bone, Joint & Infected Hardware`, `Tick-Borne Illness` and `Syphilis & the Treponematoses`.
- Opening the `Bone, Joint & Infected Hardware` sector sheet shows Ch 83 and Ch 84 at the end, after Ch 107.
- No errors in the browser console.

- [ ] **Step 3: Stop the server** (Ctrl-C in that terminal)

---

## Task 7: Push the schedule to the store

**Files:**
- None modified. This writes `cockpit:schedule` in Redis, which is what the phone actually reads.

- [ ] **Step 1: Confirm the store credentials are present**

```bash
test -f .env.local && echo "env present" || echo "MISSING .env.local — pull it from Vercel before pushing"
```

Expected: `env present`

- [ ] **Step 2: Push**

```bash
npm run push:schedule
```

Expected: `Pushed schedule 2026-08-26: 38 sections, 584 sessions.`

If it prints `schedule.js is invalid — NOT pushing:`, stop. The validator and the resequencer check different things; fix the source and re-run Task 3, never bypass it.

- [ ] **Step 3: Verify the store serves the new plan**

```bash
curl -s https://id-cockpit.vercel.app/api/schedule | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const p=JSON.parse(b);console.log("version",p.version,"| sections",p.sections.length,"| sessions",p.sections.reduce((n,s)=>n+s.rows.length,0));console.log("sector 4:",p.sections[3].title);});'
```

Expected: `version 2026-08-26 | sections 38 | sessions 584` and `sector 4: Pneumonia & the Atypicals`

---

## Task 8: Deploy and verify the code path

**Files:**
- None modified.

The store push already puts the new content on his phone. This deploys the bundled fallback copy and the service-worker bump.

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Vercel, then verify what actually shipped**

```bash
curl -s https://id-cockpit.vercel.app/sw.js | grep -o 'idcockpit-web-v[0-9]*'
```

Expected: `idcockpit-web-v19`

```bash
curl -s https://id-cockpit.vercel.app/schedule.js | grep -c "Bone, Joint & Infected Hardware"
```

Expected: `1`

If either returns the old value, the deploy has not landed yet. Wait and re-run — do not treat the `git push` as proof.

- [ ] **Step 3: Tell Tyler to open the app on wifi**

---

## Rollback

Every change is content-only and reversible. To undo:

```bash
git revert --no-edit HEAD~4..HEAD && node scripts/resequence.mjs --write && npm test && npm run push:schedule && git push origin main
```

Read-state is untouched by any of this — no session id changes, so nothing is orphaned either way.
