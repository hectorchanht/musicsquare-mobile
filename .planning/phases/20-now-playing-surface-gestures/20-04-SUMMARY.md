---
phase: 20-now-playing-surface-gestures
plan: 04
subsystem: now-playing-ui
tags: [nowbar, mini-player, pointer-gesture, slide-and-snap, tap-to-expand]
requires:
  - "src/lib/actions/coverSwipe.ts (20-01 — horizontal prev/next action reused via use:coverSwipe)"
  - "src/lib/stores/player.svelte (player.prev/next, player.expand, player.queue)"
provides:
  - "NP-05: nowbar .np-open content slides 1:1 and swaps track on horizontal swipe (lighter than the cover — no carousel/peek)"
  - "Tap-to-expand preserved (sub-slop tap → player.expand via existing onclick)"
  - "Pinned .np-prog loader rail (sits outside .np-open, does not slide)"
affects:
  - "src/lib/components/Nowbar.svelte (swipe host)"
tech-stack:
  added: []
  patterns:
    - "use:coverSwipe on the .np-open content row (not the whole bar) so the loader rail stays pinned"
    - "reuse 0.28xwidth proportional commit + 0.5px/ms flick + prev-only boundary rubber-band (D-02/D-06/D-08)"
key-files:
  created:
    - ".planning/phases/20-now-playing-surface-gestures/20-04-SUMMARY.md"
  modified:
    - "src/lib/components/Nowbar.svelte"
decisions:
  - "D-06 lighter than the cover: .np-open content slides 1:1 and swaps on commit — NO multi-cover carousel/peek (the art is too small to read)."
  - "D-07 tap-to-expand preserved: onclick={handleOpen} untouched; sub-slop tap reaches it because coverSwipe arms no click-suppressor on a sub-slop tap."
  - "Loader rail integrity: use:coverSwipe is on .np-open only; .np-prog sits outside it and carries no swipe → stays pinned while content slides."
  - "hasPrev=hasPrevNeighbor (false at queue index 0), hasNext=true, enabled=!resolving; reduced-motion collapses the .np-open slide to instant."
metrics:
  duration: ~3 min
  tasks: 2
  files: 1
  completed: 2026-06-11
---

# Phase 20 Plan 04: Nowbar mini-player swipe (NP-05) Summary

NP-05 — the same horizontal swipe as the cover, applied to the docked nowbar but lighter: the `.np-open` content (thumb art + text) slides 1:1 with the finger and springs back, or slides off and swaps on commit (D-06 — no multi-cover carousel). The one code task landed; the device gesture-feel checkpoint (Task 2) was approved with the device pass deferred.

## What Was Built

### Task 1 — Wire coverSwipe slide-and-snap onto `.np-open` (commit `f0d4a73`)
- The docked nowbar mini-player's content row (`.np-open`) now changes track on a horizontal swipe (slide-and-snap, no peek, D-06), reusing the node-tested `coverSwipe` action with the same `0.28×width` proportional commit + `0.5px/ms` flick (D-08), the same direction mapping (left→right = prev, right→left = next), and the same prev-only boundary rubber-band (D-02).
- Wiring:
  - `onprev: () => player.prev()`, `onnext: () => player.next()` (no new advance logic).
  - `hasPrev: hasPrevNeighbor` — false exactly at queue index 0; `hasNext: true`; `enabled: !resolving`.
  - `onclick={handleOpen}` untouched (D-07 tap-to-expand path); `disabled={resolving}` and `aria-label` intact.
  - `.np-prog` loader rail sits OUTSIDE `.np-open` and carries no swipe → stays pinned while content slides.
  - Reduced-motion `@media` collapses the `.np-open` slide to instant (track change still happens).

## Task Commits

| Task | Name | Type | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Wire coverSwipe slide-and-snap onto .np-open (NP-05) | feat | f0d4a73 | src/lib/components/Nowbar.svelte |
| 2 | Device-verify nowbar swipe vs tap-to-expand (checkpoint:human-verify) | checkpoint | — | (no code; approved, device-pass deferred) |

## Verification

- `pnpm check` → **0 errors, 0 warnings** (4102 files).
- `pnpm test` → **647/647 passed, 52 files** (includes 20-01's `coverSwipe.test.ts`, no regressions).
- grep assertions: `use:coverSwipe` on `.np-open` wired to `player.prev()`/`player.next()`; `onclick={handleOpen}` unchanged; `use:coverSwipe` absent from `.np-prog`.
- Node v22.22.0 used for all tooling.

## Checkpoint Resolution — Task 2 (human-verify, blocking)

Approved by the user with the **device pass deferred** (same pattern as phases 18-03 / 19-03). The code is committed and the automated gate is green; the gesture-feel items below are device-only and will surface as HUMAN-UAT for a later real-device session.

## Deviations from Plan

None — plan executed as written. No Rule 1/2/3 auto-fixes, no Rule 4 architectural decisions, no auth gates.

## Device-Only Follow-ups (not node-testable)

1. Docked nowbar: swipe R→L → next; L→R → prev; flick commits (art + text slide and snap).
2. Short nudge (<28%, no flick) → springs back, no track change.
3. Single tap (not a swipe) → now-playing expands; a committed swipe never also expands.
4. While loading: the top running-line loader rail stays pinned and does NOT slide with the content.
5. First track (currentTime ≤ 3): swipe L→R (prev) → rubber-bands and springs back, no track change even on a hard flick.
6. Reduce-motion on → track still changes, no slide animation.
7. In now-playing FULL state, the embedded nowbar tap still collapses the sheet (its onOpen override) and the swipe still changes track.

## Authentication Gates

None.

## Known Stubs

None — fully wired to the live `coverSwipe` action and `player.prev()/next()/expand()`.

## Self-Check: PASSED

- FOUND: src/lib/components/Nowbar.svelte (use:coverSwipe on .np-open, loader rail outside it)
- FOUND commit: f0d4a73 (Task 1)
- Checkpoint Task 2: approved, device-pass deferred
