# Premium Polish — Plan 4: Launch, Icon, iOS Fit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix how the app *arrives* — the icon on the home screen, the first
frame after tapping it, and the places it currently sits badly in iOS.

**Architecture:** No app logic changes. A Python generator writes the icon set
(`public/make_icons.py`, replacing the retired dark-app version in `phone/`),
plus CSS and head-tag work in `public/index.html`.

**Tech Stack:** Pillow 11.3 (confirmed installed) for image generation, plain CSS
for the rest.

**Scope:** Stage 5 of `docs/2026-08-09-premium-polish-design.md`. Gestures
(stage 6) are deliberately excluded — see the end. Dark mode is still undecided.

---

## What is actually wrong

- **The icon is the retired dark app's artwork.** `public/icons/*` are
  byte-identical to `phone/icons/*` — a violet orb on near-black. On the home
  screen, a green editorial app wears a dark sci-fi badge.
- **Two of five safe-area edges are handled.** The header pads for the notch and
  the tab bar for the home indicator. Nothing handles landscape insets or the
  scrolling body.
- **Tapping anything flashes a grey box.** No `-webkit-tap-highlight-color`.
- **The first frame is white.** No launch images, and `html` carries no
  background, so there is a flash before CSS paints the body.

---

### Task 1: A new icon

**Files:** Create `public/make_icons.py`; regenerate `public/icons/*`

- [ ] **Step 1: Write the generator**

```python
"""Generate ID Cockpit PWA icons — apothecary.

Run: python3 public/make_icons.py   (requires Pillow)

Deep green tile, pale serif "ID", and a three-quarter progress arc — the same
idea the app's sector rings use. Deliberately a dark tile with light marks: it
holds up against both light and dark iOS wallpapers, where a pale sage tile
would disappear against the former.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)

GREEN_D = (32, 74, 52, 255)      # tile, a shade under --acc-d
GREEN_L = (58, 122, 84, 255)     # arc trail
PALE    = (242, 246, 240, 255)   # --bg, for the letterforms
GOLD    = (184, 137, 47, 255)    # --gold, the arc head


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
        d.ellipse([0, 0, size, size], fill=GREEN_D)

    # progress arc, three quarters round, gold at the head
    m = int(size * 0.14)
    box = [m, m, size - m, size - m]
    w = max(3, size // 20)
    d.arc(box, start=135, end=360, fill=GREEN_L, width=w)
    d.arc(box, start=340, end=360, fill=GOLD, width=w)

    # serif ID, optically centred
    f = _font(int(size * 0.40))
    text = "ID"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t - size * 0.01),
           text, font=f, fill=PALE)
    return img


for name, px, transparent in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon-180.png", 180, False),
]:
    draw(px, transparent).save(OUT / name)
    print("wrote", name)
```

- [ ] **Step 2: Generate and confirm they changed**

```bash
cd "8. Claude/ID Platform"
python3 public/make_icons.py
cmp -s public/icons/icon-192.png phone/icons/icon-192.png && echo "STILL IDENTICAL — generator did not run" || echo "differs from the old dark app: good"
```

- [ ] **Step 3: Look at them**

Open `public/icons/icon-192.png` and check it reads at small size. An icon that
needs to be large to be legible is a failed icon.

- [ ] **Step 4: Commit**

```bash
git add public/make_icons.py public/icons
git commit -m "feat: apothecary app icon

public/icons were byte-identical to the retired dark app's artwork, so the
green app wore a violet orb on the home screen."
```

---

### Task 2: iOS fit

**Files:** Modify `public/index.html`

- [ ] **Step 1: Kill the tap flash and paint the shell early**

Add to the top of the stylesheet, immediately after `:root{...}`:

```css
html{background:var(--bg);-webkit-text-size-adjust:100%}
*{-webkit-tap-highlight-color:transparent}
button,a{-webkit-touch-callout:none}
```

`html` matters: the body gradient paints a frame later, and before it does the
page shows the browser's default white.

- [ ] **Step 2: Handle the side insets too**

The header pads the top and the tab bar pads the bottom. Landscape and the
curved edges need the sides:

```css
#body{padding-left:env(safe-area-inset-left,0px);
      padding-right:env(safe-area-inset-right,0px)}
```

- [ ] **Step 3: Match the status bar to the app**

`public/index.html` line 8 — `default` gives a light bar that fights the header:

```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

With `black-translucent` the web view extends under the status bar, which is why
Step 1's `html` background and the existing `safe-area-inset-top` padding both
matter. Check on a real phone; if the header text collides with the clock, go
back to `default`.

- [ ] **Step 4: Verify**

```bash
python3 -m http.server 8797 --directory public
```
At 375px: tap a row and confirm no grey flash. Then check the console is clean.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: iOS fit — no tap flash, side insets, early background"
```

