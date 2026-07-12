# Royal College ID Practice-Question Format (reference)

Derived by sampling the exam corpus under
`1. Fellowship/Bzura Folder/RC prep/ID RC prep/` across ~2011–2024, both
collections (C and H) and both formats (reveal-style `.pptx`, `.docx`). This is
the format contract the SP3 questions-generator must reproduce. It is **format
only** — content grounding is governed separately (strict source-fidelity:
questions test only what Tyler has read/carded, mirroring the id-anki-cards rule).

The ~180 `KB`/`TG` "Review Deck" files and the `Working Folder`/`Copy of`
duplicates were excluded — they are topic-summary study decks and repeats, not
exam-question format.

---

## Anatomy of a question

Every question has three parts:

1. **Stem** — one of three flavors:
   - *Clinical vignette*: age, presentation, exposure/travel, labs, imaging.
     e.g. "25 yo, 3rd trimester, returned 10 days ago from archeological digging
     in Northern Mexico, cough and fever, RLL consolidation + right hilar
     adenopathy, eosinophilia."
   - *Topic prompt*: a named subject with no patient.
     e.g. "Antibiotic stewardship program (ASP)…", "Oral to PO bioavailability…".
   - *Micro/lab stem*: a susceptibility table, an ovum/blood-smear image, or an
     organism with a resistance phenotype.
     e.g. "Aeromonas hydrophila with the following susceptibilities… carbapenemase
     inactivated by EDTA."

2. **Sequential sub-questions**, each demanding an **explicit count**:
   "Name 3…", "List 4…", "What are 6…". The number is load-bearing and must
   match the number of answer items.

3. **Mark weighting** in parentheses after each sub-question: `(1)`, `(1.5)`,
   `(2)`, `(3)`, `(5)` — roughly 0.5 marks per expected item. Present on nearly
   all `.pptx` exams; sometimes omitted on older MB `.docx` versions.

**Model answers** are terse counted lists — exactly the requested number of
items, occasionally with a one-line mechanism or qualifier appended.

---

## Recurring archetypes

- **Micro / lab** — resistance mechanisms (Ambler classes, porin loss, efflux),
  MALDI/molecular methods, organism ID from smear/ovum/phenotype, CLSI breakpoints.
- **Clinical syndrome** — vignette → diagnosis → stage → investigations →
  treatment → complications.
- **Pharmacology** — MOA, resistance mechanism, spectrum of activity,
  toxicities, monitoring, drug–drug interactions, oral bioavailability/IV-to-PO.
- **Public health / IPAC / ASP** — outbreak interventions (MRSA, Legionella,
  Zika), persuasive vs restrictive stewardship, transmission prevention.
- **Vaccines / immunology** — NACI recommendations, AEFI reporting, vaccination
  of the immunocompromised, biologics and their associated infections.
- **Travel / parasitology / tropical** — malaria prophylaxis and severe-malaria
  criteria, echinococcus, chikungunya, schistosomiasis.
- **Peds variants** — same archetypes reframed for children (discitis, neonatal
  HSV, congenital TB, Kawasaki).

---

## Style quirks to encode

- **Guideline anchoring** — questions frequently cite a named body and expect
  that source's exact list: "according to PHAC", "Based on IDSA guidelines",
  "per NACI". The requested count usually matches the guideline's enumeration.
- **Year tags** — real exams sometimes annotate when a question was asked
  ("(2014; 2016; 2019)") and mark "REPEAT" or adult-vs-peds variants. Generated
  questions need not fabricate these.
- **Tables** — fill-in grids appear regularly: virus RNA/DNA + enveloped +
  antiviral; primary-immunodeficiency gene/mechanism; drug ↔ side-effect matching.
- **Images** — stems reference visuals ("you are shown a picture of his blood
  smear", an ovum from ERCP). Text-only generation should describe the finding
  in words instead of embedding an image.

---

## Presentation formats observed

- **Reveal-style `.pptx`** (AB and H exams): stem-only slide, then slides that
  reveal model answers progressively. This is the natural template for the SP4
  self-test/quiz mode.
- **`.docx`**: either combined question + model answer inline, or split into
  separate "Qs" and "As" files.

---

## Implications for SP3 (the generator)

- Output must carry: the stem, an ordered list of sub-questions each with its
  required count and mark value, and a counted model-answer list per
  sub-question — enough structure to render either an inline Q+A doc or a
  reveal-style quiz (SP4).
- Honor the explicit-count discipline: if a sub-question says "Name 3", the model
  answer has exactly 3 items, each grounded in Tyler's source material.
- Prefer the archetypes above so generated questions feel like the real exam.
- When Tyler's carded content maps to a guideline-anchored fact, phrase the
  sub-question in the "according to <body>" style where appropriate.
