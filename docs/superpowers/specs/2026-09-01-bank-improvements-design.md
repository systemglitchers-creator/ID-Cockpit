# Bank improvements — design

**Date:** 2026-09-01
**Status:** approved in conversation, awaiting written review
**Scope:** the Bank tab of the ID Cockpit (`8. Claude/ID Platform/`) and the
question pipeline that feeds it (`8. Claude/RC Question Bank/`).

The Bank shipped on 2026-09-01 (commits `167346c`, `4015c91`). It works, but
three things are wrong with it and one thing is missing:

1. **Most written questions reveal an empty answer box.** 2,500 of 3,498
   written placements have no Mandell draft; their documented cohort answer is
   rendered as small secondary text under a blank "Model answer" block.
2. **Stems carry source artefacts.** 221 stems open with exam numbering
   ("19. A patient…"); 851 are a bare topic or empty, with the whole question in
   the parts.
3. **Answer state is fragile.** A grade lives in memory and one POST; the
   answers map is read through the service worker's stale-while-revalidate
   cache, so it can be a launch behind.
4. **Nothing outside the tab knows drilling exists.** Finishing a chapter's
   reading does not surface its questions anywhere, so they are easy to forget.

## Decisions (do not re-litigate)

- Every written question gets a **Mandell-drafted model answer**; the cohort
  answer is kept alongside for comparison. This re-runs drafting over the 1,731
  questions that were previously counted as "answered" by their cohort answer.
- **Written stems are cleaned by the drafting worker**; original wording is
  preserved in the data. **MCQs are untouched.**
- **Offline = cache on first open.** No precache of the bundle.
- **Bank progress surfaces in three places:** a standing home-screen "To drill"
  card, the evening nudge, and a Stats block.
- **No exam-interface replica.** The Royal College is replacing the risr/assess
  interface; a standalone mockup exists in the session scratchpad only. From the
  exam we borrow three habits: marks per part, flag-and-return, and a marks-based
  summary. **No typed answers on the phone.**
- **Two plans, app first.** Plan 1 changes the app and is correct against
  today's data. Plan 2 re-runs the pipeline and redeploys data only.

---

# Part A — the app

## A1. What a written question shows

**Data contract (unchanged field names).** The app keeps rendering `question`
and `parts[].text`. The pipeline will write cleaned wording into those fields
and add `question_raw` / `parts_raw` (Part B). The app does not read the `_raw`
fields; nothing in the app depends on whether cleaning has run.

**Question card.**
- If `question` is empty or shorter than 25 characters and has no sentence
  punctuation, render it as a small uppercase topic heading above the parts
  (class `bktopic`), not as the 18-px serif stem. Otherwise render as today.
- Each part shows its mark allocation as a right-aligned pill, `1.5 marks`,
  when `marks` is non-null. The trailing "(1.5)" inside the part text is
  stripped for display only (regex `\s*\(\s*[\d.]+\s*\)\s*$`).
- The source line becomes "Asked N times · <up to 3 recurrence tags>" where N
  is `recurrence.length`, falling back to `source` when recurrence is empty.
- A flag button (⚑) sits in the card header; see A2 for storage.

**Reveal rule** (replaces the current unconditional "Model answer" block):

| model_answer | cohort_answer | primary box | secondary |
|---|---|---|---|
| present | present | "Model answer · {cites or 'Mandell'}" + text | "Prior cohort answer · {source}" + text, muted |
| present | null | same | none |
| null | present | "Documented answer · {source}" + cohort text | none |
| null | null | "No answer on file" | none |

`beyond_mandell`, `uncertain` and `cites` render as today, under the primary box.

**Grading** stays got / partial / missed for written, correct / incorrect for MCQ.

## A2. Answer state — durable, merge-only, cached locally

Mirrors the reading-progress pattern in `public/sync.js` (`Store` + `Server`).
Add an `IDAnswers` object to `sync.js` (same file, same idioms):

```
localStorage key   idcockpit.v1.answers
shape              { [cqid]: { result, ts, chosen?, flag? } }
```

- `IDAnswers.get()` → the local map (empty object when absent or unparsable).
- `IDAnswers.set(cqid, patch)` → merges `patch` into the record, stamps
  `ts = Date.now()`, saves, and calls `IDAnswers.schedule()`.
  - Grading: `{result, chosen}` (`chosen` is the MCQ letter; undefined for written).
  - Flagging: `{flag: true|false}`. A flag-only change still bumps `ts` and
    keeps the existing `result`.
- `IDAnswers.sync()` → `POST /api/answers` with `{answers: <whole local map>}`,
  `cache: "no-store"`; on 200, **replace** the local map with the response;
  on any failure resolve `false` and leave local untouched. Single in-flight
  guard, like `Server.sync`.
- `IDAnswers.schedule()` → 1,200 ms debounce to `sync()`.
- `IDAnswers.start(refresh)` → sync now, on `online`, and on `visibilitychange`
  to visible; `refresh` re-renders the Bank if it is the active tab.

**Server merge** (`api/answers.js`, `mergeAnswers`) is unchanged: newest `ts`
wins per cqid, absent keys are never deleted. The record gains optional
`chosen` and `flag`; the API stores whatever object it is given, so no
validation change is needed beyond the existing shape check.

