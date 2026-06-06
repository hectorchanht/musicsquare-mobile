# Phase 9: Discovery / Hot-Picks Tab - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 09-discovery-hot-picks-tab
**Areas discussed:** Placement, Discovery shelves, Artist-albums/album-play scope, Existing-picks fate
**Origin:** Routed via /gsd:do from a freeform user request (Last.fm home Top-picks + artist albums → album play).

---

## Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Home Top-picks, replace random (Recommended) | Last.fm shelves on home, replace buildDiversePicks as primary; no new tab | ✓ |
| Both: home shelves + Explore tab | Home shelves AND a dedicated Explore tab | |
| Explore tab only (ROADMAP as-is) | All discovery in a new Explore tab per original goal | |

**User's choice:** Home Top-picks (replace random).
**Notes:** Supersedes the ROADMAP Phase 9 "Explore tab" goal wording — DISCO-04 satisfied on home instead.

---

## Discovery shelves (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Top hits (global charts) | chart.getTopTracks | ✓ |
| Top artists | chart.getTopArtists → artist page | ✓ |
| Genre / mood tag shelves | tag.getTopTracks, one row per curated tag | ✓ |
| Country / region charts | geo.getTopTracks, curated countries | ✓ |

**User's choice:** All four shelves.

---

## Artist albums → album page → play (cross-phase)

| Option | Description | Selected |
|--------|-------------|----------|
| Full flow in Phase 9, reuse searchAll (Recommended) | artist.getTopAlbums + album.getInfo tracklist + tap-to-play via existing searchAll+dedupeBest | ✓ |
| Browse in 9, play in 10 | Real albums/tracklists in 9; tap-to-play in Phase 10 | |
| Defer whole album flow to Phase 10 | Artist/album pages unchanged in 9 | |

**User's choice:** Full flow in Phase 9 (reuse searchAll).
**Notes:** Expands Phase 9 scope; pulls the playable behavior in WITHOUT needing Phase 10's formal lastfm source adapter (uses the existing resolver). Phase 10 likely rescopes — flagged in CONTEXT Deferred.

---

## Existing random-artist Top picks (buildDiversePicks)

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with Last.fm (Recommended) | Drop the random ARTIST_POOL approach | |
| Keep as fallback | Last.fm primary; buildDiversePicks fallback on no-key/error | ✓ |

**User's choice:** Keep as fallback.
**Notes:** Keeps home populated signed-out / when LASTFM_KEY absent or Last.fm errors.

---

## Claude's Discretion

- Read endpoint shape (extend `/api/lastfm/info` allow-list vs new `/api/lastfm/discovery`).
- Curated genre/mood tag set + country set (CN-biased defaults, editable).
- Edge-cache TTLs (charts ~1h, tags ~6h, getTopAlbums/getInfo ~24h) + fan-out concurrency cap 3–5.
- Album tracklist resolution timing (lean lazy/on-tap).
- Shelf order/count, horizontal-scroll row UI (reuse existing patterns + tokens).

## Deferred Ideas

- Phase 10 rescope (formal lastfm source adapter + deferred GD Studio ytmusic) — flag for roadmapper.
- Personal/user-scoped discovery (top artists, history) — needs auth, Phase 11+.
- Full tag drill-down page (beyond shelves) — later.
