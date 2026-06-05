---
quick: 260606-5du
slug: smooth-live-drag-now-playing-panel-grip
status: complete
date: 2026-06-06
---

# Quick Task 260606-5du — Summary

The NowPlaying sub-nav sheet grip now drags **live** instead of only snapping on release. Single-file change (`src/lib/components/NowPlaying.svelte`). Live at openmusic.pages.dev.

## What changed
- The grip drag tracks a live `sheetDragY` (full-coordinate px; 0 = full, `peekOffset` = peek), updated 1:1 on pointermove so the panel slides vertically under the finger.
- While dragging, the sheet uses the full absolute box (`.sheet.dragging` shares `.sheet.full`'s layout) with `transform: translateY(sheetDragY)` and `transition: none`; on release the transition is restored (`transform .28s cubic-bezier(.22,1,.36,1)` — same easing as the full-page close) and it animates to its snapped resting position, then settles into the static layout (`sheetDragging=false`, `sheetDragY=0`) after the animation so there's no jump.
- `peekOffset` is measured at drag start (sheet top relative to the overlay) for correct clamping/threshold. Release commits to the opposite state when dragged past ~25% of travel, else springs back.
- Preserved: tap-to-toggle (<8px move), keyboard Enter/Space toggle, and the separate cover-drag-to-collapse gesture. Reduce-motion still disables transitions globally.

## Verification
- `pnpm check` 0/0; `pnpm build` ok; `pnpm vitest run` 58/58.
- Deployed → https://openmusic.pages.dev (`/` 200). Only NowPlaying.svelte touched; stores/data layer/other components unchanged.
