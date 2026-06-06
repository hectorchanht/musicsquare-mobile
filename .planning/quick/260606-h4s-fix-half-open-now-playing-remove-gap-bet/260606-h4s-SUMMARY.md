---
phase: quick-260606-h4s
plan: 01
subsystem: now-playing-ui
tags: [svelte5-runes, gestures, bottom-sheet, now-playing, mobile-ux]
requires: [260606-ggj]
provides: "Flush half-open offset, subnav-tap tab-switch priority, transparent floating reflow bar"
affects: [src/lib/components/NowPlaying.svelte]
tech-stack:
  added: []
  patterns: ["live-edge measurement via getBoundingClientRect for sheet snap offsets", "gesture-transient flag (gripStartTab) resolved from data-* attribute to prioritize subnav tap over generic toggle", "reactive $state offset driving a resting CSS transform"]
key-files:
  created: []
  modified: [src/lib/components/NowPlaying.svelte]
decisions:
  - "Promoted halfOffset from plain `let` to `$state` because the resting-half `.sheet` transform now reads it reactively in markup (svelte-check non_reactive_update warning would otherwise fire)."
  - "Used data-tab attributes on subnav buttons (vs. child-index mapping) to resolve gripStartTab — robust against markup reorder, no new i18n keys."
  - "Left the existing .np.reflow .cover::before top gradient unchanged: its 0%→28% dark stop (~67px over a 30vh cover) already covers the ~46px floating bar zone; white icons stay legible."
metrics:
  duration: "~10 min"
  completed: 2026-06-06
  tasks: 1
  files: 1
---

# Phase quick-260606-h4s Plan 01: Fix Half-Open Now-Playing Summary

Fixed the three half-open now-playing regressions from the 3-state sheet snap machine (260606-ggj): the dead gap above the subnav panel, the swallowed subnav-item taps, and the in-flow top bar — all in `src/lib/components/NowPlaying.svelte` (UI layer only), matching the existing Svelte 5 runes idioms exactly with no new deps or i18n keys.

## What Was Built

### BUG 1 — Flush half-open + persistent resting transform
- Added `let transportEl = $state<HTMLElement | null>(null)` and `bind:this={transportEl}` on the `<div class="transport">` row.
- In `measureOffsets()`, replaced the arbitrary `halfOffset = Math.round(npRect.height * 0.5)` with a live measurement of the transport row's bottom edge: `Math.round(transportEl.getBoundingClientRect().bottom - npRect.top)`, falling back to the old fraction only when `transportEl` is null. The existing `Math.max(20, Math.min(closedOffset - 20, halfOffset))` clamp is preserved.
- The `.sheet` resting transform now reads `sheetState === 'half' ? translateY(halfOffset) : undefined`, so resting half holds its position instead of collapsing to `inset:0` full coverage. Resting full = no transform (correct) and resting closed = normal flow (correct).
- Added a SEPARATE idempotent `$effect` that re-measures offsets whenever `sheetState === 'half' && !sheetDragging`, so tap/keyboard entry into half (which never went through `measureOffsets()`) gets the flush offset. It does not read `halfOffset`, so no reactive loop. The back-gesture single-dismiss `$effect` (lines ~120-123) was left fully untouched.
- Promoted `halfOffset` to `$state(150)` so the now-reactive resting-half transform updates when re-measured (resolved the only svelte-check warning).

### BUG 2 — Subnav item tap switches tab with priority
- Added `data-tab="queue"|"lyrics"|"related"` to the three subnav buttons.
- Added gesture-transient `let gripStartTab: Tab | null = null` (plain let). `gripDown` resolves `e.target.closest('.subnav button')?.dataset.tab` into `gripStartTab`.
- `gripUp` TAP branch (`|moved| < 8`): if `gripStartTab` is set → `selectTab(gripStartTab)` and skip the generic toggle; otherwise run the unchanged closed→half / full→half / half→closed step. `gripStartTab` is reset to `null` on every `gripUp` path (both tap branches and the drag path) so it never leaks.
- A `>=8px` drag still sets `subnavMoved`, which `selectTab` guards on, so drags snap without switching tabs. The buttons' native `onclick={() => selectTab(...)}` fallback is preserved and idempotent.

### BUG 3 — Transparent floating top bar
- Changed `.np.reflow .bar` from `position: relative; z-index: 2;` to `position: absolute; top: 0; left: 18px; right: 18px; z-index: 2;` so the bar floats transparently over the full-bleed cover (which already runs edge-to-edge at `height:30vh; margin:0 -18px`) at both half and full. `.bar` has no background; the `.icon` only paints on `:hover`, so it stays transparent over the cover with the existing darkening gradient for legibility.

## Verification

- `npm run check` (svelte-check): **0 errors, 0 warnings** (3983 files). A `non_reactive_update` warning surfaced on the first run because the resting transform read a plain-`let` `halfOffset`; fixed by promoting it to `$state`.
- `npm test` (vitest): **89/89 passing**, 13 test files (the plan referenced 78 historically; the suite has since grown to 89 — all green, no regressions; UI-only change touched no service/data tests).
- Grep gates: `transportEl` present (decl + measure + bind), `gripStartTab` present (decl + gripDown + gripUp paths), `.np.reflow .bar { position: absolute; ... }` present.

## Manual-Verify Items (on-device gesture walkthrough — could not be auto-verified)

Use a touch device or DevTools touch emulation:
1. **HALF FLUSH** — drag/tap to half-open: the subnav panel top sits flush at the transport bottom with NO dead gap; the panel fills remaining height and scrolls.
2. **TAB TAP PRIORITY** — while CLOSED, tap "Up Next" / "Lyrics" / "Related": the sheet half-opens AND switches to exactly that tab (not just opens on the current tab). While half/full, tapping an item only switches the tab.
3. **DRAG NOT SWITCH** — drag (>=8px) on the subnav row: the sheet snaps between states and the tab does NOT change.
4. **TRANSPARENT BAR** — at half AND full, the cover runs edge-to-edge to the true top and the back/title/menu bar floats transparently over it (icons legible against the gradient).
5. **REGRESSIONS** — closed↔full grip drag, full state, cover drag-down-to-collapse, queue reorder, lyrics auto-scroll, related, and the back-gesture (Back closes menu → now-playing → navigates) all still work.

## Deviations from Plan

**1. [Rule 1 - Bug] Promoted `halfOffset` to `$state` for reactivity**
- **Found during:** Task 1 (svelte-check verification)
- **Issue:** FIX 1c made the resting-half `.sheet` transform read `halfOffset` in markup, but `halfOffset` was a plain `let`. svelte-check flagged `non_reactive_update` — re-measuring `halfOffset` while resting in half would not update the transform, so the flush correction would be silently dropped on tap/keyboard/layout-change entry.
- **Fix:** Changed `let halfOffset = 150` → `let halfOffset = $state(150)`. `closedOffset` stays a plain `let` (only read imperatively inside handlers, never in markup). This matches the existing runes idiom and yields 0 warnings.
- **Files modified:** src/lib/components/NowPlaying.svelte
- **Commit:** 7fb2845

The plan otherwise executed as written.

## Commits

- `7fb2845`: fix(quick-260606-h4s): flush half-open, subnav-tap tab priority, floating reflow bar

## Self-Check: PASSED

- FOUND: src/lib/components/NowPlaying.svelte (verified exists)
- FOUND: commit 7fb2845
