import json
from pathlib import Path
import cards_core
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
    assert qc.precheck(base, "29", "Glyco", "ch29-p1") == {"hasCards": False, "hasPdf": False}
    _write(tmp_path / "ID Anki Cards" / "29 - Glyco" / "d.json", {"cards": [{"Text": "a"}]})
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch29-p1.pdf").write_bytes(b"%PDF-1.4")
    assert qc.precheck(base, "29", "Glyco", "ch29-p1") == {"hasCards": True, "hasPdf": True}


def test_build_qprompt_includes_cards_highlights_and_format(tmp_path):
    prompt = qc.build_qprompt("29", "Glyco",
                              cards=[{"Text": "Vanco {{c1::cell wall}}", "Extra": ""}],
                              highlights=[{"highlight": "Vancomycin binds D-Ala", "context": "..."}],
                              rc_format="RC FORMAT RULES")
    assert "RC FORMAT RULES" in prompt
    assert "Vanco" in prompt and "D-Ala" in prompt
    assert "Chapter 29" in prompt and "JSON" in prompt


import fitz


def _pdf_bytes(sentence="Daptomycin depolarizes the membrane."):
    doc = fitz.open(); page = doc.new_page()
    page.insert_text((72, 100), sentence, fontsize=12)
    for r in page.search_for(sentence): page.add_highlight_annot(r)
    b = doc.tobytes(); doc.close(); return b


def test_ingest_from_source_pdf(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch30-p1.pdf").write_bytes(_pdf_bytes())
    job = qc.ingest(base, "ch30-p1", "30", "Daptomycin")
    assert job["status"] == "pending" and job["sessionId"] == "ch30-p1" and len(job["highlights"]) == 1


def test_process_job_drafts_questions(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    (base / "queue" / "source").mkdir(parents=True)
    (base / "queue" / "source" / "ch30-p1.pdf").write_bytes(_pdf_bytes())
    _write(tmp_path / "ID Anki Cards" / "30 - Dapto" / "d.json", {"cards": [{"Text": "membrane"}]})
    job = qc.ingest(base, "ch30-p1", "30", "Dapto")
    QS = [{"stem": "s", "archetype": "pharm",
           "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    qc.process_job(base, job["id"], lambda prompt: QS)
    out = cards_core.load_job(base, job["id"], kind="questions")
    assert out["status"] == "drafted" and out["questions"][0]["stem"] == "s"


def test_save_writes_per_session_json(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    cards_core.ensure_queue(base, kind="questions")
    job = cards_core.create_job(base, "30", "Daptomycin", [], kind="questions")
    job = cards_core.set_status(base, job, "drafted", kind="questions",
                                sessionId="ch30-p2",
                                questions=[{"stem": "s", "subquestions": []}])
    approved = [{"stem": "s2", "archetype": "pharm",
                 "subquestions": [{"prompt": "Name 1", "count": 1, "marks": 1, "answer": ["x"]}]}]
    res = qc.save(base, job, approved)
    f = tmp_path / "ID Practice Questions" / "30 - Daptomycin" / "ch30-p2.json"
    assert f.exists() and res["saved"] == 1
    assert json.loads(f.read_text())["questions"][0]["stem"] == "s2"
    assert cards_core.load_job(base, job["id"], kind="questions")["status"] == "saved"


def test_load_session_and_all_questions(tmp_path):
    base = tmp_path / "ID Platform"; base.mkdir()
    d = tmp_path / "ID Practice Questions" / "30 - Daptomycin"
    _write(d / "ch30-p1.json", {"questions": [{"stem": "q1", "subquestions": []}]})
    _write(d / "ch30-p2.json", {"questions": [{"stem": "q2", "subquestions": []},
                                              {"stem": "q3", "subquestions": []}]})
    one = qc.load_session_questions(base, "30", "Daptomycin", "ch30-p1")
    assert [q["stem"] for q in one] == ["q1"]
    allq = qc.load_all_questions(base, "30", "Daptomycin")
    assert sorted(q["stem"] for q in allq) == ["q1", "q2", "q3"]
