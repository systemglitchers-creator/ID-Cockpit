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


def test_derive_tag_colons_and_ampersand():
    tag = cc.derive_tag("20", "Penicillins and B-Lactamase Inhibitors")
    assert tag == "Chapter::20::Penicillins::and::B-Lactamase::Inhibitors"


def test_build_prompt_includes_grounding_and_highlights():
    hs = [{"highlight": "Vanco inhibits cell wall", "context": "Vancomycin ... cell wall."}]
    prompt = cc.build_prompt("29", "Glycopeptides", hs,
                             style_guide="STYLE RULES HERE", examples="EXAMPLE CARDS")
    assert "STYLE RULES HERE" in prompt and "EXAMPLE CARDS" in prompt
    assert "Vanco inhibits cell wall" in prompt
    assert "Chapter 29" in prompt and "Glycopeptides" in prompt
    assert "JSON" in prompt  # instructs JSON-only output


def test_create_and_load_job(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glycopeptides",
                        [{"highlight": "h", "context": "c"}])
    assert job["status"] == "pending" and job["nn"] == "29" and job["id"]
    loaded = cc.load_job(tmp_path, job["id"])
    assert loaded["title"] == "Glycopeptides"
    assert (tmp_path / "queue" / "pending" / (job["id"] + ".json")).exists()


def test_set_status_moves_file(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    assert not (tmp_path / "queue" / "pending" / (job["id"] + ".json")).exists()
    assert (tmp_path / "queue" / "drafts" / (job["id"] + ".json")).exists()
    reloaded = cc.load_job(tmp_path, job["id"])
    assert reloaded["status"] == "drafted" and reloaded["cards"][0]["Text"] == "a"


def test_list_jobs_summarizes(tmp_path):
    cc.ensure_queue(tmp_path)
    j = cc.create_job(tmp_path, "30", "Strepto", [])
    cc.set_status(tmp_path, j, "drafted", cards=[{"Text": "a", "Extra": ""}])
    rows = cc.list_jobs(tmp_path)
    assert any(r["id"] == j["id"] and r["status"] == "drafted" and r["count"] == 1 for r in rows)


def test_process_job_drafts_and_marks_drafted(tmp_path, monkeypatch):
    cc.ensure_queue(tmp_path)
    monkeypatch.setattr(cc, "read_grounding", lambda: ("STYLE", "EX"))
    job = cc.create_job(tmp_path, "29", "Glyco", [{"highlight": "h", "context": "c"}])
    seen = {}
    def draft_fn(prompt):
        seen["prompt"] = prompt
        return [{"Text": "clozed {{c1::fact}}", "Extra": ""}]
    cc.process_job(tmp_path, job["id"], draft_fn)
    out = cc.load_job(tmp_path, job["id"])
    assert out["status"] == "drafted" and out["cards"][0]["Text"].startswith("clozed")
    assert "STYLE" in seen["prompt"] and "h" in seen["prompt"]


def test_process_job_records_error(tmp_path, monkeypatch):
    cc.ensure_queue(tmp_path)
    monkeypatch.setattr(cc, "read_grounding", lambda: ("S", "E"))
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    def draft_fn(prompt):
        raise RuntimeError("claude blew up")
    cc.process_job(tmp_path, job["id"], draft_fn)
    out = cc.load_job(tmp_path, job["id"])
    assert out["status"] == "error" and "claude blew up" in out["error"]


def test_push_writes_chapter_json_and_reports(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glycopeptides", [])
    job = cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    calls = {}
    def runner(cmd, **kw):
        calls["cmd"] = cmd
        import subprocess
        return subprocess.CompletedProcess(cmd, 0, stdout="added 1, skipped 0", stderr="")
    res = cc.push(tmp_path, job, [{"Text": "a", "Extra": ""}], runner=runner)
    assert res["anki"] == "ok"
    chdir = tmp_path / "ID Anki Cards"
    written = list(chdir.glob("29 - Glycopeptides/*.json"))
    assert written, "durable chapter JSON should be written"
    assert cc.load_job(tmp_path, job["id"])["status"] == "pushed"


def test_push_anki_offline_keeps_drafted(tmp_path):
    cc.ensure_queue(tmp_path)
    job = cc.create_job(tmp_path, "29", "Glyco", [])
    job = cc.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
    def runner(cmd, **kw):
        import subprocess
        return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="AnkiConnect unreachable")
    res = cc.push(tmp_path, job, [{"Text": "a", "Extra": ""}], runner=runner)
    assert res["anki"] == "offline"
    assert cc.load_job(tmp_path, job["id"])["status"] == "drafted"
