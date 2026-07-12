# SP2 — In-App Card Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the cockpit, drop a chapter's highlighted PDF and have the dashboard draft Anki cards by itself (headless Claude on the user's subscription), review them in-app, and push approved ones to Anki — updating the ◆ badge live.

**Architecture:** A shared `ai_engine.py` shells out to the `claude` CLI (`claude -p`) to draft; `cards_core.py` owns PDF extraction (reusing the id-anki-cards `extract_highlights.py` via import), prompt building, a file-based job lifecycle under `queue/`, and Anki push (shelling the id-anki-cards `add_cards.py`). `serve.py` gains a single background worker thread and `/api/cards/*` endpoints; `dashboard.html` gains a per-chapter generate dropzone + review tray. Every AI/Anki call is injected so tests stub them — no network, no cost.

**Tech Stack:** Python 3.9 stdlib + PyMuPDF (`fitz`, already installed) for extraction; the `claude` CLI for drafting; AnkiConnect (via the existing `add_cards.py`) for push; vanilla JS for UI. pytest for tests.

**Working dir:** `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform`

**Reused external assets (id-anki-cards skill):**
- `~/.claude/skills/id-anki-cards/scripts/extract_highlights.py` → `extract_highlights_with_context(pdf_path, start_page, end_page)`
- `~/.claude/skills/id-anki-cards/scripts/add_cards.py` → CLI: `python3 add_cards.py <spec.json>`; exit 0 = pushed, exit 2 = Anki unreachable; always writes `<spec>.txt`
- `~/.claude/skills/id-anki-cards/STYLE_GUIDE.md`, `examples.md` → drafting grounding

---

## File Structure

```
8. Claude/ID Platform/
  ai_engine.py        # NEW: draft() (shells claude), parse_cards()
  cards_core.py       # NEW: paths/config, extract, build_prompt, job lifecycle, push, process_job
  serve.py            # MODIFY: worker thread + /api/cards/* routes
  dashboard.html      # MODIFY: per-chapter generate dropzone + review tray
  Enable AI drafting.command   # NEW: one-time CLI install + login + config
  config.json         # runtime (gitignored)
  queue/{incoming,pending,drafts,done}/   # runtime (gitignored)
  tests/
    test_ai_engine.py       # NEW
    test_cards_core.py       # NEW
    test_cards_endpoints.py  # NEW
    conftest.py              # exists (adds platform dir to sys.path)
```

Constants used across tasks (define once in `cards_core.py`, import in tests):
- `SKILL_DIR = Path(os.environ.get("ID_SKILL_DIR", os.path.expanduser("~/.claude/skills/id-anki-cards")))`
- `SKILL_SCRIPTS = SKILL_DIR / "scripts"`
- Deck `Infectious Disease::Mandell`, model `Cloze-AnKingMaster-v3`.

Job JSON schema (one file per job, filename `<id>.json`):
`{"id","nn","title","status","created","highlights":[{"highlight","context"}],"cards":[{"Text","Extra"}]?,"error"?,"pushed":{"added","skipped"}?}`
Statuses: `pending → drafting → drafted → pushed | error`.

---

## Task 1: cards_core foundations — paths, config, queue

**Files:** Create `cards_core.py`; Test `tests/test_cards_core.py`; Modify `.gitignore`

- [ ] **Step 1: Add runtime artifacts to .gitignore**

Append to `.gitignore` (it currently ends with `server.log`):
```
config.json
queue/
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_cards_core.py`:
```python
import json
from pathlib import Path

import cards_core as cc


def test_ensure_queue_creates_dirs(tmp_path):
    cc.ensure_queue(tmp_path)
    for sub in ("incoming", "pending", "drafts", "done"):
        assert (tmp_path / "queue" / sub).is_dir()


def test_load_config_missing_is_unconfigured(tmp_path):
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] is None
    assert cc.is_configured(tmp_path) is False


def test_load_config_reads_file(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps(
        {"claudePath": "/usr/local/bin/claude", "model": None, "timeoutSec": 120}))
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] == "/usr/local/bin/claude"
    assert cfg["timeoutSec"] == 120
    assert cc.is_configured(tmp_path) is True
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_core.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'cards_core'`

- [ ] **Step 4: Write minimal implementation**

Create `cards_core.py`:
```python
"""In-app card generation: extraction, job lifecycle, Anki push. Python 3.9."""
from __future__ import annotations

import json
import os
from pathlib import Path

SKILL_DIR = Path(os.environ.get("ID_SKILL_DIR", os.path.expanduser("~/.claude/skills/id-anki-cards")))
SKILL_SCRIPTS = SKILL_DIR / "scripts"
DECK = "Infectious Disease::Mandell"
MODEL = "Cloze-AnKingMaster-v3"
QUEUE_SUBDIRS = ("incoming", "pending", "drafts", "done")
_STATUS_DIR = {"pending": "pending", "drafting": "pending", "drafted": "drafts",
               "pushed": "done", "error": "drafts"}


def ensure_queue(base_dir):
    for sub in QUEUE_SUBDIRS:
        (Path(base_dir) / "queue" / sub).mkdir(parents=True, exist_ok=True)


def load_config(base_dir):
    p = Path(base_dir) / "config.json"
    cfg = {"claudePath": None, "model": None, "timeoutSec": 240}
    if p.exists():
        try:
            cfg.update(json.loads(p.read_text(encoding="utf-8")))
        except (ValueError, OSError):
            pass
    return cfg


def is_configured(base_dir):
    cp = load_config(base_dir)["claudePath"]
    return bool(cp) and Path(cp).exists()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add cards_core.py tests/test_cards_core.py .gitignore
git commit -m "feat: cards_core foundations (paths, config, queue dirs)"
```

---

