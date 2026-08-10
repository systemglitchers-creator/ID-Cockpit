# Premium polish — design — 2026-08-09

## Goal

Make ID Cockpit feel like a shipped product rather than someone's project. One
user, no accounts, no commerce, no App Store. Purely how it looks and behaves.

Explicitly **not** in scope: multi-user, billing, onboarding/first-run, changing
the colour or type direction, and any framework rewrite. The berry/editorial
identity is good and stays.

## The diagnosis

The visual design was never the problem. Two things make it read as unfinished:

**Nothing behaves.** A hardcoded "Good morning" that greets you at 9pm. Tabs that
cut instead of easing. The core action — marking a session read — producing no
acknowledgement at all. A launch that flashes white then renders at 40% opacity.

**Nothing is prioritised.** The Today screen puts nine elements at roughly equal
weight: date, greeting, sessions-left, seven weekday dots, a level ring, a rank,
an XP bar, pages-to-next-level, and — last — the thing you are meant to do. All
outlined in hairlines on flat colour. It reads as a diagram of an app.

## Decisions taken

**Gamification is removed.** Levels, rank names, XP, "pages to level N", the
weekday streak dots, and the current-streak stat all go. Tyler confirmed they are
decoration, not motivation.

*Kept:* sector completion ("2 of 31 cleared") and the per-sector bars. Those are
genuine curriculum progress, not a game layer. **If that reading is wrong, say
so — it is the one judgement call inside "cut it entirely".**

**Haptics are not possible.** iOS Safari does not implement the Vibration API, so
a PWA cannot make the phone buzz. The mark-as-read moment is carried by motion
alone. A ten-minute spike on the iOS 17.4 hidden-switch trick is worth it; if it
does not work, it is dropped without redesign.

## The six moves

1. **One thing is the hero.** The quest card becomes large and shadowed;
   everything else recedes. Stats collapse to a single thin strip of three
   numbers: read, owed, complete.
2. **Depth instead of outlines.** Layered soft shadows, half-pixel edges, and a
   background gradient replace hairline borders on flat fill. Surfaces sit above
   the page rather than being drawn on it.
3. **Typographic craft.** Tabular figures everywhere a number can change, so
   digits stop jittering as they tick. Negative tracking on display serif, wider
   tracking on small caps, real size contrast (34px against 10px).
4. **Deletion.** See above. The home screen ends up with a date, a sentence, the
   quest, three numbers, and what's next.
5. **State-aware voice.** Copy that knows the hour and the situation: first
   session of the day, back after time away, rest day, catch-up day, sector just
   cleared, curriculum complete.
6. **Physicality.** Swipe between tabs. The sector sheet drags to dismiss rather
   than only tapping closed. Buttons compress under the finger.

## Behaviour

**Motion.** Entry animations on mount (tabs, quest card, list items with a slight
stagger). Value tweens for the numbers and the ring. Everything eased, nothing
linear. `prefers-reduced-motion: reduce` collapses every duration to zero.

**The mark-as-read moment.** Ring animates to its new value, the number counts,
the card lifts and settles. It is the one action performed daily and it should
feel like something.

**Launch.** iOS launch images so it opens in its own colour instead of a white
flash. The shell paints immediately with values filling in, rather than the
current 40%-opacity holding state.

**iOS fit.** Full safe-area handling top and bottom. No tap highlight. No
overscroll revealing white behind the tab bar.

**The icon.** `public/icons/` is currently byte-identical to the retired dark
app's artwork, so the berry app wears the old icon. New set generated to match
the current identity.

## Architecture

Three units with clear boundaries, rather than growing `app.js` (537 lines, and
already doing enough):

| Unit | Responsibility | Depends on |
|---|---|---|
| `public/copy.js` | Every user-facing string, and the state→copy decisions. Pure functions taking the computed model, returning strings. No DOM. | nothing |
| `public/motion.js` | Tween helper with per-key memory (so a rebuilt node still animates *from* its old value), the reduced-motion gate, stagger orchestration. | nothing |
| `public/index.html` | Transition/keyframe CSS, safe-area rules, launch styling, depth tokens. | — |

`app.js` calls into both and gains no new responsibilities.

**The rendering constraint.** `render()` rebuilds panels with `innerHTML`, which
destroys and recreates nodes — you cannot CSS-transition an element that no
longer exists. This is why the app has 11 transition rules and no visible motion.

We do **not** re-architect rendering to fix it; that is the code the 66 tests
exercise, and the risk is not worth a visual nicety. Two cheaper mechanisms cover
it:

- Entry animations run on mount and are unaffected by rebuilding.
- `motion.js` remembers the last value rendered per key and animates from it, so
  a brand-new ring still appears to ease from 4% to 5%.

## Testing

- `copy.js` is pure and gets real coverage: the greeting at each hour boundary,
  and one test per state (rest day, catch-up, first-of-day, returning, complete).
- `motion.js` tween maths and the reduced-motion gate are testable; the visual
  result is not, and will not be faked.
- The existing 66 tests must stay green. Removing gamification touches values
  `compute()` returns (`level`, `intoLevel`, `rankName`, `streak`) — 18
  references in `app.js`, and **zero in the tests**, which were checked rather
  than assumed. So the removal is lower risk than it looks, but it is also
  currently untested behaviour: nothing would catch a mistake, which is why it
  lands in its own commit.
- Verification is by browser screenshot at mobile viewport plus a clean console,
  as with every change this session.

## Risks

- **Deleting `compute()` outputs** may break callers not obvious from grep. Do
  the removal in its own commit so it can be reverted independently of the
  visual work.
- **Swipe-between-tabs** can fight vertical scrolling on iOS. If it feels wrong
  on a real phone it gets dropped; it is the least important of the six.
- **Launch images** need one file per device size and go stale as Apple adds
  devices. Generate the common set, accept the rest falling back to the
  background colour.

## Sequencing

Each stage lands separately and is independently revertible:

1. Remove gamification (behavioural no-op, large diff)
2. `copy.js` and state-aware voice — the most visible fix for the least risk
3. Depth, type, hierarchy — the CSS pass
4. `motion.js` and the mark-as-read moment
5. Launch, icon, iOS fit
6. Physicality — gestures last, being the most likely to be cut
