# ID Cockpit

**Read the `id-cockpit` skill before changing anything here.** It carries the
working knowledge — the two-builds trap, the study-day calendar rules, where
progress lives, and the release steps. This file only exists so a session opened
in this directory knows to go get it.

Invoke it with the Skill tool (`id-cockpit`), or Tyler can type `/id-cockpit`.

Two things that cause silent breakage, repeated here because they are easy to
trip over before the skill is loaded:

1. **`public/` is the live app** (Vercel). `phone/` is the legacy GitHub Pages
   build. A logic fix belongs in both or they diverge.
2. **Bump `CACHE` in `public/sw.js` on every app-code change.** Otherwise the
   installed phone app keeps serving the old files and the change appears not to
   have shipped.
