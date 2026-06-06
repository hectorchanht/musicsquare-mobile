---
phase: quick-260606-pic
plan: 01
subsystem: search
tags: [search, infinite-scroll, pagination, intersection-observer, skeleton, i18n]
requires:
  - "src/lib/services/catalog.ts searchAll(keyword, page, prefs?, signal?)"
  - "src/lib/services/dedupe.ts dedupeBest(tracks, preferred)"
provides:
  - "Infinite-scroll search results via IntersectionObserver sentinel + skeleton loading state"
  - "search.loadingMore i18n key (en / zh-Hant / zh-Hans)"
affects:
  - "src/routes/(app)/search/+page.svelte"
tech-stack:
  added: []
  patterns:
    - "IntersectionObserver (root:null viewport, rootMargin prefetch) sentinel inside a Svelte 5 $effect, torn down on cleanup + onDestroy"
    - "Cumulative-superset paging: dedupeBest(searchAll(kw, page+1)) REPLACES results (never concatenates) keyed by stable uid"
    - "Skeleton shimmer gated behind prefers-reduced-motion"
key-files:
  created: []
  modified:
    - "src/routes/(app)/search/+page.svelte"
    - "src/lib/i18n/en.ts"
    - "src/lib/i18n/zh-Hant.ts"
    - "src/lib/i18n/zh-Hans.ts"
decisions:
  - "REPLACE results with the full deduped superset on each page (never concatenate) because each source paginates by limit-multiplication, so searchAll(kw,N) is a cumulative superset of searchAll(kw,N-1)."
  - "hasMore detection by length comparison (no count field from upstream): newResults.length <= prevLength => exhausted."
  - "Separate moreAc AbortController for load-more so it never collides with the initial-search ac; new search aborts both."
metrics:
  duration: 4 min
  completed: 2026-06-06
  tasks: 2
  files: 4
---

# Phase quick-260606-pic Plan 01: Search Results Infinite Scroll Summary

Infinite scroll on the search results page — scrolling toward the bottom auto-fetches the next cross-source batch (via `searchAll` page-increment + `dedupeBest`-replace), with reduce-motion-aware skeleton placeholder rows as the in-flight loading state, guarded against concurrent fetches, end-of-results overrun, and observer leaks.

## What Was Built

**Task 1 (commit `dd3f20f`)** — Pagination state + `loadMore()` in the search page `<script>`:
- New `$state`: `page` (last loaded page), `loadingMore` (next-batch in-flight, distinct from initial `loading`), `hasMore` (another batch may yield net-new tracks). Separate `moreAc: AbortController` for load-more so it never collides with the initial-search `ac`.
- `run()` now aborts any in-flight load-more (`moreAc?.abort()`) at the top, and on success resets pagination (`page = 1`, `hasMore = results.length > 0`); the empty/catch path sets `hasMore = false`.
- `async loadMore()`: guards (`loadingMore || loading || !hasMore || !searched` or empty `q`) prevent double-fetch, firing during the initial search, firing past the end, and firing before any search. Captures `kw` before awaiting (race guard); aborts+recreates `moreAc`; on resolve `dedupeBest`s the cumulative superset and **REPLACES** `results` (never concatenates — keyed by stable `uid` so Svelte reuses existing rows). `merged.length <= results.length` => `hasMore = false` (sources exhausted). AbortError is swallowed; any other error sets `hasMore = false` to stop hammering a failing source.
- `onDestroy(() => io?.disconnect())` as the unmount safety net.

**Task 2 (commit `679dc7a`)** — IntersectionObserver sentinel, skeleton rows, i18n:
- `hasMore`-gated sentinel `<li class="sentinel" bind:this={sentinelEl}>` at the end of the results `<ul>`.
- `$effect` creates an `IntersectionObserver({ root: null, rootMargin: '400px 0px' })` when the sentinel mounts, calls `loadMore()` on intersect, and disconnects on effect-cleanup before re-observing (so a new search / `hasMore` toggle never leaves a stale observer). `root: null` = viewport because the WINDOW scrolls (the `.content` layout wrapper has no overflow/fixed height).
- Skeleton loading state: while `loadingMore`, 4 placeholder rows (`.row.skel`) render after the real rows, mirroring the existing `.art` + stacked `.bar` (title/artist) sizing. Shimmer keyframes are gated behind `@media (prefers-reduced-motion: reduce)`. A visually-hidden (`.vh`) `t('search.loadingMore')` cue + `aria-label` on the skeleton container serves screen readers.
- Added `search.loadingMore` to all three dicts: en `Loading more…`, zh-Hant `載入更多…`, zh-Hans `加载更多…`.