---

### Task 3: Launch images

iOS shows a blank screen between the tap and first paint unless given a startup
image per device size.

- [ ] **Step 1: Add generation to the icon script**

Append to `public/make_icons.py`:

```python
# ---- launch images -------------------------------------------------------
# iOS matches these by exact device resolution, so the set is inherently
# partial and goes stale as Apple ships new sizes. Any unmatched device falls
# back to the manifest background_color, which is the same colour — so a miss
# degrades to a plain sage screen rather than a white flash.
SPLASH = [
    (1179, 2556), (1290, 2796),     # 15/16 Pro, Pro Max
    (1170, 2532), (1284, 2778),     # 12/13/14 and Pro Max
    (1125, 2436), (1242, 2688),     # X/XS, XS Max
    (828, 1792),                    # XR/11
]

BG = (242, 246, 240, 255)           # --bg

for w, h in SPLASH:
    img = Image.new("RGBA", (w, h), BG)
    mark = draw(int(w * 0.22))
    img.paste(mark, ((w - mark.width) // 2, (h - mark.height) // 2 - int(h * 0.04)), mark)
    img.save(OUT / f"splash-{w}x{h}.png")
    print("wrote", f"splash-{w}x{h}.png")
```

- [ ] **Step 2: Generate**

```bash
python3 public/make_icons.py && ls public/icons/splash-*.png | wc -l
```
Expected: `7`

- [ ] **Step 3: Link them**

In `public/index.html`, after the existing apple meta tags. Each needs its own
media query; there is no wildcard:

```html
<link rel="apple-touch-startup-image" media="(device-width:430px) and (device-height:932px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1290x2796.png">
<link rel="apple-touch-startup-image" media="(device-width:393px) and (device-height:852px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1179x2556.png">
<link rel="apple-touch-startup-image" media="(device-width:428px) and (device-height:926px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1284x2778.png">
<link rel="apple-touch-startup-image" media="(device-width:390px) and (device-height:844px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1170x2532.png">
<link rel="apple-touch-startup-image" media="(device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1242x2688.png">
<link rel="apple-touch-startup-image" media="(device-width:375px) and (device-height:812px) and (-webkit-device-pixel-ratio:3)" href="icons/splash-1125x2436.png">
<link rel="apple-touch-startup-image" media="(device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:2)" href="icons/splash-828x1792.png">
```

- [ ] **Step 4: Cache them for offline launch**

In `public/sw.js`, add the splash files to `SHELL`, or a cold offline launch
shows nothing. Then bump `CACHE`.

- [ ] **Step 5: Ship and verify**

```bash
node --test "tests/js/*.test.mjs"
git add -A && git commit -m "feat: iOS launch images"
git push origin main
until curl -s https://id-cockpit.vercel.app/sw.js | grep -q "idcockpit-web-v10"; do sleep 6; done
curl -s -o /dev/null -w "splash:%{http_code}\n" https://id-cockpit.vercel.app/icons/splash-1290x2796.png
curl -s https://id-cockpit.vercel.app/api/progress | head -c 40
```

**Only a real device proves this one.** Tyler needs to delete and re-add the home
screen icon — iOS caches both the icon and the startup images at install time,
so an existing installation will keep showing the old dark badge no matter what
is deployed.

---

## Gestures: not in this plan

Stage 6 (swipe between tabs, drag-to-dismiss sheets) is excluded rather than
deferred. Swipe-between-tabs competes with vertical scrolling and with iOS's own
back-swipe, and the failure mode is an app that feels *broken* rather than
unpolished — worse than the problem it solves. Revisit only if the app feels
static once everything else has landed.

## Self-review notes

- **Verified before writing:** Pillow 11.3 is installed; `public/icons/*` really
  are byte-identical to `phone/icons/*`; exactly two `env(safe-area-inset-*)`
  rules exist today (header top, tab bar bottom).
- **Task 3 is inherently partial and says so.** Device-matched launch images go
  stale. The mitigation is that the fallback colour equals the splash colour, so
  an unmatched device degrades to a plain sage screen — not a white flash.
- **Task 2 Step 3 could be wrong on a real phone.** `black-translucent` is the
  better look but can collide with the clock. The step says to check and revert
  rather than presenting it as settled.
- **Nothing here is covered by the test suite** — it is images, head tags and
  CSS. The 86 tests must stay green, but green proves only that nothing else
  broke.
