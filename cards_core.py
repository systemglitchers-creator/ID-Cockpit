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
