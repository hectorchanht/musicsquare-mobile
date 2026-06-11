---
phase: 19-track-menu-rework
plan: 03
subsystem: ui-trigger-sites
tags: [menu-03, d-12, long-press, css, touch, ios-safari, android-chrome]
requires:
  - "19-01 (longpress.ts suppressNextClick trailing-click guard — preserved, not regressed)"
provides:
  - "Global `-webkit-tap-highlight-color: transparent` on interactive elements (app.css)"
  - "Hover-guarded `:hover`/`:active` press styles at all 6 long-press trigger sites"
  - "blur-on-longpress at all 14 onlongpress handlers across the 6 trigger sites"
affects:
  - "src/app.css"
  - "src/routes/(app)/+page.svelte"
  - "src/routes/(app)/library/+page.svelte"
  - "src/routes/(app)/search/+page.svelte"
  - "src/routes/(app)/artist/[name]/+page.svelte"
  - "src/routes/(app)/album/[name]/+page.svelte"
  - "src/lib/components/NowPlaying.svelte"
tech-stack:
  added: []
  patterns:
    - "Single global tap-highlight reset shared by every interactive surface (app.css idiom, mirrors the global .marquee-inner block)"
    - "@media (hover: hover) guard so touch devices never latch a sticky :hover/:active state"
    - "(e.currentTarget as HTMLElement)?.blur() in the onlongpress handler to drop focus when the sheet opens"
key-files:
  created: []
  modified:
    - "src/app.css"
    - "src/routes/(app)/+page.svelte"
    - "src/routes/(app)/library/+page.svelte"
    - "src/routes/(app)/search/+page.svelte"
    - "src/routes/(app)/artist/[name]/+page.svelte"
    - "src/routes/(app)/album/[name]/+page.svelte"
    - "src/lib/components/NowPlaying.svelte"
decisions:
  - "MENU-03 / D-12 stuck-highlight fix lands ENTIRELY at the trigger sites + one global CSS pass; longpress.ts and all onclick handlers untouched (the existing suppressNextClick trailing-click guard and pointercancel/pointerup :active release are the other half and were preserved verbatim)."
  - "Global tap-highlight reset done once in app.css (`button, a, [role=\"button\"]`) per RESEARCH Open Question 2 — fewer edits, more correct than per-element repetition."
  - "Each sticky press rule wrapped in `@media (hover: hover)` with declarations byte-unchanged — only the media-query wrapper added; no visual change on hover-capable (desktop) devices."
  - "Event param named `e` everywhere (never `t` / `track`) to avoid shadowing the i18n `t()` helper or the loop variable on the search page."
metrics:
  duration: "5 min"
  completed: "2026-06-11"
  tasks: 2
  files: 7
---

# Phase 19 Plan 03: Long-Press Release Fix (MENU-03 / D-12) Summary

Removed the stuck `:active`/`:hover`/focus highlight that latched under a held finger after a long-press opened the track menu — fixed with a one-line global `-webkit-tap-highlight-color` reset, an `@media (hover: hover)` guard around every sticky press rule, and a `blur()` on every `onlongpress` handler at all 6 trigger sites. `longpress.ts` (the trailing-click suppression half) was left untouched.

## What Was Built

### Task 1 — Global tap-highlight reset (`src/app.css`)
Added `button, a, [role="button"] { -webkit-tap-highlight-color: transparent; }` next to the existing `button { font-family: inherit; }` rule. This kills the iOS Safari grey tap-highlight flash on every interactive surface in one place (the global half of MENU-03). Commit `28a4a13`.

### Task 2 — Hover-guard + blur at the 6 trigger sites
Two edits per trigger file:

1. **Hover-guard:** every sticky `:hover` / `:active` rule wrapped in `@media (hover: hover) { … }` so touch devices never latch it. Declarations are byte-unchanged — only the media-query wrapper was added.
   - Home (`(app)/+page.svelte`): `.album:active` and `.tile:active` (2 rules).
   - Library / Search / Artist / Album / NowPlaying: `.row:hover` (1 rule each).
