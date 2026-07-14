"""Render practice questions to a clean RC-exam-styled PDF using PyMuPDF.

Embeds a Unicode system font (Arial) so medical characters (β, μ, ≥, α, ×, en/em
dashes) render correctly; falls back to PyMuPDF's built-in Latin-1 fonts if those
system fonts aren't present. Fonts are subset on save to keep the PDF small.
"""
from __future__ import annotations

import os

import fitz

_MARGIN = 54

_CANDIDATES = {
    "reg":  ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"],
    "bold": ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
    "ital": ["/System/Library/Fonts/Supplemental/Arial Italic.ttf", "/Library/Fonts/Arial Italic.ttf"],
}
_BUILTIN = {"reg": "helv", "bold": "hebo", "ital": "heit"}


def _resolve():
    return {style: next((c for c in cands if os.path.exists(c)), None)
            for style, cands in _CANDIDATES.items()}


_FILES = _resolve()


def _wrap(font, size, width, text):
    out = []
    for para in str(text).split("\n"):
        cur = ""
        for w in para.split():
            t = (cur + " " + w).strip()
            if font.text_length(t, size) <= width or not cur:
                cur = t
            else:
                out.append(cur); cur = w
        out.append(cur)
    return out or [""]


class _Doc:
    def __init__(self):
        self.doc = fitz.open()
        self.fonts, self.tag, self.file = {}, {}, {}
        for style in ("reg", "bold", "ital"):
            f = _FILES.get(style)
            if f:
                self.fonts[style] = fitz.Font(fontfile=f)
                self.tag[style] = "id" + style
                self.file[style] = f
            else:
                self.fonts[style] = fitz.Font(_BUILTIN[style])
                self.tag[style] = _BUILTIN[style]
                self.file[style] = None
        self.page = None
        self.y = 0
        self.rect = fitz.paper_rect("letter")

    def _newpage(self):
        self.page = self.doc.new_page(width=self.rect.width, height=self.rect.height)
        self.y = _MARGIN

    def line(self, text, size=11, style="reg", indent=0, gap=3):
        if self.page is None:
            self._newpage()
        font = self.fonts[style]
        width = self.rect.width - 2 * _MARGIN - indent
        for ln in _wrap(font, size, width, text):
            if self.y + size + gap > self.rect.height - _MARGIN:
                self._newpage()
            kw = {"fontname": self.tag[style], "fontsize": size}
            if self.file[style]:
                kw["fontfile"] = self.file[style]
            self.page.insert_text((_MARGIN + indent, self.y + size), ln, **kw)
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
    try:
        d.doc.subset_fonts()
    except Exception:
        pass
    return d.doc.tobytes()
