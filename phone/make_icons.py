"""Generate ID Cockpit PWA icons. Run once: python phone/make_icons.py
Requires Pillow (pip install pillow). Draws a violet orb with 'ID' on the app bg."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BG = (7, 5, 16, 255)         # #070510
VIO = (123, 92, 255, 255)    # #7b5cff
VIO2 = (171, 151, 255, 255)  # #ab97ff
CYAN = (55, 230, 207, 255)   # #37e6cf


def _font(px):
    for name in ("Chakra Petch", "HelveticaNeue-Bold", "Arial Bold", "Arial"):
        try:
            return ImageFont.truetype(name, px)
        except Exception:
            pass
    return ImageFont.load_default()


def draw(size, pad_frac, apple=False):
    img = Image.new("RGBA", (size, size), BG if apple else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_frac)
    box = [pad, pad, size - pad, size - pad]
    # ring
    d.ellipse(box, fill=BG, outline=VIO, width=max(4, size // 24))
    # inner glow ring
    g = int(size * 0.06)
    d.ellipse([box[0] + g, box[1] + g, box[2] - g, box[3] - g], outline=CYAN, width=max(2, size // 60))
    # "ID"
    txt = "ID"
    f = _font(int(size * 0.34))
    tb = d.textbbox((0, 0), txt, font=f)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.text(((size - tw) / 2 - tb[0], (size - th) / 2 - tb[1]), txt, font=f, fill=VIO2)
    return img


draw(192, 0.10).save(OUT / "icon-192.png")
draw(512, 0.10).save(OUT / "icon-512.png")
draw(512, 0.20).save(OUT / "icon-maskable-512.png")   # extra safe-area padding
draw(180, 0.10, apple=True).save(OUT / "apple-touch-icon-180.png")
print("icons written to", OUT)
