# Mandell Schedule Redesign — 2026-08-14

Full resequencing of the 584-session reading plan, plus a rebase that erases
the 7-session deficit as of 2026-08-14. Session ids never change; progress in
Redis is untouched. Pure `schedule.js` content change — shipped with
`npm run push:schedule`, no deploy.

## Why

Tyler flagged two problems mid-Staph-aureus (part 3 of 6):

1. **Monotony.** Eleven chapters ran 4–7 consecutive days (Staph ×6,
   Endocarditis ×6, Immunizations ×7…). Week 18 was seven straight days of
   pure pharmacology. 79% of the plan already varied every 1–3 days; the
   pain was concentrated in these slogs.
2. **Split topics.** Acute Pneumonia wk 7 vs Chronic Pneumonia wk ~54; acute
   vs chronic meningitis 40 weeks apart; NVE vs PVE 46 weeks apart; the Y1
   UTI sector's own subtitle promised STI syndromes it did not contain. The
   Y2 back half was taxonomy bins ("Remaining Viruses", 40 sessions), which
   he rejected explicitly: niche content dumped at the end of Y2 is not a
   solution.

## Design principles

1. **Braid rule.** No chapter runs more than 3 consecutive unread sessions.
   Braid partners always share a theme — vary the chapter, keep the theme
   (CoNS inside Staph; MAC and the TB drugs inside TB; Hep B inside Hep C;
   travel chapters inside Immunizations). Filler braids are worse than
   monotony; none are used.
2. **Flagship first, drugs behind.** The syndrome or organism chapter that
   motivates a drug class comes before it (Acute Pneumonia before macrolides;
   Candida before the antifungals; malaria before the antimalarials).
3. **Complications live with their parents.** Empyema joins pneumonia; PVE,
   CV-device infections and mediastinitis follow the staphylococci (an
   ~8-week spaced return to endocarditis, read in July); subdural
   empyema/shunt infections join CNS; peritonitis + liver/biliary join GI;
   urethritis/vulvovaginitis/PID/prostatitis/anogenital
   lesions/trichomonas/Chlamydia make the GU sector the STI arc its subtitle
   always promised. Legionella joins the pneumonia sector.
