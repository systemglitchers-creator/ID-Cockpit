# SP3 — In-App Practice-Question Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a chapter node, generate Royal-College-format practice questions grounded in that chapter's Anki cards + its retained highlighted PDF, review them in-app, and save to `ID Practice Questions/<NN - Title>/` so the ● badge lights up. No Anki push.

**Architecture:** Reuse `ai_engine.draft` (add `parse_questions`). Give the SP2 job helpers a `kind` namespace (`queue/cards/…`, `queue/questions/…`). Add `questions_core.py` (grounding load, prompt, draft, save) that reuses the shared job helpers with `kind="questions"`. The one background worker dispatches by kind. New `/api/questions/*` endpoints + a second review tray in `dashboard.html`.

**Tech Stack:** Python 3.9 stdlib + PyMuPDF (installed); the `claude` CLI (shared engine); vanilla JS. pytest with the Claude call stubbed.

**Working dir:** `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform`

**Spec:** `docs/2026-07-12-sp3-question-generation-design.md`. **Format contract:** `docs/rc-question-format.md`.

---

## File Structure

```
8. Claude/ID Platform/
  cards_core.py       # MODIFY: job helpers gain kind="cards"; retain source PDF; generic count
  ai_engine.py        # MODIFY: add parse_questions()
  questions_core.py   # NEW: chapter-card load, q-prompt, process_job (draft), save
  serve.py            # MODIFY: worker dispatch by kind; /api/questions/* routes; q_draft_fn
  dashboard.html      # MODIFY: ✦ Generate questions button + question review tray
  tests/
    test_cards_core.py       # MODIFY: queue path assertions -> queue/cards/…; source-pdf test
    test_ai_engine.py         # MODIFY: parse_questions tests
    test_questions_core.py    # NEW
    test_questions_endpoints.py # NEW
```

Question job JSON (stored via shared helpers under `queue/questions/`):
`{"id","nn","title","status","created","highlights":[…],"questions":[…]?,"error"?}` — status `pending → drafting → drafted → saved | error`.
Question object (in `questions`): `{"stem","archetype","subquestions":[{"prompt","count","marks","answer":[…]}]}`.

---

## Task 1: Namespace the job helpers by `kind`; retain source PDF

**Files:** Modify `cards_core.py`, `tests/test_cards_core.py`

Goal: queue paths become `queue/<kind>/<statusdir>`, with `kind="cards"` the default so card behavior is unchanged except the folder now nests under `cards/`. Card-ingest also stashes the source PDF at `queue/source/<NN>.pdf`. `list_jobs` counts cards **or** questions.

- [ ] **Step 1: Update the card tests' queue-path assertions (they will fail first)**

In `tests/test_cards_core.py`, every assertion referencing `"queue" / "pending"`, `"queue" / "drafts"`, `"queue" / "done"` must gain the `cards` segment. Change each such path to include `"cards"`. Specifically:
- `test_create_and_load_job`: `(tmp_path / "queue" / "pending" / …)` → `(tmp_path / "queue" / "cards" / "pending" / …)`
- `test_set_status_moves_file`: `queue/pending` → `queue/cards/pending`, `queue/drafts` → `queue/cards/drafts`
- Any other card test asserting a `queue/<sub>` path → insert `cards`.

Add a new source-PDF test:
```python
def test_ingest_upload_retains_source_pdf(tmp_path):
    import fitz
    doc = fitz.open(); page = doc.new_page()
    s = "Linezolid is an oxazolidinone."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s): page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close()
    cc._ingest_upload(tmp_path, "28", "Oxazolidinones", data)
    assert (tmp_path / "queue" / "source" / "28.pdf").exists()
```

Add a generic-count test:
```python
def test_list_jobs_counts_questions_too(tmp_path):
    cc.ensure_queue(tmp_path, kind="questions")
    j = cc.create_job(tmp_path, "29", "Glyco", [], kind="questions")
    cc.set_status(tmp_path, j, "drafted", kind="questions",
                  questions=[{"stem": "s", "subquestions": []}])
    rows = cc.list_jobs(tmp_path, kind="questions")
    assert any(r["id"] == j["id"] and r["count"] == 1 for r in rows)
```

- [ ] **Step 2: Run to confirm failures**

Run: `python3 -m pytest tests/test_cards_core.py -v`
Expected: the path-assertion tests FAIL (files now expected under `queue/cards/…` but code still writes `queue/…`), and the two new tests FAIL (no `kind` kwarg / no source pdf).

- [ ] **Step 3: Refactor `cards_core.py`**

