import json
from pathlib import Path

import cards_core as cc


def test_ensure_queue_creates_dirs(tmp_path):
    cc.ensure_queue(tmp_path)
    for sub in ("incoming", "pending", "drafts", "done"):
        assert (tmp_path / "queue" / sub).is_dir()


def test_load_config_missing_is_unconfigured(tmp_path):
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] is None
    assert cc.is_configured(tmp_path) is False


def test_load_config_reads_file(tmp_path):
    fake_claude = tmp_path / "claude"
    fake_claude.write_text("#!/bin/sh\n")
    fake_claude.chmod(0o755)
    (tmp_path / "config.json").write_text(json.dumps(
        {"claudePath": str(fake_claude), "model": None, "timeoutSec": 120}))
    cfg = cc.load_config(tmp_path)
    assert cfg["claudePath"] == str(fake_claude)
    assert cfg["timeoutSec"] == 120
    assert cc.is_configured(tmp_path) is True


import fitz  # PyMuPDF


def _make_highlighted_pdf(path):
    doc = fitz.open()
    page = doc.new_page()
    sentence = "Vancomycin inhibits bacterial cell wall synthesis."
    page.insert_text((72, 100), sentence, fontsize=12)
    for r in page.search_for(sentence):
        page.add_highlight_annot(r)
    page.insert_text((72, 140), "This line is not highlighted.", fontsize=12)
    doc.save(str(path))
    doc.close()


def test_extract_finds_highlighted_text(tmp_path):
    pdf = tmp_path / "ch.pdf"
    _make_highlighted_pdf(pdf)
    hs = cc.extract(str(pdf))
    assert len(hs) == 1
    assert "Vancomycin" in hs[0]["highlight"]
    assert "highlight" in hs[0] and "context" in hs[0]


def test_extract_no_highlights_returns_empty(tmp_path):
    doc = fitz.open(); doc.new_page().insert_text((72, 72), "plain");
    p = tmp_path / "plain.pdf"; doc.save(str(p)); doc.close()
    assert cc.extract(str(p)) == []
