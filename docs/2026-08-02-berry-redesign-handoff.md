# Handoff: ID Cockpit — Infectious Diseases Study Platform (redesign)

## Overview
ID Cockpit is a mobile study tracker for a two-year Royal College Infectious Diseases
fellowship reading plan (Mandell, 10th ed.). The curriculum is a fixed, curated list of
**617 reading sessions** grouped into ~30 clinical **sectors**; each session is one
chapter (or a slice of a long chapter) with a page range. The user reads a session,
checks it off, and the app tracks progress, streaks, levels, and schedule drift.

This bundle is a **redesign** of an existing dark, sci-fi "skill tree" version. The new
direction is a **warm plum / berry, editorial** aesthetic — calm and print-like, but still
lightly gamified (levels, XP, weekly streak, quests, per-sector progress).

The redesign keeps the existing app's **data contract and persistence unchanged** so it can
be a drop-in visual replacement (see State Management).

## About the Design Files
The files in this bundle are **design references created in HTML/JS** — a working prototype
showing the intended look and behavior. They are **not** production code to ship directly.
The task is to **recreate these designs in the target codebase's environment** (the existing
app is a self-contained HTML/vanilla-JS PWA; if rebuilding in React/Vue/SwiftUI, use that
stack's established patterns). Reuse the existing `schedule.js` (curriculum data) and
`sync.js` (persistence + gist sync) verbatim — only the presentation layer changes.

`ID Cockpit.dc.html` is authored in a component framework ("Design Components"); treat its
`<x-dc>` template + `Component` logic class as **pseudocode for structure and styling**, not
as a file to import. All layout is inline-styled; all values below are exact.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interactions.
Recreate pixel-accurately. The one caveat: the prototype embeds only **Year 1 (183 of 617
sessions)** as preview data — production must load the full `schedule.js`.

---

## Frame & Global Layout
- Target: **iPhone**, design width **402px** (content), full-bleed. Prototype renders inside
  an iOS device frame; ignore the bezel/status bar — that's the OS.
- Screen is a vertical flex column: **fixed header** → **scrolling body** → **fixed bottom tab bar**.
- Body scroll area padding: `16px 16px 104px` (last value clears the tab bar).
- Four tabs: **Today · Path · Find · Stats**. A **Sector sheet** slides up over any screen.

### Header (fixed, per screen)
- Background `#f2e4ec`, bottom border `1px solid #e8d8e1`, padding `62px 20px 16px`
  (the 62px top clears the status bar).
- Row 1: left **eyebrow** — 10.5px, weight 800, letter-spacing .16em, uppercase, color `#9c4f6b`.
  Right **meta** — 11px, weight 600, color `#9a8791`.
- Row 2: **title** — Newsreader serif, 30px, weight 500, line-height 1.08, letter-spacing -.4px,
  color `#33242c`, margin-top 5px.
- Per-screen header content:
  - Today: eyebrow = today's date (e.g. `SUN AUG 2`), title = `N-day streak` (or `Good morning` if streak ≤1), meta = `183 sessions left`.
  - Path: eyebrow `THE TWO-YEAR PATH`, title `Sectors`, meta `0 of 13 cleared`.
  - Find: eyebrow `THE WHOLE PLAN`, title `Find a chapter`, meta `183 sessions`.
  - Stats: eyebrow `WHERE YOU STAND`, title `Progress`, meta `0 pages read`.

### Bottom tab bar (fixed)
- Background `rgba(242,228,236,.94)` + `backdrop-filter: blur(14px)`, top border `1px solid #e8d8e1`,
  padding `10px 10px 28px` (28px bottom = home-indicator safe area).
- Each tab is a centered pill: 12px text; **active** = weight 800, color `#fffafc`, background = accent `#9c4f6b`, padding `8px 14px`, radius 99px; **inactive** = weight 600, color `#9a8791`, transparent.

---

## Screens / Views

### 1. Today  (screens/01-today.png)
Purpose: the daily landing — what to read now, and momentum.
Top-to-bottom in the scroll body:

1. **Streak strip** — a 7-column flex row (Mon→Sun by weekday initial). Each column: a
   9.5px/800 uppercase weekday letter (`#b3a3ac`) above a dot. Dot = 13px filled accent circle
   if that day had a read, else 9px `#e2d0dc`. Today's dot gets ring `0 0 0 3px rgba(194,94,58,.18)`.
   (Recolor that halo to the accent when you theme; see Tokens.)
