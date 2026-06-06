---
phase: quick-260606-nqf
plan: 01
subsystem: now-playing-gestures
tags: [ui, gestures, svelte5, velocity, lyrics, bottom-sheet]
requires: []
provides:
  - "createVelocityTracker — pure pointer-velocity helper shared by NowPlaying sheet + dragClose"
  - "Velocity-aware one-state flick snap in NowPlaying gripUp + dragClose dismiss"
  - "Post-reflow flush half offset (zero gap under transport)"
  - "Panel-container-scoped lyrics auto-scroll (no sheet expansion)"
  - "Finger-presence-driven lyrics auto-scroll pause/resume"
affects:
  - src/lib/components/NowPlaying.svelte
  - src/lib/actions/dragClose.ts
tech-stack:
  added: []
  patterns:
    - "Caller-supplied e.timeStamp (no Date.now/performance.now) → deterministic, SSR-safe, unit-testable velocity"
    - "Defer layout measurement until CSS transition settles: transitionend(once) + double-rAF + timeout fallback with $effect teardown cleanup"
    - "Container-scoped manual scrollTo via getBoundingClientRect rect-delta (offsetParent-agnostic) instead of scrollIntoView"
key-files:
  created:
    - src/lib/gestures/velocity.ts
    - src/lib/gestures/velocity.test.ts
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/actions/dragClose.ts
decisions:
  - "Flick threshold V = 0.5 px/ms for both surfaces; flick steps ONE state in direction (clamped at ends), slow drag keeps the existing nearest-by-position+bias fallback"
  - "dragClose flick dismiss gated by dy > 8 so the tap contract (dy<8, low velocity → no dismiss) is preserved"
  - "Lyrics scroll uses rect-delta math (elRect.top - cRect.top + scrollTop) rather than offsetTop to stay offsetParent-agnostic across the .panel/.lyrics nesting"
  - "Auto-scroll resume grace = 600ms after release/last-wheel (avoids fighting momentum scroll)"
metrics:
  duration: ~9 min
  completed: 2026-06-06
  tasks: 2
  files: 4
---

# Phase quick-260606-nqf Plan 01: Now-Playing Gesture Fixes (Velocity / Inert) Summary

Velocity-aware 3-state sheet flick + dragClose dismiss via a shared pure `createVelocityTracker` (6 unit tests), plus the half-open flush-gap root-cause fix (re-measure after the 0.32s cover reflow settles) and panel-scoped, finger-presence-driven lyrics auto-scroll.

## What Was Built

### Task 1 — Pure velocity tracker + velocity-aware snap/dismiss (commit cf4dcbf)
- **`src/lib/gestures/velocity.ts`** — dependency-free `createVelocityTracker()` exposing `sample(clientY, timeStamp)`, `velocity()` (px/ms from the last two samples; positive = DOWN, negative = UP), and `reset()`. Buffer trimmed to 3 points. `velocity()` returns `0` when there are fewer than 2 samples or `delta-t <= 0` (divide-by-zero / NaN guard — threat T-nqf-01). Caller supplies `e.timeStamp`; the module never touches `Date.now`/`performance.now`, so it is deterministic and SSR-safe.
- **`src/lib/gestures/velocity.test.ts`** — 6 cases (down ≈ +1.0, up negative, <2 samples → 0, delta-t === 0 → 0 finite/non-NaN, reset clears, last-two-only). All green.
- **`NowPlaying.svelte` gripUp DRAG branch** — added a component-scope `gripVel` tracker (`reset()`+`sample()` in `gripDown`, `sample()` in `gripMove`). On release, if `|velocity| > 0.5`, step ONE state in the flick direction (down: full→half→closed; up: closed→half→full; clamped). Otherwise the existing nearest-by-position + 0.12·closedOffset directional-bias snap runs unchanged. Settle (`sheetDragY = offsetFor(target)`, 290ms `snapTimer`, 0.28s cubic-bezier easing) untouched. TAP branch, `gripStartTab` subnav-tap priority, and `gripKey` untouched.
- **`dragClose.ts` `up()`** — added a closure-scope `vel` tracker (`reset()`+`sample()` in `down`, `sample()` in `move`). Dismiss now fires on `dy > threshold` **OR** `(v > 0.5 && dy > 8)`. Tap contract preserved (no `preventDefault` on down; dy<8 + low velocity never dismisses). `Action<HTMLElement, DragCloseOpts>` shape, `update`/`destroy`, and snap-back easing untouched.