Replace `ensure_queue` and the queue-path helpers so they take a keyword-only `kind="cards"`, and thread it through. Exact new versions:
```python
def ensure_queue(base_dir, *, kind="cards"):
    for sub in QUEUE_SUBDIRS:
        (Path(base_dir) / "queue" / kind / sub).mkdir(parents=True, exist_ok=True)
    (Path(base_dir) / "queue" / "source").mkdir(parents=True, exist_ok=True)


def _job_path(base_dir, status, job_id, *, kind="cards"):
    return Path(base_dir) / "queue" / kind / _STATUS_DIR[status] / (job_id + ".json")


def _find_job_file(base_dir, job_id, *, kind="cards"):
    for sub in ("pending", "drafts", "done"):
        p = Path(base_dir) / "queue" / kind / sub / (job_id + ".json")
        if p.exists():
            return p
    return None
```
Update `create_job`, `load_job`, `set_status`, `list_jobs`, `process_job`, `discard_job` to accept `*, kind="cards"` and pass it through every internal call. Exact new versions:
```python
def create_job(base_dir, nn, title, highlights, *, kind="cards"):
    ensure_queue(base_dir, kind=kind)
    job = {"id": uuid.uuid4().hex[:12], "nn": str(nn), "title": str(title),
           "status": "pending", "created": datetime.now().isoformat(timespec="seconds"),
           "highlights": highlights}
    _job_path(base_dir, "pending", job["id"], kind=kind).write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def load_job(base_dir, job_id, *, kind="cards"):
    p = _find_job_file(base_dir, job_id, kind=kind)
    if not p:
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def set_status(base_dir, job, status, *, kind="cards", **updates):
    old = _find_job_file(base_dir, job["id"], kind=kind)
    job = dict(job); job["status"] = status; job.update(updates)
    newp = _job_path(base_dir, status, job["id"], kind=kind)
    newp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    if old and old != newp:
        old.unlink()
    return job


def list_jobs(base_dir, *, kind="cards"):
    ensure_queue(base_dir, kind=kind)
    rows = []
    for sub in ("pending", "drafts", "done"):
        for f in sorted((Path(base_dir) / "queue" / kind / sub).glob("*.json")):
            try:
                j = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            items = j.get("cards") or j.get("questions") or []
            rows.append({"id": j["id"], "nn": j.get("nn"), "title": j.get("title"),
                         "status": j.get("status"), "count": len(items)})
    return rows


def discard_job(base_dir, job_id, *, kind="cards"):
    p = _find_job_file(base_dir, job_id, kind=kind)
    if p:
        p.unlink()
    pdf = Path(base_dir) / "queue" / kind / "incoming" / (job_id + ".pdf")
    if pdf.exists():
        pdf.unlink()
```
Update `process_job` signature to `def process_job(base_dir, job_id, draft_fn, *, kind="cards"):` and pass `kind=kind` to its `load_job`/`set_status` calls (the card prompt/parse body is otherwise unchanged).

Update `_ingest_upload` to write under `queue/cards/incoming` and to retain the source PDF:
```python
def _ingest_upload(base_dir, nn, title, pdf_bytes):
    ensure_queue(base_dir, kind="cards")
    job_id = uuid.uuid4().hex[:12]
    pdf_path = Path(base_dir) / "queue" / "cards" / "incoming" / (job_id + ".pdf")
    pdf_path.write_bytes(pdf_bytes)
    # retain a per-chapter source PDF so questions can reuse it without re-upload
    src = Path(base_dir) / "queue" / "source" / (str(nn) + ".pdf")
    src.write_bytes(pdf_bytes)
    highlights = extract(str(pdf_path))
    job = {"id": job_id, "nn": str(nn), "title": str(title), "status": "pending",
           "created": datetime.now().isoformat(timespec="seconds"), "highlights": highlights}
    _job_path(base_dir, "pending", job_id, kind="cards").write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -v`
Expected: all pass (updated path assertions + new source-pdf + questions-count tests).

- [ ] **Step 5: Commit**

```bash
git add cards_core.py tests/test_cards_core.py
git commit -m "refactor: namespace job queue by kind (cards/questions); retain source PDF"
```

---

## Task 2: ai_engine.parse_questions

**Files:** Modify `ai_engine.py`, `tests/test_ai_engine.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ai_engine.py`:
```python
def test_parse_questions_basic():
    raw = ('[{"stem":"A patient...","archetype":"clinical","subquestions":'
           '[{"prompt":"Name 2 causes","count":2,"marks":1,"answer":["a","b"]}]}]')
    qs = ae.parse_questions(raw)
    assert len(qs) == 1
    assert qs[0]["stem"].startswith("A patient")
    assert qs[0]["subquestions"][0]["count"] == 2
    assert qs[0]["subquestions"][0]["answer"] == ["a", "b"]


def test_parse_questions_trims_answer_to_count():
    raw = ('[{"stem":"s","archetype":"micro","subquestions":'
           '[{"prompt":"Name 2","count":2,"marks":1,"answer":["a","b","c"]}]}]')
    qs = ae.parse_questions(raw)
    assert qs[0]["subquestions"][0]["answer"] == ["a", "b"]  # trimmed to count


def test_parse_questions_fixes_count_when_fewer_answers():
    raw = ('[{"stem":"s","archetype":"micro","subquestions":'
           '[{"prompt":"Name 3","count":3,"marks":1.5,"answer":["a","b"]}]}]')
    qs = ae.parse_questions(raw)
    sq = qs[0]["subquestions"][0]
    assert sq["count"] == 2 and sq["answer"] == ["a", "b"]  # count follows actual answers


def test_parse_questions_code_fence_and_prose():
    raw = 'Sure:\n```json\n[{"stem":"s","subquestions":[]}]\n```\n'
    assert ae.parse_questions(raw)[0]["stem"] == "s"


def test_parse_questions_bad_raises_with_raw():
    try:
        ae.parse_questions("nope")
    except ae.BadDraftOutput as e:
        assert e.raw == "nope"
    else:
        assert False
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_ai_engine.py -k parse_questions -v`
Expected: FAIL (`parse_questions` undefined).

