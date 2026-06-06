---
phase: 09-discovery-hot-picks-tab
plan: 01
subsystem: api
tags: [lastfm, cloudflare-cache-api, edge-proxy, discovery, vitest, sveltekit]

# Dependency graph
requires:
  - phase: 08-last-fm-read-foundation-metadata-enrichment
    provides: "/api/lastfm/info edge proxy (key edge-only, absent-key 200, scoped CORS, fetchWithRetry, no-leak test), services/lastfm.ts enrich* + fetchInfo, placeholder-star image filter"
  - phase: 01-foundation
    provides: "searchAll (catalog.ts), dedupeBest (dedupe.ts), settings.preferredSource, Track contract"
provides:
  - "/api/lastfm/discovery edge endpoint: clean { items } lists for chart.gettoptracks/gettopartists, tag.gettoptracks, geo.gettoptracks, artist.gettopalbums"
  - "Cloudflare Cache API (caches.default) wrapper with per-method Cache-Control: public TTLs (charts 3600s, tags 21600s, topalbums 86400s) — first Cache API usage in the repo"
  - "/api/lastfm/info now surfaces an ordered album tracklist (LastfmInfo.tracks) for album.getinfo (D-05)"
  - "services/lastfm.ts six never-throw discovery builders: getChartTopTracks/getChartTopArtists/getTagTopTracks/getGeoTopTracks/getArtistTopAlbums/getAlbumTracklist + exported DiscoveryTrack/DiscoveryArtist/DiscoveryAlbum types"
  - "services/discovery.ts resolveStub(artist, title) → playable Track via searchAll + dedupeBest, null on miss (the load-bearing stub→Track transform, D-03)"
