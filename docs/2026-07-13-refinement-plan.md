# Refinement (Per-Session Generation + PDF Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate cards/questions per reading *session* (not per chapter), and export a chapter's/session's questions as a clean RC-exam-styled PDF.

**Architecture:** Re-key the source PDF + jobs from chapter `nn` to `sessionId` (`queue/source/<sessionId>.pdf`); questions save per session (`<sessionId>.json`). New `export_pdf.py` renders questions to PDF with PyMuPDF (`fitz`, already installed). One export endpoint serves a session PDF (`session=`) or the combined chapter PDF (omit `session`). Dashboard moves generate controls onto session rows and adds Export buttons.

**Tech Stack:** Python 3.9 stdlib + PyMuPDF; vanilla JS. pytest, Claude/Anki stubbed. Part 1 of the spec (de-lag) is already done (commit 22a3beb).

**Working dir:** `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform`
**Spec:** `docs/2026-07-13-refinement-per-session-and-export-design.md`.

---

## File Structure

```
cards_core.py       # MODIFY: _ingest_upload keys source PDF by sessionId; job carries sessionId
questions_core.py   # MODIFY: source_pdf/precheck/ingest key by sessionId; save -> <sessionId>.json;
                    #         add load_session_questions / load_all_questions
export_pdf.py       # NEW: build(header, questions) -> PDF bytes (fitz)
serve.py            # MODIFY: generate/upload/precheck accept sessionId; add /api/questions/export
dashboard.html      # MODIFY: generate controls per session row; per-session + per-chapter Export PDF
tests/test_cards_core.py, test_questions_core.py, test_cards_endpoints.py,
tests/test_questions_endpoints.py   # MODIFY: new signatures
tests/test_export_pdf.py            # NEW
```

Job dicts gain `"sessionId"`. Question files are named `<sessionId>.json` (was `<date>.json`).

---

## Task 1: Key the source PDF + jobs by sessionId

**Files:** Modify `cards_core.py`, `questions_core.py`, `tests/test_cards_core.py`, `tests/test_questions_core.py`

- [ ] **Step 1: Update the affected tests to the new signatures**

In `tests/test_cards_core.py`, replace `test_ingest_upload_creates_pending_with_highlights` and `test_ingest_upload_retains_source_pdf` with (note the new `_ingest_upload(base, session_id, nn, title, pdf)` signature and `queue/source/<sessionId>.pdf`):
```python
def test_ingest_upload_creates_pending_with_highlights(tmp_path):
    import fitz
    doc = fitz.open(); page = doc.new_page()
    s = "Daptomycin is a lipopeptide antibiotic."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s): page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close()
    job = cc._ingest_upload(tmp_path, "ch30-p1", "30", "Strepto", data)
    assert job["status"] == "pending" and job["sessionId"] == "ch30-p1" and len(job["highlights"]) == 1


def test_ingest_upload_retains_session_source_pdf(tmp_path):
    import fitz
    doc = fitz.open(); page = doc.new_page()
    s = "Linezolid is an oxazolidinone."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s): page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close()
    cc._ingest_upload(tmp_path, "ch28-p2", "28", "Oxazolidinones", data)
    assert (tmp_path / "queue" / "source" / "ch28-p2.pdf").exists()
```

