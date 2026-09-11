# Make-up extras: a missed week, spaced out on fixed days — 2026-09-10

## The ask

Tyler read nothing from Sun Sep 6 to Thu Sep 10 and was already a few days
behind before that. The app reports `Catching up · 7 to make up`. His words:

> we are 7 behind, I need you to space these out over time as I fell off this
> week, and make it so readings are caught up to Sept 10. Rest of the schedule
> unchanged.

Three requirements, in his order:

1. **Space the missed sessions out** — not a double tonight, not a double every
   day until the debt clears.
2. **Caught up to Sept 10** — today's quest is the session the plan dated
   Sep 10 (Coxiella Part 2), not the one dated Sep 1.
3. **Rest of the schedule unchanged** — every other session keeps the date the
   plan gave it.

## Why the existing catch-up cannot do this

Eight unread sessions are dated before today (Sep 1 – Sep 9, gi 64–71). The
app says seven because one later session (ch141-p1, gi 541) was read early
and the arithmetic is net.

`compute()` deals unread sessions by **queue position**, not by their planned
day: session *i* lands on `k0 + floor(i × packSlots / packCount)`. The `gi`
field only sets the plan's end. Consequences, all of which fight the ask:

- The queue starts at the oldest unread session, so today's quest is Sep 1's.
  Everything after it is shifted up to seven days late until the doubles
  slowly absorb the slip (requirement 2 and 3 fail).
- Past `CATCHUP_FROM` the first double is *today*, and it rolls forward day by
  day until he actually reads two — a nag that never lets up (requirement 1
  fails).
- No content-only reorder can fix this. Packing spreads the doubles evenly over
  the ~525 remaining study days, so the only spacing the current formula can
  produce is one double every ~11 weeks, and those doubles wobble by a day as
  the ratio changes.

A rebase (as on 2026-08-16) would make today's quest today's session but by
sliding the finish date out a week, and it would leave the eight at the front
of the queue. Neither is what he asked for.

## Design: extras pinned to a day

A session may carry `"extra": true`. An extra is dealt on its own `gi`, as a
second session on that day, and is left out of the queue entirely.

**Schedule.** The eight missed sessions become extras on the next eight
Sundays. Sunday is the first study day after the Saturday off and the day the
Mon–Sun week ring closes, so a Sunday double reads as a make-up day rather than
a punishment. Order: chapters whose other parts he is reading now come first;
the rest keep curriculum order.

| Sunday | gi | Session |
|---|---|---|
| Sep 13 | 74 | ch193-p1 Coxiella (Q fever) · Part 1 of 2 — Part 2 is Sep 10's |
| Sep 20 | 80 | ch34-p1 Quinolones · Part 1 of 3 — Part 3 is Sep 13's |
| Sep 27 | 86 | ch34-p2 Quinolones · Part 2 of 3 |
| Oct 4 | 92 | ch204-p3 S. pneumoniae · Part 3 of 3 |
| Oct 11 | 98 | ch189-p1 Mycoplasma pneumoniae |
| Oct 18 | 104 | ch190-p1 Genital Mycoplasmas |
| Oct 25 | 110 | ch238-p1 Legionnaires' · Part 1 of 2 |
| Nov 1 | 116 | ch238-p2 Legionnaires' · Part 2 of 2 |

Each row keeps its id, title, pages, sector and position; only `gi` changes and
`extra` is added. The pneumonia sector's date range in its subtitle extends to
Nov 1, which is what the generator would print. `planEnd` (max gi 597) is
untouched.

**Dealing (`compute()` in app.js, mirrored in `lib/plan.js`).**

- Unread extras: `EFF = max(gi, nextStudyDay)` where `nextStudyDay` is today,
  or tomorrow on a day off. An extra whose day has passed lands on the next
  study day and stays due until read. Reading today's regular session does
  **not** push it — the point of a make-up day is that two get read.
- The queue is everything else, dealt exactly as before. With the eight out
  of it, 525 sessions fit the 526 slots and every queued session lands on its
  `gi` (until the one read early, after which the plan runs a day ahead, as it
  always has).
- `makeup` = packing debt + unread extras, so the home line reads
  `Catching up · 8 to make up` and counts down each Sunday. `remaining` still
  counts every unread session.
- `firstOpen` / `upcoming` are chosen by (day, then regular before extra, then
  curriculum order). On a Sunday the quest is the regular session, labelled
  `· 2 sessions`; once it is marked the extra becomes the quest, still today.
- New model field `dueToday`: open sessions dealt on today. The headline says
  "Done for today." only when nothing is still due — otherwise an extra left
  for the evening would be contradicted by the header.
- The stream row of an extra says `Make-up` in its meta line, so a Sunday's
  second row explains itself.

**Nudge (`lib/plan.js tonight()`).** Reading today still silences the queue.
An unread extra pinned to today (or overdue) is nudged regardless, with the
existing two-session wording when both are due.

**Validation.** `extra`, when present, must be a boolean. The push script and
the API already pass unknown fields through.

## What this is not

- Not a change to the catch-up packing. With no extras in the data the numbers
  are byte-identical; the existing catch-up tests run against the schedule with
  the flags stripped (harness option `noExtras`) so they keep pinning the
  packing on its own.
- Not a general "defer a session" UI. Pinning is a content edit: next slip,
  flag the rows and push the schedule.
- Two overdue extras on one day make three sessions that day. Accepted: it only
  happens when a make-up day was itself skipped, and the honest count is the
  useful one.

## Tests

- Data: the eight ids are the only extras, on those eight Sundays, none on a
  Saturday, max gi unchanged.
- Sep 10: today's quest is ch193-p2; every queued session lands on its gi;
  `makeup` 8; no day carries three.
- Sun Sep 13: quest is the regular session with `· 2 sessions`; after marking
  it the extra is the quest and the headline is not "Done for today."; a
  Sunday extra never lands on Saturday.
- Mon Sep 14 with the Sunday extra unread: it sits on Monday, still due.
- Nudge: Sunday evening names both; after the regular is read it still names
  the extra.
- copy.js and copy.mjs stay mirrored (existing pin test, extended).
