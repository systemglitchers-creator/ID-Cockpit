"""Generate ID Cockpit PWA icons and launch images — apothecary.

Run: python3 public/make_icons.py   (requires Pillow)

Deep green tile, pale serif "ID", and a three-quarter progress arc — the same
idea the app's sector rings use. Deliberately a dark tile with light marks: it
holds against both light and dark iOS wallpapers, where a pale sage tile would
disappear against the former.
"""
import hashlib
import json
import re
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)

GREEN_D = (32, 74, 52, 255)      # tile, a shade under --acc-d
GREEN_L = (58, 122, 84, 255)     # arc trail
PALE    = (242, 246, 240, 255)   # --bg, for the letterforms
GOLD    = (184, 137, 47, 255)    # --gold, the arc head
BG      = (242, 246, 240, 255)   # --bg, launch screens


def _font(px):
    for name in ("Georgia Bold", "Georgia", "Times New Roman Bold", "Times New Roman"):
        try:
            return ImageFont.truetype(name, px)
        except Exception:
            pass
    return ImageFont.load_default()


def draw(size, transparent_bg=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent_bg else GREEN_D)
    d = ImageDraw.Draw(img)
    if transparent_bg:                      # maskable: iOS crops to a circle
        d.ellipse([0, 0, size - 1, size - 1], fill=GREEN_D)

    m = int(size * 0.14)
    box = [m, m, size - m, size - m]
    w = max(3, size // 20)
    d.arc(box, start=135, end=360, fill=GREEN_L, width=w)
    d.arc(box, start=340, end=360, fill=GOLD, width=w)

    f = _font(int(size * 0.40))
    text = "ID"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t - size * 0.01),
           text, font=f, fill=PALE)
    return img


# Filenames carry a content hash, and every reference is rewritten to match.
#
# This is not tidiness. vercel.json serves /icons/* as `immutable, max-age=1y`,
# which tells every cache never to revalidate. With stable filenames that means a
# changed icon can never reach a device that has already installed the app —
# which is exactly what happened: the new icon deployed, and the phone kept
# showing the retired dark app's violet orb.
REFS = ["index.html", "sw.js", "manifest.webmanifest"]


def emit(img, stem):
    """Save with a content hash, delete older versions, return the filename."""
    tmp = OUT / (stem + ".tmp.png")
    img.save(tmp)
    h = hashlib.sha256(tmp.read_bytes()).hexdigest()[:8]
    final = OUT / f"{stem}.{h}.png"
    tmp.rename(final)
    for old in OUT.glob(f"{stem}.*.png"):
        if old != final:
            old.unlink()
    return final.name


written = {}
for stem, px, transparent in [
    ("icon-192", 192, False),
    ("icon-512", 512, False),
    ("icon-maskable-512", 512, True),
    ("apple-touch-icon-180", 180, False),
]:
    written[stem] = emit(draw(px, transparent), stem)
    print("wrote", written[stem])

# ---- launch images -------------------------------------------------------
# iOS matches these by exact device resolution, so the set is inherently partial
# and goes stale as Apple ships new sizes. Any unmatched device falls back to the
# manifest background_color, which is this same colour — so a miss degrades to a
# plain sage screen rather than a white flash.
SPLASH = [
    (1179, 2556), (1290, 2796),
    (1170, 2532), (1284, 2778),
    (1125, 2436), (1242, 2688),
    (828, 1792),
]

for w, h in SPLASH:
    img = Image.new("RGBA", (w, h), BG)
    mark = draw(int(w * 0.22))
    img.paste(mark, ((w - mark.width) // 2, (h - mark.height) // 2 - int(h * 0.04)), mark)
    written[f"splash-{w}x{h}"] = emit(img, f"splash-{w}x{h}")
print("wrote", len(SPLASH), "launch images")

# Rewrite every reference to the new hashed names.
root = Path(__file__).resolve().parent
for ref in REFS:
    path = root / ref
    text = path.read_text(encoding="utf-8")
    for stem, name in written.items():
        text = re.sub(re.escape(stem) + r"(\.[0-9a-f]{8})?\.png", name, text)
    path.write_text(text, encoding="utf-8")
print("rewrote references in", ", ".join(REFS))