2. **Level card** — white `#fffafc`, border `1px solid #e8d8e1`, radius 18px, padding `14px 16px`.
   Left: 56px **conic ring** = `conic-gradient(<accent> <intoLevel%>, #ece0e8 0)` with a 44px
   `#fffafc` inner disc holding the level number (Newsreader 20px/600, accent). Right column:
   rank name (14.5px/700) + XP label (`0 / 1200 pp`, 10.5px/700 `#9a8791`) on a baseline row;
   a 7px XP bar (track `#f0e5d7`→ themed `#ece0e8`, fill accent, radius 99); sub note
   `200 pages to level 2` (10.5px `#9a8791`).
3. **Quest card** — the hero. White `#fffafc`, border `1.5px solid #d9b3c4`, radius 20px,
   padding `16px 18px 18px`, shadow `0 6px 18px rgba(120,70,100,.1)`, entrance `idrise .3s`.
   - Eyebrow `TODAY'S QUEST` (10px/800/.16em, accent) + right page label (`pp 263–268 · 6 pages`).
   - Chapter line (11px/700/.06em uppercase `#9a8791`): `CHAPTER 20 · PART 1 OF 3`.
   - Title: Newsreader 23px/500, line-height 1.16, `text-wrap:pretty`.
   - Optional **guideline chip**: inline, 10.5px/700, background `#efe6ea`, text `#7d3e5a`, radius 99, padding `5px 11px`.
   - Actions row (gap 9): **Mark as read** (flex:1, background accent `#9c4f6b`, text `#fffafc`,
     14px/700, padding `14px 16px`, radius 14; hover `#7d3e5a`) + **Sector** (background `#f2e4ec`,
     text `#7d3e5a`, same metrics; hover `#ecd3df`).
4. **Up next** — section label (`UP NEXT`, 10.5px/800/.16em `#9a8791`) + up to 3 rows. Each row:
   white card, border `1px solid #e8d8e1`, radius 14, padding `12px 14px`; left session number in
   Newsreader 15px `#c6b4bf` (26px wide); title 13.5px/600; meta `Ch 20 · Part 2 of 3 · 5 pages` (10.5px `#9a8791`).

### 2. Path  (screens/02-today.png shown as Sectors)
Purpose: see the whole two-year arc as a connected trail; jump into any sector.
- Single left-aligned vertical **spine of nodes** (no dashed line). `flex-direction: column`, no gap;
  each row uses `padding-bottom: 22px` (except last) to host the connector.
- Each **node row**: click opens that sector's sheet. Row = flex, align center, gap 15, `position:relative`.
  - **Connector** (all but last): `position:absolute; left:35px; top:70px; width:3px; height:24px; radius:99px; z-index:0`.
    Color: `#c9962f` (gold) if this sector complete, else accent if any read, else `#e2d0dc`.
  - **Ring**: 72px, `position:relative; z-index:1`, `conic-gradient(<ringCol> <pct%>, #e6d6e0 0)` with a
    56px `#f5edf1` inner disc. Inner label = pct (Newsreader 16px/600) or `✓` (22px) when complete.
    `ringCol` = `#c9962f` complete · accent when active (next-to-read sector) · a per-sector hue when
    merely started · `#d6c2ce` locked.
  - **Active** sector ring also gets a pulsing **halo**: `position:absolute; inset:-7px; border:1.5px solid <accent>;
    border-radius:50%; animation: idhalo 2s ease-out infinite`.
  - **Label** (right, flex:1): title 14px/700, line-height 1.2, color `#33242c` (complete → `#8a6f2e`);
    meta 10.5px/600 `#9a8791` (`0 of 12 read` / `Complete · 12 sessions`).
  - Locked (untouched, not-next) rows render at `opacity: .82`.

### 3. Find  (search)
Purpose: jump to any chapter by name/organism/number and check sessions off.
- **Search input**: full width, border `1px solid #e8d8e1`, background `#fffafc`, radius 14,
  padding `13px 15px`, 14px text, placeholder `Search a topic or chapter — salmonella, 44` (`#b3a3ac`). margin-bottom 14.