4. **Capstones after their prerequisites.** Chronic Pneumonia and Chronic
   Meningitis are TB/NTM/fungal/Nocardia differentials — they now sit
   directly after the mycobacterial and fungal sectors as the payoff for
   that whole arc. Coccidioidomycosis moves into Y1 fungal (completing the
   endemic trio) and Nocardia/Actinomyces into Y1 mycobacterial (as that
   sector's subtitle already claimed) so the capstone's prerequisites are
   actually complete.
5. **Year 2 is arcs, not bins.** Exposure- and presentation-themed:
   Undifferentiated Patient, Head/Neck/Eye, Enteric & Foodborne, Tick-Borne
   & Rickettsial, Zoonoses & Animal Contact, Arboviruses & VHF, Tropical &
   Helminths, then small completion sectors, then the untouched exam tail.
6. **Year balance.** Pulls into Y1 are offset by demotions to Y2 (phage
   therapy, topical antibacterials, pipeline antibiotics, disinfection,
   study design → "Stewardship Systems & Future Therapeutics"; the
   Zoonoses+Climate bundle opens the Y2 Zoonoses arc). HIV starts ~2 weeks
   later than the old plan (a conscious trade, noted below) and moves
   **before** the fungal sector — TB → HIV → fungi → capstone is the
   immunocompromise spine, and the deep fungal chapters now land right
   after the HIV OI chapter introduces them.

## The rebase — "I don't want to be behind"

The app computes `makeup = remaining − (planEnd − k0 + 1)` where `planEnd`
is the max `gi` in `schedule.js`. The deficit is erased in the data:

- Unread sessions get `gi = 50 + queue position` (study-day 50 =
  **Sun 2026-08-16**, the first study day after the rebase; Sat 08-15 is
  flex). Max `gi` = **591**.
- Read sessions get `gi` 0..41 in new-plan order — clean history.
- Effect on 2026-08-14: makeup 0 ("On plan"), one session/day. The projected
  finish slides ~8 study days, from ~Apr 28 to **Mon 2028-05-08**, taper
  intact. `CATCHUP_FROM` (2026-08-23) is untouched: any *future* slip still
  triggers doubling immediately, packing to day 591.
- No app.js change, no service-worker bump, no deploy.

Progress source of truth confirmed before rebasing: server (`cockpit:progress`)
holds exactly 42 done sessions (latest doneAt 2026-08-10), nothing unsynced.

## Spaced-return and conscious trade-offs

- PVE arrives ~6 sessions after today — ~8 weeks after ch82 was read: a
  deliberate spaced return, not a reunification for its own sake.
- FUO/fever-and-rash stay in Y2 (Undifferentiated Patient): integration
  chapters reward broad differentials. Deliberate.
- HIV begins ~early Mar 2027 (~4 weeks later than the old plan — the cost
  of influenza/RSV/FUO arriving in time for the first winter) — still late
  for a fellow; moving it earlier would
  displace the equally service-critical GN/resistance spine mid-flight.
  Longitudinal HIV clinic + Anki carry the gap. Decision, not oversight.
- Bundled sessions cannot be split (ids are immutable): ch170 (Rabies +
  Ebola/Marburg) bridges Zoonoses→VHF; ch174 carries HTLV into the VHF arc;
  ch181/ch155 put rhinovirus/coltiviruses in the Enteric arc; ch213 carries
  Whipple into Zoonoses; ch187 carries C. pneumoniae into Zoonoses. Best-fit
  placements, accepted.

## Final structure (36 sectors; braid seams shown by order)

Year 1: Drug Foundations (read) · Foundations & Sepsis (ch75 read → **FUO
×2, first in queue** — day-one consult material, pulled from Y2) ·
Endovascular & Staphylococci (…Staph 4 → CoNS 1 → Staph 5–6 → CoNS 2 →
PVE ×3 → CV devices ×3) · Pneumonia & Respiratory
(Acute Pna ×3 → Macrolides ×2 → HAP ×2 → Legionella ×2 → Quinolones ×2 →
Pneumococcus ×3 → drug finishers → Lung Abscess → Empyema ×2 → URT →
RSV ×2 → Paraflu → hMPV → **Influenza ×3 → flu antivirals ×2** — the whole
viral respiratory block lands ~Oct 2026, before his first winter, instead
of Apr–Aug 2027) ·
CNS (Approach → Meningitis 1–3 → Listeria → Meningitis 4–5 → Encephalitis
×3 → Brain Abscess ×2 → Subdural ×2 → Shunts ×2 → Meningococcus ×3) ·
GU & STI (UTI ×3 → TMP-SMX → CAUTI ×2 → TMP-SMX → urinary agents →
Urethritis → Vulvovaginitis ×2 → PID/Prostatitis ×3 → Anogenital ×2 →
Trichomonas → Chlamydia ×3) · Skin/Bone/Joint (Cellulitis ×3 → Myositis ×2
→ Hyperbaric → GAS ×3 → [septic arthritis, read] → Osteo ×2 → Rif/Metro ×3
→ [implants, read]) · GI & Intra-Abdominal (syndromes → C. diff ×3 →
Peritonitis ×3 → Liver/Biliary ×2 → organ bundle ×3 → anaerobes) ·
Enterococci & Streptococci · Gram-Negatives & Resistance (Enterobacterales
×3 → Tetracyclines ×2 → Pseudomonas ×2 → Polymyxins/Linezolid ×2 →
Acinetobacter → Tetracyclines 3 → [Salmonella, read] → Haemophilus ×2 →
Gonorrhea ×3) · Spirochetes (Lyme ×2 → Syphilis 1–2 → Relapsing Fever →
Syphilis 3–4 → Endemic Treponematoses) · Wounds/Bites/Toxins ·
Mycobacteria, Nocardia & Actinomyces (TB 1–3 → drugs → TB 4–5 → drugs →
MAC ×2 → NTM → Nocardia ×2 → Actinomyces ×2) · HIV Medicine · Invasive
Fungal (Intro → Candida ×3 → drugs → Aspergillus ×2 → drugs → Crypto ×3 →
drugs → PJP ×3 → Histo ×2 → Blasto ×2 → Cocci ×2 → Mucor ×2) · **Chronic
Syndromes — The Capstone** (Chronic Pna ×2 → Chronic Meningitis) ·
Herpesviruses & Exanthems (HSV ×3 → antiviral principles → VZV → CMV ×3 →
**herpes antivirals ×2** → EBV ×3 → herpes antivirals 3 → exanthems — ch47
and ch49 pulled from the Y2 hepatitis arc, where both reviewers flagged
them as orphaned) · Malaria, Toxo & Amebiasis ·
Immunization & Travel (Principles → Imms 1–2 → Travel ×2 → Imms 3–4 →
Returning ×2 → Imms 5–7) · Prevention & Stewardship.

Year 2: Immunocompromised & Transplant (immunomodulators braided) · HIV &
COVID — Completing (SARS/MERS closes the coronavirus family) · Viral
Hepatitis (HBV ×3 → HCV 1–3 → HDV → HCV 4–5 → HAV ×3 → HEV → hep
antivirals — influenza and the herpes antivirals moved out, leaving a clean
hepatitis arc) · The
Undifferentiated Patient · Head, Neck & Eye (deep-neck →
mediastinitis ×2 moved here; Pertussis with the cough
syndromes, Stenotrophomonas beside CF) · Enteric & Foodborne (Yersinia
enterocolitica beside Campylobacter/Shigella) · Tick-Borne &
Rickettsial (mites/ticks braided around Babesia) · Zoonoses & Animal
Contact (opens with the Zoonoses bundle braided) · Arboviruses & VHF ·
Tropical Medicine & Helminths (drug chapters braided) · Fungal completion ·
Viral Foundations & Completion · Bacteria — Completing · Stewardship
Systems & Future Therapeutics · Consolidation & Guideline Review ·
Practice Questions & Final Review.

## Mechanics

- `scripts/redesign-2026-08-structure.mjs` — the complete order, one entry
  per sector, ids listed explicitly. This file *is* the reviewable design.
- `scripts/resequence.mjs` — regenerates `public/schedule.js`; refuses to
  write unless: all 584 ids present exactly once; r/g/pp/ps/pe identical
  per id; no 4+ same-chapter runs in the unread queue; planEnd = 591.
  Regenerates num/gi/wk/fow and per-sector date ranges in `sub`.
- Tests: 79/79 pass. Catch-up fixtures updated from `behind(38)`→
  `behind(30)` etc. — planEnd moved 583→591, so the same 6-session-debt
  scenarios need 8 fewer read sessions; the assertions themselves are
  unchanged (grace date still Sun Aug 23, doubles-never-triples, order
  preserved).
- Ship: commit, `npm run push:schedule`, verify `GET /api/schedule` serves
  the new order. No CACHE bump needed (no app-code change).

## Adversarial verification (2026-08-14)

Four independent agents audited the built schedule before shipping.

**Clean:** data audit (all 584 ids identical to HEAD in r/g/pp/ps/pe, no
losses/inventions/duplicates, nulls preserved, max unread run 3); app-math
audit via the real harness (makeup 0 and drift ≤ 0 on Aug 14/15/16; a
simulated September slip still triggers immediate doubling — catch-up
armed; no session ever lands on a flex Saturday; 79/79 tests).

**Fixed from reviewer findings:** ch47/ch49 herpes antivirals braided into
the Y1 herpes sector (were orphaned in the hepatitis arc — flagged
independently by both reviewers); viral respiratory block + influenza
moved to Y1 before the first winter (were Apr–Aug 2027); FUO pulled to
Foundations & Sepsis (day-one consult material, was Sep 2027); Yersinia
enterocolitica to the Enteric arc (taxonomy-bin residue); SARS/MERS joined
the COVID arc; mediastinitis to Head & Neck (counterweight); Lyme added to
the guideline-review row and FUO/fever-and-rash to a re-read row (exam-tail
gaps — the only session-title edits, ids unchanged).

**Dismissed with reasons:** ch82 ×6 / Staph p1–p4 runs and the
drugs-before-disease opening of the Endovascular sector — already-read
history, not rebraidable; gi 42–49 "missing" — the rebase gap by design;
odd wk labels on read rows — wk/fow are rendered nowhere in the app.

**Accepted costs (noted, not fixed):** linezolid and metronidazole ride
page-contiguous bundles whose other half fits the placement; ch108
anogenital lesions precedes its organisms (syndrome-first pattern);
ch213-p2 opens "Part 2 of 2" long after its read first half (bundle,
immovable); febrile neutropenia stays in the Y2 transplant arc.

## Success criteria

- App shows **On plan** (makeup 0) on 2026-08-14/16 with the 42 read
  sessions; the queue opens FUO ×2 → Staph part 4 → CoNS part 1.
- Zero 4+-day same-chapter runs in the unread queue (validated at
  generation, by test, and by independent audit).
- Adherence: ≥7 sessions/week sustained over the next 4 weeks — check via
  the app's doneAt data at the September check-in.
