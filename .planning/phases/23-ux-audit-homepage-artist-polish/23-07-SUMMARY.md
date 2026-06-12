---
phase: 23-ux-audit-homepage-artist-polish
plan: 07
subsystem: artist-page-albums
tags: [deezer, proxy, artist-page, trackless-albums, swipe, nb_tracks, art-01]
requires:
  - src/routes/api/deezer/search/+server.ts
  - src/lib/services/deezer.ts
  - src/lib/proxy/http.ts
  - src/lib/actions/swipeAction.ts
  - src/lib/util/haptics.ts
  - src/lib/services/lastfm.ts (getArtistTopAlbums, getAlbumTracklist)
  - src/lib/services/discovery.ts (mapWithConcurrency)
provides:
  - "GET/OPTIONS /api/deezer/artist-albums proxy returning each album's nb_tracks + safe cover (D-19)"
  - "deezerArtistAlbums(name, signal) client fn — never-throws, WR-03 cache posture"
  - "Artist page trackless-album gate (skeleton → only nb_tracks>0 albums) with Last.fm fallback (ART-01/D-18)"
  - "Artist hit-songs rows wired with use:swipeAction (queue/like) + haptics + toast (D-01)"
affects:
  - "src/routes/(app)/artist/[name]/+page.svelte (albums effect + hit-songs row)"
tech-stack:
  added: []
  patterns:
    - "Edge proxy clones /api/deezer/search posture verbatim (own-origin CORS, OPTIONS 204, edge cache keyed by own-origin Request, fetchWithRetry + AbortSignal.timeout, safeImageUrl *.dzcdn.net)"
    - "SSRF guard: user q only an encoded VALUE to the fixed search host; numeric artist id (validated int) interpolated into the fixed artist/{id}/albums path (T-23-16)"
    - "Client fn mirrors deezerSearchTopN: cached() factory rejects on failure (WR-03 — never negative-cached), .catch maps to [] outside"
    - "Verify-before-render: Deezer nb_tracks (zero per-album fetches) → Last.fm fallback + capped (≤4) per-album verification; identical UX"
key-files:
  created:
    - src/routes/api/deezer/artist-albums/+server.ts
  modified:
    - src/lib/services/deezer.ts
    - src/lib/services/deezer.test.ts
    - src/routes/(app)/artist/[name]/+page.svelte
decisions:
  - "D-19 AUGMENT path adopted: new artist-albums proxy returns nb_tracks natively so trackless filtering is free; Last.fm getArtistTopAlbums kept as graceful fallback with capped per-album verification"
  - "Unified { name, image } RenderAlbum shape so the existing album-card nav (keyed on album name) is unchanged across both Deezer and Last.fm paths"
  - "Reused toast keys (toast.addedToQueue / toast.liked / toast.unliked) — no new i18n keys needed (UI-SPEC §9)"
  - "swipeAction stays a pure DOM gesture; the page fires haptics.tick() inside the queue/like commit handlers (PATTERNS §3.3)"
metrics:
  duration: ~15m
  completed: 2026-06-12
  tasks: 3
  files: 4
---

# Phase 23 Plan 07: Trackless-Album Gate + Artist Hit-Songs Swipe Summary

Added the recommended D-19 AUGMENT path for hiding trackless albums on the artist page: a thin
`/api/deezer/artist-albums` edge proxy that returns each album's `nb_tracks` natively, a
never-throwing `deezerArtistAlbums` client fn, and an artist-page gate that skeletons albums then
renders only non-empty ones (Deezer-first, Last.fm + capped verification as the graceful
fallback). Also wired `use:swipeAction` (queue / like-toggle) onto the artist hit-songs rows.

## What Was Built

### Task 1 — `/api/deezer/artist-albums` proxy (D-19, §8.2) — commit `3352d2e`
- `src/routes/api/deezer/artist-albums/+server.ts`: clones the `/api/deezer/search` posture
  VERBATIM — own-origin `corsHeaders(origin)`, `OPTIONS` 204 preflight, `edgeCache()` keyed by
  the own-origin Request, `fetchWithRetry` + native `AbortSignal.timeout(8000)`, and a
  `safeImageUrl` host allow-list (`*.dzcdn.net`). Carries NO secret (Deezer public API).
- Flow: validates/trims `?q=` (empty → empty result, no fetch), resolves the artist id via the
  fixed `api.deezer.com/search/artist` host (q is only an encoded VALUE — T-23-16), validates the
  id as a positive integer, then GETs the fixed `api.deezer.com/artist/{id}/albums?limit=50` path
  and reshapes each album to `{ title, nb_tracks (clamped non-negative int), cover (safeImageUrl) }`.
- Never-throws: any upstream failure / malformed JSON / timeout returns a 200 `{ data: [] }`
  (never a 5xx / upstream-body leak — T-23-18). A genuine no-match / empty list IS cached; a
  thrown failure is NOT (T-23-19, no cache write in the catch).

### Task 2 — `deezerArtistAlbums` client fn (TDD, D-19) — commits `9875750` (RED) + `12d033b` (GREEN)
- `src/lib/services/deezer.ts`: `deezerArtistAlbums(name, signal?): Promise<{ title; nb_tracks;
  cover }[]>` mirroring `deezerSearchTopN` — `cached('dz:artistalbums:${clean}', TTL_ARTIST, …)`
  fetching the own-origin `/api/deezer/artist-albums?q=` with `combinedSignal(signal)`; a non-ok /
  abort / timeout / malformed throw REJECTS inside the factory (WR-03 — never negative-cached) and
  the outer `.catch(() => [])` maps it to the empty sentinel. A successful empty list IS cached.