affects: [09-02-home-shelves, 09-03-artist-top-albums-album-tracklist, phase-10-source-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cloudflare Cache API (caches.default) read-through: own-origin Request cache key (no secret), per-method TTL map, dev-runtime typeof-guard"
    - "Dedicated list-shaped edge route forked from the single-entity getInfo route (decision fork B) — separate { items } contract, per-method TTLs, focused no-leak test"
    - "resolveStub: Last.fm {artist,title} stub → playable Track via the existing searchAll + dedupeBest resolver (resolve-on-tap shim, lazy)"

key-files:
  created:
    - src/routes/api/lastfm/discovery/+server.ts
    - src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts
    - src/lib/services/discovery.ts
    - src/lib/services/discovery.test.ts
  modified:
    - src/routes/api/lastfm/info/+server.ts
    - src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts
    - src/lib/services/lastfm.ts
    - src/lib/services/lastfm.test.ts

key-decisions:
  - "Endpoint fork B: NEW /api/lastfm/discovery owns the LIST methods; /api/lastfm/info stays single-entity and is only extended to surface the album tracklist"
  - "Cache key is the own-origin discovery Request (never the secret-bearing upstream URL) so the LASTFM_KEY never enters the cache (T-09-05)"
  - "Per-method TTLs: charts 3600s, tags 21600s, artist.getTopAlbums 86400s; Cache-Control: public is safe (public key-only data, no user sk)"
  - "geo country param is the ISO 3166-1 NAME (e.g. United States), not the code (US) — documented on getGeoTopTracks"
  - "Narrow caches.default through a minimal local EdgeCache interface (DOM CacheStorage shadows the Cloudflare global and lacks .default)"

patterns-established:
  - "Edge Cache API read-through wrapper (own-origin key, per-method TTL, dev typeof-guard) — reusable for any future cacheable edge proxy"
  - "fetchList helper mirroring fetchInfo for list endpoints (never-throws, {items:[]} on failure)"
  - "resolveStub resolve-on-tap shim for non-Track discovery stubs"

requirements-completed: [DISCO-01, DISCO-04]

# Metrics
duration: 9min
completed: 2026-06-06
---

# Phase 9 Plan 01: Discovery Data Foundation Summary

**A new edge `/api/lastfm/discovery` proxy serving clean `{ items }` chart/tag/geo/top-album lists with Cloudflare Cache API per-method TTLs, an album-tracklist extension to `/api/lastfm/info`, six never-throw client discovery builders, and the load-bearing `resolveStub` that turns a Last.fm `{artist,title}` stub into a playable Track.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-06T07:45:03Z
- **Completed:** 2026-06-06T07:53:53Z
- **Tasks:** 3 (all `tdd="true"` — RED then GREEN per task)
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- New `/api/lastfm/discovery` edge endpoint mirroring the Phase-8 posture verbatim (key edge-only, absent-key 200 `{ items: [] }` with NO upstream fetch, method allow-list, `fetchWithRetry` + 8s timeout, error-29 graceful, scoped CORS, no-leak) — delivers DISCO-01 at the data layer.
- First Cloudflare Cache API usage in the repo: `caches.default` read-through keyed by the own-origin discovery Request (secret never in the cache key), `Cache-Control: public, max-age=<ttl>` per method, dev-runtime `typeof caches` guard — delivers DISCO-04 (edge-cached, signed-out, no rate-limit failures).
- `/api/lastfm/info` extended so `album.getinfo` additionally returns an ordered `{ artist, title }[]` tracklist (the tracks the Phase-8 reshaper dropped), with zero regression to the single-entity 5-field contract (D-05).
- Six never-throw discovery builders in `services/lastfm.ts` + the load-bearing `resolveStub` transform in new `services/discovery.ts` (D-02/D-03), reusing `searchAll` + `dedupeBest` without modifying `catalog.ts`/`dedupe.ts`.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: Edge /api/lastfm/discovery endpoint + Cache API (TDD)** — `f73a427` (test, RED) → `7a8ef10` (feat, GREEN)
2. **Task 2: Extend /api/lastfm/info with album tracklist (TDD)** — `7d2b889` (test, RED) → `7ac44fa` (feat, GREEN)
3. **Task 3: Discovery list builders + resolveStub (TDD)** — `fcb0088` (test, RED) → `ade839d` (feat, GREEN)
4. **Cross-task fix: type-safe caches.default** — `5b7e9fd` (fix)

**Plan metadata:** committed separately with this SUMMARY + STATE/ROADMAP.

## Files Created/Modified
- `src/routes/api/lastfm/discovery/+server.ts` — Edge discovery read proxy (5 LIST methods), `pickImage` placeholder filter, `LastfmList` `{ items }` shape, Cache API wrapper, per-method `TTL` map, scoped CORS + OPTIONS.
- `src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts` — 13 cases: no-leak, non-ASCII passthrough, absent-key (no fetch), allow-list, error-29, malformed JSON, per-method reshapers, placeholder filter, per-method Cache-Control TTLs, `caches.default` hit short-circuit, own-origin cache key, OPTIONS 204.
- `src/routes/api/lastfm/info/+server.ts` — Added optional `LastfmInfo.tracks`, `pickTracks()` (array-or-single quirk), populated only for `album.getinfo`.
- `src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts` — +4 cases (ordered tracklist, one-track single-object, no-tracks→undefined, track.getinfo→undefined); all 9 prior cases unchanged.
- `src/lib/services/lastfm.ts` — `fetchList` helper, six discovery builders, exported `DiscoveryTrack/DiscoveryArtist/DiscoveryAlbum`, `tracks?` added to the client `LastfmInfo` mirror.
- `src/lib/services/lastfm.test.ts` — +10 builder cases (clean lists, param passthrough, `[]` on throw + absent-key empty).
- `src/lib/services/discovery.ts` — `resolveStub(artist, title): Promise<Track | null>`.
- `src/lib/services/discovery.test.ts` — 4 cases (top hit, first-of-many, null on miss, null/never-throws on searchAll throw).

## Decisions Made
- **Endpoint fork B** (planner-resolved, implemented): dedicated `/api/lastfm/discovery` for the list contract; `/api/lastfm/info` extended only for the album tracklist. Keeps the two response contracts and tests separate and enables per-method TTLs.
- **Cache key = own-origin Request**, not the upstream URL, so the `LASTFM_KEY` never lands in `caches.default` (T-09-05).
- **geo country = ISO 3166-1 NAME** (e.g. `United States`), documented on `getGeoTopTracks` per FEATURES.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Type-safe `caches.default` access**
- **Found during:** Final `pnpm check` after Task 3.
- **Issue:** The DOM lib's `CacheStorage` (pulled in by SvelteKit's generated tsconfig) shadows `@cloudflare/workers-types`' global and does NOT declare `default`, so `caches.default` produced 2 `svelte-check` errors (blocking the acceptance `pnpm check` 0-errors criterion).
- **Fix:** Narrowed access through a minimal local `EdgeCache`/`EdgeCacheStorage` interface + an `edgeCache()` helper (preserving the `typeof caches` dev-runtime guard) instead of relying on ambient global resolution. No runtime behavior change; the cache tests were unaffected.
- **Files modified:** `src/routes/api/lastfm/discovery/+server.ts`
- **Verification:** `pnpm check` → 0 errors / 0 warnings; discovery cache tests still green.
- **Committed in:** `5b7e9fd`

