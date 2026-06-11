# Phase 20: Now-Playing Surface & Gestures - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 20-now-playing-surface-gestures
**Areas discussed:** Cover-swipe feel, Tap cover → subnav (NP-03), Nowbar swipe (NP-05), Commit threshold

---

## Cover-swipe feel — drag feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Carousel peek | Cover follows finger, prev/next art peeks in from edge, snaps to committed track. Most native; needs 3-cover render + edge handling. | ✓ |
| Track & snap-back | Cover follows finger, no neighbor art; springs back/out on commit/cancel. Cheaper. | |
| Instant, no drag-follow | Cover doesn't move; track changes once threshold crossed. Simplest, least native. | |

**User's choice:** Carousel peek
**Notes:** Queue neighbors known via `queue[i±1]`, so peek is feasible. Accepted as the heaviest option for the most native feel (YT Music / Spotify).

## Cover-swipe feel — queue boundary behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Rubber-band resist | If no neighbor to show, cover drags with resistance and springs back — no track change. | ✓ |
| Always commit | Swipe always fires prev()/next(); peek shows placeholder when no art. | |
| You decide | Apply native-feeling edge handling at planning time. | |

**User's choice:** Rubber-band resist
**Notes:** "Next" almost always has a neighbor (auto-generated up-next); only true resist case is "prev" on the very first track. `player.prev()` already restarts the song if `currentTime > 3`.

---

## Tap cover → subnav (NP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Collapse to closed | Sheet slides back to peek/closed — immersive cover, no panel. Reuses existing closed snap. | ✓ |
| Stay half, clear active tab | Sheet stays half but empties the subnav panel. Odd in-between state. | |
| Something else | e.g. dismiss to nowbar, or toggle half/full. | |

**User's choice:** Collapse to closed
**Notes:** Applies in half only (requirement scopes it there). Implies the cover arbitrates tap (collapse) vs h-drag (prev/next) vs v-drag (sheet) by the same slop rule.

---

## Nowbar swipe (NP-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Track & snap-back | Nowbar content slides with finger, springs back/out. No mini carousel. Tap still expands. | ✓ |
| Mirror the cover carousel | Full peek of prev/next thumb art on the bar. Heavier; tiny art hard to read. | |
| Commit-only, no slide | No movement during drag; threshold changes track. Simplest. | |

**User's choice:** Track & snap-back
**Notes:** Tap-to-expand must keep working — sub-slop tap expands, horizontal drag past slop changes track, same axis-lock as the cover.

---

## Commit threshold (NP-01 / NP-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Proportional distance + flick | 8px slop + 0.5px/ms flick, distance = ~25–30% of element width (both surfaces). | ✓ |
| Reuse swipeRemove as-is | Flat 8px / 96px / 0.5px/ms everywhere. 96px small on a wide cover. | |
| You decide | Pick sensible thresholds at planning time honoring slop + flick idiom. | |

**User's choice:** Proportional distance + flick
**Notes:** Reuse `swipeRemove.ts` / `velocity.ts` mechanics; change only the distance basis from flat 96px to a fraction of element width to prevent accidental skips on a big cover.

---

## Claude's Discretion

- **NP-04 top loader:** reuse nowbar's `.np-prog.indet > i.sliver` + `np-indet` keyframe driven by `player.loading`; exact placement and half-vs-full visibility.
- **NP-02 scroll containment:** `overscroll-behavior-y: contain` on `.panel` (+ `touch-action: pan-y` if needed).
- **Axis-arbitration code shape:** inline in `npTop*` handlers vs extracted shared prelude/action — as long as the no-capture-on-pointerdown / commit-axis-after-slop / sub-slop-reaches-onclick invariant holds.
- Carousel spring/snap easing and timings; rubber-band resistance curve.

## Deferred Ideas

None — discussion stayed within phase scope.