## Verification

- `pnpm check`: clean — `0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `pnpm test`: 23 files / **201 passed** (i18n key-parity test passes — all three dicts carry `search.loadingMore`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's `pnpm check` could not pass in isolation due to the deliberate task split.**
- **Found during:** Task 1 verify.
- **Issue:** The plan declares `let io: IntersectionObserver | null = null` in Task 1 but defers the only *assignment* (`io = new IntersectionObserver(...)`) to Task 2. With no write anywhere in Task 1, svelte-check's control-flow analysis narrowed `io` to `never`, so `io?.disconnect()` reported `Property 'disconnect' does not exist on type 'never'`. This is intrinsic to the planned split, not a logic bug.
- **Fix:** Committed Task 1's logic as-is (state + `loadMore()` + `onDestroy` are complete and correct); the `io` assignment in the Task 2 `$effect` widens the type and resolves the narrowing. Final `pnpm check` after Task 2 is fully clean. No code workaround/hack was left in place.
- **Files modified:** none beyond the planned files.
- **Commit:** resolved by `679dc7a` (Task 2).

## Surgical Staging Note (per execution constraint)

The working tree carried THREE pre-existing uncommitted changes that were NOT part of this task and were left untouched:
- `src/lib/components/NowPlaying.svelte` (unrelated lyrics fix) — never staged/committed/reverted.
- `.planning/HANDOFF.json` — left as-is.
- `home.searchPill` / `search.placeholder` string edits in `en.ts` and `zh-Hant.ts` — pre-existing, unrelated.

Because `en.ts` and `zh-Hant.ts` each contained both a pre-existing edit AND my new `search.loadingMore` key, I staged **only** my `search.loadingMore` hunks via a targeted `git apply --cached` patch, verified the staged diff excluded the pre-existing hunks, then committed. `zh-Hans.ts` (only my hunk) and the search page were staged directly. No `git add -A` / `git add .` was ever used.

## Known Stubs

None. The skeleton rows are an intentional, time-bounded loading state (rendered only while `loadingMore` is true), not a data stub.

## Human Verification Required (Task 3 — blocking checkpoint, NOT auto-approved)

The plan ends with a `checkpoint:human-verify gate="blocking"` for scroll/skeleton behavior. The two auto tasks and static verifies are complete; the runtime behavior below needs a human on a real/emulated mobile viewport:

1. `pnpm dev`, phone-sized viewport, Search tab, broad term (e.g. `周杰伦` or `love`).
2. Scroll to bottom: skeletons appear briefly, then more real tracks load and replace them; list grows, no duplicate rows.
3. Keep scrolling: loading eventually STOPS once sources are exhausted (no endless skeleton flashing).
4. Spam-scroll the bottom: only ONE batch loads per trigger (Network tab: no overlapping `/api/*/search` bursts).
5. New search while results show: list resets to page 1, infinite scroll still works (no leftover old-query rows).
6. Navigate away to Home mid-scroll: no console errors about setting state after unmount.
7. (Optional) reduce-motion on: skeleton shimmer disabled.

## Self-Check: PASSED

- `src/routes/(app)/search/+page.svelte` — FOUND, contains `IntersectionObserver`.
- `src/lib/i18n/en.ts` — FOUND, contains `search.loadingMore`.
- `src/lib/i18n/zh-Hant.ts` / `src/lib/i18n/zh-Hans.ts` — FOUND, contain `search.loadingMore`.
- Commit `dd3f20f` (Task 1) — FOUND in git log.
- Commit `679dc7a` (Task 2) — FOUND in git log.
</content>
</invoke>
