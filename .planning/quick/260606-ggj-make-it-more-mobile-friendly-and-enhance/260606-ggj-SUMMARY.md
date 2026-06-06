---
phase: quick-260606-ggj
plan: 01
subsystem: mobile-ui / now-playing
tags: [svelte5-runes, gestures, drag-to-close, back-gesture, bottom-sheet, mobile-ux]
requires:
  - src/lib/components/NowPlaying.svelte (existing 2-state grip live-drag idiom)
  - src/lib/components/TrackMenu.svelte (existing 3-sheet scrim + transition:fly)
  - src/lib/actions/longpress.ts (action style reference)
  - src/lib/stores/player.svelte.ts (runes-class style reference; expand/collapse)
provides:
  - src/lib/actions/dragClose.ts (reusable finger-drag-to-dismiss Svelte action)
  - src/lib/stores/overlays.svelte.ts (centralized History-API back-to-close stack)
  - NowPlaying 3-state (closed/half/full) snap machine + subnav drag-handle + cover reflow
  - TrackMenu drag-to-close + back-gesture on all 3 sheets
affects:
  - src/routes/(app)/+layout.svelte (overlays.init in onMount)
tech-stack:
  added: []          # no new dependencies
  patterns:
    - "Reusable Svelte Action with reactive update() + style cleanup (dragClose)"
    - "Runes singleton store driving History API (overlays) with balanced-depth invariant"
    - "$effect open/cleanup pairing as the single overlay dismiss site"
key-files:
  created:
    - src/lib/actions/dragClose.ts
    - src/lib/stores/overlays.svelte.ts
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/+layout.svelte
decisions:
  - "Single dismiss path = the $effect CLEANUP. UI close handlers (scrim/X/drag/cover-collapse/back) only flip state false; the cleanup is the sole caller of overlays.dismiss(id) → history depth never desyncs."
  - "Back gesture closeTop() removes the stack entry BEFORE running close(), so the follow-on cleanup dismiss() finds nothing and is a guarded no-op (prevents double-pop)."
  - "dragClose hands off to the host's existing transition:fly: it resets its inline transform before calling onclose() so the fly-out animates from rest."
  - "Direction-biased nearest-snap for the 3-state sheet (bias = closedOffset*0.12*dir) so a deliberate swipe overshoots one state instead of always snapping to the literal nearest point."
metrics:
  duration: ~12 min
  completed: 2026-06-06
  tasks: 3
  files: 5
  commits: 3
---

# Phase quick-260606-ggj Plan 01: Make it more mobile-friendly and enhance — Summary

Native-feeling gesture overhaul of the now-playing experience and all bottom-sheets: a reusable finger-drag-to-dismiss action, a centralized History-API back-to-close overlay stack, a 3-state (closed/half/full) now-playing snap machine driven by both the grip and the subnav row, and a YouTube-Music-style cover reflow when the sheet opens — all on Svelte 5 runes with zero new dependencies and the data/fetch backend untouched.

## What Was Built

