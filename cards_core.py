"""In-app card generation: extraction, job lifecycle, Anki push. Python 3.9."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import importlib.util
import fitz  # PyMuPDF

from platform_core import CARDS_SUBDIR

SKILL_DIR = Path(os.environ.get("ID_SKILL_DIR", os.path.expanduser("~/.claude/skills/id-anki-cards")))
SKILL_SCRIPTS = SKILL_DIR / "scripts"
DECK = "Infectious Disease::Mandell"
MODEL = "Cloze-AnKingMaster-v3"
QUEUE_SUBDIRS = ("incoming", "pending", "drafts", "done")
_STATUS_DIR = {"pending": "pending", "drafting": "pending", "drafted": "drafts",
               "pushed": "done", "saved": "done", "error": "drafts"}


def ensure_queue(base_dir, *, kind="cards"):
    for sub in QUEUE_SUBDIRS:
        (Path(base_dir) / "queue" / kind / sub).mkdir(parents=True, exist_ok=True)
    (Path(base_dir) / "queue" / "source").mkdir(parents=True, exist_ok=True)


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


def _job_path(base_dir, status, job_id, *, kind="cards"):
    return Path(base_dir) / "queue" / kind / _STATUS_DIR[status] / (job_id + ".json")


def _find_job_file(base_dir, job_id, *, kind="cards"):
    for sub in ("pending", "drafts", "done"):
        p = Path(base_dir) / "queue" / kind / sub / (job_id + ".json")
        if p.exists():
            return p
    return None


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
            rows.append({"id": j["id"], "sessionId": j.get("sessionId"),
                         "nn": j.get("nn"), "title": j.get("title"),
                         "status": j.get("status"), "count": len(items)})
    return rows


def discard_job(base_dir, job_id, *, kind="cards"):
    p = _find_job_file(base_dir, job_id, kind=kind)
    if p:
        p.unlink()
    pdf = Path(base_dir) / "queue" / kind / "incoming" / (job_id + ".pdf")
    if pdf.exists():
        pdf.unlink()


def process_job(base_dir, job_id, draft_fn, *, kind="cards"):
    """Draft cards for a pending job. draft_fn(prompt) -> list[{Text,Extra}]."""
    job = load_job(base_dir, job_id, kind=kind)
    if not job:
        return
    set_status(base_dir, job, "drafting", kind=kind)
    try:
        style, examples = read_grounding()
        prompt = build_prompt(job["nn"], job["title"], job.get("highlights", []), style, examples)
        cards = draft_fn(prompt)
        if not cards:
            raise ValueError("no cards produced (no usable highlights?)")
        set_status(base_dir, job, "drafted", kind=kind, cards=cards)
    except Exception as e:  # noqa: BLE001 — record any failure for the UI
        set_status(base_dir, job, "error", kind=kind, error=str(e), rawOutput=getattr(e, "raw", None))


def _chapter_dir(base_dir, nn, title):
    # base_dir is the platform dir; chapter artifacts live in the PARENT (artifact root)
    return Path(base_dir).parent / CARDS_SUBDIR / (str(nn) + " - " + str(title))


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


def push(base_dir, job, approved_cards, runner=subprocess.run):
    """Push approved cards to Anki via add_cards.py; write durable chapter JSON."""
    job = set_status(base_dir, job, "drafted", cards=approved_cards)  # persist edits first
    spec = {"deck": DECK, "model": MODEL,
            "tag": derive_tag(job["nn"], job["title"]), "cards": approved_cards}
    chdir = _chapter_dir(base_dir, job["nn"], job["title"])
    chdir.mkdir(parents=True, exist_ok=True)
    spec_path = chdir / (datetime.now().strftime("%Y-%m-%d") + ".json")
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    add_cards = str(SKILL_SCRIPTS / "add_cards.py")
    try:
        result = runner([sys.executable, add_cards, str(spec_path)],
                        capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return {"anki": "error", "detail": "add_cards timed out"}
    if result.returncode == 0:
        set_status(base_dir, job, "pushed", cards=approved_cards,
                   pushed={"stdout": (result.stdout or "").strip()})
        return {"anki": "ok", "detail": (result.stdout or "").strip()}
    if result.returncode == 2:
        # Anki closed: durable JSON + add_cards' .txt backup remain; leave drafted
        return {"anki": "offline", "detail": (result.stderr or "").strip()}
    return {"anki": "error", "detail": (result.stderr or result.stdout or "").strip()}