- Results = **chapter group cards** (grouped by chapter number). Each: white, border `1px solid #e8d8e1`, radius 16, padding `14px 15px`.
  - Chapter eyebrow `CHAPTER 228` (10.5px/800/.13em accent); title Newsreader 17.5px/500;
    meta `Core Gram-Negative Organisms · 2 sessions · 12 pages` (10.5px `#9a8791`).
  - Session rows (each = a part): 22px checkbox + `Part 1 of 2` (12.5px/600) with sub `pp 2717–2722 · 6 pages` (10px `#b3a3ac`).
    Rows separated by `1px solid #efe2ea` top borders. Tapping toggles that session.
  - Footer button: **Mark whole chapter read** (full width, accent bg, `#fffafc` text, 12px/700, radius 11)
    ↔ **Un-read this chapter** (transparent, border `1px solid #ddccd7`, `#9a8791` text) when all done.
- Empty state: centered `#b3a3ac` 13px text, "Nothing in the plan matches that…".

### 4. Stats  (screens/03/…)
Purpose: standing at a glance + badges + per-sector bars.
1. **Summary card**: white, radius 20, padding 18. Left 96px conic ring `conic-gradient(<accent> <pct%>, #ece0e8 0)`
   with 76px inner disc: pct in Newsreader 26px/600 accent + `READ` label (9px/800/.12em `#b3a3ac`).
   Right: 4 baseline rows — `Sessions read 0 / 183`, `Pages mastered 0`, `Current streak 0 days`,
   `Versus plan 44 days behind`. Labels 11px/600 `#9a8791`; values 13px/700. Streak value is accent when >0;
   "vs plan" is `#b0552f` when behind, `#7d8a5a` when ahead, plain when on track.
2. **Sector badges** — label `SECTOR BADGES · 0 OF 13`, then wrapping pills. Earned pill:
   background `#f7ead0`, text `#8a6f2e`, border `1px solid #e6d3a8`. Unearned: background `#ece0e8`,
   text `#b3a3ac`, border `1px solid #e4d6e0`. 11px/700, padding `7px 12px`, radius 99. Label = first 1–2
   words of sector title.
3. **By sector** — label `BY SECTOR`, then a white card listing every sector: title 12.5px/600 +
   `dn/total` count (10.5px/700 `#9a8791`) on a baseline row, above a 6px progress bar
   (track `#efe2ea`, fill accent, or gold `#c9962f` at 100%). Rows split by `1px solid #efe2ea`. Tap opens sheet.

### 5. Sector sheet  (screens/05-today.png)
Purpose: the full session list for one sector; the primary check-off surface.
- Slides up from bottom over a scrim `rgba(52,38,28,.38)`; panel background `#f5edf1`,
  radius `26px 26px 0 0`, `max-height: 84%`, shadow `0 -10px 34px rgba(60,40,26,.24)`, entrance `idrise .26s`.
- **Header** (fixed inside sheet): 38×4px grabber `#d9c5d1`; row with `SECTOR` eyebrow (accent) + `CLOSE`
  (11px/700/.08em uppercase `#9a8791`); title Newsreader 23px/500; sub 11.5px `#9a8791`;
  6px progress bar (track `#e8dae4`, fill accent).
- **Rows** (scroll): 26px checkbox (radius 9) + body. Body: title 13.5px/600 (`text-wrap:pretty`,
  strike + `#ab99a4` when done); meta line `Ch 20 · pp 263–268` + a date token. Date token:
  `Today` (accent, 700) for the next-due slot · `Mon Aug 3` (`#9a8791`) for future · `Read <date>`
  (`#b08a3c`, i.e. gold-brown) once done. Optional guideline chip as on the quest card.
- Checkbox visual: `border 1.5px solid #d6c2ce` / `background #fffafc`; when checked = accent bg + border, `✓` `#fffafc` centered.

---

## Interactions & Behavior
- **Tab switch**: sets active tab, closes any open sheet. No page transition.
- **Mark as read / checkbox tap**: toggles `done` for that session id (and writes persistence, see below).
  Progress rings, streak, level, XP, quest, and "vs plan" all recompute immediately.
- **Mark whole chapter**: toggles every session id in that chapter group at once (single persistence write).
- **Quest "Sector" / node / by-sector row / badge**: opens that sector's sheet.
- **Sheet**: tap scrim or CLOSE to dismiss.
- **Search**: case-insensitive substring over `chapterTitle + guideline + sectorTitle`, plus a
  chapter-number prefix match; groups results by chapter number.
