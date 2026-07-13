# SP3 — In-App Practice-Question Generation — Design

**Status:** approved for planning · 2026-07-12

## Goal

From a chapter in the cockpit, generate Royal-College-format practice questions
grounded in **your Anki cards for that chapter plus the chapter's highlighted
PDF**, review them in-app, and save them to `ID Practice Questions/<NN - Title>/`
so the ● badge lights up. Reuses the SP2 headless-Claude engine, the queue/job
pattern, and the format contract in `docs/rc-question-format.md`. No Anki push —
questions are a study artifact (SP4's quiz mode will read them).

## Non-goals

- SP4 self-test/quiz UI (separate slice; it consumes the JSON this produces).
- New card-writing or new AI-engine plumbing — `ai_engine.draft` is reused as-is.
- Fabricating exam year-tags / images (the format doc says not to).

## Flow (one click after cards exist)

1. A chapter's row in the sector panel gains a second button: **✦ Generate
   questions** (beside ✦ Generate cards).
2. On click the server checks two things for that chapter (NN + title):
   - **Cards exist?** — is there a `ID Anki Cards/<NN - Title>/*.json`? If not,
     the UI nudges "generate cards first" (grounding needs them).
   - **Source PDF available?** — is there a retained `queue/source/<NN>.pdf`
     (stashed when you generated cards from that chapter's PDF)? If yes, draft
     immediately — **no upload**. If not, open the dropzone to get one.
3. The server loads that chapter's **card JSON** (all cards across its dated
   files) and extracts **highlights** from the source PDF, builds an RC-format
   prompt from both, and drafts via the shared headless-Claude engine.
4. A **question review tray** appears (auto-refresh, like cards). You edit /
   approve / delete.
5. **Save approved** → written to `ID Practice Questions/<NN - Title>/<YYYY-MM-DD>.json`;
   the ● badge updates live. No AnkiConnect.

**Grounding is strict source-fidelity:** every fact in a stem or model answer
must come from your cards or the PDF highlights — never outside knowledge —
mirroring the id-anki-cards rule.

## Question schema

Stored under a top-level `questions` list so `platform_core.scan_counts` counts
them (it counts `len(obj["questions"])`):
```json
{
  "questions": [
    {
      "stem": "A 25-year-old in the 3rd trimester returns from archaeological digging in N. Mexico with cough, fever, RLL consolidation, hilar adenopathy, and eosinophilia.",
      "archetype": "clinical",
      "subquestions": [
        { "prompt": "What is the most likely diagnosis?", "count": 1, "marks": 1,
          "answer": ["Pulmonary coccidioidomycosis"] },
        { "prompt": "Name 3 risk factors for dissemination.", "count": 3, "marks": 1.5,
          "answer": ["3rd-trimester pregnancy", "cellular immune deficiency", "certain ethnic backgrounds"] }
      ]
    }
  ]
}
```
`archetype` ∈ `clinical | micro | pharm | public-health | vaccine | travel | peds`.
The prompt enforces: explicit counts that equal the answer-list length, mark
weighting (~0.5/item), guideline-anchoring ("according to IDSA/PHAC/NACI") where
a carded fact maps to a named body, and the recurring archetypes from the format
doc so questions feel like the real exam.

## Architecture & reuse

- **`ai_engine.py`** — reused. Add `parse_questions(raw)` beside `parse_cards`:
  tolerant JSON extraction into the schema above, coercing/validating that each
  sub-question's `answer` length equals its `count` (drop or flag mismatches),
  raising `BadDraftOutput(raw=…)` when unusable.
- **Shared job lifecycle (B1 refactor)** — the SP2 queue helpers
  (`ensure_queue / create_job / load_job / set_status / list_jobs / _job_path /
  _find_job_file`) gain a **`kind`** dimension so cards and questions occupy
  separate namespaces: `queue/cards/{pending,drafts,done}` and
  `queue/questions/{…}`. This is a small, safe change to the just-shipped card
  code (the `queue/` tree is git-ignored, ephemeral scratch — no persisted data
  to migrate). Cards pass `kind="cards"`; questions pass `kind="questions"`.
- **Source-PDF retention** — `cards_core` card ingest additionally copies the
  uploaded PDF to `queue/source/<NN>.pdf` (overwrite per chapter), so questions
  can reuse it without a re-upload.
- **`questions_core.py`** (new) — mirrors the card pipeline for questions:
  `load_chapter_cards(base, nn, title)` (reads `ID Anki Cards/<NN - Title>/*.json`,
  concatenates all `cards`), `source_pdf(base, nn)` (locate `queue/source/<NN>.pdf`),
  `build_qprompt(nn, title, cards, highlights, rc_format)`, `process_job`
  (draft → `parse_questions` → `drafted`), and **`save(base, job, approved)`**
  (write `ID Practice Questions/<NN - Title>/<date>.json`, status `saved`). PDF
  extraction reuses `cards_core.extract`; config reuses `cards_core.load_config`.
- **Background worker** — the existing single worker dispatches by job **kind**:
  it enqueues `(kind, job_id)` and routes to `cards_core.process_job` or
  `questions_core.process_job`. The headless-Claude call is shared; only the
  prompt-build and parse differ per kind.
- **Endpoints** (serve.py) mirror cards:
  `POST /api/questions/generate` (body: nn, title — no file when a source PDF
  exists; multipart/raw PDF only in the fallback), `GET /api/questions/jobs`,
  `GET /api/questions/job/{id}`, `POST /api/questions/job/{id}/save`,
  `/discard`, `/retry`. `GET /api/questions/precheck?nn=&title=` reports
  `{hasCards, hasPdf}` so the button can decide: draft now, ask for a PDF, or
  nudge to make cards.

## Review tray (questions)

Distinct from the card tray. Each question renders: an editable **stem**
(textarea), an **archetype** tag, then each sub-question as an editable
**prompt** + **marks** with a **counted model-answer list** (one editable line
per item, add/remove line). Per-question **approve / delete**; footer **Save
approved (N)**. On save, the ● badge and the sector panel refresh.

## Error handling

| Situation | Behavior |
|---|---|
| No cards for the chapter | Precheck `hasCards:false`; button nudges "generate cards first"; no draft |
| No source PDF and none uploaded | Precheck `hasPdf:false`; open dropzone; draft only after a PDF arrives |
| Claude drafting fails / bad output | Job `error` with message + `rawOutput`; **Retry** re-enqueues (same as cards) |
| Answer count ≠ stated count | `parse_questions` trims/flags per sub-question; never saves a mismatched list silently |
| AI drafting not enabled | Reuses the SP2 `config` gate; button shows the "Enable AI drafting" nudge |

## Testing

- `ai_engine.parse_questions`: schema extraction, code-fence/prose tolerance,
  count-vs-answer-length enforcement, `BadDraftOutput.raw` on failure.
- `questions_core`: job lifecycle under `queue/questions/`; `load_chapter_cards`
  concatenates multiple dated files; `build_qprompt` includes cards + highlights
  + format rules; `process_job` drafts via a **stubbed** drafter; `save` writes
  `ID Practice Questions/<NN - Title>/<date>.json` (parent = artifact root, same
  base-dir discipline as cards) and sets status `saved`.
- `cards_core`: the `kind` refactor keeps all existing card tests green (now
  under `queue/cards/`); source-PDF retention writes `queue/source/<NN>.pdf`.
- `serve.py`: `/api/questions/*` over real HTTP with a stub drafter, a fixture
  chapter-cards file, and a fixture source PDF; worker dispatch by kind.
- No test calls the real CLI or network.

## Scope boundary

SP3 ships questions end-to-end (grounded in cards + reused PDF) plus
`parse_questions` and the `kind`-namespaced job core. The only edits to shipped
SP2 code are: the queue `kind` namespace (cards move to `queue/cards/`), source-
PDF retention on card ingest, and the worker's kind dispatch. SP4 (quiz/self-test
that reads `ID Practice Questions/`) remains separate.
