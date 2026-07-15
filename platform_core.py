"""Pure logic for the ID Study reading schedule. No HTTP here.

Only read-state tracking remains — card/question counting was removed along with
the in-app generation (that work is done via the Claude Code skills).
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


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