In `tests/test_questions_core.py`, update the source/precheck/ingest tests to key by session:
```python
def test_has_cards_and_source(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    assert qc.precheck(base, "29", "Glyco", "ch29-p1") == {"hasCards": False, "hasPdf": False}
    _write(tmp_path / "ID Anki Cards" / "29 - Glyco" / "d.json", {"cards": [{"Text": "a"}]})
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch29-p1.pdf").write_bytes(b"%PDF-1.4")
    assert qc.precheck(base, "29", "Glyco", "ch29-p1") == {"hasCards": True, "hasPdf": True}


def test_ingest_from_source_pdf(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch30-p1.pdf").write_bytes(_pdf_bytes())
    job = qc.ingest(base, "ch30-p1", "30", "Daptomycin")
    assert job["status"] == "pending" and job["sessionId"] == "ch30-p1" and len(job["highlights"]) == 1
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_cards_core.py tests/test_questions_core.py -k "ingest or source or precheck" -v`
Expected: FAIL (signatures/paths don't match yet).

- [ ] **Step 3: Re-key `cards_core._ingest_upload`**

Replace `_ingest_upload` in `cards_core.py` with:
```python
def _ingest_upload(base_dir, session_id, nn, title, pdf_bytes):
    ensure_queue(base_dir, kind="cards")
    job_id = uuid.uuid4().hex[:12]
    pdf_path = Path(base_dir) / "queue" / "cards" / "incoming" / (job_id + ".pdf")
    pdf_path.write_bytes(pdf_bytes)
    # retain a per-session source PDF so questions can reuse it without re-upload
    src = Path(base_dir) / "queue" / "source" / (str(session_id) + ".pdf")
    src.write_bytes(pdf_bytes)
    highlights = extract(str(pdf_path))
    job = {"id": job_id, "sessionId": str(session_id), "nn": str(nn), "title": str(title),
           "status": "pending", "created": datetime.now().isoformat(timespec="seconds"),
           "highlights": highlights}
    _job_path(base_dir, "pending", job_id, kind="cards").write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job
```

- [ ] **Step 4: Re-key `questions_core` source/precheck/ingest**

In `questions_core.py`, replace `source_pdf`, `precheck`, and `ingest`:
```python
def source_pdf(base_dir, session_id):
    p = Path(base_dir) / "queue" / "source" / (str(session_id) + ".pdf")
    return p if p.exists() else None


def precheck(base_dir, nn, title, session_id):
    return {"hasCards": len(load_chapter_cards(base_dir, nn, title)) > 0,
            "hasPdf": source_pdf(base_dir, session_id) is not None}


def ingest(base_dir, session_id, nn, title, pdf_bytes=None):
    """Create a pending questions job from an uploaded PDF, or the session's source PDF."""
    cards_core.ensure_queue(base_dir, kind=KIND)
    if pdf_bytes is not None:
        src = Path(base_dir) / "queue" / "source" / (str(session_id) + ".pdf")
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_bytes(pdf_bytes)
        pdf_path = src
    else:
        pdf_path = source_pdf(base_dir, session_id)
        if pdf_path is None:
            raise FileNotFoundError("no source PDF for session " + str(session_id))
    highlights = cards_core.extract(str(pdf_path))
    job = cards_core.create_job(base_dir, nn, title, highlights, kind=KIND)
    return cards_core.set_status(base_dir, job, "pending", kind=KIND, sessionId=str(session_id))
```
(Note: `create_job` doesn't take sessionId; we attach it via `set_status(..., sessionId=…)` which merges it into the job and rewrites the file in the same `pending` folder.)

- [ ] **Step 5: Run tests**

Run: `python3 -m pytest tests/test_cards_core.py tests/test_questions_core.py -k "ingest or source or precheck" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cards_core.py questions_core.py tests/test_cards_core.py tests/test_questions_core.py
git commit -m "feat: key source PDF + jobs by sessionId (per-session generation)"
```

---

## Task 2: Per-session question save + chapter load helpers

**Files:** Modify `questions_core.py`, `tests/test_questions_core.py`

- [ ] **Step 1: Update/add tests**

In `tests/test_questions_core.py`, update the save test and the process_job test to carry a `sessionId`, and add load-helper tests:
```python
def test_process_job_drafts_questions(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch30-p1.pdf").write_bytes(_pdf_bytes())
    _write(tmp_path / "ID Anki Cards" / "30 - Dapto" / "d.json", {"cards": [{"Text": "membrane"}]})
    job = qc.ingest(base, "ch30-p1", "30", "Dapto")
    QS = [{"stem": "s", "archetype": "pharm",
           "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    qc.process_job(base, job["id"], lambda prompt: QS)
    out = cards_core.load_job(base, job["id"], kind="questions")
    assert out["status"] == "drafted" and out["questions"][0]["stem"] == "s"


def test_save_writes_per_session_json(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    cards_core.ensure_queue(base, kind="questions")
    job = cards_core.create_job(base, "30", "Daptomycin", [], kind="questions")
    job = cards_core.set_status(base, job, "drafted", kind="questions",
                                sessionId="ch30-p2",
                                questions=[{"stem": "s", "subquestions": []}])
    approved = [{"stem": "s2", "archetype": "pharm",
                 "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    res = qc.save(base, job, approved)
    f = tmp_path / "ID Practice Questions" / "30 - Daptomycin" / "ch30-p2.json"
    assert f.exists() and res["saved"] == 1
    assert json.loads(f.read_text())["questions"][0]["stem"] == "s2"
    assert cards_core.load_job(base, job["id"], kind="questions")["status"] == "saved"


def test_load_session_and_all_questions(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    d = tmp_path / "ID Practice Questions" / "30 - Daptomycin"
    _write(d / "ch30-p1.json", {"questions": [{"stem": "q1", "subquestions": []}]})
    _write(d / "ch30-p2.json", {"questions": [{"stem": "q2", "subquestions": []},
                                              {"stem": "q3", "subquestions": []}]})
    one = qc.load_session_questions(base, "30", "Daptomycin", "ch30-p1")
    assert [q["stem"] for q in one] == ["q1"]
    allq = qc.load_all_questions(base, "30", "Daptomycin")
    assert sorted(q["stem"] for q in allq) == ["q1", "q2", "q3"]
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_questions_core.py -k "save or load_session or process_job" -v`
Expected: FAIL (save writes `<date>.json`; load helpers undefined).

- [ ] **Step 3: Implement**

Replace `save` in `questions_core.py` and append the load helpers:
```python
def save(base_dir, job, approved_questions):
    """Write approved questions to ID Practice Questions/<NN - Title>/<sessionId>.json."""
    d = _chapter_q_dir(base_dir, job["nn"], job["title"])
    d.mkdir(parents=True, exist_ok=True)
    name = (job.get("sessionId") or datetime.now().strftime("%Y-%m-%d")) + ".json"
    out = {"chapter": str(job["nn"]), "title": job["title"],
           "sessionId": job.get("sessionId", ""), "questions": approved_questions}
    (d / name).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    cards_core.set_status(base_dir, job, "saved", kind=KIND, questions=approved_questions)
    return {"saved": len(approved_questions)}


def load_session_questions(base_dir, nn, title, session_id):
    f = _chapter_q_dir(base_dir, nn, title) / (str(session_id) + ".json")
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text(encoding="utf-8")).get("questions", []) or []
    except (ValueError, OSError):
        return []


def load_all_questions(base_dir, nn, title):
    d = _chapter_q_dir(base_dir, nn, title)
    out = []
    if d.is_dir():
        for f in sorted(d.glob("*.json")):  # session files sort in reading order (p1, p2, …)
            try:
                out.extend(json.loads(f.read_text(encoding="utf-8")).get("questions", []) or [])
            except (ValueError, OSError):
                continue
    return out
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_questions_core.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add questions_core.py tests/test_questions_core.py
git commit -m "feat: per-session question save + chapter question loaders"
```

---

## Task 3: export_pdf.py — RC-exam-styled PDF

**Files:** Create `export_pdf.py`, `tests/test_export_pdf.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_export_pdf.py`:
```python
import fitz
import export_pdf


HEADER = {"chapter": "Chapter 82 — Endocarditis and Intravascular Infections",
          "subtitle": "pp. 1012–1017 · practice questions"}
QS = [{"stem": "A 40M with prosthetic valve endocarditis.", "archetype": "clinical",
       "subquestions": [
           {"prompt": "Name 2 empiric agents", "count": 2, "marks": 1.5, "answer": ["vancomycin", "gentamicin"]},
           {"prompt": "Name 1 indication for surgery", "count": 1, "marks": 1, "answer": ["heart failure"]},
       ]}]


def test_build_returns_pdf_with_questions_and_answers():
    data = export_pdf.build(HEADER, QS)
    assert data[:4] == b"%PDF"
    doc = fitz.open(stream=data, filetype="pdf")
    txt = "".join(p.get_text() for p in doc)
    assert "Endocarditis" in txt
    assert "Name 2 empiric agents" in txt
    assert "(1.5)" in txt              # mark weighting rendered
    assert "Answer Key" in txt
    assert "vancomycin" in txt         # model answer present
    assert doc.page_count >= 2         # questions page + answer-key page


def test_build_empty_questions_still_valid_pdf():
    data = export_pdf.build(HEADER, [])
    assert data[:4] == b"%PDF"
```

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_export_pdf.py -v`
Expected: FAIL (`No module named 'export_pdf'`).

- [ ] **Step 3: Implement**

Create `export_pdf.py`:
```python
"""Render practice questions to a clean RC-exam-styled PDF using PyMuPDF."""
from __future__ import annotations

import fitz

_MARGIN = 54
_REG, _BOLD, _ITAL = "helv", "hebo", "heit"


def _wrap(font, size, width, text):
    words = str(text).split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if font.text_length(t, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


class _Doc:
    def __init__(self):
        self.doc = fitz.open()
        self.rf, self.bf, self.itf = fitz.Font(_REG), fitz.Font(_BOLD), fitz.Font(_ITAL)
        self.page = None
        self.y = 0
        self.rect = fitz.paper_rect("letter")

    def _newpage(self):
        self.page = self.doc.new_page(width=self.rect.width, height=self.rect.height)
        self.y = _MARGIN

    def line(self, text, size=11, style="reg", indent=0, gap=3):
        font = {"bold": self.bf, "ital": self.itf}.get(style, self.rf)
        fname = {"bold": _BOLD, "ital": _ITAL}.get(style, _REG)
        if self.page is None:
            self._newpage()
        width = self.rect.width - 2 * _MARGIN - indent
        for ln in _wrap(font, size, width, text):
            if self.y + size + gap > self.rect.height - _MARGIN:
                self._newpage()
            self.page.insert_text((_MARGIN + indent, self.y + size), ln,
                                  fontname=fname, fontsize=size)
            self.y += size + gap

    def space(self, h=8):
        self.y += h

    def rule(self):
        if self.page is None:
            self._newpage()
        self.page.draw_line((_MARGIN, self.y), (self.rect.width - _MARGIN, self.y),
                            color=(0.6, 0.6, 0.6), width=0.6)
        self.y += 8


def build(header, questions):
    """header: {chapter, subtitle}; questions: list of {stem, subquestions:[{prompt,marks,answer}]}."""
    d = _Doc()
    d.line(header.get("chapter", "Practice Questions"), size=16, style="bold")
    if header.get("subtitle"):
        d.line(header["subtitle"], size=10, style="ital")
    d.rule(); d.space(4)
    for i, q in enumerate(questions, 1):
        d.line(str(i) + ".  " + q.get("stem", ""), size=11, style="bold")
        for sq in q.get("subquestions", []) or []:
            marks = sq.get("marks", "")
            d.line("(" + str(marks) + ")  " + sq.get("prompt", ""), size=10.5, indent=18)
            d.space(14)  # room to write an answer
        d.space(8)
    # answer key on a fresh page
    d._newpage()
    d.line("Answer Key", size=15, style="bold"); d.rule(); d.space(4)
    for i, q in enumerate(questions, 1):
        d.line(str(i) + ".  " + q.get("stem", ""), size=10.5, style="bold")
        for sq in q.get("subquestions", []) or []:
            d.line(sq.get("prompt", ""), size=10, style="ital", indent=18)
            for a in sq.get("answer", []) or []:
                d.line("•  " + str(a), size=10, indent=30)
        d.space(6)
    return d.doc.tobytes()
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/test_export_pdf.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add export_pdf.py tests/test_export_pdf.py
git commit -m "feat: export_pdf — RC-exam-styled question PDF via fitz"
```

---

## Task 4: serve.py — sessionId params + export endpoint

**Files:** Modify `serve.py`, `tests/test_questions_endpoints.py`, `tests/test_cards_endpoints.py`

- [ ] **Step 1: Update endpoint tests + add export test**

In `tests/test_cards_endpoints.py`, the upload call gains `sessionId`. Update `test_upload_then_draft_then_list`'s POST path to `"/api/cards/upload?sessionId=ch29-p1&nn=29&title=Glycopeptides"`.

In `tests/test_questions_endpoints.py`, update the generate call to include `sessionId`, and add an export test. Replace `test_generate_from_uploaded_pdf_then_save` with:
```python
def test_generate_then_save_then_export(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, b = _post(port, "/api/questions/generate?sessionId=ch31-p1&nn=31&title=Ceftaroline",
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
        st, sv = _post(port, f"/api/questions/job/{jid}/save", obj={"questions": STUB_QS})
        assert st == 200 and json.loads(sv)["saved"] == 1
        # per-session export streams a PDF
        st, pdf = _get_raw(port, "/api/questions/export?nn=31&title=Ceftaroline&session=ch31-p1")
        assert st == 200 and pdf[:4] == b"%PDF"
        # combined chapter export also works
        st, pdf2 = _get_raw(port, "/api/questions/export?nn=31&title=Ceftaroline")
        assert st == 200 and pdf2[:4] == b"%PDF"
    finally:
        httpd.shutdown()
```
Add a raw-bytes GET helper near `_get` in that test file:
```python
def _get_raw(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as r:
        return r.status, r.read()
```
The stub job needs a sessionId so save writes `ch31-p1.json`. The worker path sets it via `questions_core.ingest`, so no test change needed there — `ingest` attaches `sessionId`.

- [ ] **Step 2: Run to confirm failure**

Run: `python3 -m pytest tests/test_questions_endpoints.py tests/test_cards_endpoints.py -v`
Expected: FAIL (upload/generate ignore sessionId; export route 404).

- [ ] **Step 3: Modify `serve.py`**

(a) Add `import export_pdf` near the other imports.

(b) Cards upload — pass sessionId. Find the `/api/cards/upload` block and change the `_ingest_upload` call to:
```python
            job = cards_core._ingest_upload(self._pdir(), q.get("sessionId", ""),
                                            q.get("nn", ""), q.get("title", ""), pdf)
```

(c) Questions generate — pass sessionId. In the `/api/questions/generate` block change the ingest call to:
```python
                job = questions_core.ingest(self._pdir(), q.get("sessionId", ""),
                                            q.get("nn", ""), q.get("title", ""), pdf)
```

(d) Questions precheck — pass sessionId. Change the precheck call to:
```python
            self._send_json(questions_core.precheck(self._pdir(), q.get("nn", ""),
                                                    q.get("title", ""), q.get("sessionId", "")))
```

(e) Add the export route in `do_GET`, before the final 404:
```python
        if route == "/api/questions/export":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            nn, title, sess = q.get("nn", ""), q.get("title", ""), q.get("session")
            if sess:
                qs = questions_core.load_session_questions(self._pdir(), nn, title, sess)
                sub = "session " + sess + " · practice questions"
                fname = sess + ".pdf"
            else:
                qs = questions_core.load_all_questions(self._pdir(), nn, title)
                sub = "all sessions · practice questions"
                fname = str(nn) + " - " + title + " - all questions.pdf"
            header = {"chapter": "Chapter " + str(nn) + " — " + title, "subtitle": sub}
            data = export_pdf.build(header, qs)
            # durable copy alongside the question JSON
            outdir = questions_core._chapter_q_dir(self._pdir(), nn, title)
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / fname).write_bytes(data)
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", 'attachment; filename="' + fname + '"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest tests/ -q`
Expected: all pass (updated endpoint tests + everything else).

- [ ] **Step 5: Commit**

```bash
git add serve.py tests/test_questions_endpoints.py tests/test_cards_endpoints.py
git commit -m "feat: sessionId on generate/upload/precheck + /api/questions/export"
```

---

## Task 5: dashboard.html — per-session generate controls + Export buttons

**Files:** Modify `dashboard.html`

The generate controls currently live in the per-chapter `.chapgen` bar. Move them to each session row and pass `sessionId`. Add per-session and per-chapter Export buttons.

- [ ] **Step 1: Give the chapter bar a per-chapter Export button; keep it as the chapter header**

In `openPanel`, the `.chapgen` block currently holds Generate cards/questions. Replace its two generate buttons + statuses with a single chapter-level export control:
```javascript
      html+='<div class="chapgen" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">'
        +'<span class="cglabel">Chapter '+nn+'</span>'
        +'<button class="mbtn cxbtn" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">⬇ Export chapter PDF</button>'
        +'<span class="cgstatus" id="cx-'+nn+'"></span></div>';
```

- [ ] **Step 2: Add per-session generate + export controls into each row**

In the row template (the `.q` block), replace the `.qacts` div with per-session actions carrying `sessionId` (= `r.id`):
```javascript
      +'<div class="qacts">'
      +'<button class="mbtn gbtn" data-sess="'+r.id+'" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">✦ Cards</button>'
      +'<span class="cgstatus" id="cg-'+r.id+'"></span>'
      +'<button class="mbtn gbtn qgbtn" data-sess="'+r.id+'" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">✦ Questions</button>'
      +'<span class="cgstatus" id="qcg-'+r.id+'"></span>'
      +'<button class="mbtn xbtn" data-sess="'+r.id+'" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'" style="display:none">⬇ PDF</button>'
      +'</div>'
```

- [ ] **Step 3: Rewire the click handlers**

After `body.innerHTML=html;`, replace the existing `.gbtn`/`.qgbtn` wiring with session-aware wiring, and add export wiring:
```javascript
  Array.prototype.forEach.call(body.querySelectorAll(".gbtn:not(.qgbtn)"),function(b){
    b.onclick=function(){ showDropzone(b.dataset.sess, b.dataset.nn, b.dataset.title, b); };
  });
  Array.prototype.forEach.call(body.querySelectorAll(".qgbtn"),function(b){
    b.onclick=function(){ startQuestions(b.dataset.sess, b.dataset.nn, b.dataset.title, b); };
  });
  Array.prototype.forEach.call(body.querySelectorAll(".xbtn"),function(b){
    b.onclick=function(){ exportPDF(b.dataset.nn, b.dataset.title, b.dataset.sess); };
  });
  Array.prototype.forEach.call(body.querySelectorAll(".cxbtn"),function(b){
    b.onclick=function(){ exportPDF(b.dataset.nn, b.dataset.title, null); };
  });
  refreshCardJobs(); refreshQJobs();
```

- [ ] **Step 4: Update the card/question JS to be session-keyed**

Replace `showDropzone`, `uploadPdf`, `startQuestions`, `questionsDropzone`, `genQuestions`, and the status maps so they key by session id. Exact replacements:
```javascript
function showDropzone(sess,nn,title,anchor){
  var host=anchor.closest(".qacts");
  if(host.querySelector(".dz")) return;
  var dz=document.createElement("div"); dz.className="dz";
  dz.textContent="Drop the highlighted PDF for this reading";
  var inp=document.createElement("input"); inp.type="file"; inp.accept="application/pdf"; inp.style.display="none"; dz.appendChild(inp);
  anchor.closest(".q").appendChild(dz);
  dz.onclick=function(){ inp.click(); };
  inp.onchange=function(){ if(inp.files[0]) uploadPdf(sess,nn,title,inp.files[0],dz); };
  dz.ondragover=function(e){ e.preventDefault(); dz.classList.add("hot"); };
  dz.ondragleave=function(){ dz.classList.remove("hot"); };
  dz.ondrop=function(e){ e.preventDefault(); dz.classList.remove("hot"); if(e.dataTransfer.files[0]) uploadPdf(sess,nn,title,e.dataTransfer.files[0],dz); };
}
function uploadPdf(sess,nn,title,file,dz){
  dz.textContent="Uploading & scanning…";
  fetch("/api/cards/upload?sessionId="+encodeURIComponent(sess)+"&nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title),
    {method:"POST",headers:{"Content-Type":"application/pdf"},body:file})
    .then(function(r){return r.json();}).then(function(){ dz.remove(); toastMsg("Drafting cards…"); pollCardJobs(); })
    .catch(function(){ dz.textContent="Upload failed"; });
}
function startQuestions(sess,nn,title,anchor){
  var st=document.getElementById("qcg-"+sess); if(st) st.textContent="· checking…";
  fetch("/api/questions/precheck?nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title)+"&sessionId="+encodeURIComponent(sess))
    .then(function(r){return r.json();}).then(function(pc){
      if(!pc.hasCards){ if(st) st.textContent="· make cards first"; return; }
      if(!pc.hasPdf){ if(st) st.textContent="· drop the PDF (via ✦ Cards) first"; return; }
      genQuestions(sess,nn,title,st);
    }).catch(function(){ if(st) st.textContent="· error"; });
}
function genQuestions(sess,nn,title,st){
  if(st) st.textContent="· drafting…";
  fetch("/api/questions/generate?sessionId="+encodeURIComponent(sess)+"&nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title),{method:"POST"})
    .then(function(r){return r.json();}).then(function(){ toastMsg("Drafting questions…"); pollQJobs(); })
    .catch(function(){ if(st) st.textContent="· failed"; });
}
function exportPDF(nn,title,sess){
  var qs="nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title)+(sess?"&session="+encodeURIComponent(sess):"");
  window.open("/api/questions/export?"+qs, "_blank");
}
```
Update `renderCardStatuses` and `renderQStatuses` to key by `j.sessionId` instead of `j.nn`, and target `cg-<sessionId>` / `qcg-<sessionId>` / show the `.xbtn` when a session has saved questions:
```javascript
function renderCardStatuses(){
  Object.keys(CARDJOBS).forEach(function(sess){
    var j=CARDJOBS[sess], el=document.getElementById("cg-"+sess); if(!el) return;
    if(j.status==="pending"||j.status==="drafting") el.textContent="· drafting…";
    else if(j.status==="drafted"){ el.textContent="· review ("+j.count+")"; var host=el.closest(".q"); if(host) ensureTray(host.querySelector(".qacts"),j.id); }
    else if(j.status==="error") el.textContent="· failed";
    else if(j.status==="pushed") el.textContent="· pushed ✓";
  });
}
function renderQStatuses(){
  Object.keys(QJOBS).forEach(function(sess){
    var j=QJOBS[sess], el=document.getElementById("qcg-"+sess); if(!el) return;
    if(j.status==="pending"||j.status==="drafting") el.textContent="· drafting…";
    else if(j.status==="drafted"){ el.textContent="· review ("+j.count+")"; var host=el.closest(".q"); if(host) ensureQTray(host.querySelector(".qacts"),j.id); }
    else if(j.status==="error") el.textContent="· failed";
    else if(j.status==="saved"){ el.textContent="· saved ✓"; var xb=el.closest(".q"); if(xb){ var x=xb.querySelector(".xbtn"); if(x) x.style.display=""; } }
  });
}
```
And in `refreshCardJobs`/`refreshQJobs`, key the map by `sessionId`:
```javascript
function refreshCardJobs(){ return fetch("/api/cards/jobs").then(function(r){return r.json();}).then(function(rows){ CARDJOBS={}; rows.forEach(function(j){ if(j.sessionId) CARDJOBS[j.sessionId]=j; }); renderCardStatuses(); }).catch(function(){}); }
function refreshQJobs(){ return fetch("/api/questions/jobs").then(function(r){return r.json();}).then(function(rows){ QJOBS={}; rows.forEach(function(j){ if(j.sessionId) QJOBS[j.sessionId]=j; }); renderQStatuses(); }).catch(function(){}); }
```
Note: `list_jobs` must include `sessionId` in its row summary. In `cards_core.list_jobs`, add `"sessionId": j.get("sessionId")` to the row dict. (Add that one key.)

The `ensureTray`/`ensureQTray` functions take a host element to insert after — pass the row's `.qacts`; they already insert a sibling tray. `pushTray`/`saveQTray`/`pollCardJobs`/`pollQJobs` are unchanged except `pollQJobs`/`pollCardJobs` iterate `CARDJOBS`/`QJOBS` values (already do).

- [ ] **Step 5: Add CSS for the new buttons** (before `</style>`):
```css
.q .qacts{flex-wrap:wrap;gap:6px 8px}
.xbtn,.cxbtn{border-color:var(--gold) !important;color:var(--gold) !important;background:rgba(255,206,92,.06) !important}
```

- [ ] **Step 6: Verify in the browser**

Restart the server; open a sector. Confirm each session row shows **✦ Cards** and **✦ Questions**; the chapter bar shows **⬇ Export chapter PDF**. `read_console_messages` (onlyErrors) → none. `curl -s http://127.0.0.1:8756/ | grep -c 'data-sess='` ≥ 1. `node --check` on the extracted `<script>` passes.

- [ ] **Step 7: Commit**

```bash
git add dashboard.html cards_core.py
git commit -m "feat: per-session generate controls + PDF export buttons"
```

---

## Task 6: End-to-end verification

**Files:** none

- [ ] **Step 1: Full suite** — `python3 -m pytest tests/ -q` → all pass.

- [ ] **Step 2: Simulated e2e (fake claude).** Point `config.json` at a fake `claude` emitting an RC question array. Seed `ID Anki Cards/9995 - E2E/<date>.json` (a card) and `queue/source/ch9995-p1.pdf`. `POST /api/cards/upload?sessionId=ch9995-p1&nn=9995&title=E2E` (real short-highlight PDF) → drafted; `POST /api/questions/generate?sessionId=ch9995-p1&nn=9995&title=E2E` → drafted → `POST …/save`. Confirm `ID Practice Questions/9995 - E2E/ch9995-p1.json` exists. Then `GET /api/questions/export?nn=9995&title=E2E&session=ch9995-p1` returns a `%PDF`, and `GET …/export?nn=9995&title=E2E` (combined) returns a `%PDF`. Confirm the durable PDFs were written into the chapter folder.

- [ ] **Step 3: Clean up** — delete `ID Anki Cards/9995 - E2E`, `ID Practice Questions/9995 - E2E`, `queue/`, and `config.json`; confirm `/api/status` read-count unchanged and jobs empty.

- [ ] **Step 4: Browser smoke** — open a real chapter; confirm per-session ✦ Cards / ✦ Questions and the chapter Export button render; open the exported PDF for a session that has questions and eyeball the layout. Screenshot.

- [ ] **Step 5: Commit any fixes** — `git add -A && git commit -m "fix: refinement e2e adjustments"`.

---

## Self-Review Notes

- **Spec §2 per-session:** source PDF + jobs keyed by sessionId (Task 1), questions saved per session (Task 2), generate controls per row + sessionId params (Tasks 4–5), badges unchanged (scan_counts untouched). ✓
- **Spec §3 export:** `export_pdf.build` questions + answer key (Task 3); per-session vs combined via `session=` (Task 4); per-session + per-chapter buttons (Task 5); durable copy written (Task 4). ✓
- **Grounding unchanged** (session highlights + chapter cards): `questions_core.process_job`/`build_qprompt` untouched. ✓
- **Type consistency:** `_ingest_upload(base, session_id, nn, title, pdf)` and `ingest(base, session_id, nn, title, pdf)` — both callers updated in Task 4. `save` writes `<sessionId>.json`; `load_session_questions`/`load_all_questions` read it; export endpoint + `export_pdf.build(header, questions)` consume the list. `list_jobs` rows gain `sessionId`, consumed by dashboard `refreshCardJobs`/`refreshQJobs`. Consistent.
- **Placeholder scan:** none; all code steps complete.
- **Note:** `load_all_questions` sorts session files lexically (`ch82-p1 < ch82-p2 < … < ch82-p10` breaks natural order only past p9 — acceptable; chapters rarely exceed 9 sessions, and the exam sheet order is non-critical).
