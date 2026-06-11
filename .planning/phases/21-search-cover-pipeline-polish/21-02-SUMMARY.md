---
phase: 21-search-cover-pipeline-polish
plan: 02
subsystem: cover-pipeline
tags: [covers, cache, lazy-load, intersection-observer, itunes, tdd]
requires:
  - cover-cache.ts (readKey/writeKey, artist: disjoint-prefix precedent)
  - cover-backfill.ts (isSolidCover, tier() never-throw, Deezer→iTunes→CN chain)
  - itunes-cover.ts (upgradeArtwork)
  - sources/types.ts (Track, makeUid COLON form)
provides:
  - "uidCoverCacheKey / getCachedCoverByUid / setCachedCoverByUid (uid: cache family, D-13)"
  - "resolveCoverForTrack(track, signal?) — shared single-item cover resolve helper (Plans 03/04/05 consume)"
  - "lazyCover action (Action<HTMLElement, LazyCoverParam>) + LazyCoverParam type"
  - "iTunes upgradeArtwork now emits 1200x1200bb (D-11)"
affects:
  - src/lib/services/cover-cache.ts
  - src/lib/services/itunes-cover.ts
  - src/lib/services/cover-backfill.ts
  - src/lib/actions/lazyCover.ts
tech-stack:
  added: []
  patterns:
    - "Two-layer cover cache: uid-first then {artist,title} name (D-13); same flat openmusic:cover-cache:v1 store, additive disjoint prefix"
    - "Single shared tier chain (resolveTrackChain) reused by backfillCovers + resolveCoverForTrack — one source of truth for Deezer→iTunes→CN order + https guard"
    - "Classic Action closure-return-{destroy} (mirrors longpress) with IntersectionObserver + Image() probe + module-level in-flight Set de-dupe"
key-files:
  created:
    - src/lib/actions/lazyCover.ts
    - src/lib/actions/lazyCover.test.ts
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/services/itunes-cover.ts
    - src/lib/services/itunes-cover.test.ts
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
decisions:
  - "lazyCover rootMargin chosen: '200px 0px' (prefetch slightly early; tighter than the search sentinel's 400px since covers are cheaper than a page fetch)"
  - "resolveCoverForTrack signature: resolveCoverForTrack(track: Track, signal?: AbortSignal): Promise<string | null> — never throws, writes BOTH cache layers on a SOLID https hit"
  - "Hoisted tier() + resolveTrackChain to module scope so backfillCovers, backfillArtistCovers, and resolveCoverForTrack share the SAME never-throw + https-guard machinery (no duplicated fetch ladder)"
metrics:
  duration: ~12m
  tasks: 3
  files: 8
  completed: 2026-06-11
---

# Phase 21 Plan 02: Lazy-Cover Foundation Summary

Two-layer (uid-first, then name) cover cache, a sharper iTunes 1200px upgrade token, a shared single-item `resolveCoverForTrack` helper that reuses the mature Deezer→iTunes→CN tier chain, and a reusable `lazyCover` Svelte action that resolves covers on scroll-into-view with broken-URL repair and never refetches — all node-tested (TDD).

## What Was Built

### Task 1 — uid cover-cache layer + iTunes 1200px bump (commit 360fd59)
- Added the `uid:` key family to `cover-cache.ts`, mirroring the `artistCoverCacheKey` disjoint-prefix discipline exactly:
  - `uidCoverCacheKey(uid)` → `'uid:' + uid` (raw COLON-delimited `track.uid`, e.g. `uid:netease:12345` — **Pitfall 7**: no hyphen mangling; the same single helper builds the key for both get and set).
  - `getCachedCoverByUid(uid)` → `readKey(...)`; `setCachedCoverByUid(uid, url)` → `writeKey(...)` — reuses the existing private `readKey`/`writeKey` (empty-url no-op + quota try/catch inherited, never re-implemented).
  - D-13 read order documented in a comment: caller reads `getCachedCoverByUid(uid) ?? getCachedCover(artist, title)`; on resolve writes BOTH. Same flat `openmusic:cover-cache:v1` store, no migration (additive disjoint family).
- `itunes-cover.ts`: `upgradeArtwork` now swaps `100x100bb` → `1200x1200bb` (**D-11**, was 600x600bb). Updated `itunes-cover.test.ts` (the `upgradeArtwork`, `itunesSongCover`, and `itunesArtistCover` assertions all now expect 1200x1200bb).

### Task 2 — shared single-item resolve helper (commit 74c5ed0)
- Hoisted the per-tier never-throw `tier()` wrapper and the Deezer→iTunes→CN chain into a module-level `resolveTrackChain(artist, title, signal?)` — the single source of truth for the track-chain order + `isSolidCover` https guard.
- Exported `resolveCoverForTrack(track: Track, signal?): Promise<string | null>` that runs `resolveTrackChain` and, on a SOLID https hit, writes **BOTH** cache layers: `setCachedCoverByUid(track.uid, url)` AND `setCachedCover(track.artist, track.title, url)`. Returns null on a total miss; never throws.
- Refactored `backfillCovers`' `resolveOne` and `backfillArtistCovers` to reuse the hoisted `tier()`/`resolveTrackChain` (removed the duplicated inner ladders). `buildArtwork`/CAP=6/`backfillCovers` semantics intact — all 24 existing + new tests green.

### Task 3 — lazyCover action (commit 08fc7a0)
- `src/lib/actions/lazyCover.ts`: classic `Action<HTMLElement, LazyCoverParam>` (closure-return-`{destroy}`, mirroring `longpress.ts`). `LazyCoverParam = { track: Track; onResolved: (uid, url) => void }`.
  - `IntersectionObserver` with `{ root: null, rootMargin: '200px 0px' }`; on first intersection sets a one-shot `done` flag, `io.unobserve(node)`, and runs a never-throw `resolveCoverForRow`.
  - `resolveCoverForRow`: cache-first read order **uid then name** (D-13); if a hit, fire `onResolved` and return (no network). If `track.cover` is non-empty https, probe with `new Image()` (`typeof Image === 'undefined'` SSR guard) — `onload` keeps it (no chain), `onerror` treats it as broken → repair via the chain (**D-15**). On empty/broken/cache-miss, call the Task-2 `resolveCoverForTrack` helper, de-duped via a module-level in-flight `Set<string>` keyed by uid (**Pitfall 5**).
  - `destroy()` calls `io.disconnect()`. SSR guard returns a no-op `{ update, destroy }` when `IntersectionObserver` is undefined.

## Verification

- `pnpm test -- cover-cache itunes-cover cover-backfill lazyCover` → **76 passed**
- `pnpm check` → **0 errors, 0 warnings**
- Full suite: `pnpm test` → **692 passed (54 files)**

## Deviations from Plan

None — plan executed exactly as written. (One internal-detail correction: a draft lazyCover test comment contradicted its own assertion about cache reads; corrected before commit. Not a behavior deviation.)

## Notes for Downstream Plans

- **Shared helper for Plans 03/04/05:** `resolveCoverForTrack(track: Track, signal?: AbortSignal): Promise<string | null>` exported from `src/lib/services/cover-backfill.ts`. Never throws; on a SOLID https hit it has already written both cache layers, so consumers only need the returned URL.
- **lazyCover rootMargin = `'200px 0px'`** — wire `use:lazyCover={{ track, onResolved }}` on list rows; `onResolved(uid, url)` should update the row's reactive cover state.

## Self-Check: PASSED
