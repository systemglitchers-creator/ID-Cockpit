# Pinned second readings: a missed week folded into longer days — 2026-09-10

## The ask

Tyler read nothing from Sun Sep 6 to Thu Sep 10 and was a few days behind
before that: eight unread sessions dated Sep 1 – Sep 9, 51 pages. The app
reported `Catching up · 7 to make up` (seven, because ch141-p1 had been read
early and the count is net). His words, across two messages the same evening:

> we are 7 behind, I need you to space these out over time as I fell off this
> week, and make it so readings are caught up to Sept 10. Rest of the schedule
> unchanged.

> i moreso want the pages spread across other days readings, like if it was
> 1000-1007 it is now 1000-1009 for example.

So: today's quest is the session the plan dated Sep 10; every other day keeps
its date; and the missed material is absorbed by making the upcoming readings
longer, not by adding sessions.

## Why the existing model cannot do it

`compute()` deals unread sessions by queue position, one per study day, and
packs any surplus into evenly spread doubles. Two consequences fight the ask:

- The queue starts at the oldest unread session, so today's quest is Sep 1's
  and everything after it runs late (the first message).
- Past `CATCHUP_FROM` the double is *today*, every day, until he reads two — a
  nag that never lets up.

A first cut of this change pinned the eight missed sessions as extra sessions
on the next eight Sundays. That kept the calendar but was still eight added
sittings; the second message asked for the pages to be spread instead.

## Design

### The schedule: the pneumonia sector's tail is re-cut

The sector has 11 study days left (Sep 10 – Sep 22) and, with the missed pages
back in the pool, 119 pages: 68 already planned plus the 51 missed. Re-cut into
one sitting per day, chapters kept whole where they fit, at ~11 pages (~40 min)
instead of ~6:

| Day | Reading | pp |
|---|---|---|
| Thu Sep 10 | ch193 Coxiella (Q fever), whole chapter 2333–2342 | 10 |
| Fri Sep 11 | ch28 Macrolides Part 3 (387–392) **+** ch204 S. pneumoniae Part 3 (2469–2473) | 11 |
| Sun Sep 13 | ch34 Quinolones Part 1 of 2, 445–456 | 12 |
| Mon Sep 14 | ch34 Quinolones Part 2 of 2, 457–467 | 11 |
| Tue Sep 15 | ch187 Psittacosis (2293–2295) **+** ch188 C. pneumoniae (2296–2304) | 12 |
| Wed Sep 16 | ch189 Mycoplasma pneumoniae (2305–2312) **+** ch190 Genital Mycoplasmas (2313–2316) | 12 |
| Thu Sep 17 | ch238 Legionnaires', whole chapter 2799–2811 | 13 |
| Fri Sep 18 | ch173 Bunyavirus 2152–2160 | 9 |
| Sun Sep 20 | ch307 Nosocomial Pneumonia, whole chapter 3600–3609 | 10 |
| Mon Sep 21 | ch71 Bacterial Lung Abscess 873–878 | 6 |
| Tue Sep 22 | ch70 Pleural Effusion and Empyema, whole chapter 860–872 | 13 |

Upper Airway & Respiratory Viruses still starts Wed Sep 23. Nothing outside
the sector moves; `planEnd` (max gi 597) is untouched.

Merging a chapter's parts keeps the `-p1` id and drops the rest: ch193-p2,
ch34-p3, ch238-p2, ch307-p2 and ch70-p2 no longer exist. None had been read,
so no read-state is orphaned; the plan is 585 sessions. Quinolones is re-cut
from three parts to two (445–456, 457–467). Each row's `pp` equals its page
range. The Bank index and Find both key on chapter numbers parsed from titles,
so every chapter stays findable and drillable.

Three days carry two short chapters. Bundling them into one row was rejected —
the 2026-08 split of bundled sessions exists precisely so every chapter has an
id and a search hit — so the second chapter on those days is a **pinned row**.

### The app: `extra` pins a row to a day

A session flagged `"extra": true` is dealt on its own `gi` as a second row on
that day and never enters the queue. The queue is everything else, dealt as
before: with the three pinned rows out of it, 525 sessions fit 526 slots and
every queued session lands on its `gi` (the one read early, ch141-p1, keeps
the plan running a day ahead from May 2027, as it always did).

- `EFF = max(gi, nextStudyDay)`: an unread pinned row whose day has passed
  lands on the next study day and stays due. Reading the day's regular row
  does **not** push it — the point of the day is that both get read.
- **Owed means overdue.** A pinned row on a day still to come is the plan, not
  debt; only once its day has passed unread does it count in `makeup`. So the
  home line reads `528 sessions left` on Sep 10, and `Catching up · 1 to make
  up` only if a pinned row is skipped. `extras` (all pending pinned rows) is
  also on the model.
