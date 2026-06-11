---
phase: 20-now-playing-surface-gestures
plan: 03
subsystem: now-playing-ui
tags: [now-playing, pointer-gesture, carousel, axis-arbitration, a11y]
requires:
  - "src/lib/actions/coverSwipe.ts (20-01 — horizontal prev/next action wired via use:coverSwipe)"
  - "src/lib/components/NowPlaying.svelte (20-02 — settled loader + scroll-containment file)"
  - "src/lib/stores/player.svelte (player.prev/next, player.queue, sheet state)"
provides:
  - "NP-01: 3-cover rigid carousel strip on .cover (prev/current/next, 1:1 lockstep) wired to player.prev()/next()"
  - "NP-03: sub-slop tap on the cover in HALF collapses the sheet to closed"
  - "D-02 prev-boundary rubber-band on the cover (clamp + spring-back at queue index 0)"
  - "D-05 axis arbitration: horizontal carousel vs vertical collapse never double-capture"
affects:
  - "src/lib/components/NowPlaying.svelte (gesture host — final gesture wiring)"
tech-stack:
  added: []
  patterns:
    - "use:coverSwipe on a 3-cover strip with ondrag(dx) driving a 1:1 translate"
    - "axis split via touch-action (.cover-strip pan-y horizontal owner; .np-top pan-x vertical owner)"
    - "role=button cover with mirrored onclick + onkeydown (a11y_click_events_have_key_events)"
key-files:
  created:
    - ".planning/phases/20-now-playing-surface-gestures/20-03-SUMMARY.md"
  modified:
    - "src/lib/components/NowPlaying.svelte"
decisions:
  - "NP-01 carousel neighbors derived from the public player.queue.findIndex(uid); rigid edge-to-edge strip, no parallax/scale/fade/accent (UI-SPEC §1)."
  - "D-02 prev boundary = hasPrev false exactly at queue index 0; coverSwipe clamps to maxPull (0.18xcoverWidth), ignores flick, springs back over 0.32s, never changes track."
  - "D-05 axis arbitration via touch-action split: .cover-strip carries pan-y (owns horizontal), .np-top carries pan-x with the existing npTop* handlers (owns vertical); reduced-motion collapses the strip transition to instant."
  - "[Rule 3 auto-fix] Added onkeydown=tapCoverKey (Enter/Space) on the role=button cover, mirroring the grip's gripKey idiom — the NP-03 onclick tripped svelte-check a11y_click_events_have_key_events, which would fail the pnpm check 0/0 gate."
metrics:
  duration: ~7 min
  tasks: 4
  files: 1
  completed: 2026-06-11
---

# Phase 20 Plan 03: NowPlaying cover gestures (NP-01 carousel + NP-03 tap-collapse + D-05 arbitration) Summary

The two NowPlaying cover gestures that share the `.cover` / `.np-top` region and must arbitrate by axis with the existing vertical-collapse handlers — built last, after 20-01 (the `coverSwipe` action) and 20-02 (loader + scroll containment) settled the file. All three code tasks landed; the device gesture-feel checkpoint (Task 4) was approved with the device pass deferred.

## What Was Built

All gestures route through the node-tested `coverSwipe` action from 20-01 — the no-capture-on-pointerdown invariant (Pitfall 7) is intact because the only `setPointerCapture` lives inside that action's `move()`.

### Task 1 — NP-01 carousel strip + coverSwipe wiring + boundary (commit `65ca898`)
- 3-cover rigid carousel strip on `.cover` (prev / current / next, edge-to-edge, 1:1 lockstep, no parallax/scale/fade/accent), `use:coverSwipe` → `player.prev()` / `player.next()` (D-03).
- Neighbors derived from the public `player.queue.findIndex(uid)`.
- Prev-boundary: `hasPrev` is false exactly at queue index 0 → the action clamps to `maxPull = 0.18×coverWidth`, ignores flick, springs back over 0.32s, never changes track (D-02).

