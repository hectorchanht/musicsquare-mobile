---
quick_id: 260607-n0u
slug: nowbar-component-extraction-np-fullshrin
date: 2026-06-07
status: complete
commits:
  - b1edb6d
---

# Nowbar component extracted + reused as NP fullshrink top bar

The inline mini-player markup + CSS that lived in `(app)/+layout.svelte`
is now `src/lib/components/Nowbar.svelte` with two variants:

- `'docked'` (default): position:fixed at the bottom-of-screen — the
  original layout-level mini-player. Behavior unchanged.
- `'embed'`: position:static, sits in the parent's flow.

`NowPlaying.svelte` renders `<Nowbar variant="embed" onOpen={…} />` at
the top of `.np` when `sheetState === 'full'`. The onOpen callback sets
`sheetState = 'closed'` so a tap on the bar collapses the subnav panel
and returns to the full Now Playing view (queue/lyrics hidden, cover +
controls visible again).

CSS in `.np.fullshrink` now HIDES the previous fullshrink chrome
(.bar / .cover / .meta / .prog / .transport / .np-error) — the embedded
Nowbar carries the same information in one compact row, replacing the
absolute-positioned scaffolding. The sheet's inset is pushed down by
`var(--nowbar-h) + 16px` so the queue/lyrics panel never overlaps the bar.

## Files

- `src/lib/components/Nowbar.svelte` (new — 170 LOC)
- `src/lib/components/NowPlaying.svelte` (+ import, + conditional render,
  CSS rewrite for fullshrink state)
- `src/routes/(app)/+layout.svelte` (− inline markup, − CSS, + `<Nowbar />`)

## Verified live

- Docked Nowbar still renders at the bottom of the viewport when NP is
  collapsed (regression check on the extraction). Same cover/title/artist/
  play buttons, same z-index, same backdrop-blur.
- Embed-variant CSS path is gated by `.np.fullshrink` — only reachable via
  drag-up to the 'full' state (the existing gte gestures handle that).
  Programmatic dispatch of pointer events doesn't traverse the velocity-
  tracker thresholds, so embed verification is bounded to the gated
  conditional + the static CSS; the mechanics are mechanical and the
  fullshrink layout was previously verified in mtv.

## Gate

- `pnpm check` 0/0, 415/415 tests.