- The quest is chosen by (day, then regular before pinned, then curriculum
  order): on Fri Sep 11 the quest is Macrolides Part 3 labelled `· 2 sessions`;
  once marked, S. pneumoniae Part 3 becomes the quest, still today.
- New model field `dueToday` (open rows dealt onto today). The headline says
  "Done for today." only when nothing is still due, so the header never
  contradicts a quest card that still shows a pinned row.
- The stream shows such a day with its existing `×2` badge; no extra label.

### The nudge (`lib/plan.js tonight()`)

Reading today still silences the queue. An unread pinned row for today (or
left over from an earlier day) is nudged regardless, with the existing
two-session wording when both are due. `makeup` mirrors the app: overdue only.

### Validation

`extra`, when present, must be a boolean. The push script and the API pass
unknown fields through unchanged.

## What this is not

- Not a change to the catch-up packing. With no pinned rows the numbers are
  byte-identical; the existing catch-up tests load the plan with the flags
  stripped (harness option `noExtras`) so they keep pinning the packing.
- Not a generator change. `scripts/resequence.mjs` does not know about pinning;
  its structure file carries a note not to re-run it over this tail.
- Two overdue pinned rows on one day make three sessions that day. Accepted —
  it only happens when a pinned day was itself skipped, and the honest count
  is the useful one.

## Revision 2026-09-16: make-up Sundays, and no stacking of today

Six days in, Tyler opened the app to four rows on a Wednesday: Quinolones
Parts 1 and 2 (the packing's first double is always *today* once the grace
date is past), Tuesday's pinned C. pneumoniae (an overdue pinned row landed
on today and stuck), and Wednesday's own pinned Genital Mycoplasmas. Two rules
were stacking today, which is the opposite of what he has asked for three
times.

**The rule now.** Sessions owed beyond one a day are paid **one per Sunday**
(the first study day after the Saturday off), from `CATCHUP_FROM` on, and
never by stacking today. On track that is exactly one a day and the mechanism
is inert; behind, each Sunday carries two until the debt is gone, so the end
date still holds. Sundays are fixed dates, so the first make-up does not
recede as days pass. If more is owed than there are Sundays left, the tail
runs past the plan's end and `drift` says so.

- A pinned row whose day has passed unread **rejoins the queue in curriculum
  order**. It no longer chases today, and `makeup` is simply the queue's
  surplus over the days left.
- Each row has its own slot: reading the day's pinned row does not spend the
  queue's slot, and reading the queue's row does not push the pinned one.
- On a make-up Sunday the second slot stays open until it is used — reading
  one leaves the other due today (`dueToday`, the greeting rather than "Done
  for today."), reading both pays one Sunday off.
- `lib/plan.js tonight()` mirrors all of it; Wednesday's nudge names two rows,
  Sunday's names the pair.

Wed Sep 16 under this rule: Quinolones Part 1 + Genital Mycoplasmas; Thu
Part 2; Fri Psittacosis; Sun Sep 20 C. pneumoniae + Legionnaires'; Sun Sep 27
the second make-up; on plan from the following week, with the session read
early in August absorbing the last day of lateness in May 2027.

Tests: `tests/js/makeup-days.test.mjs` reproduces the Sep 16 state and the
Sunday flow; the catch-up fixtures in `schedule-dates.test.mjs` now assert a
Monday slip is first paid on Sun Sep 20, never on the Monday.

## Tests (`tests/js/pinned-readings.test.mjs`)

- Data: the sector's tail is exactly the table above (ids, days, page ranges,
  `pp` = range, which rows are pinned), 119 pages over 11 days, the merged
  ids are gone, whole chapters carry no "Part" label, the sector subtitle ends
  Sep 22.
- Sep 10: the quest is the whole Q fever chapter (`pp 2333–2342 · 10 pages`),
  every queued session lands on its `gi`, Upper Airway starts Sep 23, only
  Sep 11 / 15 / 16 carry two rows, `makeup` 0, no "Catching up" line.
- Fri Sep 11: the quest is the regular row with `· 2 sessions`; after marking
  it the pinned row is the quest, still today, headline not "Done for today."
- A pinned row skipped on Friday sits on Sunday as the second row, `makeup` 1,
  `Catching up · 1 to make up`; never on a Saturday.
- Nudge: Friday evening names both, in order; after the first is read it still
  names the pinned one; an overdue one rides Sunday's nudge as the make-up.
- Session-count pins updated to 585 (day view, braid, schedule API, sector
  sheet). copy.js and copy.mjs stay mirrored (existing pin test, extended).