### Task 2 — Flush half offset, panel-scoped lyrics scroll, touch-presence auto-scroll (commit ef4fda5)
- **FIX A (BUG-2 real root cause):** `h4s` measured `transportEl.bottom` DURING the `.cover` 0.32s reflow, so `halfOffset` overshot by the cover-shrink delta → visible gap. The resting-half `$effect` now re-runs `measureOffsets()` AFTER the reflow settles: `coverEl` is bound (`bind:this`) and the effect attaches a one-shot `transitionend` listener plus a double-`requestAnimationFrame` and a 340ms `setTimeout` fallback (covers already-reflowed taps and `prefers-reduced-motion` where no transition fires). All listeners/timers are cleaned up in the effect teardown (threat T-nqf-02 — no leak/late fire). `measureOffsets()` itself, the gripDown live-drag measure, and the resting `.sheet` `translateY(halfOffset)` read are all unchanged.
- **FIX B (BUG-3a):** Replaced `el.scrollIntoView({block:'center'})` (which walks ancestors and yanked the sheet to full in half mode) with manual `container.scrollTo()` on the bounded `.panel` scroller, resolved via `lyricsEl.closest('.panel')`. Position computed offsetParent-agnostically from rect deltas (`elRect.top - cRect.top + container.scrollTop`) and centered (`- clientHeight/2 + offsetHeight/2`). Null-guarded. Auto-scroll now stays inside `.panel` and never changes `sheetState`.
- **FIX C (BUG-3b):** Replaced the blind 2.5s idle timer with finger-presence control. `lyricsTouched()` now ONLY pauses (`autoScroll = false`, clears pending resume). New `lyricsReleased()` schedules `autoScroll = true` after a 600ms grace. New `lyricsWheel()` pauses then schedules the same resume (no release event for wheel). Markup wires `onpointerdown={lyricsTouched}`, added `onpointerup`/`onpointercancel={lyricsReleased}` and `onwheel={lyricsWheel}`.

## Verification

- **`npm run check`**: 0 errors / 0 warnings (4000 files, svelte-check over the full project).
- **`npm test`**: 171/171 tests passing across 20 files — includes the 6 new `velocity.test.ts` cases. No service/data tests touched.
- **Grep gates**: `createVelocityTracker` imported in both `NowPlaying.svelte` and `dragClose.ts`; `closest('.panel')`, `transitionend`, and `lyricsReleased` present in `NowPlaying.svelte`; `scrollIntoView` absent (the only prior call was replaced; no bare token remains, even in comments).

## Manual On-Device Walkthrough (gesture feel — not unit-testable; non-blocking)

These require a touch device or DevTools touch emulation and could not be auto-verified:
1. **Fast flick DOWN** from near-full: a quick short downward flick steps full→half (or half→closed); does NOT bounce back.
2. **Fast flick UP**: a quick short upward flick steps closed→half→full.
3. **Slow drag fallback**: a slow drag still snaps to the nearest state by position+bias (unchanged).
4. **Half flush**: drag/tap to half — the subnav panel top sits flush at the transport bottom with NO dead gap; panel fills remaining height and scrolls.
5. **Lyrics half stays half**: on the lyrics tab in half mode, as lines advance the active line auto-centers WITHIN the panel and the sheet stays half (does NOT jump to full).
6. **Touch pause / release resume**: holding a finger on the lyrics pauses auto-scroll; releasing resumes ~600ms later; wheel scrolling also pauses then resumes.
7. **Modal fast-flick dismiss**: a fast downward flick on a `dragClose` modal/sheet dismisses it even when not dragged past 120px; a tap (dy<8, low velocity) still does NOT dismiss.
8. **Regressions**: closed↔full grip drag, full state, cover drag-down-to-collapse, queue reorder, subnav-tap tab priority, Last.fm enrichment, lyrics translation, and the back-gesture single dismiss all still work.

## Deviations from Plan

None of substance. One micro-adjustment: FIX B computes the line offset via `getBoundingClientRect` rect-deltas instead of raw `el.offsetTop` — the plan flagged that `offsetTop` resolves against the offset parent (`.lyrics`, not `.panel`) and asked to account for it; the rect-delta form is offsetParent-agnostic and correctly centers within `.panel`, which is the cleaner way to satisfy that requirement. Tracked as `[Rule 1 - correctness]` — same intent as the plan, no behavioral surprise.

## Threat Model Compliance

- **T-nqf-01 (velocity divide-by-zero / NaN)** — mitigated: `velocity()` returns `0` for `delta-t <= 0` and `<2` samples (covered by Test 4: finite, non-NaN). No Infinity/NaN reaches the transform.
- **T-nqf-02 (listener/timeout leak)** — mitigated: the resting-half `$effect` teardown removes the `transitionend` listener (also `{ once: true }`) and clears the double-rAF + 340ms fallback.
- **T-nqf-SC (package installs)** — accept: no new dependencies; `velocity.ts` is dependency-free in-repo code.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/gestures/velocity.ts
- FOUND: src/lib/gestures/velocity.test.ts
- FOUND: src/lib/components/NowPlaying.svelte
- FOUND: src/lib/actions/dragClose.ts
- FOUND commit cf4dcbf (Task 1)
- FOUND commit ef4fda5 (Task 2)
