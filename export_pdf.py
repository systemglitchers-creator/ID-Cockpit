"""Render practice questions to a clean RC-exam-styled PDF using PyMuPDF."""
from __future__ import annotations

import fitz

_MARGIN = 54
_REG, _BOLD, _ITAL = "helv", "hebo", "heit"


def _wrap(font, size, width, text):
    words = str(text).split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if font.text_length(t, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


class _Doc:
    def __init__(self):
        self.doc = fitz.open()
        self.rf, self.bf, self.itf = fitz.Font(_REG), fitz.Font(_BOLD), fitz.Font(_ITAL)
        self.page = None
        self.y = 0
        self.rect = fitz.paper_rect("letter")

    def _newpage(self):
        self.page = self.doc.new_page(width=self.rect.width, height=self.rect.height)
        self.y = _MARGIN

    def line(self, text, size=11, style="reg", indent=0, gap=3):
        font = {"bold": self.bf, "ital": self.itf}.get(style, self.rf)
        fname = {"bold": _BOLD, "ital": _ITAL}.get(style, _REG)
        if self.page is None:
            self._newpage()
        width = self.rect.width - 2 * _MARGIN - indent
        for ln in _wrap(font, size, width, text):
            if self.y + size + gap > self.rect.height - _MARGIN:
                self._newpage()
            self.page.insert_text((_MARGIN + indent, self.y + size), ln,
                                  fontname=fname, fontsize=size)
            self.y += size + gap

    def space(self, h=8):
        self.y += h

    def rule(self):
        if self.page is None:
            self._newpage()
        self.page.draw_line((_MARGIN, self.y), (self.rect.width - _MARGIN, self.y),
                            color=(0.6, 0.6, 0.6), width=0.6)
        self.y += 8


def build(header, questions):
    """header: {chapter, subtitle}; questions: list of {stem, subquestions:[{prompt,marks,answer}]}."""
    d = _Doc()
    d.line(header.get("chapter", "Practice Questions"), size=16, style="bold")
    if header.get("subtitle"):
        d.line(header["subtitle"], size=10, style="ital")
    d.rule(); d.space(4)
    for i, q in enumerate(questions, 1):
        d.line(str(i) + ".  " + q.get("stem", ""), size=11, style="bold")
        for sq in q.get("subquestions", []) or []:
            marks = sq.get("marks", "")
            d.line("(" + str(marks) + ")  " + sq.get("prompt", ""), size=10.5, indent=18)
            d.space(14)  # room to write an answer
        d.space(8)
    # answer key on a fresh page
    d._newpage()
    d.line("Answer Key", size=15, style="bold"); d.rule(); d.space(4)
    for i, q in enumerate(questions, 1):
        d.line(str(i) + ".  " + q.get("stem", ""), size=10.5, style="bold")
        for sq in q.get("subquestions", []) or []:
            d.line(sq.get("prompt", ""), size=10, style="ital", indent=18)
            for a in sq.get("answer", []) or []:
                d.line("•  " + str(a), size=10, indent=30)
        d.space(6)
    return d.doc.tobytes()
