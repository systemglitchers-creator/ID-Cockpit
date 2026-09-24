# ID Cockpit

**The front end is frozen (2026-09-24). UI work goes to Culture**
(`8. Claude/ID Culture/`). Only the backend and the schedule data are still
edited here: `api/`, `lib/`, `public/schedule.js`, `public/guidelines.js`,
`public/qbank/`. Culture reads all of them through rewrites.

**Read the `id-cockpit` skill before changing anything here.** It carries the
working knowledge — the two-builds trap, the study-day calendar rules, where
progress lives, and the release steps. This file only exists so a session opened
in this directory knows to go get it.

Invoke it with the Skill tool (`id-cockpit`), or Tyler can type `/id-cockpit`.

Two things that cause silent breakage, repeated here because they are easy to
trip over before the skill is loaded:

1. **Bump `CACHE` in `public/sw.js` on every app-code change.** Otherwise the
   installed phone app keeps serving the old files and the change appears not to
   have shipped.
2. **Never rename an icon by hand — run `python3 public/make_icons.py`.**
   Filenames carry a content hash because `vercel.json` serves `/icons/*` as
   immutable; a stable name means a changed icon can never reach an installed
   device.
