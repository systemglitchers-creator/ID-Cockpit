import fitz
import export_pdf


HEADER = {"chapter": "Chapter 82 — Endocarditis and Intravascular Infections",
          "subtitle": "pp. 1012–1017 · practice questions"}
QS = [{"stem": "A 40M with prosthetic valve endocarditis.", "archetype": "clinical",
       "subquestions": [
           {"prompt": "Name 2 empiric agents", "count": 2, "marks": 1.5, "answer": ["vancomycin", "gentamicin"]},
           {"prompt": "Name 1 indication for surgery", "count": 1, "marks": 1, "answer": ["heart failure"]},
       ]}]


def test_build_returns_pdf_with_questions_and_answers():
    data = export_pdf.build(HEADER, QS)
    assert data[:4] == b"%PDF"
    doc = fitz.open(stream=data, filetype="pdf")
    # PyMuPDF extraction of embedded-font text uses non-breaking spaces; normalize
    # them so content checks aren't fooled (the rendered PDF spacing is correct).
    txt = "".join(p.get_text() for p in doc).replace("\xa0", " ")
    assert "Endocarditis" in txt
    assert "Name 2 empiric agents" in txt
    assert "(1.5)" in txt              # mark weighting rendered
    assert "Answer Key" in txt
    assert "vancomycin" in txt         # model answer present
    assert doc.page_count >= 2         # questions page + answer-key page


def test_build_empty_questions_still_valid_pdf():
    data = export_pdf.build(HEADER, [])
    assert data[:4] == b"%PDF"