## Task 2: ai_engine — draft() and parse_cards()

**Files:** Create `ai_engine.py`; Test `tests/test_ai_engine.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_ai_engine.py`:
```python
import subprocess
import pytest

import ai_engine as ae


def fake_runner(result):
    def run(cmd, **kw):
        return result
    return run


def test_draft_returns_stdout_and_passes_prompt():
    seen = {}
    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="[]", stderr="")
    out = ae.draft("PROMPT", claude_path="/bin/claude", runner=run)
    assert out == "[]"
    assert "/bin/claude" in seen["cmd"] and "-p" in seen["cmd"] and "PROMPT" in seen["cmd"]


def test_draft_adds_model_only_when_set():
    seen = {}
    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="[]", stderr="")
    ae.draft("P", claude_path="/bin/claude", model="claude-x", runner=run)
    assert "--model" in seen["cmd"] and "claude-x" in seen["cmd"]


def test_draft_missing_binary_raises_not_configured():
    with pytest.raises(ae.EngineNotConfigured):
        ae.draft("P", claude_path=None, runner=fake_runner(None))


def test_draft_nonzero_exit_raises_failed():
    r = subprocess.CompletedProcess(["c"], 1, stdout="", stderr="boom")
    with pytest.raises(ae.EngineFailed):
        ae.draft("P", claude_path="/bin/claude", runner=fake_runner(r))


def test_draft_timeout_raises_engine_timeout():
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)
    with pytest.raises(ae.EngineTimeout):
        ae.draft("P", claude_path="/bin/claude", runner=run)


def test_parse_cards_plain_array():
    raw = '[{"Text":"a","Extra":""},{"Text":"b","Extra":"x"}]'
    assert ae.parse_cards(raw) == [{"Text": "a", "Extra": ""}, {"Text": "b", "Extra": "x"}]


def test_parse_cards_strips_code_fence_and_prose():
    raw = 'Here you go:\n```json\n[{"Text":"a","Extra":""}]\n```\nDone.'
    assert ae.parse_cards(raw) == [{"Text": "a", "Extra": ""}]


def test_parse_cards_bad_output_raises():
    with pytest.raises(ae.BadDraftOutput):
        ae.parse_cards("no json here")


def test_parse_cards_coerces_missing_extra():
    assert ae.parse_cards('[{"Text":"a"}]') == [{"Text": "a", "Extra": ""}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ai_engine.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'ai_engine'`

- [ ] **Step 3: Write minimal implementation**

Create `ai_engine.py`:
```python
"""Headless-Claude drafting service. Shared by cards and (later) questions."""
from __future__ import annotations

import json
import re
import subprocess


class EngineNotConfigured(Exception):
    pass


class EngineTimeout(Exception):
    pass


class EngineFailed(Exception):
    pass


class BadDraftOutput(Exception):
    pass


def draft(prompt, *, claude_path, model=None, timeout=240, runner=subprocess.run):
    """Run `claude -p <prompt>` and return stdout. No tools granted (text-only)."""
    if not claude_path:
        raise EngineNotConfigured("claude CLI path not configured")
    cmd = [claude_path, "-p", prompt]
    if model:
        cmd += ["--model", model]
    try:
        result = runner(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise EngineTimeout(str(e))
    except FileNotFoundError as e:
        raise EngineNotConfigured(str(e))
    if result.returncode != 0:
        raise EngineFailed((result.stderr or "claude failed").strip())
    return result.stdout


def parse_cards(raw):
    """Pull a JSON array of {Text, Extra} from Claude's output, tolerantly."""
    if raw is None:
        raise BadDraftOutput("empty output")
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise BadDraftOutput("no JSON array found")
    try:
        arr = json.loads(text[start:end + 1])
    except ValueError as e:
        raise BadDraftOutput(str(e))
    if not isinstance(arr, list):
        raise BadDraftOutput("not a list")
    cards = []
    for item in arr:
        if isinstance(item, dict) and "Text" in item:
            cards.append({"Text": item["Text"], "Extra": item.get("Extra", "") or ""})
    if not cards:
        raise BadDraftOutput("no valid cards")
    return cards
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_ai_engine.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add ai_engine.py tests/test_ai_engine.py
git commit -m "feat: ai_engine headless-claude draft + parse_cards"
```

---

## Task 3: cards_core — PDF extraction (auto-scan)

**Files:** Modify `cards_core.py`; Test `tests/test_cards_core.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_cards_core.py`:
```python
import fitz  # PyMuPDF


def _make_highlighted_pdf(path):
    doc = fitz.open()
    page = doc.new_page()
    sentence = "Vancomycin inhibits bacterial cell wall synthesis."
    page.insert_text((72, 100), sentence, fontsize=12)
    for r in page.search_for(sentence):
        page.add_highlight_annot(r)
    page.insert_text((72, 140), "This line is not highlighted.", fontsize=12)
    doc.save(str(path))
    doc.close()


def test_extract_finds_highlighted_text(tmp_path):
    pdf = tmp_path / "ch.pdf"
    _make_highlighted_pdf(pdf)
    hs = cc.extract(str(pdf))
    assert len(hs) == 1
    assert "Vancomycin" in hs[0]["highlight"]
    assert "highlight" in hs[0] and "context" in hs[0]


def test_extract_no_highlights_returns_empty(tmp_path):
    doc = fitz.open(); doc.new_page().insert_text((72, 72), "plain"); 
    p = tmp_path / "plain.pdf"; doc.save(str(p)); doc.close()
    assert cc.extract(str(p)) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_core.py -k extract -v`
Expected: FAIL `AttributeError: module 'cards_core' has no attribute 'extract'`

- [ ] **Step 3: Write minimal implementation**

Add imports at the top of `cards_core.py` (below existing imports):
```python
import importlib.util
import fitz  # PyMuPDF
```