- [ ] **Step 3: Implement**

Append to `ai_engine.py`:
```python
def _extract_array(raw):
    """Shared: pull the first JSON array from Claude output, tolerant of fences/prose."""
    if raw is None:
        raise BadDraftOutput("empty output", raw=raw)
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    if start == -1:
        raise BadDraftOutput("no JSON array found", raw=raw)
    try:
        arr, _ = json.JSONDecoder().raw_decode(text[start:])
    except ValueError as e:
        raise BadDraftOutput(str(e), raw=raw)
    if not isinstance(arr, list):
        raise BadDraftOutput("not a list", raw=raw)
    return arr


def parse_questions(raw):
    """Parse RC questions; enforce count == len(answer) per sub-question."""
    arr = _extract_array(raw)
    out = []
    for item in arr:
        if not isinstance(item, dict) or "stem" not in item:
            continue
        subs = []
        for sq in item.get("subquestions", []) or []:
            if not isinstance(sq, dict):
                continue
            ans = sq.get("answer") or []
            if not isinstance(ans, list):
                ans = [str(ans)]
            count = sq.get("count")
            if isinstance(count, int) and count < len(ans):
                ans = ans[:count]            # trim over-long answer to stated count
            count = len(ans)                 # count always mirrors the final answer list
            subs.append({"prompt": str(sq.get("prompt", "")), "count": count,
                         "marks": sq.get("marks", 0), "answer": [str(a) for a in ans]})
        out.append({"stem": str(item.get("stem", "")),
                    "archetype": str(item.get("archetype", "")), "subquestions": subs})
    if not out:
        raise BadDraftOutput("no valid questions", raw=raw)
    return out
```
(Optional tidy: `parse_cards` may be refactored to call `_extract_array`; not required. If you do, keep its tests green.)

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_ai_engine.py -v`
Expected: all pass (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add ai_engine.py tests/test_ai_engine.py
git commit -m "feat: ai_engine.parse_questions (RC schema, count discipline)"
```

---

## Task 3: questions_core — grounding load + prompt

**Files:** Create `questions_core.py`, `tests/test_questions_core.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_questions_core.py`:
```python
import json
from pathlib import Path
import questions_core as qc


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


def test_load_chapter_cards_concatenates(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    ch = tmp_path / "ID Anki Cards" / "29 - Glyco"
    _write(ch / "2026-01-01.json", {"cards": [{"Text": "a", "Extra": ""}]})
    _write(ch / "2026-02-02.json", {"cards": [{"Text": "b", "Extra": "x"}]})
    cards = qc.load_chapter_cards(base, "29", "Glyco")
    texts = sorted(c["Text"] for c in cards)
    assert texts == ["a", "b"]


def test_has_cards_and_source(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    assert qc.precheck(base, "29", "Glyco") == {"hasCards": False, "hasPdf": False}
    _write(tmp_path / "ID Anki Cards" / "29 - Glyco" / "d.json", {"cards": [{"Text": "a"}]})
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "29.pdf").write_bytes(b"%PDF-1.4")
    assert qc.precheck(base, "29", "Glyco") == {"hasCards": True, "hasPdf": True}


def test_build_qprompt_includes_cards_highlights_and_format(tmp_path):
    prompt = qc.build_qprompt("29", "Glyco",
                              cards=[{"Text": "Vanco {{c1::cell wall}}", "Extra": ""}],
                              highlights=[{"highlight": "Vancomycin binds D-Ala", "context": "..."}],
                              rc_format="RC FORMAT RULES")
    assert "RC FORMAT RULES" in prompt
    assert "Vanco" in prompt and "D-Ala" in prompt
    assert "Chapter 29" in prompt and "JSON" in prompt
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_questions_core.py -v`
Expected: FAIL (`No module named 'questions_core'`).

- [ ] **Step 3: Implement (grounding + prompt only; job/save in Task 4)**

