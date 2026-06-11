---
phase: 20-now-playing-surface-gestures
plan: 01
subsystem: gestures
tags: [svelte-action, pointer-gesture, carousel, nowbar, tdd]
requires:
  - "src/lib/gestures/velocity.ts (createVelocityTracker — 0.5px/ms flick read)"
  - "src/lib/actions/swipeRemove.ts (structural analog mirrored verbatim)"
provides:
  - "coverSwipe — reusable horizontal axis-locked prev/next Svelte action (NP-01 cover carousel + NP-05 nowbar slide build on this)"
  - "CoverSwipeOpts — { onprev, onnext, ondrag?, hasPrev?, hasNext?, enabled? }"
affects:
  - "src/lib/components/NowPlaying.svelte (future plan: cover carousel host)"
  - "src/lib/components/Nowbar.svelte (future plan: slide-and-snap host)"
tech-stack:
  added: []
  patterns:
    - "arm-on-down / commit-axis-after-slop / capture-only-in-move (Pitfall 7 invariant, shared with swipeRemove.ts + dragClose.ts)"
    - "capture-phase one-shot trailing-click suppressor (swipeRemove WR-01 idiom)"
    - "measure-at-drag-start proportional commit (NowPlaying.measureOffsets idiom)"
    - "iOS rubber-band logarithmic damping at a true boundary"
key-files:
  created:
    - "src/lib/actions/coverSwipe.ts"
    - "src/lib/actions/coverSwipe.test.ts"
  modified: []
decisions:
  - "D-02 boundary rubber-band: resist via sign(dx)*maxPull*(1-e^-|dx|/maxPull), maxPull=0.18xwidth, flick IGNORED, always springs back over 0.32s"
  - "D-03 direction mapping: drag RIGHT (dx>0)=onprev, drag LEFT (dx<0)=onnext; NO new advance logic — onprev/onnext are the host's player.prev()/next()"
  - "D-08 proportional commit: 0.28xmeasuredWidth (measured at down() via getBoundingClientRect) replaces swipeRemove's flat 96px; flick 0.5px/ms with |dx|>8 still commits except at a boundary"
metrics:
  duration: 5 min
  completed: 2026-06-11
  tasks: 2
  files: 2
---

# Phase 20 Plan 01: coverSwipe prev/next swipe action Summary

A reusable horizontal axis-locked prev/next swipe Svelte action — a structural mirror of `swipeRemove.ts` with a proportional `0.28 × width` commit, a live `ondrag(dx)` callback, and an iOS rubber-band clamp at true queue boundaries — fully node-tested (16 headless tests, no jsdom).

## What Was Built

`coverSwipe` is the single gesture both NP-01 (cover carousel) and NP-05 (nowbar slide) will build on in later plans. It copies the swipeRemove.ts idiom byte-for-byte — `SLOP = 8`, `FLICK_V = 0.5`, `createVelocityTracker()`, `pan-y` touch-action on attach, the capture-phase one-shot `suppressClick` armed in `up()` only when captured, and a `destroy()` that drops the suppressor + resets inline styles + clears `touchAction` — then layers the three UI-SPEC-pinned deltas:

1. **Proportional commit (D-08):** `down()` measures `node.getBoundingClientRect().width` and computes `commitDist = 0.28 × width` and `maxPull = 0.18 × width` (mirroring `NowPlaying.measureOffsets`'s measure-at-drag-start idiom), replacing the analog's flat 96px threshold.
2. **prev/next + live dx (D-03):** exposes `onprev`/`onnext` (drag RIGHT = onprev, drag LEFT = onnext — these ARE the host's `player.prev()`/`next()`, no new advance logic) plus a per-frame `ondrag(dx)` so a host can translate its 3-cover carousel strip 1:1 (UI-SPEC §1) or slide nowbar content.
3. **iOS rubber-band at a true boundary (D-02):** when the relevant neighbor is absent (prev gesture && `hasPrev:false`, or next gesture && `hasNext:false`), the live translate is clamped to `sign(dx)·maxPull·(1 − e^(−|dx|/maxPull))`, flick is **ignored**, and the gesture **always** springs back to `translateX(0)` over `0.32s cubic-bezier(.22,1,.36,1)` (the heavier cover-reflow settle). Non-boundary commits/spring-backs use the `0.28s` curve.

The LOAD-BEARING Pitfall-7 invariant — never `setPointerCapture` on `pointerdown`; capture only in `move()` after the `|ddx| >= SLOP && |ddx| > |ddy|` horizontal commit — is enforced in code (the only `node.setPointerCapture(...)` call is inside `move()`, verified by `grep`) and asserted in tests (captureCalls length 0 right after pointerdown, equals `[pointerId]` after the committing move). A sub-slop tap arms no suppressor, so the host's tap-to-collapse / tap-to-expand `onclick` still fires.

## Task Commits

| Task | Name | Type | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Write failing tests for coverSwipe (RED) | test | 8ba9924 | src/lib/actions/coverSwipe.test.ts |
| 2 | Implement coverSwipe action (GREEN) | feat | 2133d86 | src/lib/actions/coverSwipe.ts |

## Verification

- `pnpm test src/lib/actions/coverSwipe.test.ts` — **16/16 green**.
- `pnpm test` (full suite) — **647/647 green, 52 files** (no regressions).
- `pnpm check` — **0 errors, 0 warnings** (svelte-check clean).
- `grep -n setPointerCapture src/lib/actions/coverSwipe.ts` — the sole `node.setPointerCapture(e.pointerId)` call is inside `move()` (line 122), after the horizontal-commit check; never in `down()` (Pitfall 7 confirmed).
- Line counts: coverSwipe.ts 197 (≥ 90 required), coverSwipe.test.ts 269 (≥ 120 required).

## TDD Gate Compliance

Gate sequence verified in git log:
1. RED — `test(20-01): add failing tests...` (8ba9924). Suite failed with `Cannot find module './coverSwipe'` before the implementation existed (no test passed unexpectedly during RED).
2. GREEN — `feat(20-01): implement coverSwipe...` (2133d86) after the RED commit. All 16 tests pass.
3. REFACTOR — not needed; the GREEN implementation was clean and idiomatic on first pass (no refactor commit).

## Deviations from Plan

### Environment setup (not a plan deviation)

- The worktree had no `node_modules`. Ran `pnpm install --frozen-lockfile` to restore the **existing** locked dependencies — no new packages were added (consistent with threat-register T-20-SC: zero new dependencies, slopcheck N/A). This is environment provisioning, not a Rule 3 package install of a new dependency.

Otherwise: **None — plan executed exactly as written.** Both tasks ran clean; no Rule 1/2/3 auto-fixes, no Rule 4 architectural decisions, no authentication gates, no checkpoints.

## Known Stubs

None. The action is fully wired (it imports the existing `createVelocityTracker`); no placeholder values, no mock data sources.

## Threat Flags

None. This is a client-side, browser-only pointer gesture: it sets inline `transform`/`transition`/`touchAction` styles only — never `innerHTML`, never a URL — and adds no network call, no data flow, no auth, no new dependency. The realistic threat surface is unchanged from the existing `swipeRemove.ts` (threat register T-20-01 accept / T-20-02 mitigate via `destroy()` + one-shot suppressor, both honored verbatim).

## Self-Check: PASSED

- FOUND: src/lib/actions/coverSwipe.ts
- FOUND: src/lib/actions/coverSwipe.test.ts
- FOUND commit: 8ba9924 (test RED)
- FOUND commit: 2133d86 (feat GREEN)
