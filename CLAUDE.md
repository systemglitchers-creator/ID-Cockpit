# ID Cockpit

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