### Task 2 — NP-03 tap-cover-collapses-in-half (commit `f0bff21`)
- Sub-slop tap on the cover in the `half` state collapses the sheet to `closed` via the existing closed-snap path (D-04); no-op in closed/full.
- [Rule 3 auto-fix] Added `onkeydown={tapCoverKey}` (Enter/Space) on the `role="button"` cover mirroring the grip's `gripKey` idiom — same half-only collapse — to keep `pnpm check` at 0/0 (a11y_click_events_have_key_events). No new i18n keys, no new keyframes.

### Task 3 — D-05 axis arbitration with the existing vertical collapse (commit `1251d1f`)
- Horizontal carousel (`.cover-strip`, `touch-action: pan-y`) and vertical collapse (`.np-top`, `touch-action: pan-x`, `npTop*` handlers) never both capture.
- Reduced-motion collapses the strip transition to instant (track change still happens).

## Task Commits

| Task | Name | Type | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Carousel strip + coverSwipe wiring + boundary (NP-01) | feat | 65ca898 | src/lib/components/NowPlaying.svelte |
| 2 | Tap-cover-collapses-in-half (NP-03) + a11y keydown | feat | f0bff21 | src/lib/components/NowPlaying.svelte |
| 3 | Axis arbitration with existing vertical collapse (D-05) | feat | 1251d1f | src/lib/components/NowPlaying.svelte |
| 4 | Device-verify cover gesture arbitration (checkpoint:human-verify) | checkpoint | — | (no code; approved, device-pass deferred) |

## Verification

- `pnpm test src/lib/actions/coverSwipe.test.ts` — **16/16 green**.
- `pnpm test` (full suite) — **647/647 green, 52 files** (no regressions).
- `pnpm check` — **0 errors, 0 warnings**.
- Pitfall-7 confirmed: the sole `setPointerCapture` call lives inside `coverSwipe.move()` after the horizontal-commit check; never on pointerdown.
- Node v22.22.0 used for all tooling (shell-default v16 breaks svelte-check/vitest).

## Checkpoint Resolution — Task 4 (human-verify, blocking)

Approved by the user with the **device pass deferred** (same pattern as phases 18-03 / 19-03). All code is committed and the automated gate is green; the gesture-feel items below are device-only and will surface as HUMAN-UAT for a later real-device session.

## Deviations from Plan

- **[Rule 3 — blocking] Added `tapCoverKey` (Enter/Space) keydown handler on `.cover`** (commit `f0bff21`). The NP-03 `onclick` on the `role="button"` cover tripped svelte-check's `a11y_click_events_have_key_events`, which would fail the `pnpm check` 0/0 acceptance criterion. Fixed by mirroring the existing grip's `gripKey` idiom (same half-only collapse). No new i18n keys, no new keyframes.

Otherwise: plan executed as written. No Rule 4 architectural decisions, no auth gates.

## Device-Only Follow-ups (not node-testable)

1. HALF: single-tap cover → collapses to `closed`; tap in closed/full does nothing new.
2. Drag cover L→R past ~28% → previous track (prev art peeks 1:1, snaps to center); R→L → next; flick commits.
3. Short horizontal nudge (<28%, no flick) → springs back, no track change.
4. First track (index 0, currentTime ≤ 3): drag L→R (prev) → rubber-bands and springs back, no track change even on a hard flick.
5. Drag cover straight DOWN → existing sheet collapse still works (no carousel hijack).
6. Sub-slop tap still collapses; a committed swipe never also collapses.
7. Reduce-motion on → track still changes, no slide animation.

## Authentication Gates

None.

## Known Stubs

None — gestures are fully wired to the live `coverSwipe` action and `player.prev()/next()`.

## Self-Check: PASSED

- FOUND: src/lib/components/NowPlaying.svelte (carousel strip + tap-collapse + axis arbitration)
- FOUND commit: 65ca898 (Task 1)
- FOUND commit: f0bff21 (Task 2)
- FOUND commit: 1251d1f (Task 3)
- Checkpoint Task 4: approved, device-pass deferred
