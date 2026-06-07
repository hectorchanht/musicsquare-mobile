---
quick_id: 260607-lni
slug: search-artist-tiles-all-unique-artists-n
date: 2026-06-07
status: complete
commits:
  - b7773bf
---

# Search artist tiles: every unique artist, horizontal scroll

The kyf gate (≥2 tracks AND query contains-or-contained-by artist name,
capped to 3 tiles) was too tight — most queries surfaced 0–2 tiles when
the result set actually carries 20–40 relevant artists. Replaced with:

- One tile per UNIQUE artist that appears in `results`.
- Sort by track count desc, tie-break on first-seen order (mirrors the
  song-list relevance ranking).
- No cap. The row is horizontally scrollable (`use:dragScroll`,
  `flex-wrap:nowrap; overflow-x:auto`, scrollbar hidden).
- Avatar concurrency bumped 3 → 6 so the longer list fills in promptly.
  Both `enrichArtist` and `deezerArtistCover` are already TTL-cached
  client-side, so repeat queries are free.

Verified live (search "love"): 35 tiles for 37 songs (≈1:1 unique-artist
ratio); `scrollWidth: 3768px` vs `clientWidth: 351px` (overflow confirmed,
drag-to-scroll wired); 24/35 tiles show real LF/Deezer avatars within
~12s, rest keep the gradient fallback (no LF/Deezer match for those
names — graceful posture preserved).

Single file. check 0/0, 415/415 tests.
