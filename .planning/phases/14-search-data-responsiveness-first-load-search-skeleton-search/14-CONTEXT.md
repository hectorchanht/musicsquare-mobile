# Phase 14: Search & Data Responsiveness - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Source:** User spec captured directly (via /gsd:do → add-phase → plan-phase; no discuss-phase)

<domain>
## Phase Boundary

UX/playback responsiveness polish for the search + data layer (NOT part of the v1.1 Last.fm milestone). Four scoped items only. No new sources, no auth, no now-playing animation (that is Phase 15).
</domain>

<decisions>
## Implementation Decisions

### D-01 — First-load search skeleton
- Show skeleton placeholder rows during the FIRST/initial search fetch, not only during infinite-scroll load-more.
- REUSE the skeleton already shipped in quick task 260606-pic (`src/routes/(app)/search/+page.svelte`, the `search.loadingMore` skeleton rows). Same visual language; do not invent a second skeleton style.
- Skeleton shows while `loading` (initial query) is true and there are no results yet; replaced by real rows when the first batch resolves. Reduce-motion aware (match existing shimmer behavior).

### D-02 — Search state preserved across navigation
- Lift search state out of the page component into a shared Svelte 5 runes store (e.g. `src/lib/stores/searchSession.svelte.ts`): query string, loaded results, current page, `hasMore`, and scroll position.
- Returning to the Search tab after navigating away shows the SAME query (e.g. "jay") and its already-loaded results INSTANTLY with NO refetch. Restore scroll position if feasible.
- A NEW/changed query still resets state and searches fresh (must not break the existing infinite-scroll reset-on-new-query behavior).

### D-03 — Default audio quality 128–160 kbps
- Change the DEFAULT music audio quality tier to 128–160 kbps so audio URLs resolve/stream faster.
- Apply at the per-source bitrate selection points: JOOX `br` tier (currently 4 / lossless), and netease/qq/kuwo bitrate/quality params. Pick the tier each source uses that lands in/near 128–160 kbps.
- This is the DEFAULT only — if a user-facing quality setting exists, default it to this tier; do not remove higher-quality options.

### D-04 — TTL query cache for search + discovery
- Add a TTL-based cache for search and discovery API call results (results change infrequently) → instant repeat responses + fewer proxy calls.
- Key by normalized query + source (+ page where applicable). Reasonable default TTL (e.g. minutes-to-hours; pick per data volatility). In-memory at minimum; persisted cache (localStorage/IDB) is allowed if it fits existing patterns.
- Must integrate with the existing `catalog.ts` / `searchAll` path and the discovery services without breaking dedupe or the cumulative-superset pagination contract.

### Claude's Discretion
- Exact store shape/file name, cache implementation (in-memory Map vs persisted), exact TTL values per method, scroll-restore mechanics, and which concrete bitrate tier per source maps to 128–160 kbps. Research should determine these.
</decisions>

<specifics>
## Specific Ideas

- Example acceptance: search "jay" → results load → navigate to Library → return to Search → "jay" + results shown instantly, no spinner, no network refetch.
- First-load skeleton must appear on the very first query, mirroring the load-more skeleton already in place.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Search UI + pagination (already shipped)
- `src/routes/(app)/search/+page.svelte` — current search page; has loading/loadingMore state, IntersectionObserver sentinel, skeleton rows, infinite-scroll reset-on-new-query (quick task 260606-pic).
- `.planning/quick/260606-pic-search-results-infinite-scroll-when-user/260606-pic-PLAN.md` — the infinite-scroll plan (pagination = cumulative-superset; replace-not-append).

### Search/data services + sources
- `src/lib/services/catalog.ts` — `searchAll(keyword, page)` aggregator + `dedupeBest`.
- `src/lib/sources/netease.ts`, `qq.ts`, `kuwo.ts`, `joox.ts` — per-source search + bitrate/quality params (JOOX `JOOX_BR`/`br`, others' quality args).
- `src/lib/services/discovery.ts`, `picks.ts`, `similar.ts`, `lastfm.ts` — discovery API calls (also benefit from D-04 cache).

### Stores / settings
- `src/lib/stores/` (player.svelte.ts, settings.svelte.ts) — where audio-quality default + any persisted settings live (D-03), and the conventions for a new searchSession store (D-02).
</canonical_refs>

<deferred>
## Deferred Ideas

- Now-playing shared-element expand/collapse animation + blur — that is **Phase 15**, out of scope here.
</deferred>

---

*Phase: 14-search-data-responsiveness*
*Context captured: 2026-06-06 via user spec*
