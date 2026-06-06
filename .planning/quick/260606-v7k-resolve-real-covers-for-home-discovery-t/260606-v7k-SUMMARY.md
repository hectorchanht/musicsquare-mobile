---
phase: quick-260606-v7k
plan: 01
subsystem: home-discovery-covers
tags: [covers, itunes, backfill, cache, discovery, svelte5]
requires:
  - searchAll / dedupeBest (CN-source cover path, existing)
  - mapWithConcurrency (capped pool, existing)
  - matchKey (normalized identity, existing)
  - caaReleaseGroupCover (CAA-by-mbid, existing)
provides:
  - itunesSongCover / itunesArtistCover (no-auth Western + artist cover SOURCE)
  - buildItunesSearchUrl / upgradeArtwork (pure URL helpers)
  - artistCoverCacheKey / getCachedArtistCover / setCachedArtistCover (artist-only cache)
  - backfillArtistCovers (capped artist-image pass)
  - iTunes fallback step inside backfillCovers.resolveOne
affects:
  - src/routes/(app)/+page.svelte (tileCover artist branch + scheduleBackfill artist pass)
tech-stack:
  added: [] # NO new npm dependency (constraint honored)
  patterns:
    - "iTunes Search API (no-auth, CORS *) as the Western-catalog + artist fallback cover source"
    - "artist-only cache key ('artist:' + matchKey(name,'')) disjoint from the track key"
    - "AbortSignal.timeout(6000) + AbortSignal.any(caller, timeout) bounding every fetch"
key-files:
  created:
    - src/lib/services/itunes-cover.ts
    - src/lib/services/itunes-cover.test.ts
    - src/lib/services/cover-backfill.test.ts
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-backfill.ts
    - src/routes/(app)/+page.svelte
decisions:
  - "Chose iTunes Search API over Deezer: no key, CORS *, strongest Western catalog, trivial 100->600 token-swap upgrade; Deezer needs object-key artwork selection + weaker text-match on chart titles."
  - "Artist image resolved via entity=album&attribute=artistTerm (musicArtist entity carries NO artwork field) — the standard album-art-as-artist-image proxy."
  - "Artist cache key pinned to 'artist:' + matchKey(name,'') so it can never collide with a {artist,title} track key (pinned in a test)."
metrics:
  duration: ~8m
  completed: 2026-06-06
  tasks_completed: 3
  tasks_deferred: 1 # Task 4 checkpoint:human-verify (runtime visual)
  files_created: 3
  files_modified: 3
  commits: 5
  tests: "326 passed (36 files)"
---

# Phase quick-260606-v7k Plan 01: Resolve Real Covers for Home Discovery Tiles Summary

Western-catalog home TRACK tiles now resolve real album covers via a no-auth iTunes Search fallback after CN-source + CAA both miss, and 熱門歌手 ARTIST tiles now resolve a real image via the same source on a capped, cached, post-paint pass with an artist-only cache key — gradient stays the graceful last resort.

## What Was Built

The prior `rvy` attempt wired the backfill pipeline correctly but did not deliver covers because the cover SOURCE was CN-only (poor Western-catalog coverage) and never touched artist tiles. This plan closes both source gaps without a new endpoint, new dependency, or any secret.

### Task 1 — Pure iTunes cover resolver (`itunes-cover.ts`) [TDD]
- `buildItunesSearchUrl(term, entity, attribute?)` — URLSearchParams-encoded `itunes.apple.com/search` URL (`limit=1`, optional attribute).
- `upgradeArtwork(url)` — defensive `100x100bb` → `600x600bb` token swap (unchanged when token absent; null on empty/whitespace/null/undefined).
- `itunesSongCover(artist, title, signal?)` — `entity=song` for `${artist} ${title}`; returns upgraded `results[0].artworkUrl100` or null.
- `itunesArtistCover(artist, signal?)` — artist image via `entity=album&attribute=artistTerm` top album art (the musicArtist entity has no artwork field — documented in the file header).
- Every fetch bounded by `AbortSignal.timeout(6000)` combined with the caller signal via `AbortSignal.any`; short-circuits to null when the caller signal is already aborted. **Never throws** — any non-ok / empty / malformed-JSON / abort / throw → null.
- 19 unit tests (RED → GREEN), `vi.stubGlobal('fetch', ...)`, no live network.

