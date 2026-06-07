---
gsd_debug_version: 1.0
slug: search-skeleton-not-showing
status: resolved
trigger: "no skeleton indicate searching for first row nor when auto search at the end of list"
created: 2026-06-06T13:30:00Z
updated: 2026-06-06T14:30:00Z
---

# Debug Session: search-skeleton-not-showing

## Symptoms

- **Expected behavior:**
  - On the Search page, a shimmer SKELETON should appear while a search is in flight:
    1. **First-row / initial search** — skeleton rows show while the first batch of results is loading (D-01).
    2. **Auto-search at end of list** — when infinite-scroll triggers the next page (load-more), a skeleton should show while that batch loads.
- **Actual behavior:**
  - NO skeleton appears in either case — neither on the first/initial search, nor during the auto load-more at the bottom of the list. Results just appear (or not) with no loading indicator.
- **Error messages:** none reported (visual/timing).
- **Timeline:** Phase 14 just shipped D-01 (first-load skeleton) + D-06 (progressive streaming) + D-04 (TTL cache). Skeleton was human-approved at the verify checkpoint, but the user now reports it not showing in practice.
- **Reproduction:** Search page → type a query + submit → observe (no first-load skeleton). Scroll to bottom of a result list to trigger auto load-more → observe (no load-more skeleton).

## Likely Location

- `src/routes/(app)/search/+page.svelte`:
  - First-load gate: `{#if loading && results.length === 0}` (~line 244) renders `skeletonRows(6, ...)`.
  - Load-more gate: `{#if loadingMore}` (~line 265) renders `skeletonRows(4, ...)` inside the results-list branch.
  - `run()` sets `results = []` then `loading = true`, then `await searchAll(kw, 1, {}, sig, onPartial)`; `onPartial` sets `results = dedupeBest(partial.interleaved, ...)` on the FIRST source settle.
  - `loadMore()` sets `loadingMore = true` then `await searchAll(kw, next, ...)`.
- `src/lib/services/catalog.ts` — D-04 TTL cache wraps `searchAll`; D-06 `onPartial` emits per-source. A cache HIT resolves ~synchronously and fires `onPartial` once.

## Hypothesis Seed

The loading WINDOW likely collapses below one paint frame (CONFIRMED — see Evidence).

## Current Focus

- hypothesis: CONFIRMED — skeleton loading window collapses below one paint frame on cache-HIT / fast-settle.
- test: microtask-vs-macrotask ordering probes of the cache-HIT and cache-MISS paths.
- expecting: HIT → 0 paint windows while gate true (never visible); MISS → many paint windows (visible).
- next_action: (resolved — fix applied + verified)
- reasoning_checkpoint: a Svelte 5 `$state` mutation flushes to the DOM within a microtask checkpoint, but the browser only PAINTS on a macrotask/animation-frame boundary; a gate true only across microtasks never reaches the screen.

## Evidence

- timestamp: 2026-06-06T14:05:00Z
  observation: Static read of `+page.svelte` + `catalog.ts` + `ttl-cache.ts`. `run()` sets `results=[]; loading=true` synchronously, then `await searchAll(...)`. `ttl-cache.cached()` returns `Promise.resolve(hit.value)` on a HIT; `searchAll` then fires `onPartial` once (`pending:0`) which sets `results` to non-empty. So on a HIT, `results` is repopulated in the microtask immediately after the await.
- timestamp: 2026-06-06T14:12:00Z
  observation: Ran a node ordering probe (`/tmp/timing-probe.mjs`) mirroring `run()` over a `Promise.resolve()` cache HIT. Result: gate `loading && results.length===0` was true after the synchronous set, but ZERO macrotasks (paint opportunities) ran before `onPartial` flipped it false. => skeleton DOM created + destroyed inside one frame, never painted.
