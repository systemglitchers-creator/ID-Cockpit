"""In-app practice-question generation. Reuses cards_core job helpers + ai_engine."""
from __future__ import annotations

import json
from datetime import datetime
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


def source_pdf(base_dir, session_id):
    p = Path(base_dir) / "queue" / "source" / (str(session_id) + ".pdf")
    return p if p.exists() else None


def precheck(base_dir, nn, title, session_id):
    return {"hasCards": len(load_chapter_cards(base_dir, nn, title)) > 0,
            "hasPdf": source_pdf(base_dir, session_id) is not None}


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
