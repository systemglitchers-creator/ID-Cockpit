# ID Study Platform — Backbone + Dashboard (SP0 + SP1)

**Date:** 2026-07-11
**Status:** Approved design, ready for implementation planning
**Slice:** First of five sub-projects in the ID Study Platform

---

## 1. Context and the whole platform

Tyler is studying for the Royal College Infectious Diseases exam. Three things
exist today, unconnected:

1. **ID Study Schedule** — a self-contained HTML app
   (`1. Fellowship/Study Schedule/ID Study Schedule.html`) holding a curated
   two-year Mandell reading plan as an embedded `SECTIONS` array (617 sessions,
   each with chapter title, page range, week, and a stable `id` like `ch20-p1`).
   Done-state is tracked in `localStorage` under key `id_grid_done_v4`.
2. **id-anki-cards skill** — takes a highlighted PDF chapter + page range,
   drafts cloze cards in Tyler's style with strict source-fidelity, and pushes
   them to Anki via AnkiConnect. Durable JSON records land in
   `8. Claude/ID Anki Cards/<NN - Chapter Title>/<YYYY-MM-DD>.json`.
3. **Old Royal College practice exams** — a large corpus under
   `1. Fellowship/Bzura Folder/RC prep/ID RC prep/` whose format Tyler wants new
   practice questions to match (characterized in the appendix,
   `rc-question-format.md`).

**The vision:** one platform where Tyler sees the schedule, clicks a session,
reads it, brings back the highlighted PDF, and the system builds Anki cards and
then RC-format practice questions — all tracked in one place.

### 1.1 The architectural constraint

A static HTML page cannot read PDFs off disk, run the highlight-extraction
Python, talk to AnkiConnect, or invoke Claude to draft cards/questions. Those
"smart" steps require a Claude Code agent plus local scripts. Making a pure web
app do the whole loop itself would require a standing local backend server that
calls the Claude **API** (metered, paid, per-token) — a separate, larger project.

**Decision — agent-backed, not headless-API.** The drafting engine stays
Claude Code (this), covered by Tyler's existing subscription, with the in-chat
review loop he already trusts. The platform is a **cockpit**: it shows state and
hands off work to Claude; it never thinks by itself. This is free to run and far
smaller to build. The headless-API upgrade is explicitly deferred.

### 1.2 The five sub-projects

| # | Sub-project | Owns | Depends on |
|---|---|---|---|
| **SP0** | Backbone | Local server, data store, folder/naming contract, prompt templates | — |
| **SP1** | Dashboard | Schedule HTML rewired as cockpit: per-session status + actions | SP0 |
| **SP2** | Ingestion + Anki | Upload PDF → extract → draft cards → review → push (ports id-anki-cards) | SP0 |
| **SP3** | Questions generator | Chapter cards/highlights → RC-format SAQs → review → store | SP0, SP2 |
| **SP4** | Question bank / quiz | Browse + filter + reveal-style self-test; track attempts | SP3 |

**This spec covers SP0 + SP1 only.** Each later sub-project gets its own
spec → plan → build cycle. SP0's folder/prompt contract is designed so the later
slices plug in without rework.

---

## 2. Goal of this slice

Stand up the free local cockpit — a small Python server plus the rewired
schedule HTML — that shows, per session: whether it has been read, how many
Anki cards exist, and how many practice questions exist; and that offers
copy-a-prompt buttons to kick off the next step in Claude Code. **No card or
question generation happens in this slice** (that is SP2/SP3); this is the home
everything else plugs into.

### Success criteria

- `python3 serve.py` starts a local server on `localhost:8756` and serves the
  dashboard.
- The dashboard shows the existing reading plan with its current look preserved.
- Each session shows read-state and, for its chapter, a live count of existing
  Anki cards and practice questions.
- Toggling a session's read-state persists to `state.json` and survives reload.
- Existing `localStorage` done-state is imported once so no progress is lost.
- Clicking a session reveals a detail panel with copy-a-prompt buttons that copy
  a correct, chapter-and-page-aware prompt to the clipboard.

---

## 3. Architecture

- **Server:** Python **standard library `http.server`** — zero `pip` installs.
  One file, `serve.py`, living in `8. Claude/ID Platform/`. Started with
  `python3 serve.py`; binds `localhost:8756` and prints the URL.
- **Plan stays in the HTML.** The curated `SECTIONS` array remains the single
  source of truth for *what to read*. The server does not know the plan and does
  not duplicate it.
- **Server owns only state + derived counts.** It answers two questions: which
  sessions are marked done, and how many cards/questions exist per chapter (by
  scanning the artifact folders live, so counts are never stale).
- **Session → chapter mapping.** Each session title begins `Chapter NN — …`.
  The chapter number `NN` maps to the artifact folder prefix `NN - …`. Counts
  are computed at chapter granularity and displayed on every session of that
  chapter.

### Why a server at all

A browser at `file://` cannot list directories or reliably fetch local JSON.
The tiny server is what lets the page see Tyler's Drive folders. It is local and
free to run.

---

## 4. Data and folder contract (SP0 deliverable)

