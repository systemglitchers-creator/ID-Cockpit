"""Pure logic for the ID Study Platform cockpit. No HTTP here."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

_CHAPTER_RE = re.compile(r"(?:Chapter\s+)?(\d+)")


def parse_chapter_num(title):
    """Return the chapter number as a string, or None if the title has none.

    Matches 'Chapter 20 — ...' and '20 - ...'. Returns the first integer that
    appears at, or right after an optional 'Chapter ' prefix at, the start.
    """
    m = _CHAPTER_RE.match(title.strip())
    return m.group(1) if m else None


CARDS_SUBDIR = "ID Anki Cards"
QUESTIONS_SUBDIR = "ID Practice Questions"


def _count_items(json_path, key):
    """Number of items under `key` in a JSON file; 0 if unreadable or absent."""
    try:
        obj = json.loads(json_path.read_text())
    except (ValueError, OSError):
        return 0
    items = obj.get(key)
    return len(items) if isinstance(items, list) else 0


def _scan_subdir(base_dir, subdir, key, counts):
    root = Path(base_dir) / subdir
    if not root.is_dir():
        return
    for chapter_dir in root.iterdir():
        if not chapter_dir.is_dir():
            continue
        nn = parse_chapter_num(chapter_dir.name)
        if nn is None:
            continue
        total = sum(_count_items(f, key) for f in chapter_dir.glob("*.json"))
        counts.setdefault(nn, {"cards": 0, "questions": 0})
        counts[nn][key if key == "cards" else "questions"] = total


def scan_counts(base_dir):
    """Map chapter number -> {'cards': n, 'questions': m} by scanning artifact folders."""
    counts = {}
    _scan_subdir(base_dir, CARDS_SUBDIR, "cards", counts)
    _scan_subdir(base_dir, QUESTIONS_SUBDIR, "questions", counts)
    return counts
