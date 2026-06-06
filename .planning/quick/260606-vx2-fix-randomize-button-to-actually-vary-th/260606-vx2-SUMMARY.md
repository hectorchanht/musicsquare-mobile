---
phase: quick-260606-vx2
plan: 01
subsystem: home-discovery
tags: [randomize, discovery, lastfm, shuffle, home-page]
requires:
  - "src/lib/services/discovery.ts (mapWithConcurrency, DISCOVERY_TAGS/COUNTRIES)"
  - "src/lib/services/lastfm.ts (getChartTopTracks/getTagTopTracks/getGeoTopTracks)"
  - "/api/lastfm/discovery edge page passthrough (pre-existing, unchanged)"
provides:
  - "shuffle<T>(arr): pure, non-mutating Fisher-Yates full permutation"
  - "pickRandomPage(max): bounded 1-based integer page draw"
  - "Optional page param on the three top-track discovery builders (threaded only when page>1)"
  - "Randomize home button that varies page + shelf order + tile order + topHits/topArtists and overwrites cache"
affects:
  - "src/routes/(app)/+page.svelte (home discovery refresh + Randomize button)"
tech-stack:
  added: []
  patterns:
    - "Reused picks.ts sample() Fisher-Yates pattern (Math.random, no seed, no dependency)"
    - "Param-only-when-needed plumbing (page key added only when page>1) to preserve edge cache key"
key-files:
  created: []
  modified:
    - "src/lib/services/discovery.ts"
    - "src/lib/services/discovery.test.ts"
    - "src/lib/services/lastfm.ts"
    - "src/routes/(app)/+page.svelte"
decisions:
  - "[VX2]: shuffle + pickRandomPage live in discovery.ts (sibling to mapWithConcurrency + its test), mirroring picks.ts sample() — pure, dependency-free, no seeding"
  - "[VX2]: page param threaded ONLY when page>1 so cold/background calls produce the EXACT same request + edge cache key (charts-1h/tags-6h) as before — Randomize is the only caller that varies it"
  - "[VX2]: RANDOM_PAGE_BOUND=5 (small) so a random page still has data on high-traffic Last.fm methods; fan-out WIDTH unchanged (one request per existing shelf, FANOUT_CAP in flight) — no new fan-out (T-vx2-03)"
  - "[VX2]: getChartTopArtists left limit-only (chart.gettopartists varies less usefully by page; artist tiles are reshuffled client-side instead)"
  - "[VX2]: shuffle applied to LOCAL vars before assignment + saveCache so persisted cache and rendered UI carry the identical shuffled arrangement"
metrics:
  duration: ~6 min
  tasks_completed: 2
  tasks_deferred: 1
  files_modified: 4
  completed: 2026-06-06
---

# Phase quick-260606-vx2 Plan 01: Fix Randomize Button to Actually Vary the Discovery Surface — Summary

Made the home 隨機推薦 / Randomize button genuinely vary the discovery surface on every press — a fresh random Last.fm chart/tag/geo page plus shuffled shelf order, within-shelf tile order, and topHits/topArtists order — bypassing the identical cached arrangement and overwriting the cache, via a pure tested `shuffle`/`pickRandomPage` pair and an optional `page` param threaded through the discovery builders only when `page > 1` (so cold/background calls keep the existing request + edge cache key). No edge change, no new dependency, no settings system.

## What Was Built

### Task 1 — Pure variation helpers + page-param plumbing (TDD)
- **`shuffle<T>(arr: T[]): T[]`** in `discovery.ts` — copy-then-Fisher-Yates (identical algorithm to `picks.ts` `sample()` but returns the FULL permutation, no slice). Returns a NEW array, never mutates the input; `[]`→`[]`, `[x]`→`[x]`. Varies tile order and shelf order.
- **`pickRandomPage(max: number): number`** in `discovery.ts` — returns a random INTEGER in `[1, max]` inclusive (Last.fm pages are 1-based). `max<=1` / fractional / zero / negative → always `1`. Never returns `0`, never `> max`, never a fraction. Bounded positive integer (T-vx2-01 mitigation: the value the client sends to `?page=` is never an attacker-controlled string; the edge already `encodeURIComponent`s it).
- **Optional `page = 1` param** added to `getChartTopTracks`, `getTagTopTracks`, `getGeoTopTracks` in `lastfm.ts`. The `page` key is added to the request ONLY when `page > 1`, so a default/cold/background call produces the EXACT same request — and the same edge cache key (charts-1h / tags-6h) — as before. `getChartTopArtists` left limit-only (deliberate). Every builder's never-throws / `[] on failure` posture is intact (`fetchList` unchanged).
- **Tests** (`discovery.test.ts`, `describe('shuffle / pickRandomPage variation helpers (Randomize, VX2)')`): shuffle is a new same-length permutation with the same multiset and no input mutation; `[]`/`[x]` edge cases; `pickRandomPage` is an integer in `[1,max]` across 200 iterations; `pickRandomPage(1)`/`pickRandomPage(0)` always `1`; fractional max is floored.

