import platform_core as core


def test_load_state_returns_empty_when_missing(tmp_path):
    assert core.load_state(tmp_path / "state.json") == {"sessions": {}}


def test_load_state_tolerates_corrupt_json(tmp_path):
    sp = tmp_path / "state.json"
    sp.write_text("{not valid", encoding="utf-8")
    assert core.load_state(sp) == {"sessions": {}}


def test_load_state_tolerates_wrong_shape(tmp_path):
    sp = tmp_path / "state.json"
    sp.write_text("[1, 2, 3]", encoding="utf-8")
    assert core.load_state(sp) == {"sessions": {}}


def test_toggle_done_sets_and_persists(tmp_path):
    sp = tmp_path / "state.json"
    entry = core.toggle_done(sp, "ch20-p1", True)
    assert entry["done"] is True and entry["doneAt"]
    reloaded = core.load_state(sp)
    assert reloaded["sessions"]["ch20-p1"]["done"] is True


def test_toggle_done_false_clears_flag(tmp_path):
    sp = tmp_path / "state.json"
    core.toggle_done(sp, "ch20-p1", True)
    entry = core.toggle_done(sp, "ch20-p1", False)
    assert entry["done"] is False


def test_import_ids_unions_without_clobbering(tmp_path):
    sp = tmp_path / "state.json"
    core.toggle_done(sp, "ch20-p1", True)
    core.import_ids(sp, ["ch20-p1", "ch21-p1", "ch21-p2"])
    state = core.load_state(sp)
    assert set(state["sessions"]) == {"ch20-p1", "ch21-p1", "ch21-p2"}
    assert all(state["sessions"][k]["done"] for k in state["sessions"])
