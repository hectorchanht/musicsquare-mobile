---
phase: 20-now-playing-surface-gestures
plan: 02
subsystem: now-playing-ui
tags: [now-playing, loader, scroll-containment, css, svelte5]
requires:
  - "src/lib/stores/player.svelte (player.loading reactive flag)"
  - "src/lib/components/Nowbar.svelte (np-prog/indet/sliver loader pattern + np-indet keyframe — copied verbatim)"
provides:
  - "NP-04: top running-line loader at the .np view top edge, driven by player.loading"
  - "NP-02: overscroll-behavior-y: contain on .panel (half-open scroll no longer chains to the page behind the sheet)"
affects:
  - "src/lib/components/NowPlaying.svelte (markup + CSS only; gesture region left untouched for plan 20-03)"
tech-stack:
  added: []
  patterns:
    - "Reuse the nowbar's indeterminate running-line loader (np-prog indet + i.sliver + np-indet keyframe) verbatim for a second mount point"
    - "overscroll-behavior-y: contain for front-layer scroll containment (CSS-only, no JS scroll-lock)"
key-files:
  created:
    - ".planning/phases/20-now-playing-surface-gestures/20-02-SUMMARY.md"
  modified:
    - "src/lib/components/NowPlaying.svelte"
decisions:
  - "NP-04 renders in ALL sheet states (unconditional {#if player.loading}) per UI-SPEC §6 default; the suppress-in-full fallback was NOT applied — the embedded Nowbar's own .np-prog sits at its own in-flow top edge while this loader is absolutely pinned to the notch-safe top of .np, so no visual duplication is expected."
  - "Positioning rule uses the two-class selector .np-top-loader.np-prog so its top: env(safe-area-inset-top) wins over .np-prog's base top: 0 regardless of source order (equal single-class specificity would otherwise let the later .np-prog rule override it)."
  - "NP-02 is CSS-only (single property on .panel). pan-y scroll preserved — NO touch-action: none. iOS <16 lacks overscroll-behavior support → documented best-effort, no JS scroll-lock workaround in this phase."
metrics:
  duration: ~12 min
  tasks: 2
  files: 1
  completed: 2026-06-11
---

# Phase 20 Plan 02: NP-04 Top Running-Line Loader + NP-02 Scroll Containment Summary

Two small, gesture-free, additive edits to `NowPlaying.svelte` — a top running-line loader mirroring the nowbar's indeterminate bar (NP-04) and `overscroll-behavior-y: contain` on the scroll panel (NP-02) — landed first in wave 1 so the heavy gesture plan (20-03) edits a settled file. No pointer handler (`npTopDown`/`npTopMove`/`npTopUp`) was touched.

## What Was Built

### Task 1 — NP-04: top running-line loader (commit `4cbee1d`)
- Added `<div class="np-top-loader np-prog indet"><i class="sliver"></i></div>` as the FIRST child of the `.np` `<section>`, wrapped in `{#if player.loading}` so the element exists exactly when `player.loading === true`.
- Reuses the nowbar's `np-prog` / `np-prog.indet` / `.sliver` class names verbatim so it inherits the shared `np-indet` keyframe behavior.
- Copied the `.np-prog`, `.np-prog > i`, `.np-prog.indet`, `.np-prog.indet > i.sliver` rules, the `@keyframes np-indet`, and the `@media (prefers-reduced-motion: reduce)` 2.2s override **byte-for-byte** from `Nowbar.svelte` into `NowPlaying.svelte`'s `<style>` (3px height, rail `rgba(255,255,255,0.12)`, sliver `var(--color-primary)`, sliver `width: 35%; animation: np-indet 1.1s ease-in-out infinite`).
- Added a `.np-top-loader.np-prog { top: env(safe-area-inset-top); z-index: 60; }` positioning rule: full-bleed (`left/right: 0` inherited from `.np-prog`, which spans the full width despite `.np`'s 18px horizontal padding because padding does not offset an absolutely-positioned child's `left/right: 0`), flush with the notch-safe top edge, above the cover and `.bar` (within the `z-index: 50` `.np`) but below any modal.
- Indeterminate variant ONLY — no determinate `<i style:width>` seek bar (that belongs to the embedded Nowbar's seek progress, not wanted here).

### Task 2 — NP-02: scroll containment (commit `649b813`)
- Edited the `.panel` rule from `{ flex: 1; overflow-y: auto; }` to `{ flex: 1; overflow-y: auto; overscroll-behavior-y: contain; }`.
- Kept `pan-y` scroll — did NOT add `touch-action: none`; the browser still owns vertical scrolling, the panel still scrolls.
- Added a code comment noting NP-02 + the iOS <16 best-effort caveat (no JS scroll-lock workaround in this phase).

## Verification

- `pnpm check` → 0 errors, 0 warnings (4100 files) after each task.
- `pnpm test` → 631 tests passed (51 files) after each task.
- `grep -v '^\s*//' ... | grep -c "np-prog indet"` → non-zero; `np-indet` present; `env(safe-area-inset-top)` present.
- `grep -qE "overscroll-behavior-y:\s*contain"` → matches; `.panel` does NOT carry `touch-action: none`.
- `git diff 871f76d..HEAD` for `NowPlaying.svelte`: NO changes to `npTopDown`/`npTopMove`/`npTopUp` or any `onpointer*` binding — markup + CSS additions only.
- Zero new i18n keys added.
- Node v22.22.0 used for all tooling (shell-default v16 breaks svelte-check/vitest).

## Deviations from Plan

None — plan executed exactly as written. The UI-SPEC's permitted suppress-in-full fallback for NP-04 was deliberately NOT applied (the default unconditional `{#if player.loading}` was chosen and documented in a code comment, per the task's explicit "DEFAULT is unconditional" instruction).

One implementation detail worth flagging (not a deviation): the positioning rule had to use the two-class selector `.np-top-loader.np-prog` rather than `.np-top-loader` alone, so its `top: env(safe-area-inset-top)` wins over `.np-prog`'s base `top: 0` (equal single-class specificity would let the later-declared `.np-prog` rule override a bare `.np-top-loader`). Documented in a code comment.

## Authentication Gates

None.

## Known Stubs

None — both edits are fully wired: the loader reads the live `player.loading` flag and the CSS property applies to the real `.panel` scroller.

## Device-Only Follow-ups (not node-testable)

- NP-04 visual confirmation that the loader appears flush under the notch on a device with a safe-area inset, and that it does not visually duplicate the embedded Nowbar's own `.np-prog` when `sheetState === 'full'`.
- NP-02 confirmation on a real touch device that half-open over-scroll/bounce stops at the panel edges and never scrolls the page behind the sheet (Android Chrome + iOS Safari ≥16; iOS <16 is documented best-effort).

These are visual/behavioral checks deferred to the phase device pass.

## Self-Check: PASSED

- FOUND: `src/lib/components/NowPlaying.svelte` (loader markup at line 665, `.np-top-loader.np-prog` rule at line 853, `overscroll-behavior-y: contain` at line 962)
- FOUND: commit `4cbee1d` (Task 1)
- FOUND: commit `649b813` (Task 2)
