"""In-app card generation: extraction, job lifecycle, Anki push. Python 3.9."""
from __future__ import annotations

import json
import os
from pathlib import Path

import importlib.util
import fitz  # PyMuPDF

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
