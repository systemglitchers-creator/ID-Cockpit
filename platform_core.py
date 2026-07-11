"""Pure logic for the ID Study Platform cockpit. No HTTP here."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

_CHAPTER_RE = re.compile(r"(?:Chapter\s+)?(\d+)")
CARDS_SUBDIR = "ID Anki Cards"
QUESTIONS_SUBDIR = "ID Practice Questions"


def parse_chapter_num(title):
    """Return the chapter number as a string, or None if the title has none.

    Matches 'Chapter 20 — ...' and '20 - ...'. Returns the first integer that
    appears at, or right after an optional 'Chapter ' prefix at, the start.
    """
    m = _CHAPTER_RE.match(title.strip())
    return m.group(1) if m else None


def _count_items(json_path, key):
    """Number of items under `key` in a JSON file; 0 if unreadable or absent."""
    try:
        obj = json.loads(json_path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return 0
    items = obj.get(key) if isinstance(obj, dict) else None
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
        counts[nn][key] += total


def scan_counts(base_dir):
    """Map chapter number -> {'cards': n, 'questions': m} by scanning artifact folders."""
    counts = {}
    _scan_subdir(base_dir, CARDS_SUBDIR, "cards", counts)
    _scan_subdir(base_dir, QUESTIONS_SUBDIR, "questions", counts)
    return counts


def _now_iso():
    return datetime.now().isoformat(timespec="seconds")


def load_state(state_path):
    """Read state.json, returning {'sessions': {...}}; tolerant of missing/corrupt file."""
    p = Path(state_path)
    if not p.exists():
        return {"sessions": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {"sessions": {}}
    if not isinstance(data, dict) or "sessions" not in data:
        return {"sessions": {}}
    return data


def _save_state(state_path, state):
    p = Path(state_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2), encoding="utf-8")


def toggle_done(state_path, session_id, done):
    """Set a session's read-state and persist. Returns the updated entry."""
    state = load_state(state_path)
    entry = {"done": bool(done), "doneAt": _now_iso() if done else None}
    state["sessions"][session_id] = entry
    _save_state(state_path, state)
    return entry


def import_ids(state_path, ids):
    """One-time seed: mark each id done if not already present. Idempotent union.

    Returns the full updated state dict.
    """
    state = load_state(state_path)
    for sid in ids:
        if sid not in state["sessions"]:
            state["sessions"][sid] = {"done": True, "doneAt": _now_iso()}
    _save_state(state_path, state)
    return state


def fill_prompt(template, fields):
    """Replace {key} placeholders with values. Unknown placeholders are left as-is."""
    out = template
    for key, val in fields.items():
        out = out.replace("{" + key + "}", str(val))
    return out