Create `questions_core.py`:
```python
"""In-app practice-question generation. Reuses cards_core job helpers + ai_engine."""
from __future__ import annotations

import json
from pathlib import Path

import cards_core
from platform_core import CARDS_SUBDIR  # "ID Anki Cards"

QUESTIONS_SUBDIR = "ID Practice Questions"
KIND = "questions"


def _artifact_root(base_dir):
    return Path(base_dir).parent


def _chapter_card_dir(base_dir, nn, title):
    return _artifact_root(base_dir) / CARDS_SUBDIR / (str(nn) + " - " + str(title))


def load_chapter_cards(base_dir, nn, title):
    """Concatenate all cards across the chapter's dated JSON files."""
    d = _chapter_card_dir(base_dir, nn, title)
    cards = []
    if d.is_dir():
        for f in sorted(d.glob("*.json")):
            try:
                obj = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            for c in obj.get("cards", []) or []:
                if isinstance(c, dict) and c.get("Text"):
                    cards.append({"Text": c["Text"], "Extra": c.get("Extra", "") or ""})
    return cards


def source_pdf(base_dir, nn):
    p = Path(base_dir) / "queue" / "source" / (str(nn) + ".pdf")
    return p if p.exists() else None


def precheck(base_dir, nn, title):
    return {"hasCards": len(load_chapter_cards(base_dir, nn, title)) > 0,
            "hasPdf": source_pdf(base_dir, nn) is not None}


def read_rc_format():
    """The RC format contract from docs/rc-question-format.md (grounding for the prompt)."""
    p = Path(__file__).resolve().parent / "docs" / "rc-question-format.md"
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def build_qprompt(nn, title, cards, highlights, rc_format):
    card_lines = "\n".join("- " + c["Text"] + ((" | " + c["Extra"]) if c.get("Extra") else "")
                           for c in cards)
    hl_lines = "\n".join(("HIGHLIGHT: " + h["highlight"] +
                          (("\nCONTEXT  : " + h["context"]) if h.get("context") else ""))
                         for h in highlights)
    return (
        "You are writing Royal College-style practice questions for Chapter "
        + str(nn) + " — " + str(title) + ".\n\n"
        "Reproduce this exam format exactly:\n\n" + rc_format + "\n\n"
        "Ground every stem and every model-answer item ONLY in the facts below "
        "(the student's own Anki cards and the chapter's highlighted passages) — "
        "never outside knowledge. If a sub-question says 'Name 3', the answer has "
        "exactly 3 items.\n\n"
        "=== ANKI CARDS (memorized facts) ===\n" + card_lines + "\n\n"
        "=== HIGHLIGHTED PASSAGES (clinical context) ===\n" + hl_lines + "\n\n"
        "Output ONLY a JSON array of question objects with keys: \"stem\", "
        "\"archetype\" (clinical|micro|pharm|public-health|vaccine|travel|peds), and "
        "\"subquestions\" (array of {\"prompt\",\"count\",\"marks\",\"answer\":[…]}). "
        "No prose, no code fence."
    )
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_questions_core.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add questions_core.py tests/test_questions_core.py
git commit -m "feat: questions_core grounding (chapter cards, source PDF, prompt)"
```

---

## Task 4: questions_core — ingest, process_job, save

**Files:** Modify `questions_core.py`, `tests/test_questions_core.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_questions_core.py`:
```python
import fitz


def _pdf_bytes(sentence="Daptomycin depolarizes the membrane."):
    doc = fitz.open(); page = doc.new_page()
    page.insert_text((72, 100), sentence, fontsize=12)
    for r in page.search_for(sentence): page.add_highlight_annot(r)
    b = doc.tobytes(); doc.close(); return b


def test_ingest_from_source_pdf(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "30.pdf").write_bytes(_pdf_bytes())
    job = qc.ingest(base, "30", "Daptomycin")
    assert job["status"] == "pending" and job["nn"] == "30" and len(job["highlights"]) == 1


def test_process_job_drafts_questions(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "30.pdf").write_bytes(_pdf_bytes())
    _write(tmp_path / "ID Anki Cards" / "30 - Dapto" / "d.json", {"cards": [{"Text": "membrane"}]})
    job = qc.ingest(base, "30", "Dapto")
    QS = [{"stem": "s", "archetype": "pharm",
           "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    qc.process_job(base, job["id"], lambda prompt: QS)
    out = cards_core.load_job(base, job["id"], kind="questions")
    assert out["status"] == "drafted" and out["questions"][0]["stem"] == "s"


def test_save_writes_practice_questions_json(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    cards_core.ensure_queue(base, kind="questions")
    job = cards_core.create_job(base, "30", "Daptomycin", [], kind="questions")
    job = cards_core.set_status(base, job, "drafted", kind="questions",
                                questions=[{"stem": "s", "subquestions": []}])
    approved = [{"stem": "s2", "archetype": "pharm",
                 "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    res = qc.save(base, job, approved)
    written = list((tmp_path / "ID Practice Questions" / "30 - Daptomycin").glob("*.json"))
    assert written and res["saved"] == 1
    obj = json.loads(written[0].read_text())
    assert obj["questions"][0]["stem"] == "s2"
    assert cards_core.load_job(base, job["id"], kind="questions")["status"] == "saved"
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_questions_core.py -k "ingest or process_job or save" -v`
Expected: FAIL (`ingest`/`process_job`/`save` undefined).

- [ ] **Step 3: Implement**