### Task 1 — Reusable primitives (commit `310ce93`)
- **`src/lib/actions/dragClose.ts`** (95 lines) — `Action<HTMLElement, DragCloseOpts>`. Finger-follows translateY on pointermove (transition off), and on release: drag-down past `threshold` (default 120, matching the cover) → reset inline transform + call `onclose()` (host's `transition:fly` plays the exit); below threshold → animate back to 0 (snap-back). Tap-preserving: never `preventDefault`s on pointerdown and only dismisses past threshold, so child `onclick` handlers keep firing. Sets `touch-action:none` + `user-select:none` on attach (no text-selection / page-scroll while dragging). Reactive `update()` swaps `onclose` / toggles `enabled`; `destroy()` removes listeners and resets inline styles.
- **`src/lib/stores/overlays.svelte.ts`** (121 lines) — runes singleton `Overlays`. `open(id, close)` pushes a stack entry + one `history.pushState` (idempotent if already top); `closeTop()` pops + runs the top close handler (back-gesture path); `dismiss(id)` removes the entry and calls `history.back()` once (guarded by a `popping` flag so the echo popstate doesn't double-close); `init()` installs the single `popstate` listener and returns a teardown. SSR-safe (`typeof window` guards). **Invariant: history depth == overlay stack depth.**

### Task 2 — NowPlaying 3-state sheet + subnav drag-handle + cover reflow (commit `77d0d8b`)
- Replaced `panelFull: boolean` with `sheetState: 'closed' | 'half' | 'full'`. `measureOffsets()` computes `closedOffset` (real peek when closed, else ~0.72·height) and `halfOffset` (~0.5·height, clamped between full and closed). Resting translateY derived from state via `offsetFor()`.
- **Snap rules** (pointerup): `|moved|<8` → TAP single-step (closed→half, full→half, half→closed); otherwise direction-biased nearest-snap among {full, half, closed} with the existing 290ms settle timer. Grip keyboard Enter/Space mirrors the tap step.
- **Subnav row is also a drag handle**: the same `gripDown/gripMove/gripUp` handlers are attached to `<nav class="subnav">`. A `subnavMoved` flag (set when the gesture passes 8px) suppresses the tab-switch on a drag; genuine taps still fire `selectTab()`.
- **Subnav tap → half-open + reflow**: tapping a subnav item while closed switches the tab AND opens the sheet to half. `class:reflow={sheetState !== 'closed'}` on `.np` drives the cover from a centered square (`min(72vw,320px)`, `aspect-ratio:1/1`, `margin:10px auto`) to a full-bleed banner (`height:30vh`, `margin:0 -18px`, no radius) with a top/bottom gradient scrim; the header overlaps the banner top (`z-index`), and `.meta` is pulled up (`margin-top:-42px`) to overlap the bottom — YT-Music style. CSS transitions on width/height/margin/border-radius animate the reflow both ways.
- Mobile guards: `touch-action:none` + `user-select:none` on sheet/grip/subnav; subnav buttons `min-height:40px`. Cover drag-collapse, queue reorder, lyrics auto-scroll, tab switching, related, and i18n all preserved unchanged.

### Task 3 — Wiring (commit `caf9f6a`)
- **`+layout.svelte`**: `overlays.init()` called once in the existing `onMount`, its teardown returned for cleanup (single popstate listener).
- **`TrackMenu.svelte`**: `use:dragClose` on all 3 sheets (`.menu` → `close`, picker `.menu` → `pickerOpen=false`, detail `.modal` → `detailTrack=null`). Three `$effect`s register each sheet with `overlays` on open and `overlays.dismiss(id)` in cleanup.
- **`NowPlaying.svelte`**: an `$effect` registers `overlays.open('nowplaying', () => player.collapse())` on mount and dismisses on unmount. Because NowPlaying only renders while `player.expanded`, mount == overlay open. TrackMenu (rendered inside NowPlaying) registers above it in the stack, so Back closes the menu first, then now-playing, then navigates.

## Single Dismiss Path (history-depth balance) — REQUIRED DOCUMENTATION

The plan mandated ONE dismiss path so scrim / X / drag / cover-collapse / back-gesture never desync history depth. **The chosen single dismiss site is the `$effect` cleanup.**

- Every UI close handler (scrim onclick, X button, `dragClose`'s onclose, the now-playing ChevronDown / cover drag-collapse / openArtist) does **only one thing**: flip the open state false (`menuOpen=false`, `pickerOpen=false`, `detailTrack=null`, or `player.collapse()`).
- Flipping the state false re-runs the registering `$effect`, whose **cleanup is the sole caller of `overlays.dismiss(id)`**.
- The back gesture takes a separate but compatible route: `popstate` → `overlays.closeTop()` removes the stack entry **first**, then runs the registered `close()` (which flips state false) → the `$effect` cleanup fires → `overlays.dismiss(id)` finds the id already gone and is a guarded **no-op**. No double-pop.
- For UI closes, `dismiss(id)` removes the entry then calls `history.back()` once; the resulting popstate echo is swallowed by the `popping` flag.

Net effect: `open()` always pushes exactly one history state; exactly one of {cleanup `dismiss()`, back-gesture `closeTop()`} pops it. History depth == overlay stack depth at all times.

## New i18n Keys

**None.** Existing `nowplaying.*` keys were reused. The grip aria-label now maps `closed → nowplaying.expandPanel` and `half|full → nowplaying.collapsePanel` (no third label added). No keys removed. All three dicts (en / zh-Hant / zh-Hans) are untouched and remain in sync.

## Deviations from Plan

None — plan executed exactly as written. (Dependencies were restored in the worktree via `pnpm install --frozen-lockfile` from the existing committed lockfile; this is a dependency restore, not a new-package install, so it is not a Rule 3 package-install checkpoint.)

## Known Stubs

None. No hardcoded empty data, placeholder text, or unwired components were introduced. All existing data flows (queue, lyrics, related, library) are preserved.

## Verification

- `npm run check` (svelte-check): **0 errors, 0 warnings** after every task and at final state (3966 files).
- `npm test` (vitest): **78/78 tests pass** (12 files). No regressions — this is UI-only; no service/data tests touched.
- Grep gates: `popstate`/`pushState` present in overlays.svelte.ts; `touchAction`/`userSelect` present in dragClose.ts; 3× `use:dragClose` in TrackMenu; `overlays.` wired in NowPlaying.
- No file deletions in any commit; no untracked files left behind.

## Manual-Verify Items (cannot be auto-verified — for the user on a device / devtools touch emulation)

These three gesture walkthroughs require a real touch device or devtools touch emulation and are NOT blocking:

1. **Snap stickiness** — Closed sheet: drag the GRIP up slowly → follows finger; release ~half → sticks at half; drag up again → full; drag down full → half → closed. Drag the SUBNAV ROW up/down → moves identically to the grip. Confirm a deliberate fast swipe overshoots one state.
2. **Reflow smoothness** — Tap a subnav item while closed → opens to half, that tab active, cover becomes a full-bleed banner with the header overlapping its top and the meta overlapping its bottom; return to closed → cover/meta animate smoothly back to the centered square. Tapping a subnav item while half/full only switches the tab (no reflow change).
3. **Back-balance** — Open the options menu → Back closes it (no navigation); Back again with now-playing full-screen → collapses to nowbar (no navigation); Back again with nothing open → normal navigation. Cross-check that scrim-tap / X / drag-close then a subsequent Back never double-closes or gets stuck (history depth balanced). Verify menu-item taps (e.g. "Add to queue") still fire through `use:dragClose`, and cover drag-down still collapses now-playing.

## Commits

- `310ce93` feat(quick-260606-ggj): add dragClose action + back-gesture overlay store
- `77d0d8b` feat(quick-260606-ggj): 3-state now-playing sheet + subnav drag-handle + cover reflow
- `caf9f6a` feat(quick-260606-ggj): wire drag-to-close + back-gesture into sheets and now-playing

## Self-Check: PASSED

- Created files exist: `src/lib/actions/dragClose.ts`, `src/lib/stores/overlays.svelte.ts`, this SUMMARY.
- Modified files exist: `NowPlaying.svelte`, `TrackMenu.svelte`, `(app)/+layout.svelte`.
- All 3 commits present in git log: `310ce93`, `77d0d8b`, `caf9f6a`.
