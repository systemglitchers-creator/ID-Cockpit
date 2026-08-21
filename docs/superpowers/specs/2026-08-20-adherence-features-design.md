# Adherence Features — 2026-08-20

Three levers matched to Tyler's actual failure modes (his words: defer-and-slip,
too drained to start, genuinely no time some days — *not* forgetting):

## 1. Evening nudge (Web Push) — the defer-and-slip fix

A daily push to the installed PWA naming the exact reading, so "later tonight"
has a concrete object: *"S. aureus · Part 5 of 6 · pp 2399–2405 · ~25 min."*

- **Never fires** if he already read that day, or on a flex Saturday.
- On a catch-up double day it says so: two sessions listed, "clears the debt".
- **Fixed time**: Vercel hobby crons are daily-granularity and fire within the
  hour, so the nudge is `30 23 * * *` UTC ≈ 8:30pm ADT (7:30pm AST in winter).
  Per-user configurable time would need hourly crons (Pro plan) — cut.
- Pieces:
  - `lib/plan.js` — CJS mirror of the app's study-day calendar + today's deal
    (START, FLEX_START, isFlex, studyIdx, catch-up grace), computed in
    America/Halifax regardless of server TZ. Returns tonight's session(s) or
    null (rest day / already read / plan complete). Unit-tested.
  - `lib/nudge.js` — pure decision + message composition, injected deps
    (schedule, progress, now). Unit-tested.
  - `api/push.js` — GET → `{publicKey}`; POST `{subscription}` → store in
    Redis `cockpit:push` (single record, single-user app); DELETE → remove.
  - `api/nudge.js` — cron target. Validates `Authorization: Bearer
    $CRON_SECRET`, self-fetches the deployed `/schedule.js` (always the live
    plan), reads progress from Redis, calls lib, sends via `web-push`.
    A 404/410 from the push service deletes the dead subscription.
  - `sw.js` — `push` handler (showNotification) + `notificationclick`
    (focus/open). CACHE bump.
  - Settings sheet — "Evening nudge" toggle: permission prompt on tap,
    subscribe, POST; off = unsubscribe + DELETE. Hidden with a note when the
    platform can't push (needs the installed app, iOS 16.4+).
  - Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
    `CRON_SECRET` (production). Public key served by GET /api/push.

## 2. Weekly ring + 14-day strip — the no-time-some-days fix

Daily streaks punish call weeks and trigger the screw-it spiral; weeks forgive.

- Home, between stats and The plan: **"N of 6 this week"** ring (plan weeks
  run Mon–Sun with Saturday off → 6 study days) + a **14-day dot strip**:
  read · double (gold) · missed · rest · today.
- Stats: **perfect weeks** count — weeks with ≥ target sessions read, counted
  from Mon 2026-08-17 (first full week after the rebase; earlier doneAt data
  is bulk re-entry noise).
- Pure `weekView(m)` in app.js, exported for tests. Ring reuses `conic()`.

## 3. Minutes on the quest card — the too-drained fix

"7 pages" becomes "7 pages · ~25 min" (pp × 3.5 min/page, rounded to 5).
Same estimate rides in the nudge body. Framing only; no schedule change.

## Cut (YAGNI)

Daily streaks; light-day session swaps (erodes the curated order); per-user
nudge time (Pro-plan cron); social anything.

## Tests

- lib/plan: rest day → null; already-read → null; normal day → 1 session with
  pp; behind → 2 on a double day; Halifax TZ boundary (server UTC evening =
  local same day).
- lib/nudge: message text for single and double; skip decisions.
- api/push round-trip under `COCKPIT_FAKE_KV`.
- weekView: ring counts this plan-week only; dots classify read/double/
  missed/rest; perfect-weeks ignores pre-2026-08-17 history.
- Quest card shows "· ~N min" (harness innerHTML).

## Verification

83+ tests green; deploy; `GET /api/push` serves the key; `POST`+`DELETE`
round-trip with a dummy subscription leaves the store empty; manual
`curl -H "Authorization: Bearer …" /api/nudge` returns a skip/send decision;
home screen screenshot shows ring + strip + minutes. Real subscription must
come from Tyler's phone (toggle in settings).