- timestamp: 2026-06-06T14:16:00Z
  observation: Ran a cache-MISS probe (`/tmp/timing-probe2.mjs`) with 60ms/120ms source RTTs. Result: ~52 paint windows while the gate was true => skeleton DOES show on a genuine slow search. Matches the user's note that a slow miss should show it; the user hit fast/cached paths.
- timestamp: 2026-06-06T14:20:00Z
  observation: Load-more has the identical defect — `loadingMore=true; await searchAll(...)` flips `loadingMore` false in the next microtask on a HIT, so `{#if loadingMore}` never paints.
- timestamp: 2026-06-06T14:26:00Z
  observation: Post-fix verification (`/tmp/verify-fix.mjs`): CACHE-HIT now yields 62 paint windows (was 0), total floored at 280ms; SLOW-MISS yields 133 paint windows, total = 600ms RTT with ZERO added delay (floor absorbed by the real wait). svelte-check: 0 errors/0 warnings. 23 related unit tests pass. Dev server `/search` returns 200.

## Eliminated

- "Load-more skeleton in an unreachable/off-screen render branch" — ELIMINATED: the `{#if loadingMore}` branch is correctly inside the results-list `{:else}` and renders above the sentinel; it just collapses below a paint frame, same root cause as first-load.
- "`someFailed` / empty-state branch masks the skeleton" — ELIMINATED: branch order is fine; the empty-state `{:else if searched && !loading && results.length === 0}` only fires after loading clears.
- "Skeleton never shows at all (CSS/markup broken)" — ELIMINATED: a genuinely slow (cache-miss, throttled) search DOES paint the skeleton; the markup/CSS are correct.

## Resolution

- root_cause: The skeleton's loading window collapses below one browser paint frame on the D-04 cache-HIT / fast-settle path. After `run()` synchronously sets `results=[]; loading=true`, `await searchAll(...)` resolves a cached value via `Promise.resolve()`, whose continuation fires `onPartial` — repopulating `results` — in the very next MICROTASK. Svelte 5 flushes `$state`→DOM within a microtask checkpoint, but the browser only PAINTS on a macrotask/animation-frame boundary, and zero macrotasks occur while `loading && results.length===0` holds. The skeleton DOM is created and torn down within a single frame and is never visible. The load-more skeleton (`{#if loadingMore}`) has the identical microtask-collapse defect. (A genuinely slow cache-miss search has real RTT macrotasks, so it DID show the skeleton.)
- fix: Decoupled the skeleton visibility from the raw `loading`/`loadingMore` flags and gave each a minimum on-screen DWELL so it always survives ≥1 paint frame. Added `SKELETON_MIN_MS = 280`, a `minDwell(startedAt)` helper, and two dwell-floored `$state` flags `showFirstSkeleton` / `showMoreSkeleton`. `run()` raises `showFirstSkeleton` at start and, in `finally`, `await minDwell(startedAt)` before clearing it (guarded by `myAc === ac` so a superseding query's skeleton isn't hidden). `loadMore()` mirrors this with `showMoreSkeleton` (guarded by `myMoreAc === moreAc`). The template now gates the first-load skeleton on `{#if showFirstSkeleton}` and the load-more skeleton on `{#if showMoreSkeleton}`. D-04 caching and D-06 progressive streaming are untouched — `onPartial` still fills `results` as sources settle; a slow search exceeds the 280ms floor so it gets ZERO added delay, while a near-instant cache hit now flashes the skeleton for ~280ms.
- verification: node timing probes confirm CACHE-HIT goes from 0 → 62 skeleton paint-windows and SLOW-MISS keeps its 133 windows with no added latency (total = real RTT). `svelte-check` clean (0 errors/0 warnings). 23 related unit tests pass (catalog fan-out + searchSession + searchHistory). Dev server serves `/search` (HTTP 200). Manual browser confirmation recommended with DevTools network throttling (fresh vs cached query) to visually confirm the shimmer.
- files_changed: src/routes/(app)/search/+page.svelte
