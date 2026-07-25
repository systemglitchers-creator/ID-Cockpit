# Ad-hoc Reading: Search + Dynamic Schedule Re-flow

**Date:** 2026-07-25
**Status:** Design — approved
**Scope:** `phone/index.html` only (the Mac `dashboard.html` keeps current behavior; state stays compatible)

## Problem

Tyler frequently reads opportunistically — a ward case or a presentation (e.g. salmonella)
displaces the assigned chapter that day. Today the app has no way to credit that:

1. **Finding the chapter is impractical.** 584 sessions across 31 sectors; the only navigation
   is scrolling the skill tree and opening sectors. He won't hunt for a chapter on a phone.
2. **Out-of-order completion looks like failure.** The chapter he actually read sits months
   away in the plan, and the day reads as "overdue".

The data model already supports out-of-order completion (`toggle()` works on any session id).
The gap is *findability* and *date semantics*.

## Decisions

- **Credit the real chapter.** Ad-hoc reading is recorded by marking the actual Mandell
  chapter's sessions done, wherever they sit in the curriculum.
- **Dynamic re-flow.** Remaining unread sessions are dated from today forward, in curriculum
  order, one per study day. Finishing ahead pulls everything forward; slipping pushes it back.
- **Replace "Overdue" with plan drift.** Under re-flow nothing can ever be overdue, so that
  metric becomes a constant 0 and hides slippage. The HUD slot instead shows projected finish
  vs. the original plan end date.

## Design

### 1. Search overlay (the primary fix)

A 🔍 button in the HUD opens a full-screen search.

- **Input:** live filter, autofocused. Matches against the session title and its sector title,
  case-insensitive. A numeric query (`44`) also matches that chapter number.
- **Results grouped by chapter** (group key = the `chNN` prefix of the session id, so a combined
  row like "Chapter 22 + Chapter 23" groups correctly under `ch22`). Each group shows:
  - chapter title (with the `· Part X of Y` suffix stripped)
  - sector name and combined page range
  - **"Mark all N read"** — the key action: he read the whole chapter, not one part
  - individual part rows, each tappable to toggle
- Each part shows its effective date (see §2) and done state.

### 2. Effective schedule (re-flow)

Computed fresh on every render, never stored:

- `todayIdx = studyIdx(today)` — study days elapsed (already skips flex Saturdays).
- `doneToday` = sessions whose `doneAt` falls on today's date.
- Walking all sessions in curriculum order, the *j*-th still-incomplete session is assigned
  index `todayIdx + doneToday + j`; its date is `dayDate(thatIndex)`.
- Completed sessions display the date they were actually read (`doneAt`), not a planned date.
- A session is highlighted **Today** when its effective index equals `todayIdx` and today is not
  a flex day. Once the day's session is done, `doneToday` shifts the next one to tomorrow.

Consequence: the `.overdue` date styling is removed — it can no longer occur.

### 3. Plan drift (replaces the Overdue HUD stat)

- `projectedFinish = dayDate(todayIdx + doneToday + remaining - 1)`
- `planEnd = dayDate(max gi)` — the original plan's last study day.
- Display the difference in whole days: `+12d` (behind, gold) / `−6d` (ahead, cyan) /
  `on plan`. Label changes from "Overdue" to "vs plan".

This keeps the self-healing schedule while still surfacing slippage honestly.

### 4. Week headers

Sector panel week headers currently read `Week N · <original date range>`. Those planned dates
now contradict the re-flowed session dates, so the header becomes just `Week N` (curriculum
structure, no dates).

### 5. Bulk marking

`markMany(ids, done)` writes all entries, then renders and schedules one Gist push — avoiding
N re-renders and N sync pushes when marking a whole chapter.

## Out of scope (YAGNI)

- Logging non-Mandell reading (UpToDate, papers) — he chose chapter-credit, not a separate log.
- Porting re-flow to the Mac `dashboard.html` — phone-first; revisit after use.
- Changing the stored state schema. `{sessions:{id:{done,doneAt,updatedAt}}}` is unchanged, so
  Gist sync and the Mac app keep working.

## Verification

- Search `salmonella` returns the right chapter; "Mark all" ticks every part and persists.
- A numeric query (`44`) finds chapter 44.
- Marking a far-future chapter pulls subsequent dates forward (next-up date unchanged, finish
  date moves earlier, drift decreases).
- Drift shows `on plan` when current, gold `+Nd` when behind.
- No `.overdue` styling ever renders; "Today" appears on exactly one session (or none once the
  day's session is complete).
- Offline still works; state remains readable by the Mac app.