**App wiring.**
- `bkAnswers` is replaced by `IDAnswers.get()` reads. `bankGrade` and the flag
  button call `IDAnswers.set`.
- Bank open no longer does a bare `fetch("/api/answers")`; it calls
  `IDAnswers.sync()` and renders from local either way.
- **Review misses** no longer deletes entries. It builds `bkQueue` from
  results in {missed, incorrect, partial}, sets a `bkReview = true` flag so the
  "skip already-answered" loop in `bankStart` is bypassed, and re-grading
  writes a newer `ts`. The summary after a review pass counts only that pass.

**Service worker** (`public/sw.js`): in the fetch handler, return early
(network only) for any same-origin request whose pathname starts with `/api/`.
Everything else keeps its current behaviour, which already gives
cache-on-first-open for `qbank/*.json`. Bump `CACHE`.

**Failure modes.**
- Server unreachable: local stands; rings and summaries render from local.
- Storage cleared: first sync sends `{}` and receives everything.
- Two devices: later `ts` wins per question.

## A3. Drilling as part of the loop

### The owed rule — one module, two runtimes

`lib/bank.js` (CommonJS, like `lib/plan.js`) exports pure functions used by
the nudge; `public/app.js` gets a byte-for-byte mirror of the same two functions
(the app has no module loader; `lib/nudge.js` and `compute()` already live this
way, and the tests pin parity).

```
chapterSessionIds(sections, chapterNumber) -> [sessionId]
   rows whose title matches /^Chapter\s+(\d+)/ with that number,
   in every sector.

owedChapters(sections, progress, index, answers) -> [{chapter, id, title,
   sector, remaining, total, readAt}]
   for each index chapter with weeks.length > 0:
     ids = chapterSessionIds(...); skip if ids is empty
     read = every id has progress[id].done
     ready = index cqids minus the chapter's `deferred` list
             (the index carries only an `n_deferred` count today; Plan 1
             adds `deferred: [cqid]` with a one-line change to
             `build_bundle.py` and a rebuild against current data, so the
             rule is exact from day one — Part B keeps the field)
     remaining = ready cqids with no answers[cqid].result
     owed when read && remaining > 0
   sorted by readAt (max doneAt of its sessions) descending.
```

Catch-all chapters (`weeks: []`) are never owed; they are always available but
never demanded.

### Home card

- Rendered by a new `renderDrill()` called from `renderToday()` after the quest
  card, into a new `<div id="drillCard">` placed after `#questCard`.
- Empty when nothing is owed (no placeholder, no border).
- Otherwise a card titled "To drill" listing up to three owed chapters: a
  sector-coloured dot, chapter number and title, and "N of M left". A fourth or
  later chapter collapses to "+K more".
- Tapping a row: `tab = "bank"; bankOpen(id)`. The existing Bank code then
  applies the sector accent and starts at the first ungraded ready question.
- Never blocks reading; never changes the quest card.

### Evening nudge

`lib/nudge.js` `compose(sections, progress, now, bank)` gains an optional
fourth argument `bank = { owed: [...] }` produced by `owedChapters`.

- Reading tonight **and** owed → existing message, plus one trailing line per
  owed chapter (max two, then "+K more chapters to drill"), badge = sessions +
  owed chapters.
- Nothing to read (already read today, or plan finished) **and** owed →
  `{ title: "Ready to drill", body: <lines>, badge: owed.length }`.
- Rest day → null, as today, regardless of owed.
- Nothing owed → behaviour unchanged.

`api/nudge.js` fetches `/qbank/index.json` from the host (same pattern as it
fetches `schedule.js`) and `getAnswers()` from `_kv.js`, computes `owed`, and
passes it in. If the index fetch fails, `bank` is omitted and the nudge is the
reading-only message — a bank outage must not silence the reading nudge.

### Stats block

Below the reading summary in `renderStats()`, a "Question bank" block:

- Answered / total unlocked (unlocked = chapters where `chapterRead` is true,
  plus catch-alls).
- Three-cell strip: Got · Partial · Missed (MCQ correct counts as Got).
- Marks: earned / available across answered questions, using the marks rule
  below.
- Chapters fully drilled (every ready cqid graded).
- "Flagged · N" — tapping opens a flat list in the Bank of every flagged
  question across chapters, each row opening that chapter at that question.

### Marks rule

- Written: sum of `parts[].marks`; a part with null marks counts 1. Result
  maps got → full, partial → half, missed → 0.
- MCQ: 1 mark; correct → 1, incorrect → 0.
- Chapter summary shows "14.5 of 25 marks" beside the existing tally.

## A4. Tests (node, against `public/` and `lib/`)

- `tests/js/bank-owed.test.mjs`: `owedChapters` — unread chapter not owed;
  read chapter with ungraded ready question owed; read chapter whose only
  ungraded questions are deferred not owed; catch-all never owed; chapter split
  across two weeks owed only when both sessions read; ordering by readAt;
  **parity** — `lib/bank.js` and the copy inside `app.js` give identical output
  on the same fixture.