- **Animations**: `idrise` (translateY 14px→0, opacity 0→1, .26–.3s ease) on quest card & sheet;
  `idhalo` (scale .94→1.32, opacity .55→0, 2s ease-out infinite) on the active node ring.
  Bars/rings transition `width/background .3–.4s`.

## State Management
Keep the existing contract exactly — this makes the redesign a drop-in.
- **localStorage key**: `idcockpit.v1.state`, shape `{ sessions: { [id]: { done: bool, doneAt: ISOstring|null, updatedAt: ISOstring } } }`.
- Existing helper `sync.js` exposes `window.IDStore` (get/set/merge/replace) and `window.IDSync`
  (gist pull/push, `schedulePush()`); on any toggle, write via IDStore then `IDSync.schedulePush()`.
  The prototype falls back to raw localStorage if those globals are absent.
- **Derived at render (pure, from `SECTIONS` + `sessions`)**:
  - pagesTotal/Done, sessionsTotal/Done, per-sector counts & pct.
  - **level** = `floor(pagesDone / pagesPerLevel) + 1` (default `pagesPerLevel = 200`); rank = `RANKS[min(7, floor((level-1)/2))]`,
    RANKS = Initiate, Junior Resident, Senior Resident, ID Fellow, Senior Fellow, Chief Fellow, Attending, Consultant.
  - **streak** = consecutive study days (skipping flex Saturdays) back from today with ≥1 read.
  - **schedule re-flow**: remaining (unread) sessions are dealt onto consecutive study days starting today
    (tomorrow if something was already read today); each gets an "effective date". Completed sessions keep
    their real `doneAt` date. **"vs plan" drift** = whole-day diff between the projected finish of the re-flowed
    queue and the plan's original end date.
  - **Study-day calendar**: `START = 2026-06-22`; **flex days** = Saturdays on/after `2026-07-18` are skipped
    when advancing study-day indices. (Ported verbatim from the original `cockpit.js`.)

## Design Tokens
Colors:
- Accent (berry) `#9c4f6b`; deep accent (hover/links/chip text) `#7d3e5a`. Themeable — swatches: `#9c4f6b #8a4d78 #a85566 #7d3e5a`.
- Gold (complete/badge/read-date) `#c9962f`; badge bg `#f7ead0`, border `#e6d3a8`, text `#8a6f2e`; read-date text `#b08a3c`.
- Surfaces: app/screen bg `#f5edf1`; header/nav/soft bg `#f2e4ec`; card white `#fffafc`; sheet bg `#f5edf1`; on-accent text `#fffafc`.
- Borders/tracks: main border `#e8d8e1`; hairline `#efe2ea`; ring/xp track `#ece0e8` (also `#e6d6e0` node track, `#e8dae4` sheet track); checkbox border `#d6c2ce`; empty pip/connector `#e2d0dc`; quest-card border `#d9b3c4`; grabber `#d9c5d1`.
- Text: primary `#33242c`; muted `#9a8791`; faint `#b3a3ac`; numerals `#c6b4bf`; done-strike `#ab99a4`.
- Guideline chip: bg `#efe6ea`, text `#7d3e5a`. Scrim `rgba(52,38,28,.38)`.
Type: **Newsreader** (serif) for titles/ring numbers — weights 500/600; **Hanken Grotesk** (sans) for everything else — 400/600/700/800. Both from Google Fonts.
Radius: pills 99px; cards 14–20px; sheet 26px top; checkboxes 7–9px. Spacing is on a loose 4px rhythm.
Game constants: `pagesPerLevel` 200 (tunable 50–500); ranks list above.

## Assets
None — no images/icons. Glyphs used: `✓` (check) and the halo/ring are pure CSS. Fonts via Google Fonts
(`Newsreader`, `Hanken Grotesk`). Sector accent hues are generated with
`oklch(0.615 0.128 <hue>)`, hue = `28 + (index*19)%58`.

## Files
- `ID Cockpit.dc.html` — the full prototype (template + logic). Primary reference.
- `schedule.js` — curriculum data (`window.SECTIONS`). **Prototype has Year 1 only (183 sessions); use the full 617-session file in production.**
- `screens/` — reference screenshots: `01-today.png` (Today), `02-today.png` (Path/Sectors),
  `03-today.png` (Stats), `05-today.png` (Sector sheet). Find looks like a search field over the group cards described above.