Append to `cards_core.py`:
```python
def _load_skill_module(name):
    """Import a module from the id-anki-cards scripts dir by file path."""
    path = SKILL_SCRIPTS / (name + ".py")
    spec = importlib.util.spec_from_file_location("idac_" + name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def extract(pdf_path):
    """Auto-scan the whole PDF; return [{'highlight','context'}] for each highlight."""
    with fitz.open(pdf_path) as doc:
        pages = doc.page_count
    eh = _load_skill_module("extract_highlights")
    pairs = eh.extract_highlights_with_context(pdf_path, 1, pages)
    out = []
    for page_num, hi, ctx in pairs:  # confirmed shape: (page, highlight, context)
        hi = (hi or "").strip()
        if hi:
            out.append({"highlight": hi, "context": (ctx or "").strip()})
    return out
```

Confirmed by reading the source: `extract_highlights_with_context` returns a
list of `(page_num, highlight_text, context_text)` tuples (docstring: "Returns a
list of (page_num, highlight_text, context_text) tuples").

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -k extract -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add cards_core.py tests/test_cards_core.py
git commit -m "feat: cards_core PDF highlight extraction (auto-scan)"
```

---

## Task 4: cards_core — tag derivation and prompt building

**Files:** Modify `cards_core.py`; Test `tests/test_cards_core.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_cards_core.py`:
```python
def test_derive_tag_colons_and_ampersand():
    tag = cc.derive_tag("20", "Penicillins and B-Lactamase Inhibitors")
    assert tag == "Chapter::20::Penicillins::and::B-Lactamase::Inhibitors"


def test_build_prompt_includes_grounding_and_highlights():
    hs = [{"highlight": "Vanco inhibits cell wall", "context": "Vancomycin ... cell wall."}]
    prompt = cc.build_prompt("29", "Glycopeptides", hs,
                             style_guide="STYLE RULES HERE", examples="EXAMPLE CARDS")
    assert "STYLE RULES HERE" in prompt and "EXAMPLE CARDS" in prompt
    assert "Vanco inhibits cell wall" in prompt
    assert "Chapter 29" in prompt and "Glycopeptides" in prompt
    assert "JSON" in prompt  # instructs JSON-only output
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_core.py -k "tag or prompt" -v`
Expected: FAIL `AttributeError` on `derive_tag`

- [ ] **Step 3: Write minimal implementation**

Append to `cards_core.py`:
```python
def derive_tag(nn, title):
    """Chapter::NN::Title::With::Colons — spaces become '::', words kept verbatim."""
    words = str(title).strip().split()
    return "::".join(["Chapter", str(nn)] + words)


def build_prompt(nn, title, highlights, style_guide, examples):
    """Assemble the drafting prompt: grounding + highlights + JSON-only instruction."""
    lines = []
    for h in highlights:
        lines.append("HIGHLIGHT: " + h["highlight"])
        if h.get("context"):
            lines.append("CONTEXT  : " + h["context"])
        lines.append("")
    body = "\n".join(lines).strip()
    return (
        "You are drafting Anki cloze cards for Chapter " + str(nn) + " — " + str(title) + ".\n\n"
        "Follow this style guide exactly:\n\n" + style_guide + "\n\n"
        "Worked examples of the target style:\n\n" + examples + "\n\n"
        "Draft cards ONLY from the highlighted facts below. Every fact in a card must\n"
        "come from these highlights or their context — never outside knowledge.\n\n"
        + body + "\n\n"
        "Output ONLY a JSON array of objects with keys \"Text\" and \"Extra\" "
        "(Extra may be an empty string). No prose, no code fence."
    )


def read_grounding():
    """Read STYLE_GUIDE.md and examples.md from the id-anki-cards skill dir."""
    def _read(name):
        p = SKILL_DIR / name
        try:
            return p.read_text(encoding="utf-8")
        except OSError:
            return ""
    return _read("STYLE_GUIDE.md"), _read("examples.md")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -k "tag or prompt" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add cards_core.py tests/test_cards_core.py
git commit -m "feat: cards_core tag derivation + drafting prompt builder"
```

---

## Task 5: cards_core — job lifecycle

**Files:** Modify `cards_core.py`; Test `tests/test_cards_core.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_cards_core.py`:
```python
def test_create_and_load_job(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glycopeptides",
                        [{"highlight": "h", "context": "c"}])
    assert job["status"] == "pending" and job["nn"] == "29" and job["id"]
    loaded = cc.load_job(tmp_path, job["id"])
    assert loaded["title"] == "Glycopeptides"
    assert (tmp_path / "queue" / "pending" / (job["id"] + ".json")).exists()


def test_set_status_moves_file(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    assert not (tmp_path / "queue" / "pending" / (job["id"] + ".json")).exists()
    assert (tmp_path / "queue" / "drafts" / (job["id"] + ".json")).exists()
    reloaded = cc.load_job(tmp_path, job["id"])
    assert reloaded["status"] == "drafted" and reloaded["cards"][0]["Text"] == "a"


def test_list_jobs_summarizes(tmp_path):
    cc.ensure_queue(tmp_path)
    j = cc.create_job(tmp_path, "30", "Strepto", [])
    cc.set_status(tmp_path, j, "drafted", cards=[{"Text": "a", "Extra": ""}])
    rows = cc.list_jobs(tmp_path)
    assert any(r["id"] == j["id"] and r["status"] == "drafted" and r["count"] == 1 for r in rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_core.py -k "job" -v`
Expected: FAIL `AttributeError` on `create_job`

- [ ] **Step 3: Write minimal implementation**

Add imports at top of `cards_core.py`: `import uuid` and `from datetime import datetime`.

Append to `cards_core.py`:
```python
def _job_path(base_dir, status, job_id):
    return Path(base_dir) / "queue" / _STATUS_DIR[status] / (job_id + ".json")


def _find_job_file(base_dir, job_id):
    for sub in ("pending", "drafts", "done"):
        p = Path(base_dir) / "queue" / sub / (job_id + ".json")
        if p.exists():
            return p
    return None


def create_job(base_dir, nn, title, highlights):
    ensure_queue(base_dir)
    job = {
        "id": uuid.uuid4().hex[:12],
        "nn": str(nn), "title": str(title),
        "status": "pending",
        "created": datetime.now().isoformat(timespec="seconds"),
        "highlights": highlights,
    }
    _job_path(base_dir, "pending", job["id"]).write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def load_job(base_dir, job_id):
    p = _find_job_file(base_dir, job_id)
    if not p:
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def set_status(base_dir, job, status, **updates):
    """Update job dict, move its file to the folder for `status`, persist."""
    old = _find_job_file(base_dir, job["id"])
    job = dict(job)
    job["status"] = status
    job.update(updates)
    if old and old != _job_path(base_dir, status, job["id"]):
        old.unlink()
    _job_path(base_dir, status, job["id"]).write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def list_jobs(base_dir):
    ensure_queue(base_dir)
    rows = []
    for sub in ("pending", "drafts", "done"):
        for f in sorted((Path(base_dir) / "queue" / sub).glob("*.json")):
            try:
                j = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            rows.append({"id": j["id"], "nn": j.get("nn"), "title": j.get("title"),
                         "status": j.get("status"), "count": len(j.get("cards") or [])})
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -k "job" -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add cards_core.py tests/test_cards_core.py
git commit -m "feat: cards_core job lifecycle over queue folders"
```

---

## Task 6: cards_core — process_job (draft) and push

**Files:** Modify `cards_core.py`; Test `tests/test_cards_core.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_cards_core.py`:
```python
def test_process_job_drafts_and_marks_drafted(tmp_path, monkeypatch):
    cc.ensure_queue(tmp_path)
    monkeypatch.setattr(cc, "read_grounding", lambda: ("STYLE", "EX"))
    job = cc.create_job(tmp_path, "29", "Glyco", [{"highlight": "h", "context": "c"}])
    seen = {}
    def draft_fn(prompt):
        seen["prompt"] = prompt
        return [{"Text": "clozed {{c1::fact}}", "Extra": ""}]
    cc.process_job(tmp_path, job["id"], draft_fn)
    out = cc.load_job(tmp_path, job["id"])
    assert out["status"] == "drafted" and out["cards"][0]["Text"].startswith("clozed")
    assert "STYLE" in seen["prompt"] and "h" in seen["prompt"]


def test_process_job_records_error(tmp_path, monkeypatch):
    cc.ensure_queue(tmp_path)
    monkeypatch.setattr(cc, "read_grounding", lambda: ("S", "E"))
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    def draft_fn(prompt):
        raise RuntimeError("claude blew up")
    cc.process_job(tmp_path, job["id"], draft_fn)
    out = cc.load_job(tmp_path, job["id"])
    assert out["status"] == "error" and "claude blew up" in out["error"]


def test_push_writes_chapter_json_and_reports(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glycopeptides", [])
    job = cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    calls = {}
    def runner(cmd, **kw):
        calls["cmd"] = cmd
        import subprocess
        return subprocess.CompletedProcess(cmd, 0, stdout="added 1, skipped 0", stderr="")
    res = cc.push(tmp_path, job, [{"Text": "a", "Extra": ""}], runner=runner)
    assert res["anki"] == "ok"
    chdir = tmp_path / "ID Anki Cards"
    written = list(chdir.glob("29 - Glycopeptides/*.json"))
    assert written, "durable chapter JSON should be written"
    assert cc.load_job(tmp_path, job["id"])["status"] == "pushed"


def test_push_anki_offline_keeps_drafted(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    job = cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    def runner(cmd, **kw):
        import subprocess
        return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="AnkiConnect unreachable")
    res = cc.push(tmp_path, job, [{"Text": "a", "Extra": ""}], runner=runner)
    assert res["anki"] == "offline"
    assert cc.load_job(tmp_path, job["id"])["status"] == "drafted"
```

Note: `push` writes the durable chapter JSON under `<base>/ID Anki Cards/<NN - Title>/`. In production `base_dir` is `8. Claude`, so this matches the folder `scan_counts` reads. In tests it's `tmp_path/ID Anki Cards/...`.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_core.py -k "process_job or push" -v`
Expected: FAIL `AttributeError` on `process_job`

- [ ] **Step 3: Write minimal implementation**

Add `import subprocess`, `import sys` to `cards_core.py` top imports.

Append to `cards_core.py`:
```python
def process_job(base_dir, job_id, draft_fn):
    """Draft cards for a pending job. draft_fn(prompt) -> list[{Text,Extra}]."""
    job = load_job(base_dir, job_id)
    if not job:
        return
    set_status(base_dir, job, "drafting")
    try:
        style, examples = read_grounding()
        prompt = build_prompt(job["nn"], job["title"], job.get("highlights", []), style, examples)
        cards = draft_fn(prompt)
        if not cards:
            raise ValueError("no cards produced (no usable highlights?)")
        set_status(base_dir, job, "drafted", cards=cards)
    except Exception as e:  # noqa: BLE001 — record any failure for the UI
        set_status(base_dir, job, "error", error=str(e))


def _chapter_dir(base_dir, nn, title):
    return Path(base_dir) / "ID Anki Cards" / (str(nn) + " - " + str(title))


def push(base_dir, job, approved_cards, runner=subprocess.run):
    """Push approved cards to Anki via add_cards.py; write durable chapter JSON."""
    spec = {"deck": DECK, "model": MODEL,
            "tag": derive_tag(job["nn"], job["title"]), "cards": approved_cards}
    chdir = _chapter_dir(base_dir, job["nn"], job["title"])
    chdir.mkdir(parents=True, exist_ok=True)
    spec_path = chdir / (datetime.now().strftime("%Y-%m-%d") + ".json")
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    add_cards = str(SKILL_SCRIPTS / "add_cards.py")
    result = runner([sys.executable, add_cards, str(spec_path)],
                    capture_output=True, text=True, timeout=60)
    if result.returncode == 0:
        set_status(base_dir, job, "pushed", pushed={"stdout": (result.stdout or "").strip()})
        return {"anki": "ok", "detail": (result.stdout or "").strip()}
    if result.returncode == 2:
        # Anki closed: durable JSON + add_cards' .txt backup remain; leave drafted
        return {"anki": "offline", "detail": (result.stderr or "").strip()}
    return {"anki": "error", "detail": (result.stderr or result.stdout or "").strip()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py -v`
Expected: PASS (all cards_core tests)

- [ ] **Step 5: Commit**

```bash
git add cards_core.py tests/test_cards_core.py
git commit -m "feat: cards_core process_job (draft) and Anki push"
```

---

## Task 7: serve.py — worker thread and /api/cards/* endpoints

**Files:** Modify `serve.py`; Test `tests/test_cards_endpoints.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_cards_endpoints.py`:
```python
import json, threading, time, urllib.request
import fitz
import serve


def _highlighted_pdf_bytes():
    doc = fitz.open(); page = doc.new_page()
    s = "Vancomycin inhibits bacterial cell wall synthesis."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s):
        page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close(); return data


STUB_CARDS = [{"Text": "Vanco inhibits {{c1::cell wall}} synthesis", "Extra": ""}]


def _start(base_dir):
    httpd = serve.make_server(host="127.0.0.1", port=0, base_dir=str(base_dir),
                              draft_fn=lambda prompt: STUB_CARDS)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.05)
    return httpd, httpd.server_address[1]


def _req(port, path, data=None, method="GET", ctype="application/json"):
    url = f"http://127.0.0.1:{port}{path}"
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": ctype} if data else {})
    with urllib.request.urlopen(r) as resp:
        return resp.status, resp.read().decode()


def test_config_reports_unconfigured(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, body = _req(port, "/api/cards/config")
        assert st == 200 and json.loads(body)["configured"] is False
    finally:
        httpd.shutdown()


def test_upload_then_draft_then_list(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, body = _req(port, "/api/cards/upload?nn=29&title=Glycopeptides",
                        data=_highlighted_pdf_bytes(), method="POST", ctype="application/pdf")
        assert st == 200
        job_id = json.loads(body)["jobId"]
        # worker drafts asynchronously; poll jobs until drafted
        drafted = False
        for _ in range(50):
            _, jb = _req(port, "/api/cards/jobs")
            rows = json.loads(jb)
            if any(r["id"] == job_id and r["status"] == "drafted" for r in rows):
                drafted = True; break
            time.sleep(0.1)
        assert drafted, "job should reach drafted"
        _, jd = _req(port, f"/api/cards/job/{job_id}")
        assert json.loads(jd)["cards"][0]["Text"].startswith("Vanco")
    finally:
        httpd.shutdown()


def test_push_endpoint_writes_chapter_json(tmp_path, monkeypatch):
    import cards_core, subprocess
    monkeypatch.setattr(cards_core, "push",
        lambda base, job, cards, **kw: (cards_core.set_status(base, job, "pushed",
            pushed={"stdout": "added"}) and None) or {"anki": "ok"})
    httpd, port = _start(tmp_path)
    try:
        cards_core.ensure_queue(tmp_path)
        job = cards_core.create_job(tmp_path, "29", "Glyco", [])
        cards_core.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
        body = json.dumps({"cards": [{"Text": "a", "Extra": ""}]}).encode()
        st, resp = _req(port, f"/api/cards/job/{job['id']}/push", data=body, method="POST")
        assert st == 200 and json.loads(resp)["anki"] == "ok"
    finally:
        httpd.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cards_endpoints.py -v`
Expected: FAIL — `make_server` has no `draft_fn` param / routes 404.

- [ ] **Step 3: Write minimal implementation**

Edit `serve.py`. Add imports near the top (after existing imports):
```python
import queue as _queue
import threading
import uuid
from urllib.parse import urlparse, parse_qs

import cards_core
import ai_engine
```
(`urlparse`/`parse_qs` may already be imported — do not duplicate.)

Add a module-level default drafter factory:
```python
def _real_draft_fn(base_dir):
    """Build a draft_fn that runs headless Claude using config.json, or errors."""
    def draft_fn(prompt):
        cfg = cards_core.load_config(base_dir)
        raw = ai_engine.draft(prompt, claude_path=cfg.get("claudePath"),
                              model=cfg.get("model"), timeout=cfg.get("timeoutSec", 240))
        return ai_engine.parse_cards(raw)
    return draft_fn
```

In `make_server(...)`, after setting `httpd.base_dir`, add the worker:
```python
    httpd.draft_fn = draft_fn or _real_draft_fn(httpd.base_dir)
    httpd.card_q = _queue.Queue()
    def _worker():
        while True:
            jid = httpd.card_q.get()
            if jid is None:
                return
            try:
                cards_core.process_job(httpd.base_dir, jid, httpd.draft_fn)
            except Exception:
                pass
            finally:
                httpd.card_q.task_done()
    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    httpd.card_worker = t
```
And change the signature to `def make_server(host="127.0.0.1", port=8756, base_dir=None, draft_fn=None):`.

Add route handling. In `do_GET`, before the final `self.send_error(404,...)`:
```python
        if route == "/api/cards/config":
            self._send_json({"configured": cards_core.is_configured(self._base())})
            return
        if route == "/api/cards/jobs":
            self._send_json(cards_core.list_jobs(self._base()))
            return
        if route.startswith("/api/cards/job/"):
            jid = route[len("/api/cards/job/"):]
            job = cards_core.load_job(self._base(), jid)
            if job is None:
                self.send_error(404, "no such job"); return
            self._send_json(job)
            return
```

In `do_POST`, before the final `self.send_error(404,...)`:
```python
        if route == "/api/cards/upload":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            length = int(self.headers.get("Content-Length", 0))
            pdf = self.rfile.read(length) if length else b""
            job = cards_core._ingest_upload(self._base(), q.get("nn", ""), q.get("title", ""), pdf)
            self.server.card_q.put(job["id"])
            self._send_json({"jobId": job["id"]})
            return
        if route.startswith("/api/cards/job/") and route.endswith("/push"):
            jid = route[len("/api/cards/job/"):-len("/push")]
            job = cards_core.load_job(self._base(), jid)
            if job is None:
                self.send_error(404, "no such job"); return
            body = self._read_body()
            res = cards_core.push(self._base(), job, body.get("cards", []))
            self._send_json(res)
            return
        if route.startswith("/api/cards/job/") and route.endswith("/discard"):
            jid = route[len("/api/cards/job/"):-len("/discard")]
            cards_core.discard_job(self._base(), jid)
            self._send_json({"discarded": jid})
            return
        if route.startswith("/api/cards/job/") and route.endswith("/retry"):
            jid = route[len("/api/cards/job/"):-len("/retry")]
            job = cards_core.load_job(self._base(), jid)
            if job:
                cards_core.set_status(self._base(), job, "pending")
                self.server.card_q.put(jid)
            self._send_json({"retry": jid})
            return
```

- [ ] **Step 4: Add `_ingest_upload` and `discard_job` to `cards_core.py`**

Append to `cards_core.py`:
```python
def _ingest_upload(base_dir, nn, title, pdf_bytes):
    """Save an uploaded PDF, extract highlights, and create a pending job."""
    ensure_queue(base_dir)
    job_id = uuid.uuid4().hex[:12]
    pdf_path = Path(base_dir) / "queue" / "incoming" / (job_id + ".pdf")
    pdf_path.write_bytes(pdf_bytes)
    highlights = extract(str(pdf_path))
    job = {
        "id": job_id, "nn": str(nn), "title": str(title), "status": "pending",
        "created": datetime.now().isoformat(timespec="seconds"), "highlights": highlights,
    }
    _job_path(base_dir, "pending", job_id).write_text(
        json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def discard_job(base_dir, job_id):
    p = _find_job_file(base_dir, job_id)
    if p:
        p.unlink()
    pdf = Path(base_dir) / "queue" / "incoming" / (job_id + ".pdf")
    if pdf.exists():
        pdf.unlink()
```

Add a test for `_ingest_upload` in `tests/test_cards_core.py`:
```python
def test_ingest_upload_creates_pending_with_highlights(tmp_path):
    import fitz
    doc = fitz.open(); page = doc.new_page()
    s = "Daptomycin is a lipopeptide antibiotic."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s): page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close()
    job = cc._ingest_upload(tmp_path, "30", "Strepto", data)
    assert job["status"] == "pending" and len(job["highlights"]) == 1
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_cards_core.py tests/test_cards_endpoints.py -v`
Expected: PASS (all). Then run the full suite: `python3 -m pytest tests/ -q` → all green (prior 25 + new).

- [ ] **Step 6: Commit**

```bash
git add serve.py cards_core.py tests/test_cards_endpoints.py tests/test_cards_core.py
git commit -m "feat: /api/cards/* endpoints + background drafting worker"
```

---

## Task 8: dashboard.html — per-chapter generate dropzone + review tray

**Files:** Modify `dashboard.html`

The sector panel (`openPanel`) currently lists sessions grouped by week. Add, per
distinct chapter in that sector, a generate control and (when a job exists) a
review tray. All new JS is additive to the existing `<script>`.

- [ ] **Step 1: Add a "Generate cards" control per chapter in the panel body**

In `dashboard.html`, find `openPanel(si)` where it builds `html` for each row.
Before the sessions loop, compute the distinct chapters in the sector and, for
each chapter's first appearance, emit a generate bar. Replace the row loop's
chapter handling by inserting, when `nn` changes, this block:
```javascript
      if(nn && nn!==lastChap){
        lastChap=nn;
        html+='<div class="chapgen" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">'
          +'<span class="cglabel">Chapter '+nn+'</span>'
          +'<button class="mbtn cgbtn" data-nn="'+nn+'" data-title="'+esc(cleanTitle(r.r))+'">✦ Generate cards</button>'
          +'<span class="cgstatus" id="cg-'+nn+'"></span></div>';
      }
```
Declare `var lastChap=null;` next to `lastWk` at the top of the function.

- [ ] **Step 2: Add styles** (append to the `<style>` block, before `</style>`):
```css
.chapgen{display:flex;align-items:center;gap:10px;padding:10px 22px 4px}
.cglabel{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--vio2)}
.cgstatus{font-family:var(--mono);font-size:10px;color:var(--dim)}
.gbtn{border-color:var(--cyan) !important;color:var(--cyan) !important;background:rgba(55,230,207,.06) !important}
.dz{margin:2px 22px 8px;border:1px dashed var(--line);border-radius:10px;padding:14px;text-align:center;color:var(--dim);font-family:var(--mono);font-size:11px;cursor:pointer}
.dz.hot{border-color:var(--cyan);color:var(--cyan)}
.tray{margin:2px 22px 12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.tcard{padding:10px 12px;border-top:1px solid var(--line2)}
.tcard textarea{width:100%;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;font-family:var(--mono);font-size:11px;padding:6px;resize:vertical;min-height:38px}
.tcard .trow{display:flex;gap:8px;align-items:center;margin-top:6px}
.tcard.dropped{opacity:.4}
.tray .tfoot{padding:10px 12px;display:flex;gap:10px;align-items:center;background:var(--panel2)}
```

- [ ] **Step 3: Wire the generate button → dropzone → upload**

In `openPanel`, after `body.innerHTML=html;` and the existing wiring, add:
```javascript
  Array.prototype.forEach.call(body.querySelectorAll(".gbtn"),function(btn){
    btn.onclick=function(){ showDropzone(btn.dataset.nn, btn.dataset.title, btn); };
  });
  refreshCardJobs();
```
Then add these functions near `copyPrompt`:
```javascript
function showDropzone(nn,title,anchor){
  var host=anchor.closest(".chapgen");
  if(host.nextSibling && host.nextSibling.classList && host.nextSibling.classList.contains("dz")){ return; }
  var dz=document.createElement("div"); dz.className="dz";
  dz.textContent="Drop the highlighted PDF for Chapter "+nn+" here, or click to choose";
  var inp=document.createElement("input"); inp.type="file"; inp.accept="application/pdf"; inp.style.display="none";
  dz.appendChild(inp);
  host.parentNode.insertBefore(dz, host.nextSibling);
  dz.onclick=function(){ inp.click(); };
  inp.onchange=function(){ if(inp.files[0]) uploadPdf(nn,title,inp.files[0],dz); };
  dz.ondragover=function(e){ e.preventDefault(); dz.classList.add("hot"); };
  dz.ondragleave=function(){ dz.classList.remove("hot"); };
  dz.ondrop=function(e){ e.preventDefault(); dz.classList.remove("hot");
    if(e.dataTransfer.files[0]) uploadPdf(nn,title,e.dataTransfer.files[0],dz); };
}
function uploadPdf(nn,title,file,dz){
  dz.textContent="Uploading & scanning highlights…";
  fetch("/api/cards/upload?nn="+encodeURIComponent(nn)+"&title="+encodeURIComponent(title),
    {method:"POST",headers:{"Content-Type":"application/pdf"},body:file})
    .then(function(r){return r.json();})
    .then(function(){ dz.remove(); toastMsg("Drafting cards… I'll show them when ready"); pollCardJobs(); })
    .catch(function(){ dz.textContent="Upload failed — try again"; });
}
```

- [ ] **Step 4: Add job polling + review tray rendering**

Add near the other card functions:
```javascript
var CARDJOBS={};
function refreshCardJobs(){
  return fetch("/api/cards/jobs").then(function(r){return r.json();}).then(function(rows){
    CARDJOBS={}; rows.forEach(function(j){ CARDJOBS[j.nn]=j; });
    renderCardStatuses();
  }).catch(function(){});
}
function renderCardStatuses(){
  document.querySelectorAll(".chapgen").forEach(function(host){
    var nn=host.dataset.nn, j=CARDJOBS[nn], el=document.getElementById("cg-"+nn);
    if(!el) return;
    if(!j){ el.textContent=""; return; }
    if(j.status==="pending"||j.status==="drafting") el.textContent="· drafting…";
    else if(j.status==="drafted"){ el.textContent="· ready to review ("+j.count+")"; ensureTray(host,j.id); }
    else if(j.status==="error") el.textContent="· failed — retry";
    else if(j.status==="pushed") el.textContent="· pushed ✓";
  });
}
function pollCardJobs(){
  var n=0; var iv=setInterval(function(){
    n++; refreshCardJobs();
    var anyDrafting=Object.keys(CARDJOBS).some(function(k){var s=CARDJOBS[k].status;return s==="pending"||s==="drafting";});
    if(!anyDrafting || n>120){ clearInterval(iv); }
  }, 1500);
}
function ensureTray(host,jobId){
  if(host.nextSibling && host.nextSibling.classList && host.nextSibling.classList.contains("tray")) return;
  fetch("/api/cards/job/"+jobId).then(function(r){return r.json();}).then(function(job){
    var tray=document.createElement("div"); tray.className="tray";
    var html="";
    (job.cards||[]).forEach(function(c,i){
      html+='<div class="tcard" data-i="'+i+'"><textarea class="ttext">'+esc(c.Text)+'</textarea>'
        +'<textarea class="textra" placeholder="Extra (optional)">'+esc(c.Extra||"")+'</textarea>'
        +'<div class="trow"><button class="mbtn tdrop">Delete</button></div></div>';
    });
    html+='<div class="tfoot"><button class="mbtn gbtn tpush">⇪ Push approved to Anki</button>'
      +'<button class="mbtn tdiscard">Discard</button><span class="cgstatus tmsg"></span></div>';
    tray.innerHTML=html;
    host.parentNode.insertBefore(tray, host.nextSibling);
    tray.querySelectorAll(".tdrop").forEach(function(b){ b.onclick=function(){ b.closest(".tcard").classList.toggle("dropped"); }; });
    tray.querySelector(".tpush").onclick=function(){ pushTray(tray,jobId); };
    tray.querySelector(".tdiscard").onclick=function(){
      fetch("/api/cards/job/"+jobId+"/discard",{method:"POST"}).then(function(){ tray.remove(); refreshCardJobs(); }); };
  });
}
function pushTray(tray,jobId){
  var cards=[];
  tray.querySelectorAll(".tcard").forEach(function(c){
    if(c.classList.contains("dropped")) return;
    var t=c.querySelector(".ttext").value.trim(); if(!t) return;
    cards.push({Text:t, Extra:c.querySelector(".textra").value.trim()});
  });
  var msg=tray.querySelector(".tmsg"); msg.textContent="Pushing…";
  fetch("/api/cards/job/"+jobId+"/push",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cards:cards})})
    .then(function(r){return r.json();}).then(function(res){
      if(res.anki==="ok"){ msg.textContent="Pushed ✓"; toastMsg("Cards pushed to Anki"); tray.remove(); refreshStatus(); refreshCardJobs(); }
      else if(res.anki==="offline"){ msg.textContent="Anki closed — saved a backup, open Anki and push again"; }
      else { msg.textContent="Push error: "+(res.detail||""); }
    }).catch(function(){ msg.textContent="Push failed"; });
}
```

- [ ] **Step 5: Verify in the browser**

Restart the server (`lsof -ti tcp:8756 | xargs kill; python3 serve.py &`), open `http://127.0.0.1:8756/`, open a sector, and confirm each chapter shows a **✦ Generate cards** button. (Full drafting needs the CLI configured — Task 9 — so here just confirm the control renders and the dropzone opens on click, with no console errors via `read_console_messages`.)

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat: dashboard per-chapter generate dropzone + review tray"
```

---

## Task 9: Enable AI drafting.command — one-time setup

**Files:** Create `Enable AI drafting.command`

- [ ] **Step 1: Create the setup script**

Create `Enable AI drafting.command`:
```bash
#!/bin/bash
# Double-click ONCE to let the dashboard draft cards/questions on your Claude
# subscription. Installs the Claude CLI if needed, logs you in, and saves config.
set -e
DIR="/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform"
echo "Setting up AI drafting for the ID Cockpit..."

if ! command -v claude >/dev/null 2>&1; then
  echo "Installing the Claude CLI (npm i -g @anthropic-ai/claude-code)..."
  npm install -g @anthropic-ai/claude-code
fi
CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  echo "Could not find 'claude' after install. Open a terminal, run 'npm i -g @anthropic-ai/claude-code', then re-run this."
  exit 1
fi

echo "Logging you into Claude (a browser window will open). Use your Claude subscription account..."
"$CLAUDE" login || true

python3 - "$DIR" "$CLAUDE" <<'PY'
import json, sys, pathlib
d, claude = sys.argv[1], sys.argv[2]
cfg = {"claudePath": claude, "model": None, "timeoutSec": 240}
pathlib.Path(d, "config.json").write_text(json.dumps(cfg, indent=2))
print("Saved config.json ->", claude)
PY

echo "Done. AI drafting is enabled. You can close this window."
```

- [ ] **Step 2: Make it executable and validate syntax**

Run:
```bash
cd "/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform"
chmod +x "Enable AI drafting.command"
bash -n "Enable AI drafting.command" && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add "Enable AI drafting.command"
git commit -m "feat: Enable AI drafting.command one-time setup"
```

---

## Task 10: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `python3 -m pytest tests/ -q`
Expected: all pass (prior 25 + the new ai_engine/cards_core/endpoints tests).

- [ ] **Step 2: Simulated end-to-end without the real CLI**

With a temp base dir and a stub drafter, exercise upload→draft→push via HTTP
(this is `tests/test_cards_endpoints.py::test_upload_then_draft_then_list` plus
the push endpoint test). Confirm both pass — this proves the whole pipeline minus
the real Claude call.

- [ ] **Step 3: Browser smoke test**

Start the server, open the dashboard, open a sector, confirm: **✦ Generate cards**
per chapter; clicking opens the dropzone; if `config.json` is absent the console
shows no errors and (optional) a setup nudge. Use `read_console_messages`
(onlyErrors) → none. Screenshot the panel with the generate controls.

- [ ] **Step 4: Real drafting (manual, optional — needs `Enable AI drafting` run)**

If the user has run `Enable AI drafting.command`: open a sector, drop a real
highlighted chapter PDF, confirm status goes `drafting… → ready to review`, the
tray shows cards, edit one, push with Anki open, and confirm the ◆ badge
increments and `ID Anki Cards/<NN - Title>/<date>.json` was written.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: SP2 end-to-end verification adjustments"
```

---

## Self-Review Notes

- **Spec §ai_engine:** Task 2 (draft/parse_cards, typed errors, subprocess stub). ✓
- **Spec §cards_core:** save/extract (Tasks 3, 7 `_ingest_upload`), build_prompt (4), job lifecycle (5), process_job + push + tag + chapter JSON (6). ✓
- **Spec §worker + endpoints:** Task 7 (worker thread, upload/jobs/job/push/discard/retry/config). ✓
- **Spec §UI review tray:** Task 8 (per-chapter generate, dropzone, status chips, tray edit/delete/push). ✓
- **Spec §setup:** Task 9. ✓  **Spec §error table:** anki-offline (6), draft error (6), no-highlights (6 `process_job` empty→error; extract empty allowed), retry (7), config-gated (7/8). ✓
- **Spec §testing:** stubbed draft_fn + mocked add_cards runner throughout; fixture PDF via fitz. ✓
- **Type consistency:** `draft_fn(prompt)->list[{Text,Extra}]` used in Task 6 (`process_job`), Task 7 (`_real_draft_fn`, `make_server`), and stubbed in Task 7 tests. `push(...)->{"anki":...}` consumed by Task 7 endpoint and Task 8 `pushTray`. `list_jobs` rows `{id,nn,title,status,count}` consumed by Task 8 `refreshCardJobs`. Consistent.
- **Placeholder scan:** none; every code step is complete. The one prior uncertainty (return shape of `extract_highlights_with_context`) was resolved by reading the source — confirmed `(page, highlight, context)` tuples — and Task 3 unpacks it exactly.
