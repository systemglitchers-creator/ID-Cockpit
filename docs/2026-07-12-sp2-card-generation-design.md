# SP2 — In-App Card Generation (node-centric, headless-Claude) — Design

**Status:** approved for planning · 2026-07-12

## Goal

From the Skill Tree cockpit, generating Anki cards for a chapter is one seamless
flow with no second window and no pasting: open a sector, drop the chapter's
highlighted PDF, and the dashboard drafts cloze cards by itself, shows them for
review, and pushes the approved ones into Anki — updating the ◆ badge live. The
same engine will later power practice-question generation (SP3) from the same
node, which is why the AI engine is built to be shared.

**Cost/UX constraint (decided with the user):** drafting runs on the user's
existing Claude subscription via the headless Claude CLI (`claude -p`) invoked
by the server — no metered API billing, no background loop the user must keep
running. The only remaining wall is a one-time CLI install + login.

## Non-goals

- Practice-question generation (SP3) — separate slice; reuses `ai_engine`.
- Changing card *style* — drafting reuses the existing `id-anki-cards`
  `STYLE_GUIDE.md` + `examples.md` verbatim as grounding.
- Multi-user, auth, remote hosting. Single user, localhost.

## Generation is keyed to a chapter

Anki cards are per-chapter (tag `Chapter::NN::Title`), but a sector node
contains many session-rows, and one chapter spans several rows (e.g. "Chapter 29
· Part 1/2/3"). So the generate affordance is surfaced **per chapter** inside the
sector panel: rows are visually grouped by chapter, and each chapter group has a
**✦ Generate cards** control. The chapter number and title are parsed from the
row text (`chapNum`, `cleanTitle`, already in the dashboard). One uploaded PDF =
one chapter's highlights = one job tagged to that chapter.

## Architecture

Three new server-side units plus dashboard UI. `serve.py` stays thin (routing
only); all logic lives in focused modules.

### 1. `ai_engine.py` — shared headless-Claude drafting service
- `draft(prompt, *, timeout, model=None, claude_path) -> str` — invokes
  `claude -p <prompt>` as a subprocess (adding `--model <model>` only if a model
  is configured; otherwise the CLI's own subscription default is used, which
  avoids hardcoding a model ID that could go stale). Returns stdout. No tools are
  granted to Claude (pure text-in/text-out), so there are no permission prompts.
  Raises typed errors: `EngineNotConfigured` (binary missing/unauthed),
  `EngineTimeout`, `EngineFailed`.
- `parse_cards(raw) -> list[{"Text","Extra"}]` — extracts the JSON array from
  Claude's output tolerantly (handles code fences / surrounding prose), raises
  `BadDraftOutput` if no valid array is found.
- Config comes from `config.json` (see below). This module is the ONLY place
  that shells out to Claude; cards and questions both call it.

### 2. `cards_core.py` — the card pipeline (pure-ish, unit-testable)
- `save_upload(pdf_bytes, job_id) -> path` — writes the PDF to
  `queue/incoming/<job>.pdf`.
- `extract(pdf_path) -> list[{"highlight","context"}]` — auto-scans the whole
  PDF via the existing `extract_highlights.py` logic (imported, not shelled),
  over pages 1..N. Returns highlight+context pairs. Empty list is a valid,
  reported outcome ("no highlights found").
- `build_prompt(chapter, highlights, style_guide, examples) -> str` — assembles
  the drafting prompt: STYLE_GUIDE + examples + the highlights/context + chapter
  meta + "output ONLY a JSON array of {Text, Extra} cards, grounded solely in
  these highlights."
- Job lifecycle over `queue/` folders, each job a JSON file:
  `pending` (extracted, awaiting draft) → `drafting` → `drafted` (cards ready to
  review) → `pushed` (in Anki) | `error` (with message + raw output kept).
  Helpers: `create_job`, `load_job`, `set_status`, `list_jobs`.
- `push(job, approved_cards) -> {added, skipped}` — derives the tag
  `Chapter::NN::Title`, calls the existing `add_cards.py` push (AnkiConnect) into
  deck `Infectious Disease::Mandell`, writes the durable record to
  `8. Claude/ID Anki Cards/<NN - Title>/<YYYY-MM-DD>.json`, moves job to `done`.
  If AnkiConnect is unreachable, returns an "anki-offline" result, keeps the
  `.txt` backup, and leaves the job `drafted` so the user can push later.

### 3. Background worker (in `serve.py`)
A single daemon thread with a `queue.Queue`. `POST /api/cards/upload` extracts +
creates the `pending` job, enqueues its id, and returns immediately. The worker
pulls one job at a time, calls `ai_engine.draft` + `parse_cards`, and writes the
`drafted` job (or `error`). One-at-a-time keeps subscription usage gentle and
makes failures easy to reason about. The auto-refreshing dashboard surfaces
status changes without the user doing anything.

### 4. Dashboard UI (in `dashboard.html`)
Within the sector panel, per chapter:
- **✦ Generate cards** → a dropzone (drag/drop or pick a PDF).
- Live status chip: `Drafting…` → `Ready to review (N)` → `Pushed ◆N`.
- **Review tray**: each drafted card shows Text/Extra with **edit** (inline
  textarea), **approve** (default on), **delete**. Footer: **Push approved to
  Anki** + count. On success the ◆ badge updates via the existing refresh.
- Errors render inline with a **Retry** action (re-enqueues the job).

## Data & config

```
8. Claude/ID Platform/
  config.json            # { "claudePath": "...", "model": null, "timeoutSec": 240 }  (model optional; null → CLI default)
  queue/
    incoming/<job>.pdf
    pending/<job>.json   # {id, nn, title, sessionHint, highlights:[...], status}
    drafts/<job>.json    # {..., cards:[{Text,Extra}], status:"drafted"}
    done/<job>.json      # {..., pushed:{added,skipped}, status:"pushed"}
```
`config.json` and `queue/` are git-ignored. Job JSON is the durable audit trail
and the app↔worker interface.

## Endpoints (added to `serve.py`)

- `POST /api/cards/upload` (multipart: pdf + fields nn, title) → `{jobId}`
- `GET  /api/cards/jobs` → list of `{id, nn, title, status, count}` (drives chips + tray)
- `GET  /api/cards/job/{id}` → full job incl. drafted cards
- `POST /api/cards/job/{id}/push` (body: approved/edited cards) → `{added, skipped, anki}`
- `POST /api/cards/job/{id}/discard`
- `POST /api/cards/job/{id}/retry`
- `GET  /api/cards/config` → `{configured: bool}` (UI shows setup nudge if false)

## One-time setup

`Enable AI drafting.command` (double-click once):
1. Installs the Claude CLI (`npm i -g @anthropic-ai/claude-code`) if absent.
2. Runs `claude login` (browser OAuth with the user's Claude account →
   subscription, not API billing).
3. Detects the binary path (`which claude`) and writes `config.json`
   (`claudePath`; `model` left null to use the CLI default; `timeoutSec`).
The dashboard shows a one-line "Enable AI drafting" banner until
`/api/cards/config` reports configured.

## Error handling

| Situation | Behavior |
|---|---|
| CLI missing/unauthed | `/api/cards/config` → not configured; UI banner; upload disabled with a nudge |
| No highlights in PDF | Job `error` "no highlights found"; tray explains; nothing drafted |
| Claude timeout/failure | Job `error` with message; **Retry** re-enqueues |
| Malformed Claude output | Job `error`; raw output kept in job file for debugging; Retry |
| Anki closed on push | `.txt` backup written; job stays `drafted`; "Anki offline — push later" |
| Server restart mid-draft | On boot, any `drafting` jobs are re-enqueued (idempotent) |

## Testing

- `ai_engine`: `parse_cards` tolerance (code fences, prose, bad JSON); `draft`
  with the subprocess **stubbed** via an injected runner (canned stdout) — never
  calls the real CLI or the network.
- `cards_core`: job lifecycle transitions; `build_prompt` includes style guide +
  highlights; `extract` over a tiny fixture PDF with a known highlight; `push`
  with `add_cards`/AnkiConnect **mocked** (added/skipped/anki-offline paths);
  tag derivation `Chapter::NN::Title`.
- `serve.py`: endpoint tests over real HTTP with the drafting runner stubbed —
  upload a fixture PDF → assert `pending`→(worker)→`drafted`; push → assert
  chapter JSON written + status `pushed`.
- The Claude drafting *quality* is validated manually (as `id-anki-cards`
  already is); automated tests never depend on an LLM.

## Scope boundary

SP2 ships the cards flow end-to-end plus the shared `ai_engine`. SP3 (practice
questions) is the immediate next slice: same node, same engine, an RC-format
prompt (grounded by `docs/rc-question-format.md`), output to
`ID Practice Questions/<NN - Title>/` and the ● badge. Designing SP2 this way
means SP3 is mostly a new prompt + a second review tray, not new plumbing.