Add `from datetime import datetime` to `questions_core.py` imports. Append:
```python
def ingest(base_dir, nn, title, pdf_bytes=None):
    """Create a pending questions job from an uploaded PDF, or the retained source PDF."""
    cards_core.ensure_queue(base_dir, kind=KIND)
    if pdf_bytes is not None:
        src = Path(base_dir) / "queue" / "source" / (str(nn) + ".pdf")
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(pdf_bytes)
        pdf_path = src
    else:
        pdf_path = source_pdf(base_dir, nn)
        if pdf_path is None:
            raise FileNotFoundError("no source PDF for chapter " + str(nn))
    highlights = cards_core.extract(str(pdf_path))
    return cards_core.create_job(base_dir, nn, title, highlights, kind=KIND)


def process_job(base_dir, job_id, draft_fn):
    """Draft questions for a pending job. draft_fn(prompt) -> list[question]."""
    job = cards_core.load_job(base_dir, job_id, kind=KIND)
    if not job:
        return
    cards_core.set_status(base_dir, job, "drafting", kind=KIND)
    try:
        cards = load_chapter_cards(base_dir, job["nn"], job["title"])
        prompt = build_qprompt(job["nn"], job["title"], cards, job.get("highlights", []),
                               read_rc_format())
        questions = draft_fn(prompt)
        if not questions:
            raise ValueError("no questions produced")
        cards_core.set_status(base_dir, job, "drafted", kind=KIND, questions=questions)
    except Exception as e:  # noqa: BLE001
        cards_core.set_status(base_dir, job, "error", kind=KIND,
                              error=str(e), rawOutput=getattr(e, "raw", None))


def _chapter_q_dir(base_dir, nn, title):
    return _artifact_root(base_dir) / QUESTIONS_SUBDIR / (str(nn) + " - " + str(title))


def save(base_dir, job, approved_questions):
    """Write approved questions to ID Practice Questions/<NN - Title>/<date>.json."""
    d = _chapter_q_dir(base_dir, job["nn"], job["title"])
    d.mkdir(parents=True, exist_ok=True)
    out = {"chapter": str(job["nn"]), "title": job["title"], "questions": approved_questions}
    (d / (datetime.now().strftime("%Y-%m-%d") + ".json")).write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    cards_core.set_status(base_dir, job, "saved", kind=KIND, questions=approved_questions)
    return {"saved": len(approved_questions)}
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_questions_core.py -v`
Expected: all pass. Then full suite: `python3 -m pytest tests/ -q` (cards still green under `queue/cards/`).

- [ ] **Step 5: Commit**

```bash
git add questions_core.py tests/test_questions_core.py
git commit -m "feat: questions_core ingest, process_job (draft), save"
```

---

## Task 5: serve.py — worker kind-dispatch + /api/questions/* endpoints

**Files:** Modify `serve.py`, `tests/test_questions_endpoints.py`

- [ ] **Step 1: Write failing endpoint tests**

Create `tests/test_questions_endpoints.py`:
```python
import json, threading, time, urllib.request
import fitz, serve, cards_core


def _pdf():
    doc = fitz.open(); p = doc.new_page()
    s = "Ceftaroline has MRSA activity."
    p.insert_text((72, 100), s, fontsize=12)
    for r in p.search_for(s): p.add_highlight_annot(r)
    b = doc.tobytes(); doc.close(); return b


STUB_QS = [{"stem": "A patient with MRSA bacteremia.", "archetype": "clinical",
            "subquestions": [{"prompt": "Name 1 agent", "count": 1, "marks": 1, "answer": ["ceftaroline"]}]}]


def _start(base):
    httpd = serve.make_server(host="127.0.0.1", port=0, base_dir=str(base),
                              platform_dir=str(base),
                              draft_fn=lambda p: [{"Text": "x", "Extra": ""}],
                              q_draft_fn=lambda p: STUB_QS)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.05)
    return httpd, httpd.server_address[1]


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as r:
        return r.status, r.read().decode()


def _post(port, path, obj=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else None)
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method="POST",
                                 headers={"Content-Type": ctype} if data else {})
    with urllib.request.urlopen(req) as r:
        return r.status, r.read().decode()


def test_precheck(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, b = _get(port, "/api/questions/precheck?nn=31&title=Foo")
        assert st == 200 and json.loads(b) == {"hasCards": False, "hasPdf": False}
    finally:
        httpd.shutdown()


def test_generate_from_uploaded_pdf_then_save(tmp_path):
    # seed a card so grounding has something (not strictly required for the stub)
    d = tmp_path.parent / "ID Anki Cards" / "31 - Ceftaroline"
    httpd, port = _start(tmp_path)
    try:
        st, b = _post(port, "/api/questions/generate?nn=31&title=Ceftaroline",
                      raw=_pdf(), ctype="application/pdf")
        assert st == 200
        jid = json.loads(b)["jobId"]
        ok = False
        for _ in range(50):
            _, jb = _get(port, "/api/questions/jobs")
            if any(r["id"] == jid and r["status"] == "drafted" for r in json.loads(jb)):
                ok = True; break
            time.sleep(0.1)
        assert ok
        _, jd = _get(port, f"/api/questions/job/{jid}")
        assert json.loads(jd)["questions"][0]["stem"].startswith("A patient")
        st, sv = _post(port, f"/api/questions/job/{jid}/save",
                       obj={"questions": STUB_QS})
        assert st == 200 and json.loads(sv)["saved"] == 1
        assert list((tmp_path.parent / "ID Practice Questions" / "31 - Ceftaroline").glob("*.json"))
    finally:
        httpd.shutdown()
```
Note: `base_dir`/`platform_dir` are `tmp_path`, so the artifact root (parent) is `tmp_path.parent` — hence the `ID Anki Cards`/`ID Practice Questions` assertions use `tmp_path.parent`.

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_questions_endpoints.py -v`
Expected: FAIL (`make_server` has no `q_draft_fn`; routes 404).

- [ ] **Step 3: Modify `serve.py`**

(a) Add `import questions_core` near the other imports.

(b) Add a real questions drafter beside `_real_draft_fn`:
```python
def _real_q_draft_fn(platform_dir):
    def q_draft_fn(prompt):
        cfg = cards_core.load_config(platform_dir)
        raw = ai_engine.draft(prompt, claude_path=cfg.get("claudePath"),
                              model=cfg.get("model"), timeout=cfg.get("timeoutSec", 240))
        return ai_engine.parse_questions(raw)
    return q_draft_fn