```
8. Claude/
  ID Anki Cards/<NN - Chapter Title>/<YYYY-MM-DD>.json        # exists (id-anki-cards)
  ID Practice Questions/<NN - Chapter Title>/<YYYY-MM-DD>.json # NEW convention; SP3 fills it
  ID Platform/
    serve.py            # the server
    dashboard.html      # the rewired cockpit (see SP1)
    state.json          # { "sessions": { "ch20-p1": {"done": true, "doneAt": "..."} } }
    prompts.json        # editable copy-a-prompt templates
    docs/               # this spec + rc-question-format.md
```

- **Card/question counts are derived**, never stored — computed by scanning the
  two artifact folders and matching the chapter number. Nothing to keep in sync.
- **`state.json`** is a single human-readable, git-friendly JSON file the server
  owns. Chosen over SQLite: one user, small scale, easy to inspect and back up.
- **`ID Practice Questions/` mirrors `ID Anki Cards/`** exactly (same
  `<NN - Chapter Title>` folder naming) so SP3 and SP4 inherit the same mapping.

### 4.1 `prompts.json` shape

```json
{
  "cards": "Using the id-anki-cards skill, make Anki cards from the highlighted PDF for Chapter {NN} — {title}, pages {ps}-{pe}. Confirm the PDF path with me.",
  "questions": "Using the id-practice-questions skill, make RC-format practice questions for Chapter {NN} — {title} from my existing Anki cards."
}
```

Placeholders `{NN} {title} {ps} {pe}` are filled by the server from the session
the page passes in. Templates live in a file so wording can be tuned without
touching code.

---

## 5. Server API

- `GET /` → serves `dashboard.html`.
- `GET /api/status` →
  `{ "done": { "<id>": {"done":true,"doneAt":"..."} },
     "chapters": { "20": {"cards":14,"questions":0}, ... } }`
  Counts computed live by scanning artifact folders.
- `POST /api/session/{id}/done` → body `{"done": true|false}`; toggles and
  persists to `state.json`; returns the updated entry.
- `POST /api/import` → body `{"ids": ["ch20-p1", ...]}`; one-time seed of
  done-state from the page's existing `localStorage` set. Idempotent (union with
  existing state).
- `GET /api/prompt?action=cards|questions&session={id}&NN={NN}&title=...&ps=...&pe=...`
  → `{ "prompt": "..." }`; template filled from `prompts.json`. (The page holds
  the plan, so it supplies the session's fields; the server just fills the
  template. Keeping template text server-side means one edit point.)

All endpoints are localhost-only; no auth (single-user local tool).

---

## 6. Dashboard (SP1)

**Reuse the existing schedule HTML — do not rebuild it.** Keep the dark theme,
the `SECTIONS` data, and the session grid. It becomes `dashboard.html` served by
the server. Additions:

1. **Status badges** on each session: `✓ read`, `◆ N cards`, `● N Q`. Card and
   question counts come from `/api/status` (per chapter), merged client-side
   with the plan the page already holds.
2. **Session detail panel** on click: chapter, page range, read-state, and:
   - Two **copy-a-prompt buttons** — *"Copy: make Anki cards"* and
     *"Copy: make RC questions"* — each fetches the filled prompt from
     `/api/prompt` and writes it to the clipboard.
   - Links to open any existing card/question JSON for that chapter.
3. **State moves from `localStorage` → server.** Read-toggles call
   `POST /api/session/{id}/done`. On first load, if server state is empty and
   `localStorage['id_grid_done_v4']` is present, the page POSTs it to
   `/api/import` once, then reads authoritative state from the server thereafter.

### Hand-off flow (agent-backed)

Tyler clicks *"Copy: make RC questions"* → prompt copied → he pastes it into his
Claude Code session → Claude runs the skill (SP3, built later) → the question
JSON lands in `ID Practice Questions/<NN - …>/` → the badge updates on next
dashboard load. The dashboard never invokes Claude directly; the clipboard is
the seam.

---

## 7. Chosen defaults (flagged for change)

- **Port 8756.**
- **`state.json`** (not SQLite).
- **The cards prompt leaves the PDF path to the skill to confirm** — highlighted
  PDFs are not yet in a fixed location, so the template asks Claude to confirm
  the path (as id-anki-cards already does). If Tyler later standardizes a
  textbook-PDF folder, the template can auto-fill the path — a small change.

---

## 8. Verification

Runtime-observable, so verify in the preview browser:

1. Start `serve.py`; confirm it binds `localhost:8756` and serves the dashboard.
2. Load the dashboard; confirm the reading plan renders with its existing look.
3. Confirm a chapter Tyler has already carded (a populated
   `ID Anki Cards/<NN - …>/` folder) shows the correct `N cards` badge.
4. Toggle a session read; reload; confirm the state persisted (and appears in
   `state.json`).
5. Click a session; click *"Copy: make RC questions"*; confirm the clipboard
   holds a correctly filled prompt.
6. Confirm the one-time `localStorage` import seeds prior done-state.

---

## 9. Out of scope for this slice

- Card generation, question generation, PDF upload, AnkiConnect (SP2/SP3).
- Quiz/self-test mode and attempt tracking (SP4).
- Headless-API drafting (deferred platform upgrade).
- Any redesign of the schedule's visual style beyond adding badges and the
  detail panel.
