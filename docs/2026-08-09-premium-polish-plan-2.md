# Premium Polish — Plan 2: Palette, Depth, Type

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app to the apothecary palette, then replace outlines with
depth and make the numbers behave typographically. After this it should look
expensive; hierarchy and dark mode follow in plan 3.

**Architecture:** Task 1 is a refactor with **no visual change** — it makes the
palette genuinely swappable, which the code currently only claims to be. Task 2
is then a single `:root` edit. Tasks 3 and 4 are CSS-only passes.

**Tech Stack:** Plain CSS custom properties, vanilla JS, no build step.

**Scope:** Stage 3 of `docs/2026-08-09-premium-polish-design.md`, plus the palette
change Tyler asked for after the spec was written. Hierarchy (quest-as-hero,
stats strip), motion, launch, icon, gestures and the dark variant are later plans.

---

## Why Task 1 exists

`public/index.html` line 18 says the swatch "stays swappable". It does not. An
audit found:

- `var ACC = "#9c4f6b"` in `app.js` — a **JavaScript copy** of `--acc`, used to
  colour the sector rings.
- `"#d6c2ce"` in `app.js` — a copy of `--box`.
- Eight hardcoded hexes in the stylesheet outside `:root`, including the `body`
  background itself.

Swapping `:root` alone would leave berry pink scattered through a green app, in
places nobody would think to look. Fix the mechanism first, then use it.

---

### Task 1: Make the palette actually swappable

**Files:** Modify `public/index.html`, `public/app.js`

- [ ] **Step 1: Capture the "before" for comparison**

```bash
cd "8. Claude/ID Platform" && python3 -m http.server 8797 --directory public
```
Open `http://127.0.0.1:8797/`, screenshot the Today, Path and Stats tabs. Task 1
must not change a pixel; these are the reference.

- [ ] **Step 2: Add variables for the values that lack them**

In `public/index.html`, inside `:root{...}`, add before the font lines:

```css
  --alt-hover:#ecd3df; --undo-bd:#ddccd7; --pill-bd:#e4d6e0;
  --behind:#b0552f; --ahead:#7d8a5a;
```

`--behind` and `--ahead` are semantic, not decorative: they mean "off plan" and
"ahead of plan" and must stay legible against any palette.

- [ ] **Step 3: Replace the hardcoded hexes**

Six edits in `public/index.html`:

| Line | From | To |
|---|---|---|
| 32 | `body{background:#efe4ea;` | `body{background:var(--bg);` |
| 81 | `.qacts .alt:hover{background:#ecd3df}` | `.qacts .alt:hover{background:var(--alt-hover)}` |
| 129 | `border:1px solid #ddccd7;` | `border:1px solid var(--undo-bd);` |
| 143 | `.summary .v.behind{color:#b0552f}` | `.summary .v.behind{color:var(--behind)}` |
| 144 | `.summary .v.ahead{color:#7d8a5a}` | `.summary .v.ahead{color:var(--ahead)}` |
| 147 | `border:1px solid #e4d6e0}` | `border:1px solid var(--pill-bd)}` |

Note line 32 changes `#efe4ea` to `var(--bg)`, which is `#f5edf1` — a deliberate
one-shade difference, since two near-identical background colours in the same app
is a bug, not a design.

- [ ] **Step 4: Stop duplicating the accent in JavaScript**

In `public/app.js`, replace:

```js
  var ACC = "#9c4f6b";
```

with:

```js
  // Read from the stylesheet rather than duplicating it — a second copy of the
  // accent is how a palette swap leaves the old colour behind in one place.
  var ACC = getComputedStyle(document.documentElement)
              .getPropertyValue("--acc").trim() || "#9c4f6b";
```

- [ ] **Step 5: Replace the other JS colour**

In `public/app.js`, in the `ringCol` line, replace `"#d6c2ce"` with
`"var(--box)"`. It is used as an SVG/conic colour where `var()` resolves, the
same way `"var(--gold)"` already does on that line.

- [ ] **Step 6: Verify nothing is left**

```bash
grep -n "#[0-9a-fA-F]\{6\}" public/app.js
python3 - <<'PY'
import re
s=open('public/index.html',encoding='utf-8').read()
root=re.search(r':root\{.*?\n\}', s, re.S).group(0)
print("hexes outside :root:", len(re.findall(r'#[0-9a-fA-F]{6}', s.replace(root,''))))
PY
```
Expected: `app.js` shows only the `|| "#9c4f6b"` fallback; the count is `1` (the
`theme-color` meta tag, handled in Task 2).

- [ ] **Step 7: Confirm it is pixel-identical**

Reload and screenshot the same three tabs. They must match Step 1 exactly. The
sector rings on Path are the ones to check — they are what `ACC` colours.

**The tests will break here — this is expected, not a surprise.** `app.js` now
calls `getComputedStyle` at load, and the vm sandbox in `tests/js/harness.mjs`
does not provide it, so every harness test throws a ReferenceError. Verified: the
harness has zero references to it today.

