---
quick_id: 260607-mtv
slug: np-fullshrink-mini-bar-above-open-sheet
date: 2026-06-07
status: complete
commits:
  - b9ff702
---

# NP fullshrink mini-bar visible above the open sheet

ju0 P4 added the fullshrink layout (cover + title + artist + mini-play
collapse into a YT-Music-style horizontal mini-bar at the top when
sheetState==='full'), but the layout was invisible in practice:
`.sheet.full { inset: 0; z-index: 5 }` painted the entire viewport
including the area the absolute-positioned mini-bar (z:2-3) was supposed
to occupy.

One-line fix: in `.np.fullshrink`, override the sheet's `inset` to
`64px 0 0 0` so the sheet starts BELOW the mini-bar (the 64px matches
the existing `padding-top: 64px` already reserved). Mini-bar paints
above; sheet renders the queue/lyrics panel underneath; no z-fight
because they're spatially separated.

Verified (preview eval, forcing `.fullshrink` + `.sheet.full` to bypass
the drag-up gesture):

- sheet computed `top: 64px` (was 0px)
- cover `48×48` at `left:64 top:6`
- meta at `left:120 top:8`
- bar (collapse + mini-play row) at `top:4`

Matches the YouTube Music sticky-bar shape in the user's reference image.

check 0/0, 415/415 tests.