### Task 2 — Wire Randomize to a varied, cache-bypassing refresh
- `refresh()` gained a 3rd param `randomize = false`. The Randomize button now calls `refresh(true, false, true)` — `background=false` keeps the press non-silent yet leaves the button usable (WR-02: `loading` flips back in `finally`).
- When `randomize`: each chart/tag/geo call draws a fresh `pickRandomPage(RANDOM_PAGE_BOUND=5)`; `topHits`, `topArtists`, each shelf's `tracks`, and the ORDER of `tagShelves`/`countryShelves` are all `shuffle()`d. The shuffle is applied to the LOCAL vars before assignment + `saveCache` so the persisted cache and the rendered UI carry the same arrangement. Randomize never reads `loadCache()`; it always fetches and overwrites the cache.
- Non-randomize (cold start `refresh(!token)`, background `refresh(false, true)`) pass page 1 and do NOT shuffle → identical request + edge cache key + rank order as before.
- Error retry button left as `refresh(true)`. WR-04 `refreshGen` generation guard (both `gen !== refreshGen` early-returns) unchanged. D-06 `buildDiversePicks` `else` fallback branch untouched (it already randomizes via its own `sample()`).

## Tasks

| Task | Name | Type | Status | Commit |
| ---- | ---- | ---- | ------ | ------ |
| 1 (RED) | Failing tests for shuffle + pickRandomPage | test | Done | 19504d4 |
| 1 (GREEN) | Implement helpers + page-param plumbing | feat | Done | b6bae76 |
| 2 | Wire Randomize to varied cache-bypassing refresh | feat | Done | 50c7ccd |
| 3 | Runtime visual verification (consecutive presses differ) | checkpoint:human-verify | **DEFERRED-TO-HUMAN** | n/a |

## Verification

- `npx vitest --run` (via `node_modules/.bin/vitest run`): **332/332 passed** (36 files), including the 6 new shuffle/pickRandomPage cases. (Was 326 before; +6 new.)
- `npx svelte-check --tsconfig ./tsconfig.json`: **0 errors, 0 warnings** (4029 files).
- `npx vite build`: **clean** (adapter-cloudflare, `.svelte-kit/cloudflare`).
- No edge endpoint change (`/api/lastfm/discovery` `page` passthrough was pre-existing at lines 239/249 — confirmed, untouched). No new npm dependency. No settings/config system introduced.

## TDD Gate Compliance

- RED gate present: `19504d4` `test(260606-vx2): add failing tests...` — confirmed failing before implementation (6 fail: `shuffle`/`pickRandomPage` not a function; 13 existing pass).
- GREEN gate present: `b6bae76` `feat(260606-vx2): implement shuffle + pickRandomPage...` — confirmed passing after (19/19 in the file, 332/332 suite).
- No REFACTOR commit needed (implementation was minimal and clean as written).

## Guardrails Preserved

- **WR-02** (button usable / not locked in "Loading…"): Randomize uses `background=false`, so `loading` flips back in the `finally`; the button is only briefly disabled during the fetch.
- **WR-04** (`refreshGen` generation guard): both `gen !== refreshGen` early-returns retained verbatim; a stale background revalidate finishing after a manual Randomize is still discarded.
- **Never-throws builders**: `getChartTopTracks`/`getTagTopTracks`/`getGeoTopTracks` still return `[]` on failure; `fetchList` unchanged; the `Promise.all` still cannot reject.
- **D-06 fallback**: the `buildDiversePicks` `else` branch is byte-for-byte unchanged (its own `sample()` already randomizes the no-key grid; Randomize still reshuffles it because `refresh` always fetches).
- **Edge security (T-vx2-01)**: `pickRandomPage` produces a bounded positive integer; the edge already `encodeURIComponent`s `page` and only appends it — no command construction, allow-list of methods unaffected, key stays server-side (T-vx2-02). No new fan-out width (T-vx2-03 — one request per existing shelf, FANOUT_CAP in flight).

## Scope Boundary Honored

- `DISCOVERY_TAGS` / `DISCOVERY_COUNTRIES` were NOT made user-configurable — the tag/country LISTS remain the fixed constants. Only the shelf ORDER, within-shelf tile order, topHits/topArtists order, and the fetched chart page vary. The upcoming "user-configurable tags/countries + layout reorder/hide" task is left untouched.

## Deviations from Plan

None — plan executed exactly as written. (The plan flagged that the edge already supports `page`; confirmed at `+server.ts` lines 239/249, no edge change made.)

## Deferred — Task 3 (checkpoint:human-verify): DEFERRED-TO-HUMAN

This is a runtime visual check that requires a real `LASTFM_KEY` (the discovery endpoint returns an all-empty list with no key, so no shelves render to randomize) and human visual judgement of "do consecutive presses look different". The executor cannot perform either. All automated verification that does NOT need a key is green (332 tests, svelte-check 0/0, build clean). Exact human steps:

1. Run against a Last.fm key — either:
   - `npm run build` then `LASTFM_KEY=<key> npx wrangler pages dev .svelte-kit/cloudflare`, OR
   - test on https://openmusic.pages.dev (prod has the key).
2. Open the home page; let the discovery shelves load (top hits / top artists / per-tag / per-country).
3. Press 隨機推薦 / Randomize. Confirm the visible tiles AND/OR the order of shelves visibly CHANGE.
4. Press it 3–4 more times — each press should produce a noticeably different surface, not the identical grid.
5. Confirm the Randomize button does NOT get stuck on "Loading…" / stays usable between presses (WR-02).
6. Reload the page — the LAST randomized arrangement should render from cache (saveCache persisted it), then a background revalidate runs without locking the button.
7. (Optional no-key check) With no `LASTFM_KEY`, confirm the home page still shows the `buildDiversePicks` fallback grid and Randomize still reshuffles it (unchanged path).

Resume signal: type "approved" if consecutive Randomize presses visibly vary the home surface and the button stays usable, or describe what still looks identical / broken.

## Known Stubs

None. The changes are pure variation logic (shuffle/page draw) and a refresh-flow wiring; no placeholder/empty-data or "coming soon" stubs were introduced.

## Self-Check: PASSED
