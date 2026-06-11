# Phase 23: UX Audit & Homepage/Artist Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 23-ux-audit-homepage-artist-polish
**Areas discussed:** Row swipe-actions, Compact homepage mode, Section grid/chart nav, Feedback + trackless albums

---

## Row swipe-actions

| Option | Description | Selected |
|--------|-------------|----------|
| All vertical lists | Search, library tabs, album tracklist, artist songs; skip horizontal shelves + queue | ✓ |
| Search + library only | Heaviest two surfaces only | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| One action per direction | Right → queue, left → like; full-commit iOS-Mail style, spring back | ✓ |
| Reveal buttons | Gmail-style tappable buttons under row | |
| Both directions = same reveal | Action rail either way | |

| Option | Description | Selected |
|--------|-------------|----------|
| Add to end | TrackMenu addQueue semantics | ✓ |
| Play next | Insert after current | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle | Swipe-left unlikes if already liked; icon reflects state | ✓ |
| Like-only, no-op if liked | | |
| You decide | | |

---

## Compact homepage mode

| Option | Description | Selected |
|--------|-------------|----------|
| Quick-picks pager | 4 stacked compact rows per column, horizontal snap (YT Music) | ✓ |
| 4-row free-scroll grid | No snap | |
| One row of smaller tiles | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-section in /settings/home | Selector per section row; homeDensity stays global default | ✓ |
| Replace homeDensity | | |
| Long-press section title | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Track sections only (Recommended) | | |
| All sections | Artist sections get avatar+name compact list variant | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No ⋮ on artist rows | Track rows: tap=play, ⋮/long-press=menu; artist rows: tap=artist page | ✓ |
| ⋮ = mini artist actions | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| None — all shelf (Recommended) | | |
| Library mirrors compact | | |
| Top Hits compact | | |
| **Other (free text)** | "all compact, update that on config" — ALL sections compact by default, per-section override in settings | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse homeShelfSize, round to ×4 | One knob drives both modes | ✓ |
| Fixed columns for compact | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Snap with next-column peek | scroll-snap, ~90% viewport columns | ✓ |
| Free scroll, no snap | | |
| You decide | | |

---

## Section grid/chart nav

| Option | Description | Selected |
|--------|-------------|----------|
| One dynamic /chart/[id] (Recommended) | | |
| Per-type routes | /charts/tags/[tag], /charts/countries/[country], /charts/top | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Deep list, ~50–100 rows | Longer Last.fm fetch, standard row pattern | ✓ |
| Cover grid | | |
| Same count as homepage | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Straight to that playlist | Playlist shelf arrow opens that playlist's detail in library | ✓ |
| Playlists tab | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Whole title row tappable | Title + chevron one target (YT Music) | ✓ |
| Chevron only | | |
| You decide | | |

---

## Feedback + trackless albums

| Option | Description | Selected |
|--------|-------------|----------|
| Global toast store | One store + layout component; migrate 3 local copies | ✓ |
| Keep local copies | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| In-flight guard | Generalize TrackMenu inFlight Set into shared helper | ✓ |
| Time debounce | | |
| Both | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Commit-tier only | ~15ms tick on swipe commit, like, queue add, long-press menu, swipe-remove | ✓ |
| All action buttons | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy verify + remove (Recommended) | | |
| Verify before render | Skeletons until track counts known; render only non-empty | ✓ |
| Heuristic only | | |
| **Other note** | User: "2 and see if deezer can produce better quality on album data" → verify-before-render + Deezer-as-source research item (nb_tracks native) | ✓ |

---

## Claude's Discretion

- Skeleton audit sweep + exact shapes (locked project rule: match count/size/length)
- A11y mechanics: focus-trap implementation, full icon-button/toggle inventory
- Compact-mode sizing/spacing; swipe threshold basis + reveal visuals
- Toast wording/i18n, stacking; chart-page pagination; top-charts route split
- Album-verification concurrency/caching if Last.fm path kept after Deezer research

## Deferred Ideas

None — discussion stayed within phase scope.
