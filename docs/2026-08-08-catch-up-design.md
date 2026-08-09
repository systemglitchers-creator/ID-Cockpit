# Catch-up: absorb a slip instead of sliding the finish date — 2026-08-08

## Why

Family in town cost Tyler several reading days. The app reported it as
"19 days behind" and then "7 days behind" — the projected finish sliding past the
plan's original end. That is honest but useless: the number only ever grows, and
nothing in the app does anything about it.

He wanted two things: the shortfall visible on the home screen, and the schedule
adjusted so he isn't behind, "even if that means distributing those readings
elsewhere".

## The tension

Those two asks fight each other. Once the schedule absorbs the slip, "days
behind" is **zero by construction** — showing it would display a permanent 0.

Resolved by changing what is surfaced: the debt appears as **sessions owed**
(`makeup`), not days lost. Same fact, in the form that survives redistribution.

## Design

**Packing.** Previously each unread session took the next study day, one per day,
so the tail simply ran past the plan's end. Now the remaining sessions are packed
into the study days still available before the plan's *original* end date:

```
session i  →  k0 + graced + floor((i - graced) × packSlots / packCount)
```

On track, `remaining ≤ slots` and this collapses to exactly one a day — the
feature is dormant unless he has actually slipped, and dissolves on its own as he
reads ahead. Behind, a few days carry two and the end date holds.

At 38 read: 546 sessions into 540 slots → 534 single days, **6 doubles**, last
session on Fri Apr 28 2028, the original end.

**Grace window.** `CATCHUP_FROM = 2026-08-23` — two study weeks out, so coming
back from time away doesn't come due the next morning. Tyler chose the delay.

This is a **fixed date, not "today + 12 days"**. That distinction is the whole
correctness of it: a relative window is recomputed on every render, so the first
double recedes one day per day and the make-up never arrives. Caught in
verification, before shipping; there is a test pinning it across three dates.

A pleasant side effect: without the offset, 540 ÷ 6 = 90 study days = exactly 15
weeks, so every double landed on a Sunday. The grace breaks that phase alignment
— the doubles now fall Sun, Thu, Tue, Sun, Thu, Tue.

**Display.**

| Where | Behind | On track |
|---|---|---|
| Home header | `Catching up · 6 to make up` | `556 sessions left` |
| Quest card | `… · 2 sessions` on a double day | unchanged |
| Stats "Versus plan" | `making up 6` | `on track` |

The quest card labels a double day explicitly; otherwise the second session
appears from nowhere once the first is marked.

## Tests

31 total, 11 covering this. The catch-up ones assert the end date holds, doubles
never become triples, the count of doubles equals the sessions owed, curriculum
order never goes backwards, the feature is inert when on track, and reading ahead
dissolves it. Mutation-checked: disabling the packing fails 5.

## Limits, accepted

- `CATCHUP_FROM` is a one-off date for this slip. A future break gets no grace
  period — doubles start at the next open day. A general rule would need to
  persist when a slip happened; not worth the state today.
- If he falls far enough behind that `remaining > 2 × slots`, days would carry
  three or more. No guard: at that point the plan needs re-cutting, not packing.
- Not mirrored into the legacy `phone/` build. That build is a dark-themed
  leftover on GitHub Pages; the date *fix* was mirrored there because it was a
  correctness bug, but a feature is not worth doubling.