```

(c) Change `make_server` signature to add `q_draft_fn=None`, and rework the queue/worker to carry a kind and dispatch. Replace the current worker block with:
```python
    httpd.draft_fn = draft_fn or _real_draft_fn(httpd.platform_dir)
    httpd.q_draft_fn = q_draft_fn or _real_q_draft_fn(httpd.platform_dir)
    httpd.card_q = _queue.Queue()
    def _worker():
        while True:
            item = httpd.card_q.get()
            if item is None:
                return
            kind, jid = item
            try:
                if kind == "questions":
                    questions_core.process_job(httpd.platform_dir, jid, httpd.q_draft_fn)
                else:
                    cards_core.process_job(httpd.platform_dir, jid, httpd.draft_fn)
            except Exception:
                pass
            finally:
                httpd.card_q.task_done()
    t = threading.Thread(target=_worker, daemon=True); t.start()
    httpd.card_worker = t
```

(d) The existing card endpoints enqueue a bare id — update those two spots to carry the kind:
- In `/api/cards/upload`: `self.server.card_q.put(("cards", job["id"]))`
- In the cards `/retry`: `self.server.card_q.put(("cards", jid))`

(e) Add GET routes (in `do_GET`, before the final 404):
```python
        if route == "/api/questions/precheck":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            self._send_json(questions_core.precheck(self._pdir(), q.get("nn", ""), q.get("title", "")))
            return
        if route == "/api/questions/jobs":
            self._send_json(cards_core.list_jobs(self._pdir(), kind="questions"))
            return
        if route.startswith("/api/questions/job/"):
            jid = route[len("/api/questions/job/"):]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job is None:
                self.send_error(404, "no such job"); return
            self._send_json(job)
            return
```

(f) Add POST routes (in `do_POST`, before the final 404):
```python
        if route == "/api/questions/generate":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            length = int(self.headers.get("Content-Length", 0))
            pdf = self.rfile.read(length) if length else None
            try:
                job = questions_core.ingest(self._pdir(), q.get("nn", ""), q.get("title", ""), pdf)
            except FileNotFoundError:
                self.send_error(409, "no source PDF; upload one"); return
            self.server.card_q.put(("questions", job["id"]))
            self._send_json({"jobId": job["id"]})
            return
        if route.startswith("/api/questions/job/") and route.endswith("/save"):
            jid = route[len("/api/questions/job/"):-len("/save")]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job is None:
                self.send_error(404, "no such job"); return
            body = self._read_body()
            self._send_json(questions_core.save(self._pdir(), job, body.get("questions", [])))
            return
        if route.startswith("/api/questions/job/") and route.endswith("/discard"):
            jid = route[len("/api/questions/job/"):-len("/discard")]
            cards_core.discard_job(self._pdir(), jid, kind="questions")
            self._send_json({"discarded": jid})
            return
        if route.startswith("/api/questions/job/") and route.endswith("/retry"):
            jid = route[len("/api/questions/job/"):-len("/retry")]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job:
                cards_core.set_status(self._pdir(), job, "pending", kind="questions")
                self.server.card_q.put(("questions", jid))
            self._send_json({"retry": jid})
            return
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_questions_endpoints.py tests/test_cards_endpoints.py -v`
Expected: all pass (card endpoints still work — they now enqueue `("cards", id)` and the worker dispatches). Then full suite `python3 -m pytest tests/ -q`.

- [ ] **Step 5: Commit**

```bash
git add serve.py tests/test_questions_endpoints.py
git commit -m "feat: /api/questions/* endpoints + worker kind-dispatch"
```

---

## Task 6: dashboard.html — Generate-questions button + question review tray

**Files:** Modify `dashboard.html`

- [ ] **Step 1: Add a Generate-questions button into the chapter bar**

In `openPanel`, the `.chapgen` bar currently holds the cards button. Add a questions button beside it. Change the `.chapgen` template to append:
```javascript
        +'<button class="mbtn gbtn qgbtn" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">✦ Generate questions</button>'
        +'<span class="cgstatus" id="qcg-'+nn+'"></span>'
```
(Insert this right after the existing `✦ Generate cards` button + its `cgstatus` span, inside the same `.chapgen` div.)

- [ ] **Step 2: Wire the questions button (after `body.innerHTML=html;`)**

Add next to the existing `.gbtn` wiring:
```javascript
  Array.prototype.forEach.call(body.querySelectorAll(".qgbtn"),function(btn){
    btn.onclick=function(){ startQuestions(btn.dataset.nn, btn.dataset.title, btn); };
  });
  refreshQJobs();
