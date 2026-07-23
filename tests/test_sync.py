import json
import platform_core as core


def test_merge_prefers_newer_updatedat():
    local = {"a": {"done": True, "doneAt": "2026-07-01T00:00:00", "updatedAt": "2026-07-01T00:00:00"}}
    remote = {"a": {"done": False, "doneAt": None, "updatedAt": "2026-07-02T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert out["a"]["done"] is False  # remote is newer


def test_merge_unions_disjoint_keys():
    local = {"a": {"done": True, "updatedAt": "2026-07-01T00:00:00"}}
    remote = {"b": {"done": True, "updatedAt": "2026-07-01T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert set(out) == {"a", "b"}


def test_merge_falls_back_to_doneat_when_no_updatedat():
    local = {"a": {"done": True, "doneAt": "2026-07-05T00:00:00"}}
    remote = {"a": {"done": True, "doneAt": "2026-07-03T00:00:00"}}
    out = core.merge_sessions(local, remote)
    assert out["a"]["doneAt"] == "2026-07-05T00:00:00"  # local newer


def test_load_sync_config_from_file(tmp_path):
    (tmp_path / "sync.json").write_text(json.dumps({"token": "t", "gist_id": "g"}))
    cfg = core.load_sync_config(tmp_path)
    assert cfg == {"token": "t", "gist_id": "g"}


def test_load_sync_config_absent_returns_none(tmp_path, monkeypatch):
    monkeypatch.delenv("ID_GIST_TOKEN", raising=False)
    monkeypatch.delenv("ID_GIST_ID", raising=False)
    assert core.load_sync_config(tmp_path) is None


def test_toggle_writes_updatedat(tmp_path):
    sp = tmp_path / "state.json"
    entry = core.toggle_done(sp, "x1", True)
    assert entry["done"] is True and entry.get("updatedAt")