### Task 2 — Wire iTunes fallback + artist cache key & pass [TDD]
- `cover-cache.ts`: added `artistCoverCacheKey(artist)` = `'artist:' + matchKey(artist, '')` (provably disjoint from the track key — pinned in a test), plus `getCachedArtistCover` / `setCachedArtistCover`. Refactored read/write into shared `readKey` / `writeKey` helpers; artist + track entries coexist in the same flat `openmusic:cover-cache:v1` record.
- `cover-backfill.ts`: `resolveOne` (track) now falls back to `itunesSongCover` when the CN cover misses (null/empty); CN stays the primary cheap step. Added `backfillArtistCovers(names, opts)` mirroring `backfillCovers` (CAP=3 pool, `max` cap, skip-cached, de-dupe, never-throws, signal-aware) resolving via `itunesArtistCover` and caching under the artist key.
- 28 cover-backfill + cover-cache tests (RED → GREEN).

### Task 3 — Home wiring (`+page.svelte`)
- `tileCover`: added a dedicated `artistName?` branch reading `getCachedArtistCover(artistName)` (kept distinct from the `{artist,title}` track branch so the same name never collides). Steps 1–2 (Last.fm image, CAA-by-mbid) unchanged; `void coverVer` reactivity preserved.
- `scheduleBackfill`: now also collects null-image top-artist names and fires `void backfillArtistCovers(artistNames, { onResolved: () => coverVer++, max: 12 })` alongside the existing track `backfillCovers`. Same `coverVer++` trigger → covers (track AND artist) appear progressively.
- Artist tile call site passes `{ image: a.image, mbid: a.mbid, artistName: a.name }`; `{@const}` hoisted to be the immediate child of `{#each}` (Svelte 5 placement rule).
- Covers render as `<img src>` over the gradient with `onerror → hide` (no new CSS `url()`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `{@const}` placement under `<button>` rejected by svelte-check**
- **Found during:** Task 3 (`pnpm check`)
- **Issue:** Svelte 5 requires `{@const}` to be the immediate child of `{#each}` (etc.), not nested inside an element.
- **Fix:** Hoisted `{@const artistCover = ...}` above the `<button>` as the direct `{#each}` child.
- **Files modified:** `src/routes/(app)/+page.svelte`
- **Commit:** 840e9c1

**2. [Rule 3 - Blocking] Test mock `calls[0][0]` typed as empty tuple under svelte-check**
- **Found during:** Task 3 (`pnpm check`)
- **Issue:** `vi.fn(async () => ...)` with no declared params types `mock.calls[0]` as `[]`, so `calls[0][0]` failed type-checking.
- **Fix:** Annotated the fetch mock param `(_url: string)` so the call tuple types cleanly; removed the now-unnecessary `as string` cast.
- **Files modified:** `src/lib/services/itunes-cover.test.ts`
- **Commit:** 840e9c1 (committed with Task 3 since it was surfaced by Task 3's check)

### Note on the plan's `pnpm test -- --run <filter>` verify commands
The project's `test` script is already `vitest --run`, so `pnpm test -- --run <filter>` passes `--run` twice and CAC rejects it. Ran the equivalent `pnpm test <filter>` (filter only) instead. No code impact.

## Threat Model Compliance

| Threat ID | Mitigation applied |
|-----------|--------------------|
| T-v7k-01 (info disclosure) | iTunes is a public no-auth endpoint; query carries only artist/title text. No env var, no secret/key/PII. |
| T-v7k-02 (self-DoS) | iTunes rides the existing CAP=3 `mapWithConcurrency` pool + total `max` cap (24 tracks / 12 artists) + per-call `AbortSignal.timeout(6000)`; skip-already-cached; fired post-paint (void). |
| T-v7k-03 (injection via cover URL) | Resolved URLs consumed ONLY as `<img src>` attributes — never CSS `url()`. No safeImageUrl / host allow-list change (confirmed no new `url()` interpolation added). |
| T-v7k-04 (broken image) | Misses return null → no `<img>` rendered / `onerror → hide` → gradient shows. `resolveOne` / `resolveOneArtist` never throw. |
| T-v7k-SC (dependency tampering) | NO new npm dependency added — plain `fetch` + `URL`. No install task. |

## Verification

- `pnpm test` — **326 passed (36 files)**, including 19 itunes-cover + 28 cover-backfill/cover-cache tests (URL build, 100→600 upgrade, CN-first→iTunes-fallback ordering, artist-key distinctness, never-throws, abort).
- `pnpm check` — **0 errors, 0 warnings**.
- `pnpm build` — production build succeeded (Cloudflare adapter), no compile/runtime errors.

## Task 4 — DEFERRED-TO-HUMAN (checkpoint:human-verify)

Task 4 is a runtime visual confirmation that real covers render on BOTH home track tiles AND artist tiles. This **cannot** be performed by the executor (it requires a human looking at a running browser, and live Last.fm + iTunes responses). All automated verification that is feasible has been run and is green (full test suite, svelte-check, production build). The human must perform the final visual check:

**Steps for the human reviewer:**

1. **Choose a surface that exercises the discovery shelves.** Covers come from the live Last.fm key + live iTunes API.
   - Local `pnpm dev` WITHOUT `LASTFM_KEY` set → the home page shows the `buildDiversePicks` fallback grid (real Tracks that already have covers); the discovery shelves (top hits / tag / country / 熱門歌手) will NOT appear, so the new iTunes paths are not exercised.
   - To exercise the discovery shelves locally, set `LASTFM_KEY` in the env, OR verify on the deployed **openmusic.pages.dev** (which has the prod key). Note which surface you viewed.
2. **Force a cold resolve:** in DevTools console run `localStorage.removeItem('openmusic:cover-cache:v1')`, then reload.
3. **Top hits / tag / country shelf:** confirm Western tracks (Ariana Grande / Olivia Rodrigo / Drake-type chart entries) show a real album cover within a second or two (covers land progressively as the capped backfill resolves) — NOT a flat color gradient. A few genuine misses staying gradient is acceptable; the majority should now have art.
4. **熱門歌手 (top artists) row:** confirm the circle tiles show real artist/album images, not gradients.
5. **No broken-image icons anywhere:** a 404/miss must show the gradient, not a broken `<img>`.
6. **Warm reload (no cache clear):** covers should appear instantly from the cover cache, no re-fetch flicker.
7. **DevTools Network tab:** confirm requests go to `itunes.apple.com/search` only as a fallback (far fewer than one-per-tile, capped ≤3 concurrent), and that no request carries a secret/key.

**Resume signal:** type "approved" once real covers render on both track and artist tiles with no broken images, or describe what is still gradient/broken.

## Known Stubs

None. The artist cache key, the iTunes fallback, and the artist backfill pass are all fully wired to live data; the gradient is the intentional graceful fallback (documented), not a stub.

## Self-Check: PASSED

All created/modified files exist on disk and all five per-task commits are present in git history:

- FOUND: `src/lib/services/itunes-cover.ts`
- FOUND: `src/lib/services/itunes-cover.test.ts`
- FOUND: `src/lib/services/cover-backfill.test.ts`
- FOUND: `src/lib/services/cover-cache.ts`
- FOUND: `src/lib/services/cover-backfill.ts`
- FOUND: `src/routes/(app)/+page.svelte`
- Commits: 987ab85 (test T1), 6c44889 (feat T1), e354ee8 (test T2), cf2b947 (feat T2), 840e9c1 (feat T3) — all FOUND.