Add to the `sandbox` object in `tests/js/harness.mjs`, next to `document`:

```js
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
```

The empty string falls through to the `||` fallback, so tests exercise the same
default a browser without the variable would. Then run:

`node --test "tests/js/*.test.mjs"` — expected 77 pass.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js tests/js/harness.mjs
git commit -m "refactor: make the palette genuinely swappable

The file claimed the swatch stays swappable; it did not. app.js held a
JavaScript copy of --acc and one of --box, and eight hexes sat outside
:root including the body background.

No visual change: verified pixel-identical across all three tabs."
```

---

### Task 2: Apothecary

Deep clinical green on pale sage. One `:root` block, plus the two places iOS
reads a theme colour.

**Files:** Modify `public/index.html`, `public/manifest.webmanifest`

- [ ] **Step 1: Replace the palette**

In `public/index.html`, replace the whole `:root{...}` block's colour lines
(keep `--sans` and `--serif` exactly as they are):

```css
:root{
  --acc:#2f6b4a; --acc-d:#245139;
  --gold:#b8892f; --gold-txt:#7a6224; --gold-bg:#f2ecd8; --gold-bd:#ddd0aa; --read:#9c7d33;
  --bg:#f2f6f0; --soft:#e9f0e7; --card:#fdfffc; --on-acc:#fdfffc;
  --line:#dce7db; --hair:#e6efe4; --track:#dfe9dd; --node-track:#d7e4d5; --sheet-track:#dde8db;
  --box:#c2d2c0; --pip:#d3e0d1; --quest-bd:#b6cfb9; --grab:#c9d8c7;
  --txt:#1d2b22; --mut:#6d8074; --faint:#9aab9d; --numeral:#adbfab; --strike:#8f9f8d;
  --chip-bg:#e7efe5; --chip-txt:#2f6b4a;
  --alt-hover:#dde9db; --undo-bd:#cbdac9; --pill-bd:#dae6d8;
  --behind:#a85a2c; --ahead:#3f7d55;
```

`--behind` stays warm ochre so "off plan" reads as a warning rather than
blending into a green interface. `--ahead` is a green distinct from `--acc`.

- [ ] **Step 2: Update the comment above it**

Replace the stale swatch note on line 18 with:

```css
    apothecary — deep clinical green on pale sage. Every colour in the app comes
    from this block; there are no hardcoded hexes outside it (see plan 2 task 1). */
```

- [ ] **Step 3: Update the theme colour iOS uses for the status bar**

`public/index.html` line 6:
```html
<meta name="theme-color" content="#e9f0e7">
```

`public/manifest.webmanifest`:
```json
  "background_color": "#f2f6f0",
  "theme_color": "#e9f0e7",
```

- [ ] **Step 4: Look at every tab**

Reload and check Today, Path, Find and Stats, plus an open sector sheet. Watch
specifically for: text contrast on the accent button, the gold "complete" state
against green, and the `behind`/`ahead` stat colours.

- [ ] **Step 5: Check contrast, do not eyeball it**

In the browser console:

```js
(function(){
  function lum(h){var c=h.replace('#','').match(/../g).map(function(x){var v=parseInt(x,16)/255;
    return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
    return .2126*c[0]+.7152*c[1]+.0722*c[2]}
  function ratio(a,b){var l1=lum(a),l2=lum(b);return ((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toFixed(2)}
  return {textOnBg:ratio('#1d2b22','#f2f6f0'), mutedOnBg:ratio('#6d8074','#f2f6f0'),
          onAccBtn:ratio('#fdfffc','#2f6b4a'), faintOnBg:ratio('#9aab9d','#f2f6f0')};
})()
```
Expected: `textOnBg` and `onAccBtn` above 4.5. `mutedOnBg` above 3.0. If
`faintOnBg` is below 3.0 that is acceptable — it is decorative numerals, not
content — but note it rather than ignoring it.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/manifest.webmanifest
git commit -m "feat: apothecary palette

Deep clinical green on pale sage, Tyler's pick from four directions. One
:root block plus the two theme-colour declarations iOS reads.

--behind stays warm ochre so off-plan reads as a warning rather than
blending into a green interface."
```

---

### Task 3: Depth instead of outlines

Hairline borders on flat fill read as a diagram. Layered shadows and a
background gradient make surfaces sit above the page.

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add depth tokens to `:root`**

```css
  --sh-1:0 1px 2px rgba(20,45,30,.05);
  --sh-2:0 1px 2px rgba(20,45,30,.05),0 10px 24px -12px rgba(20,45,30,.16);
  --sh-3:0 1px 2px rgba(20,45,30,.05),0 10px 24px -12px rgba(20,45,30,.18),
         0 28px 56px -28px rgba(20,45,30,.22);
  --edge:.5px solid rgba(47,107,74,.10);
```

Shadows are tinted with the palette's own hue rather than neutral grey — a grey
shadow on a green ground reads as dirt.

- [ ] **Step 2: Give the page a gradient**

```css
body{background:linear-gradient(178deg,#f7faf6 0%,#f2f6f0 46%,#eaf1e8 100%);
     background-attachment:fixed;
```
(keep the rest of the `body` rule unchanged)

- [ ] **Step 3: Lift the quest card**

Replace the `.quest` border and add depth:

```css
.quest{background:var(--card);border:var(--edge);border-radius:22px;
       box-shadow:var(--sh-3);padding:18px 16px 16px;margin-bottom:16px}
```

- [ ] **Step 4: Lift the row cards, less**

For `.qrow`, `.sbrow` and the Up Next rows, replace `border:1px solid var(--line)`
with `border:var(--edge); box-shadow:var(--sh-1);`. These sit just above the page,
not floating.

- [ ] **Step 5: Give the primary button a light source**

```css
.go{background:linear-gradient(180deg,#358055,#276044);
    box-shadow:0 1px 0 rgba(255,255,255,.2) inset,0 6px 14px -6px rgba(30,80,55,.5)}
```

- [ ] **Step 6: Verify at mobile width**

Resize the browser to 375px and screenshot each tab. Shadows tuned at desktop
width look heavy on a phone. If the quest card looks like it is floating off the
screen, step `--sh-3` down to `--sh-2`.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: depth instead of outlines

Layered shadows tinted with the palette hue, a fixed background gradient,
and an inset highlight on the primary button. Surfaces now sit above the
page rather than being drawn on it."
```

---

### Task 4: Typography

**Files:** Modify `public/index.html`

- [ ] **Step 1: Make every changing number tabular**

Add to `:root`'s consumers — any rule displaying a number that can change needs
`font-variant-numeric:tabular-nums`. The set is: `.qp` (page range), `.summary
.v`, `.cv`/stat values, `.rn`/row numerals, `.hmeta`, and the sector counts.

Add a utility and apply it:

```css
.tnum,.qp,.summary .v,.hmeta,.sbrow .c{font-variant-numeric:tabular-nums}
```

Without this, digits have different widths and the count-up animation in plan 3
will visibly jitter.

- [ ] **Step 2: Tighten the display serif**

```css
.title{letter-spacing:-.018em}
.quest .qt{letter-spacing:-.02em}
```

- [ ] **Step 3: Open up the small caps**

```css
.eyebrow,.quest .qk,.upn,.ck{letter-spacing:.2em}
```

- [ ] **Step 4: Verify**

Reload, and confirm on the Stats tab that the numbers in the right-hand column
line up vertically. That is the visible proof tabular figures took effect.

- [ ] **Step 5: Run the tests and commit**

```bash
node --test "tests/js/*.test.mjs"
git add public/index.html
git commit -m "feat: typographic craft

Tabular figures anywhere a number changes, negative tracking on display
serif, wider tracking on small caps. The figures matter beyond neatness:
proportional digits jitter when a value animates."
```

---

### Task 5: Ship

- [ ] **Step 1: Bump the service worker**

```bash
sed -i '' 's/idcockpit-web-v6/idcockpit-web-v7/' public/sw.js
```

- [ ] **Step 2: Full suite and push**

```bash
node --test "tests/js/*.test.mjs"
git add public/sw.js && git commit -m "chore: bump sw cache for the palette and depth work"
git push origin main
```
Expected: 77 pass.

- [ ] **Step 3: Verify live**

```bash
until curl -s https://id-cockpit.vercel.app/sw.js | grep -q "idcockpit-web-v7"; do sleep 6; done
curl -s -o /dev/null -w "app:%{http_code}\n" https://id-cockpit.vercel.app/
curl -s https://id-cockpit.vercel.app/api/progress | head -c 60
```

Then open the deployed app at mobile viewport, screenshot all four tabs, and
confirm a clean console and that progress still reads 35 sessions.

---

## Self-review notes

- **Spec coverage:** stage 3 (depth, type) plus the palette change requested
  after the spec was written. Hierarchy — quest-as-hero and the stats strip — is
  deliberately **not** here: it restructures markup rather than restyling it, and
  belongs with the motion work. Dark mode is its own plan.
- **Task 1 exists because of a real audit finding**, not caution: a JS copy of
  the accent and eight loose hexes. Its success criterion is "no pixel changed",
  which is unusual and deliberate — it is the only way to know the mechanism
  works before relying on it.
- **Values are real.** The `:root` block is derived from the apothecary mockup
  Tyler picked; the line numbers in Task 1 Step 3 were read from the current file.
- **Known gap, quantified:** `schedule.js` carries **30 distinct sector accent
  colours** in its data (`#3d7a5a`, `#b0413e`, `#a8432f`, `#9a5a2f`, `#3f5a8a`,
  `#6a5aa0`, …), authored against the berry palette. They are data, not CSS, so
  Task 2 does not touch them. Several are warm reds and oranges that will fight a
  green interface. Check the Path tab after Task 2; re-hueing them is a
  `schedule.js` edit and gets its own commit — and it must not touch session
  `id`s, which progress is keyed to.
