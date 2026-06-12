---
phase: 23-ux-audit-homepage-artist-polish
plan: 02
subsystem: gestures-a11y
tags: [svelte-action, gesture, accessibility, focus-trap, swipe]
requires:
  - src/lib/actions/swipeRemove.ts
  - src/lib/gestures/velocity.ts
  - src/lib/actions/longpress.ts
provides:
  - src/lib/actions/swipeAction.ts (directional swipe-action gesture, UX-04 D-02)
  - src/lib/actions/focusTrap.ts (hand-rolled focus-trap action, UX-06 §7.3)
affects:
  - "downstream surface plans wire use:swipeAction onto search/library/album/artist/chart .row"
  - "downstream a11y plans wire use:focusTrap onto TrackMenu/sheets/overlays"
tech-stack:
  added: []
  patterns:
    - "Hand-rolled Svelte Action (longpress/swipeRemove posture): add listeners on attach, return { update?, destroy }"
    - "Phase 15/20 gesture invariants: pan-y, no setPointerCapture on pointerdown, capture after horizontal commit, sub-slop reaches onclick, vertical-dominant yields, WR-01 trailing-click suppression"
    - "Full-commit-then-spring-back (iOS-Mail): commit per-direction, row always returns to translateX(0), never removed"
key-files:
  created:
    - src/lib/actions/swipeAction.ts
    - src/lib/actions/swipeAction.test.ts
    - src/lib/actions/focusTrap.ts
  modified: []
decisions:
  - "swipeAction generalizes swipeRemove verbatim (slop/flick/axis-arbitration/WR-01) and changes ONLY commit semantics: per-direction callbacks + unconditional spring-back, dropping the removal branch and FADE_DISTANCE/opacity fade (D-02)."
  - "swipeAction stays a PURE DOM gesture — no haptics inside; the consuming component fires haptics.tick() in onSwipeRight/onSwipeLeft (PATTERNS.md §3.3)."
  - "focusTrap manages FOCUS ONLY — no Escape/open-close handling; dismissal stays with the host overlay's Phase 19 $effect history invariant (§7.3)."
  - "focusTrap falls back to focusing the container (tabindex=-1) when no focusable child exists, and restores activeElement on destroy, so focus is never permanently lost (T-23-04)."
metrics:
  duration: ~10m
  tasks: 2
  files: 3
  completed: 2026-06-12
---

# Phase 23 Plan 02: Gesture & A11y Primitives Summary

Built two new dependency-free Svelte actions consumed by downstream row/overlay plans: a directional `swipeAction` gesture (generalized verbatim from `swipeRemove`, commits queue/like per-direction then always springs back) and a hand-rolled `focusTrap` (focuses-first, cycles Tab, restores focus on destroy). No surface wiring in this plan — new files only.

## What Was Built

### Task 1 — `swipeAction` directional gesture (TDD, UX-04 D-02)
- `src/lib/actions/swipeAction.ts` — `Action<HTMLElement, SwipeActionOpts>` with opts `{ onSwipeRight?, onSwipeLeft?, threshold? (default 96), enabled? }`.
- Inherited verbatim from `swipeRemove.ts`: `SLOP = 8`, `FLICK_V = 0.5`, `createVelocityTracker()` seeded on X, `touchAction = 'pan-y'`, NO `setPointerCapture` on pointerdown (capture only after horizontal commit in `move()`), sub-slop reaches `onclick`, vertical-dominant goes passive, and the WR-01 `suppressClick` trailing-click handler armed only on a committed drag.
- Changed commit semantics: `up()` computes `committed = |dx| > threshold || (|v| > FLICK_V && |dx| > SLOP)`; if committed, `dx > 0 ? onSwipeRight?.() : onSwipeLeft?.()`; then ALWAYS springs back to `translateX(0)`. Dropped swipeRemove's removal branch, `onremove`, and `FADE_DISTANCE`/opacity fade (rows are never removed).
- Pure DOM action — does not call haptics (host fires `haptics.tick()` in the callbacks).
- `src/lib/actions/swipeAction.test.ts` — 15 headless tests mirroring `swipeRemove.test.ts`: right-commit, left-commit, sub-slop-no-commit (tap preserved), vertical-yield, right/left flick-commit, spring-back, capture-only-in-move, pan-y on attach/clear on destroy, enabled:false inert, WR-01 suppression (commit + spring-back + tap-arms-none), no-opacity-fade, and reactive `update()`.

### Task 2 — `focusTrap` hand-rolled action (UX-06 §7.3)
- `src/lib/actions/focusTrap.ts` — `Action<HTMLElement>` following the `longpress.ts` posture (no new dependency).
- On mount: captures `document.activeElement` as the return target, focuses the first focusable child (selector `a[href], button:not([disabled]), input/select/textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`), falling back to focusing the node itself (`tabindex=-1`) if none.
- `keydown` listener cycles `Tab`/`Shift+Tab` within the focusable set (wraps last→first and first→last); also wraps when focus is outside the set. Escape is NOT handled (focus-only).
- `destroy()` removes the listener and restores focus to the captured trigger (guarded against a detached/disconnected target). No open/close state mutation.

## Verification
- `pnpm exec vitest run src/lib/actions/swipeAction.test.ts` → 15/15 pass.
- `pnpm check` → 0 errors, 0 warnings (4254 files).
- Confirmed `swipeAction.ts` has no `setPointerCapture` in the pointerdown handler (only in `move()`), and no removal branch / no `FADE_DISTANCE`.

## Deviations from Plan

### Setup (not a code deviation)
**Restored dependencies in the worktree** — `node_modules` was absent in this fresh worktree, so `vitest`/`svelte-check` could not run. Ran `pnpm install --frozen-lockfile` (restoring the committed lockfile's exact dependency set — no new packages added, no lockfile change). This is dependency restoration, not a package install of a new/ambiguous package, so the package-legitimacy checkpoint does not apply.

### Auto-fixed Issues
None — both files implemented exactly as the plan and PATTERNS.md `up()` pseudocode specified.

## Notes
- Task 2's `<files>` listed only `focusTrap.ts` (no companion test); none was added, consistent with the plan. `pnpm check` is the specified verification gate for Task 2.
- `.planning/HANDOFF.json` showed as modified at agent start (pre-existing, unrelated to this plan) and was left untouched.

## Threat Flags
None — both actions only invoke caller-supplied callbacks (swipe) or manage local focus (trap); no new network/auth/file surface introduced. T-23-04 mitigated (focus restore + container fallback); T-23-05 accepted per plan (callbacks act on the user's own queue/library; spring-back guarantees no destructive removal).

## Known Stubs
None.

## Self-Check: PASSED
All created files present; all task commits (8a1aa4f, 75fc173, 95bdecd, 21f32b8) found in git log.