```

- [ ] **Step 3: Add CSS** (before `</style>`):
```css
.qtray{margin:2px 22px 12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.qq{padding:12px;border-top:1px solid var(--line2)}
.qq .qstem{width:100%;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;font-family:var(--sans);font-size:13px;padding:7px;min-height:52px;resize:vertical}
.qq .sub{margin:8px 0 0;padding:8px;border:1px solid var(--line2);border-radius:8px}
.qq .sub .sp{display:flex;gap:8px;align-items:center}
.qq .sub .sp input.p{flex:1;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;font-family:var(--mono);font-size:11px;padding:5px}
.qq .sub .sp input.m{width:52px;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;font-family:var(--mono);font-size:11px;padding:5px;text-align:center}
.qq .ans{display:flex;gap:6px;align-items:center;margin-top:5px}
.qq .ans input{flex:1;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;font-family:var(--mono);font-size:11px;padding:5px}
.qq.dropped{opacity:.4}
.qtray .tfoot{padding:10px 12px;display:flex;gap:10px;align-items:center;background:var(--panel2)}
```

- [ ] **Step 4: Add the questions JS** (after the card functions, e.g. after `pushTray`):
```javascript
// ---- in-app practice questions (SP3) ----
var QJOBS={};
function startQuestions(nn,title,anchor){
  var st=document.getElementById("qcg-"+nn); if(st) st.textContent="· checking…";
  fetch("/api/questions/precheck?nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title))
    .then(function(r){return r.json();}).then(function(pc){
      if(!pc.hasCards){ if(st) st.textContent="· make cards first"; return; }
      if(!pc.hasPdf){ questionsDropzone(nn,title,anchor); return; }
      genQuestions(nn,title,null,st);
    }).catch(function(){ if(st) st.textContent="· error"; });
}
function questionsDropzone(nn,title,anchor){
  var host=anchor.closest(".chapgen");
  if(host.nextSibling && host.nextSibling.classList && host.nextSibling.classList.contains("dz")) return;
  var dz=document.createElement("div"); dz.className="dz";
  dz.textContent="No saved PDF — drop the Chapter "+nn+" PDF to make questions";
  var inp=document.createElement("input"); inp.type="file"; inp.accept="application/pdf"; inp.style.display="none"; dz.appendChild(inp);
  host.parentNode.insertBefore(dz,host.nextSibling);
  dz.onclick=function(){ inp.click(); };
  inp.onchange=function(){ if(inp.files[0]) genQuestions(nn,title,inp.files[0],document.getElementById("qcg-"+nn),dz); };
}
function genQuestions(nn,title,file,st,dz){
  if(st) st.textContent="· drafting…"; if(dz) dz.remove();
  var opts={method:"POST"};
  if(file){ opts.headers={"Content-Type":"application/pdf"}; opts.body=file; }
  fetch("/api/questions/generate?nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title),opts)
    .then(function(r){return r.json();}).then(function(){ toastMsg("Drafting questions…"); pollQJobs(); })
    .catch(function(){ if(st) st.textContent="· failed"; });
}
function refreshQJobs(){
  return fetch("/api/questions/jobs").then(function(r){return r.json();}).then(function(rows){
    QJOBS={}; rows.forEach(function(j){ QJOBS[j.nn]=j; }); renderQStatuses();
  }).catch(function(){});
}
function renderQStatuses(){
  document.querySelectorAll(".chapgen").forEach(function(host){
    var nn=host.dataset.nn, j=QJOBS[nn], el=document.getElementById("qcg-"+nn);
    if(!el) return;
    if(!j){ el.textContent=""; return; }
    if(j.status==="pending"||j.status==="drafting") el.textContent="· drafting…";
    else if(j.status==="drafted"){ el.textContent="· review ("+j.count+")"; ensureQTray(host,j.id); }
    else if(j.status==="error") el.textContent="· failed — retry";
    else if(j.status==="saved") el.textContent="· saved ✓";
  });
}
function pollQJobs(){
  var n=0; var iv=setInterval(function(){ n++; refreshQJobs();
    var busy=Object.keys(QJOBS).some(function(k){var s=QJOBS[k].status;return s==="pending"||s==="drafting";});
    if(!busy||n>120) clearInterval(iv);
  },1500);
}
function ensureQTray(host,jobId){
  if(host.nextSibling && host.nextSibling.classList && host.nextSibling.classList.contains("qtray")) return;
  fetch("/api/questions/job/"+jobId).then(function(r){return r.json();}).then(function(job){
    var tray=document.createElement("div"); tray.className="qtray"; var html="";
    (job.questions||[]).forEach(function(q,i){
      html+='<div class="qq" data-i="'+i+'"><textarea class="qstem">'+esc(q.stem)+'</textarea>';
      (q.subquestions||[]).forEach(function(sq){
        html+='<div class="sub"><div class="sp"><input class="p" value="'+esc(sq.prompt)+'"><input class="m" value="'+esc(String(sq.marks))+'"></div>';
        (sq.answer||[]).forEach(function(a){ html+='<div class="ans"><input value="'+esc(a)+'"></div>'; });
        html+='</div>';
      });
      html+='<div class="trow" style="margin-top:6px"><button class="mbtn qdrop">Delete question</button></div></div>';
    });
    html+='<div class="tfoot"><button class="mbtn gbtn qsave">⇩ Save approved</button>'
      +'<button class="mbtn qdiscard">Discard</button><span class="cgstatus qmsg"></span></div>';
    tray.innerHTML=html; host.parentNode.insertBefore(tray,host.nextSibling);
    tray.querySelectorAll(".qdrop").forEach(function(b){ b.onclick=function(){ b.closest(".qq").classList.toggle("dropped"); }; });
    tray.querySelector(".qsave").onclick=function(){ saveQTray(tray,jobId); };
    tray.querySelector(".qdiscard").onclick=function(){ fetch("/api/questions/job/"+jobId+"/discard",{method:"POST"}).then(function(){ tray.remove(); refreshQJobs(); }); };
  });
}
function saveQTray(tray,jobId){
  var questions=[];
  tray.querySelectorAll(".qq").forEach(function(qq){
    if(qq.classList.contains("dropped")) return;
    var stem=qq.querySelector(".qstem").value.trim(); if(!stem) return;
    var subs=[];
    qq.querySelectorAll(".sub").forEach(function(sub){
      var ans=[]; sub.querySelectorAll(".ans input").forEach(function(ai){ var v=ai.value.trim(); if(v) ans.push(v); });
      subs.push({prompt:sub.querySelector("input.p").value.trim(), marks:parseFloat(sub.querySelector("input.m").value)||0, count:ans.length, answer:ans});
    });
    questions.push({stem:stem, archetype:"", subquestions:subs});
  });
  var msg=tray.querySelector(".qmsg"); msg.textContent="Saving…";
  fetch("/api/questions/job/"+jobId+"/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questions:questions})})
    .then(function(r){return r.json();}).then(function(res){
      msg.textContent="Saved ✓ ("+res.saved+")"; toastMsg("Questions saved"); tray.remove(); refreshStatus(); refreshQJobs();
    }).catch(function(){ msg.textContent="Save failed"; });
}
```

- [ ] **Step 5: Verify in the browser**

Restart the server; open the dashboard; open a sector. Confirm each chapter shows BOTH **✦ Generate cards** and **✦ Generate questions**. Clicking Generate questions on a chapter with no cards shows "· make cards first". Use `read_console_messages` (onlyErrors) → none. Confirm the served page: `curl -s http://127.0.0.1:8756/ | grep -c "qgbtn"` ≥ 1, and `node --check` on the extracted `<script>` passes.

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat: dashboard generate-questions button + question review tray"
```

---

## Task 7: End-to-end verification

**Files:** none

- [ ] **Step 1: Full suite** — `python3 -m pytest tests/ -q` → all pass (SP2 card tests now under `queue/cards/`, plus all new SP3 tests).

- [ ] **Step 2: Simulated e2e via a fake `claude`.** Point `config.json` at a fake `claude` that prints a JSON array of RC questions. Restart the server. Seed a chapter card (`ID Anki Cards/9998 - E2E Q/…`) and a source PDF (`queue/source/9998.pdf`). `POST /api/questions/generate?nn=9998&title=E2E%20Q`, poll `/api/questions/jobs` to `drafted`, `GET` the job to see questions, `POST /save`, and confirm `ID Practice Questions/9998 - E2E Q/<date>.json` written and the ● badge for that chapter reads ≥1 via `/api/status`.

- [ ] **Step 3: Clean up the e2e artifacts** — delete `ID Practice Questions/9998 - E2E Q/`, `ID Anki Cards/9998 - E2E Q/`, `queue/`, and `config.json` (so drafting reads unconfigured again). Confirm `/api/status` shows the real done-count unchanged and `/api/questions/jobs` is `[]`.

- [ ] **Step 4: Browser smoke** — open a real chapter that HAS cards + a source PDF (or seed one), click Generate questions, confirm draft→review tray→save works and the ● badge increments. Screenshot. (Skip if no configured CLI — Step 2 already proves the pipeline.)

- [ ] **Step 5: Commit any fixes** — `git add -A && git commit -m "fix: SP3 e2e adjustments"`.

---

## Self-Review Notes

- **Spec grounding (cards + reused PDF):** Task 3 `load_chapter_cards` + `source_pdf`, Task 4 `ingest` (reuse or upload), Task 1 source-PDF retention. ✓
- **RC schema + count discipline:** Task 2 `parse_questions` (trim/align count), Task 3 `build_qprompt` (format doc + counts). ✓
- **Shared job system (kind namespace):** Task 1 (cards→`queue/cards`, questions→`queue/questions`), worker dispatch Task 5. ✓
- **Save not push:** Task 4 `save` writes `ID Practice Questions/…`, no AnkiConnect; ● badge via existing `scan_counts`. ✓
- **Precheck / fallbacks:** Task 3 `precheck`, Task 5 endpoint + 409, Task 6 button logic (make-cards-first / dropzone / draft). ✓
- **Endpoints mirror cards + worker by kind:** Task 5. ✓  **Review tray (stem/subs/answers):** Task 6. ✓
- **Type consistency:** `q_draft_fn(prompt)->list[question]` used in Task 4 `process_job`, Task 5 `_real_q_draft_fn`/`make_server`/worker, stubbed in Task 5 tests. `save(...)->{"saved":n}` consumed by Task 5 endpoint + Task 6 `saveQTray`. `list_jobs(kind=…)` rows `{id,nn,title,status,count}` consumed by Task 6 `refreshQJobs`. `kind="cards"` default keeps every existing card call site working. Consistent.
- **Placeholder scan:** none; all code steps complete.
