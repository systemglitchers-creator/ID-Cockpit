import json
from pathlib import Path
import questions_core as qc


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


def test_load_chapter_cards_concatenates(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    ch = tmp_path / "ID Anki Cards" / "29 - Glyco"
    _write(ch / "2026-01-01.json", {"cards": [{"Text": "a", "Extra": ""}]})
    _write(ch / "2026-02-02.json", {"cards": [{"Text": "b", "Extra": "x"}]})
    cards = qc.load_chapter_cards(base, "29", "Glyco")
    texts = sorted(c["Text"] for c in cards)
    assert texts == ["a", "b"]


def test_has_cards_and_source(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    assert qc.precheck(base, "29", "Glyco") == {"hasCards": False, "hasPdf": False}
    _write(tmp_path / "ID Anki Cards" / "29 - Glyco" / "d.json", {"cards": [{"Text": "a"}]})
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "29.pdf").write_bytes(b"%PDF-1.4")
    assert qc.precheck(base, "29", "Glyco") == {"hasCards": True, "hasPdf": True}


def test_build_qprompt_includes_cards_highlights_and_format(tmp_path):
    prompt = qc.build_qprompt("29", "Glyco",
                              cards=[{"Text": "Vanco {{c1::cell wall}}", "Extra": ""}],
                              highlights=[{"highlight": "Vancomycin binds D-Ala", "context": "..."}],
                              rc_format="RC FORMAT RULES")
    assert "RC FORMAT RULES" in prompt
    assert "Vanco" in prompt and "D-Ala" in prompt
    assert "Chapter 29" in prompt and "JSON" in prompt
