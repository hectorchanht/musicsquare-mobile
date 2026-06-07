---
quick_id: 260607-lw9
slug: library-play-default-longer-ttls
date: 2026-06-07
status: complete
commits:
  - 0b5519d
---

# Library Play default icon + longer cache TTLs

## T1 — Library row affordance

Playlists + Downloads rows now render the Play icon in non-edit mode
(matching Liked + History). Edit mode keeps Trash2 + row-click removes.

The inline per-row `.del` bin on Downloads is removed — removal lives
behind the Edit pill like every other bulk-editable tab. Consistent
affordance, no more visual ambiguity ("is the bin going to fire if I tap
this row?").

Verified live: Downloads/Playlists rows show `lucide-play`; inline `.del`
gone; entering Edit mode flips to `lucide-trash-2`.

## T2 — Cache TTLs bumped (data is stable, repeat-hit is the dominant pattern)

| File | Const | Old | New |
|---|---|---|---|
| services/deezer.ts | TTL_COVER | 24h | **7d** |
| services/deezer.ts | TTL_SEARCH | 1h | **6h** |
| services/deezer.ts | TTL_RELATED | 1h | **6h** |
| services/lastfm.ts | TTL_LASTFM | 1h | **6h** |
| services/similar.ts | TTL_SIMILAR | 1h | **6h** |
| services/catalog.ts | SEARCH_TTL_MS | 5min | **60min** |

Rationale: covers are effectively immutable for an existing release;
search rankings shift over days not hours; charts update daily but a
half-day-old chart is invisible to the user; bio/tags/listeners drift
slowly. A music app's catalogue is stable enough that 6h TTL on the
metadata layer + 7d on covers gives instant repeat responses with no
visible staleness, and drops cold-fetch load to near zero within a
typical browsing session. The search page still exposes a fresh load
via the search button.

## Gate

- `pnpm check` 0/0, 415/415 tests.