- `tests/js/answers-local.test.mjs`: `IDAnswers` — set stamps ts and persists;
  sync replaces local with server response; failed sync leaves local intact;
  flag-only set preserves result.
- `tests/js/answers-api.test.mjs`: existing four tests plus "record with
  chosen and flag round-trips".
- `tests/js/nudge.test.mjs`: "read tonight and owed" appends lines and badge;
  "read today, owed" fires drill-only; "rest day, owed" is null; "nothing owed"
  unchanged.
- `tests/js/bank-marks.test.mjs`: marks arithmetic for written and MCQ, null
  marks default.
- Service worker: a test that loads `sw.js` in the sandbox and asserts the
  fetch handler does not call `respondWith` for `/api/answers`.
- Rendering (card, reveal rule, drill card, stats block) verified by browser
  screenshot and a clean console, per the repo's existing practice.

## A5. Ship

Standard path from the id-cockpit skill: edit `public/`, tests green, bump
`CACHE` in `sw.js`, commit to `main`, verify with `curl` that the deployed
`app.js` contains the change and `sw.js` carries the new cache name.

---

# Part B — the pipeline

Workspace `8. Claude/RC Question Bank/` (not a git repo; log every task in
`data/PIPELINE_LOG.md`).

## B1. Drafting scope

Every written question in `data/questions_mapped.jsonl` (2,395), including the
1,731 that carry a `cohort_answer`. MCQs are skipped.

## B2. Batching

- Group by `primary_chapter`; one batch per chapter, split at 12 questions.
- Chapter text from `data/mandell_pages/<id>.txt` (the corrected, folio-indexed
  extraction; 208 chapters). Chapters with no pagefile (catch-alls and the 33
  unmatched) are drafted from established knowledge with `cites: null` — never
  an invented page.
- Pagefiles over ~120 KB are chunked; the worker gets the chunk(s) most
  relevant to its questions (keyword overlap on stem + parts), and the whole
  file when in doubt. Log the chunking decision per batch.
- Batch files `data/draft_batches/d###.json` keep today's shape; results in
  `data/draft_results/d###.json`. **Existing 664 results are re-drafted too**,
  so the whole set is produced under one prompt and one rule.
- Resumable: `data/draft_missing.txt` lists batches without a result; a run
  starts from that list. Rate-limit deaths lose nothing.

## B3. Worker output schema

```json
{"answers":[{
  "cqid": "Q0419",
  "question_clean": "A patient presents with abdominal pain and bloody diarrhea and is diagnosed with E. coli O157.",
  "parts_clean": ["What is the pathogenesis of this infection?", "..."],
  "model_answer": "a) ... (1) ... (2) ... b) ...",
  "cites": "Mandell pp. 1246–1249" ,
  "beyond_mandell": null,
  "uncertain": false,
  "cohort_conflict": null
}]}
```

Prompt rules (extend the Task 8 prompt):
- Clean the stem and parts: drop leading numbering and "A)/B)" labels, expand a
  bare topic into one prompt sentence, keep every clinical detail and every
  count ("three", "4"), keep the mark allocation out of the text (it lives in
  `marks`). `parts_clean.length` must equal `parts.length`.
- Mirror the mark allocation: "(1.5)" asking for three items gets exactly three
  numbered points.
- Ground every point in the supplied text; cite as book pages; never invent a
  citation; `cites: null` when the text was absent.
- Where a `cohort_answer` is supplied and substantively disagrees, resolve
  against Mandell and put one sentence in `cohort_conflict`
  ("Cohort answer lists X; Mandell pp. Y supports Z").
- `uncertain: true` when the worker could not ground the core of the answer.

## B4. Quality checkpoint (before mass production)

Draft three chapters (one high-yield, one niche, one catch-all) and show Tyler
three answers side by side with their cohort answers. Mass production starts
only on his go-ahead. Afterwards, sample 10 across 5 chapters and log it.

## B5. Bundle

`scripts/build_bundle.py`:
- Written records: `question` ← `question_clean` (fallback: raw with leading
  numbering stripped by `^\s*\d+[\.\)]\s*`), `parts[].text` ← `parts_clean[i]`,
  plus `question_raw`, `parts_raw`, `cohort_conflict`.
- `index.json` chapters keep the `deferred: [cqid]` list introduced in Plan 1
  (alongside the existing `n_deferred` count).
- Assert before writing: every written cqid has a `model_answer`;
  `parts_clean` lengths match; no `question` starts with a digit-dot.
- Print the coverage line and stop with non-zero exit on any assertion.

## B6. Deploy

Data only. Commit `public/qbank/*.json` to `main`; Vercel serves them with
`max-age=0, must-revalidate`, and the service worker refreshes a chapter file
in the background on next open. No `CACHE` bump is required for data, but bump
it anyway so the refreshed index is picked up on the first launch rather than
the second.

---

## Out of scope

- Typed answers, timers, or an exam-layout mode (mockup retained in scratchpad
  only; the data model supports it if wanted later).
- Spaced repetition, cross-chapter shuffles, timed blocks.
- MM Micro content.
- Any change to the reading schedule, catch-up maths, or `/api/progress`.
