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
