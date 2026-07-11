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
