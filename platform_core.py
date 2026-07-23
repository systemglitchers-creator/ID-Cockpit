"""Pure logic for the ID Study reading schedule. No HTTP here.

Only read-state tracking remains — card/question counting was removed along with
the in-app generation (that work is done via the Claude Code skills).
"""
from __future__ import annotations

import json
import os
import urllib.request
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
    now = _now_iso()
    entry = {"done": bool(done), "doneAt": now if done else None, "updatedAt": now}
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


def _sync_ts(e):
    e = e or {}
    return e.get("updatedAt") or e.get("doneAt") or ""


def merge_sessions(local, remote):
    """Conflict-free union: newest timestamp wins per session id."""
    local = local or {}
    remote = remote or {}
    out = {}
    for i in set(local) | set(remote):
        a, b = local.get(i), remote.get(i)
        if a is None:
            out[i] = b
        elif b is None:
            out[i] = a
        else:
            out[i] = b if _sync_ts(b) > _sync_ts(a) else a
    return out


def load_sync_config(platform_dir):
    """Return {'token','gist_id'} from sync.json or env, else None."""
    p = Path(platform_dir) / "sync.json"
    if p.exists():
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            c = {}
        if c.get("token") and c.get("gist_id"):
            return {"token": c["token"], "gist_id": c["gist_id"]}
    tok, gid = os.environ.get("ID_GIST_TOKEN"), os.environ.get("ID_GIST_ID")
    if tok and gid:
        return {"token": tok, "gist_id": gid}
    return None


def _gist_request(cfg, data=None, method="GET"):
    req = urllib.request.Request(
        "https://api.github.com/gists/" + cfg["gist_id"],
        data=data, method=method,
        headers={
            "Authorization": "Bearer " + cfg["token"],
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "id-cockpit",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read()


def pull_remote(cfg):
    """Return the remote sessions map (or {} if unavailable)."""
    _, raw = _gist_request(cfg)
    g = json.loads(raw)
    f = (g.get("files") or {}).get("state.json")
    if not f or not f.get("content"):
        return {}
    return json.loads(f["content"]).get("sessions", {})


def push_remote(cfg, state):
    """Write the full state dict to the gist's state.json. Returns True on 2xx."""
    body = json.dumps({"files": {"state.json": {"content": json.dumps(state, indent=2)}}}).encode("utf-8")
    status, _ = _gist_request(cfg, data=body, method="PATCH")
    return 200 <= status < 300
