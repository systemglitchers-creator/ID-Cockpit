# Guidelines Tab, Icon Badge, Dusk Mode — 2026-08-20

Three additions from the open brainstorm; Tyler picked these (pearls deferred).

## 1. Guidelines tab

A fifth bottom tab ("Guides"): every guideline in the plan, one tap to the
source document.

- **Curated**: only tags with a real document behind them appear. Topic
  labels ("FUO workup", "Nocardiosis") are deliberately absent — a tab of
  fake links teaches you to stop tapping. 107 of 117 tags are mapped.
- Grouped by sector in curriculum order; a gold ✓↗ marks guidelines whose
  chapter is already read ("covered").
- Data in `public/guidelines.js` — one line per entry (`tag → {url, org}`),
  loaded before app.js, cached in the service-worker shell. Fixing a link
  is a one-line diff.
- **Every URL adversarially verified before shipping**: a 9-agent fan-out
  fetched each link, judged whether it lands on the right current document,
  and replaced dead or wrong ones with verified alternatives (society page
  preferred, then DOI, then official clinician page; never a blog).
- The guideline chip on the quest card becomes a link (↗) when mapped.
- One schedule quirk honored: the ch170 bundle carries a combined
  rabies+VHF tag — single map entry, keyed exactly, pointing at rabies PEP.

## 2. App icon badge

The installed app's icon carries today's due count (1, or 2 on a catch-up
double), cleared the moment the session is marked.

- Set on every render: `perDay[todayIdx]` — naturally 0 after reading,
  on rest Saturdays, and when caught up.
- The evening push also sets it (`badge` field in the nudge payload), so
  the icon nags even if the banner is missed. iOS requires notification
  permission — granted by the nudge toggle, so the features arrive together.

## 3. Dusk mode

The 9pm palette: same apothecary, lamplight instead of daylight.

- A full alternate token block under `:root[data-theme="dusk"]` (every
  colour token overridden, including shadows, edges, scrim, and the body
  gradient — the light body gradient was hardcoded and would have leaked).
- **Auto from 7pm to 6am**, with a three-way override in the gear sheet
  (Auto / Always / Off) stored in localStorage.
- `applyTheme()` runs on every render: sets `data-theme`, re-reads `--acc`
  (rings and connectors read the accent from JS), and updates the
  theme-color meta so the iOS status bar matches.

## Tests (108 total, all green pre-verification)

- Map integrity: every entry matches a real schedule tag (caught the
  combined rabies tag); all URLs https; topic labels stay out.
- Quest chip renders as a link when mapped, plain chip otherwise.
- Badge counts: 1 normal day, 0 after reading, 0 Saturday, 2 on a double.
- Dusk clock: 9pm yes, noon no, 5am yes, 6:30am no; Always/Off override.
- Nudge payload carries the badge count.

## Ship

Apply verified URL fixes → retest → CACHE v17 → commit, push, deploy →
live check: Guides tab rows, dusk at evening hours, `/api/nudge` payload.