- `src/lib/services/deezer.test.ts`: 9 new cases (success-reshape with `nb_tracks`, special-char
  encoding, empty-name no-fetch, already-aborted no-fetch, non-ok → [], throw → [], malformed → [],
  successful-empty IS cached, WR-03 failure-not-cached-then-refetch). RED first (9 failing, 31
  passing), then GREEN (all 40 pass).

### Task 3 — Artist page trackless-album gate + hit-songs swipe (ART-01 D-18, §8.1, D-01) — commit `aa47ce4`
- `src/routes/(app)/artist/[name]/+page.svelte`:
  - The race-guarded `albumsFor` effect now does verify-before-render. Path A (preferred):
    `deezerArtistAlbums(n)` → filter to `nb_tracks > 0` and drop stub names (`isStubAlbumName`:
    empty/whitespace + `(null)`/`null`/`undefined`/`unknown album`/`unknown`). Path B (fallback,
    when Deezer returns `[]`): `getArtistTopAlbums(n)` → drop stubs → `mapWithConcurrency(cap 4,
    never-throw)` verifying each album's track count via `getAlbumTracklist(name, artist)`, hiding
    any that resolve to 0/failed. Both paths emit a unified `{ name, image }` `RenderAlbum` so the
    existing album-card nav (keyed on album name) is unchanged.
  - The `albumsLoading` skeleton (4 cards) + `albumsFor === n` race guard are preserved; the
    skeleton stays up until track-counts are known, then only non-empty albums render.
  - Hit-songs `.row` buttons gained `use:swipeAction={{ onSwipeRight: queueTrack, onSwipeLeft:
    likeTrack }}` alongside the existing `use:longpress` + `onclick`. `queueTrack` =
    `player.addToQueue` + `haptics.tick()` + `toast.addedToQueue`; `likeTrack` =
    `library.toggleLike` + `haptics.tick()` + `toast.liked`/`toast.unliked` (reused keys, no new
    i18n).

## Verification
- `pnpm check` exits 0 — 4262 files, 0 errors, 0 warnings (after each of Tasks 1 and 3).
- `pnpm vitest run src/lib/services/deezer.test.ts` — 1 file, 40 tests, all pass.
- Proxy: exports `GET` + `OPTIONS`; OPTIONS returns 204 with `corsHeaders`; reshaped albums carry
  `nb_tracks` + `safeImageUrl` covers; failure path returns 200 empty; fixed `api.deezer.com` host
  with `q` encoded as a value only (T-23-16/17/18/19).
- Hit-songs rows swipe (queue/like) coexisting with tap-to-play + long-press menu (swipeAction
  inherits the Phase 15/20 tap-preserving / vertical-yields invariants verbatim from Plan 02).

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 3 - Blocking] Imported `getAlbumTracklist` from `lastfm.ts` for the fallback verification**
- **Found during:** Task 3 — the plan's `<action>` named `deezerAlbum()` OR `getAlbumTracklist`
  for the fallback per-album count check. `getAlbumTracklist(album, artist)` (lastfm.ts:278) is the
  cleaner never-throws fit (returns a track array whose length is the count) and avoids a second
  Deezer round-trip per album inside the already-capped fan-out.
- **Fix:** Imported and used `getAlbumTracklist` (wrapped in `.catch(() => [])`) inside the
  `mapWithConcurrency` callback.
- **Files modified:** src/routes/(app)/artist/[name]/+page.svelte
- **Commit:** aa47ce4

This is within the plan's explicitly-offered choice ("`deezerAlbum()` ... OR `getAlbumTracklist`"),
not a true deviation — recorded for traceability.

## TDD Gate Compliance
Task 2 (`tdd="true"`) followed RED → GREEN: `test(23-07)` commit `9875750` lands the failing tests
(9 failing, 31 passing), `feat(23-07)` commit `12d033b` lands the implementation (all 40 pass). No
REFACTOR commit needed — the fn matched the established `deezerSearchTopN` shape on first write.

## Known Stubs
None. The proxy, client fn, and artist-page gate are fully implemented and wired. The `nb_tracks`
filter is real (sourced from Deezer natively or verified per-album via Last.fm), not a placeholder.

## Threat Flags
None beyond the plan's `<threat_model>`. The new proxy introduces one network surface
(`/api/deezer/artist-albums`) already enumerated in the register (T-23-16/17/18/19) and mitigated:
fixed `api.deezer.com` host, `q` encoded as a value, numeric-id validation before path
interpolation, `safeImageUrl` on every cover, 200-empty on failure (no upstream leak), and
WR-03 no-negative-cache (tested).

## Self-Check: PASSED
- FOUND: src/routes/api/deezer/artist-albums/+server.ts
- FOUND: src/lib/services/deezer.ts (deezerArtistAlbums exported)
- FOUND: src/lib/services/deezer.test.ts (9 new deezerArtistAlbums cases)
- FOUND: src/routes/(app)/artist/[name]/+page.svelte (deezerArtistAlbums + use:swipeAction)
- FOUND commit: 3352d2e (Task 1)
- FOUND commit: 9875750 (Task 2 RED)
- FOUND commit: 12d033b (Task 2 GREEN)
- FOUND commit: aa47ce4 (Task 3)
