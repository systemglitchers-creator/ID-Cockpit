# Refinement — Per-Session Generation + Question PDF Export — Design

**Status:** approved for planning · 2026-07-13

Refines the working SP2/SP3 platform after real use. Three parts; part 1 is done.

## 1. De-lag the Skill Tree (DONE — commit 22a3beb)

The lag was 100% client-side rendering (server serves in <1 ms). Removed the
`mix-blend-mode` film-grain overlay, `backdrop-filter` blur on the HUD and scrim,
the infinite XP shimmer, and the per-frame animated glow on the active node. Kept
one cheap halo ring. Look preserved, jank gone.

## 2. Per-session generation (not per-chapter)

**Why:** the real workflow is per *reading session* — read one page range (e.g.
Ch 82 pp. 1012–1017), highlight it, and generate from *that* reading, not the
whole chapter.

**Change:** the **✦ Generate cards** / **✦ Generate questions** actions move from
the per-chapter `.chapgen` bar onto **each session row** (`.q`). Each carries the
session id (e.g. `ch82-p2`), chapter number, title, and page range.

**Keying & storage:**
- **Source PDF** is retained per session: `queue/source/<sessionId>.pdf` (was
  `<NN>.pdf`). Questions reuse the *same session's* PDF (no re-drop).
- **Cards**: drafted from that session's PDF highlights, still tagged
  `Chapter::<NN>` (so they file correctly in Anki), pushed after review, and the
  durable JSON appended to `ID Anki Cards/<NN - Title>/<date>.json`. Multiple
  sessions of one chapter accumulate in the same chapter folder.
- **Questions**: grounded in that session's PDF highlights **plus** the chapter's
  existing cards (alignment), saved to
  `ID Practice Questions/<NN - Title>/<sessionId>.json`.
- **Badges** stay **chapter-level totals** (◆ cards, ● questions) via
  `scan_counts`, so the tree still shows chapter progress at a glance.

**Precheck** becomes per-session: for questions, `hasCards` (chapter has any
cards) and `hasPdf` (this session's source PDF exists). Cards generation just
needs a dropped PDF.

**Impact:** `_ingest_upload` / questions `ingest` key by `sessionId` instead of
`nn`; endpoints pass `sessionId`; the dashboard renders generate controls per
row. Anki tagging and chapter-folder output are unchanged.

## 3. Question export → clean RC-exam PDF

**What:** an **⬇ Export PDF** action on a chapter (compiling all its saved
questions) produces a print-ready PDF styled like a real Royal College exam:
- Header: chapter number + title, date.
- **Questions section**: numbered questions; each shows the stem, then its
  sub-questions as `(marks)` + prompt with blank space to answer.
- **Answer key section** (new page): the same numbering with the model-answer
  lists — mirroring the real "Qs / As" split so it doubles as self-test.

**How:** a new `export_pdf.py` builds the PDF from a chapter's questions JSON
using **PyMuPDF (`fitz`)** — already a dependency (used for highlight
extraction), so no new install and it works offline. `fitz` supports multi-page
layout and `insert_textbox` (word-wrapping within a rect), enough for a clean
exam sheet. New endpoint `GET /api/questions/export?nn=&title=` streams
`application/pdf` (a download); the dashboard button hits it and the browser
saves the file. The PDF is also written to
`ID Practice Questions/<NN - Title>/<NN> practice questions.pdf` for a durable copy.

**Content fidelity:** export is a pure transform of already-saved questions — no
AI call, no cost, deterministic.

## Testing

- `cards_core`/`questions_core`: session-keyed source PDF + ingest (job carries
  `sessionId`; source at `queue/source/<sessionId>.pdf`); existing chapter-folder
  output unchanged. Update tests that assumed `<NN>.pdf` keying.
- `export_pdf`: build a PDF from a fixture questions JSON; assert a non-empty
  PDF (`%PDF` header) and that stems/answers appear in the extracted text.
- `serve.py`: `/api/questions/export` returns `application/pdf`; generate
  endpoints accept `sessionId`.
- Browser: per-row generate controls render; export downloads a PDF.

## Scope boundary

Refinement only — reuses the SP2/SP3 engine, worker, and review trays. No change
to the AI drafting, Anki push, or the (already-fixed) rendering. SP4 (quiz mode)
still separate.
