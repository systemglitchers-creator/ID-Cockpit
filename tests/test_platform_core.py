import json
from pathlib import Path

PLATFORM_DIR = Path(__file__).resolve().parent.parent


def test_prompts_json_has_both_templates():
    data = json.loads((PLATFORM_DIR / "prompts.json").read_text())
    assert "cards" in data and "questions" in data
    assert "{NN}" in data["cards"] and "{title}" in data["cards"]
    assert "{NN}" in data["questions"] and "{title}" in data["questions"]


import platform_core as core


def test_parse_chapter_num_extracts_leading_number():
    assert core.parse_chapter_num("Chapter 20 — Penicillins · Part 1 of 3") == "20"
    assert core.parse_chapter_num("20 - Penicillins and Beta-Lactamase Inhibitors") == "20"
    assert core.parse_chapter_num("Chapter 5 — Something") == "5"


def test_parse_chapter_num_returns_none_when_absent():
    assert core.parse_chapter_num("Antimicrobial Stewardship overview") is None


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


def test_scan_counts_counts_cards_and_questions(tmp_path):
    cards_dir = tmp_path / "ID Anki Cards" / "20 - Penicillins"
    _write_json(cards_dir / "2026-07-01.json", {"cards": [{"Text": "a"}, {"Text": "b"}]})
    _write_json(cards_dir / "2026-07-02.json", {"cards": [{"Text": "c"}]})
    q_dir = tmp_path / "ID Practice Questions" / "20 - Penicillins"
    _write_json(q_dir / "2026-07-03.json", {"questions": [{"stem": "x"}]})

    counts = core.scan_counts(tmp_path)
    assert counts["20"]["cards"] == 3
    assert counts["20"]["questions"] == 1


def test_scan_counts_handles_missing_folders(tmp_path):
    assert core.scan_counts(tmp_path) == {}


def test_scan_counts_ignores_nonjson_and_bad_json(tmp_path):
    d = tmp_path / "ID Anki Cards" / "21 - Cephalosporins"
    d.mkdir(parents=True)
    (d / "notes.txt").write_text("ignore me")
    (d / "broken.json").write_text("{not valid json")
    _write_json(d / "2026-07-01.json", {"cards": [{"Text": "a"}]})
    counts = core.scan_counts(tmp_path)
    assert counts["21"]["cards"] == 1


def test_scan_counts_tolerates_non_dict_json(tmp_path):
    d = tmp_path / "ID Anki Cards" / "22 - Carbapenems"
    d.mkdir(parents=True)
    (d / "list.json").write_text("[1, 2, 3]")
    _write_json(d / "2026-07-01.json", {"cards": [{"Text": "a"}]})
    counts = core.scan_counts(tmp_path)
    assert counts["22"]["cards"] == 1


def test_scan_counts_accumulates_duplicate_chapter_folders(tmp_path):
    root = tmp_path / "ID Anki Cards"
    _write_json(root / "20 - Penicillins" / "a.json", {"cards": [{"Text": "1"}, {"Text": "2"}]})
    _write_json(root / "Chapter 20 - Penicillins dup" / "b.json", {"cards": [{"Text": "3"}]})
    counts = core.scan_counts(tmp_path)
    assert counts["20"]["cards"] == 3


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


def test_fill_prompt_substitutes_all_fields(tmp_path):
    template = "Chapter {NN} — {title}, pages {ps}-{pe}."
    out = core.fill_prompt(template, {"NN": "20", "title": "Penicillins", "ps": "263", "pe": "268"})
    assert out == "Chapter 20 — Penicillins, pages 263-268."


def test_fill_prompt_leaves_unknown_placeholders_untouched():
    out = core.fill_prompt("Ch {NN} {missing}", {"NN": "20"})
    assert out == "Ch 20 {missing}"