2. **blur-on-longpress:** every `onlongpress` handler now accepts the event and calls `(e.currentTarget as HTMLElement)?.blur()` before opening the menu, dropping focus from the trigger when the sheet opens.

| File | onlongpress handlers blurred | hover-guards added |
|------|------------------------------|--------------------|
| `(app)/+page.svelte` | 5 (`.tile` fallback, 3× `.album` tileMenu, `.album` librarySongRow) | 2 (`.album:active`, `.tile:active`) |
| `(app)/library/+page.svelte` | 4 (liked / playlist / downloads / history rows) | 1 (`.row:hover`) |
| `(app)/search/+page.svelte` | 1 (`.row`) | 1 (`.row:hover`) |
| `(app)/artist/[name]/+page.svelte` | 1 (`.row`) | 1 (`.row:hover`) |
| `(app)/album/[name]/+page.svelte` | 1 (`.row`) | 1 (`.row:hover`) |
| `NowPlaying.svelte` | 2 (queue `.row.q-row`, related `.row`) | 1 (`.row:hover`) |
| **Total** | **14** | **7** |

Commit `0056801`.

## How It Fits Together

`longpress.ts` already handles the **trailing-click** half of D-12: when the hold fires, it arms `suppressNextClick` (capture-phase) so the synthetic finger-up `click` is eaten before it reaches the bubble-phase `onclick` that plays/navigates, and its `pointercancel`/`pointerup` `clear()` releases the held `:active`. The missing half was the **stuck visual** — iOS sticky `:hover`, the grey tap-highlight flash, and lingering focus. This plan adds exactly those three guards at the call sites (blur for focus, `@media (hover: hover)` for sticky `:hover`/`:active`, global `-webkit-tap-highlight-color: transparent` for the grey flash), without modifying `longpress.ts` or any `onclick` handler — so the trailing-click guard is preserved, not regressed.

## Deviations from Plan

None — plan executed exactly as written. The plan's line-reference hints (e.g. `.row:hover` at :461) had shifted by a few lines from prior-wave edits, but every targeted construct was located and edited correctly via exact-string matching.

## Verification

- `pnpm check` → `0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (4100 files) — both after Task 1 and after Task 2.
- `pnpm test src/lib/actions/longpress` → 2/2 passed (the `shouldSuppressClickAfterLongpress` trailing-click guard stays green).
- `pnpm test` (full suite) → 626/626 passed across 51 test files.
- `src/lib/actions/longpress.ts` confirmed unmodified (`git status` clean for it).
- All `onclick` handlers confirmed unchanged (only `onlongpress` handlers gained the blur prefix).
- All node/pnpm commands run with the v22.22.0 PATH prefix (default shell node is v16, which breaks the toolchain).

### Device verification (deferred — not node-testable)
The plan's `<human-check>` (RESEARCH A3) requires real-hardware confirmation on **iOS Safari AND Android Chrome** that long-pressing a home tile / a library-search-artist-album row / a NowPlaying queue row opens the menu with NO residual pressed/hover/focus highlight on finger-up, and does NOT also play/navigate. This is a visual contract that cannot be exercised under the repo's node-only Vitest setup — it is tracked for the phase device-pass alongside the MENU-02 marquee re-measure check.

## Known Stubs

None — this is a CSS + event-handler change with no data sources, no placeholders, and no UI components awaiting wiring.

## Self-Check: PASSED

- FOUND: src/app.css (`-webkit-tap-highlight-color: transparent` on `button, a, [role="button"]`)
- FOUND: all 6 trigger files modified (14 blur calls, 7 `@media (hover: hover)` guards)
- FOUND commit 28a4a13 (Task 1 — app.css)
- FOUND commit 0056801 (Task 2 — 6 trigger sites)
- VERIFIED: src/lib/actions/longpress.ts unchanged; onclick handlers unchanged
