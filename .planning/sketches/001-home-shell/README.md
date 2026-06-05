---
sketch: 001
name: home-shell
question: "What does the mobile home shell feel like — top nav + search, 3×3 song grid, bottom now-playing bar, bottom tab nav?"
winner: null
tags: [layout, home, shell, mobile, now-playing, phase-4]
---

# Sketch 001: Home Shell

## Design Question
What does the MusicSquare Mobile home screen feel like? Fixed top nav with a search affordance, a center 3×3 grid of 9 "top random songs", a persistent now-playing bar, and bottom tab navigation — three visual languages compared.

## How to View
`open .planning/sketches/001-home-shell/index.html`
(Tap any tile → it loads into the bottom now-playing bar. Tap 🔍 → search overlay. Bottom tabs + mood chips are live.)

## Variants
- **A: YT-Music faithful** — mood chips row, red accent, cover-art tiles with title overlaid on a gradient scrim, search as a top-nav icon. Closest to the reference screenshot.
- **B: Spotify-esque** — "Good evening" greeting, no chips, green accent, titles *below* the tiles, a thin progress sliver under the now-playing bar.
- **C: MusicSquare-branded** — own violet identity, a full-width search *pill* in the nav, source badges featured on every tile (multi-source aggregation = the differentiator), glassy blurred now-playing bar, subtle top gradient.

## What to Look For
- **Tile labels:** overlaid-on-art (A/C) vs below-tile (B) — which reads better at 3-across on a phone?
- **Source badges:** all 3 show NetEase/QQ/Kuwo/JOOX per tile — is that signal worth the visual noise, or too busy? (C leans into it.)
- **Search:** top-nav icon (A/B) vs full search pill (C).
- **Now-playing bar:** plain (A) vs progress sliver (B) vs glass/blur (C).
- **Accent + overall vibe:** red / green / violet.
- Grounding: the 9 songs use the real Phase 1 `Track` fields (title, artist, source, qualityLabel) and the 4 real sources.