**2. [Rule 1 - Bug] Over-strict geo country test assertion**
- **Found during:** Task 3 GREEN run.
- **Issue:** The geo builder test asserted the upstream URL contained `encodeURIComponent('United States')` (`United%20States`), but `URLSearchParams.toString()` form-encodes a space as `+` (`United+States`). Both decode to the same value server-side; the assertion, not the implementation, was wrong.
- **Fix:** Re-asserted via `new URL(...).searchParams.get('country') === 'United States'` so it validates the round-trip regardless of `+`/`%20`.
- **Files modified:** `src/lib/services/lastfm.test.ts`
- **Verification:** `pnpm test lastfm discovery` → all green.
- **Committed in:** `ade839d` (Task 3 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking type error, 1 test-assertion bug)
**Impact on plan:** Both necessary for the acceptance criteria (`pnpm check` clean + accurate tests). No scope creep, no new dependencies, no API/runtime-shape change.

## Issues Encountered
- `pnpm test lastfm discovery` (space-separated) is interpreted by the runner as one filter unless passed as separate argv; invoked as `pnpm test -- lastfm discovery` (two filters) during execution. The final acceptance run used the full `pnpm test` suite.

## User Setup Required
None — no external service configuration required. `LASTFM_KEY` is the same optional Phase-8 edge secret; absent key is a supported 200-empty state (the D-06 home fallback trigger). No new env vars.

## Next Phase Readiness
- **Plan 02 (home shelves)** can consume `getChartTopTracks/getChartTopArtists/getTagTopTracks/getGeoTopTracks` + `resolveStub` directly; the concurrency cap for the home fan-out belongs in the Plan-02 builder (not here, per the plan).
- **Plan 03 (artist top-albums + album tracklist)** can consume `getArtistTopAlbums` + `getAlbumTracklist` + `resolveStub`.
- No blockers. `+layout.svelte` untouched. No new dependency added.

## Threat Flags
None — all new surface (the discovery endpoint + Cache API) is covered by the plan's `<threat_model>` (T-09-01..T-09-06): key edge-only/no-leak tested, absent-key no-fetch tested, allow-list + encoded passthrough, error-29 graceful, own-origin (secret-free) cache key, scoped CORS.

## Known Stubs
None — no placeholder/hardcoded-empty data was introduced. `[]`/`null` returns are the intentional never-throw graceful states (absent-key / miss / failure), each covered by a test.

## Self-Check: PASSED

- All 4 created files present on disk (discovery `+server.ts` + test, `discovery.ts` + test).
- All 7 task commits present in git history (3 RED test, 3 GREEN feat, 1 fix).
- `pnpm check`: 0 errors / 0 warnings. `pnpm test`: 19 files / 159 tests passing.

---
*Phase: 09-discovery-hot-picks-tab*
*Completed: 2026-06-06*
