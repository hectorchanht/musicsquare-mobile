# Phase 14: Search & Data Responsiveness - Research

**Researched:** 2026-06-06
**Domain:** Svelte 5 runes state stores, in-memory TTL caching, per-source audio-quality selection, search UX
**Confidence:** HIGH (all findings verified against the actual codebase; no external package decisions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — First-load search skeleton.** Show the skeleton placeholder rows during the FIRST/initial search fetch, not only during infinite-scroll load-more. REUSE the skeleton already shipped in quick task 260606-pic (`src/routes/(app)/search/+page.svelte`, the `search.loadingMore` skeleton rows). Same visual language; do not invent a second skeleton style. Skeleton shows while `loading` (initial query) is true and there are no results yet; replaced by real rows when the first batch resolves. Reduce-motion aware (match existing shimmer behavior).
- **D-02 — Search state preserved across navigation.** Lift search state out of the page component into a shared Svelte 5 runes store (e.g. `src/lib/stores/searchSession.svelte.ts`): query string, loaded results, current page, `hasMore`, and scroll position. Returning to the Search tab after navigating away shows the SAME query and its already-loaded results INSTANTLY with NO refetch. Restore scroll position if feasible. A NEW/changed query still resets state and searches fresh (must not break the existing infinite-scroll reset-on-new-query behavior).
- **D-03 — Default audio quality 128–160 kbps.** Change the DEFAULT music audio quality tier to 128–160 kbps so audio URLs resolve/stream faster. Apply at the per-source bitrate selection points: JOOX `br` tier (currently 4 / lossless), and netease/qq/kuwo bitrate/quality params. Pick the tier each source uses that lands in/near 128–160 kbps. This is the DEFAULT only — if a user-facing quality setting exists, default it to this tier; do not remove higher-quality options.
- **D-04 — TTL query cache for search + discovery.** Add a TTL-based cache for search and discovery API call results → instant repeat responses + fewer proxy calls. Key by normalized query + source (+ page where applicable). Reasonable default TTL. In-memory at minimum; persisted cache allowed if it fits existing patterns. Must integrate with the existing `catalog.ts` / `searchAll` path and the discovery services without breaking dedupe or the cumulative-superset pagination contract.

### Claude's Discretion
- Exact store shape/file name, cache implementation (in-memory Map vs persisted), exact TTL values per method, scroll-restore mechanics, and which concrete bitrate tier per source maps to 128–160 kbps. Research should determine these.

### Deferred Ideas (OUT OF SCOPE)
- Now-playing shared-element expand/collapse animation + blur — that is **Phase 15**, out of scope here.
</user_constraints>

## Summary

All four items are pure client-side / data-layer changes within the established SvelteKit + Svelte 5 runes architecture. There are **zero new dependencies** — the project's stated preference for vanilla runes is the correct and sufficient tool for every item.

The single most important finding is for **D-03**: the bitrate/`br` parameters described in CONTEXT are **not actually the levers that control playback quality in the current code**. Each source picks its audio URL via a client-side *quality ladder* (`pickBestPlayUrl` for QQ, `pickJooxPlayUrl` for JOOX, `level=zp` for Kuwo, and "whatever Meting returns" for Netease) — every ladder is hard-coded to prefer the *highest* tier. The JOOX `br=4` proxy constant only selects *which tier set* the upstream returns; the client still picks Atmos/lossless off the top. There is **already a `defaultQuality` setting** (`'auto' | 'lossless' | '320' | '128'`) with a UI segmented control on `/settings/playback`, but it is **completely unwired** — nothing reads it. So D-03 is really two coupled tasks: (1) make the quality ladders honor a quality preference, and (2) default that preference to the 128k tier. This is more surgical than "flip `br` to a different number" and the planner must scope it as a per-source ladder change, not a constant edit.

For **D-02** and **D-04**, the codebase already has three exemplary patterns to mirror: module-level runes-class singletons exported once (`player`, `settings`, `overlays`, `names`, `history`), all SSR-guarded with `browser` / `typeof window` checks, and a working in-memory-Map-with-TTL cache **already implemented on the edge** in `/api/lastfm/discovery/+server.ts` (Cloudflare Cache API, per-method TTLs). The D-04 cache should be a *client-side* in-memory `Map` wrapping `searchAll` (the single seam every search + discovery + picks + similar path funnels through), with awareness that the discovery list endpoints are *already* edge-cached so the client cache there is a latency win, not a rate-limit necessity.

**Primary recommendation:** Build a `searchSession` runes-class singleton (mirror `overlays.svelte.ts`) for D-02; wrap `searchAll` in catalog.ts with a small TTL Map cache for D-04; wire the existing `settings.defaultQuality` into each source's quality ladder and default it to `'128'` for D-03; add `loading && results.length === 0` to the existing skeleton's `{#if}` guard for D-01.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| First-load skeleton (D-01) | Browser / Client (Svelte component) | — | Pure render-state toggle in `+page.svelte`; no data or server involvement |
| Cross-route search state (D-02) | Browser / Client (runes store) | — | Module-level reactive state, client-only; SSR must NOT share it across requests |
| Default audio quality (D-03) | Browser / Client (source adapters) | API/Proxy (JOOX `br` only) | Quality ladder selection is client-side per-source logic; only JOOX's tier-set selector lives in the proxy |
| TTL query cache (D-04) | Browser / Client (catalog service) | CDN/edge (discovery already edge-cached) | Client in-memory Map at the `searchAll` seam; the discovery LIST endpoint already has its own edge cache layer |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte (runes) | 5.56.2 `[VERIFIED: package.json]` | `$state` reactive stores for D-02 + D-04 | Already the project's exclusive state tool (player/settings/overlays/names/history all use it) |
| SvelteKit | 2.63.0 `[VERIFIED: package.json]` | App framework, `$app/environment` browser guard | Established |
| `@sveltejs/adapter-cloudflare` | 7.2.8 `[VERIFIED: package.json]` | Cloudflare Pages/Workers SSR target | Established deployment target |
| Vitest | ^4.1.3 `[VERIFIED: package.json]` | Test runner (node project, single config) | Established; 201 passing tests |

### Supporting
**No new packages required.** The TTL cache (D-04) is a ~30-line in-memory `Map` helper. The store (D-02) is a runes class. The skeleton (D-01) is an `{#if}` change. The quality wiring (D-03) is per-source ladder logic. All vanilla, matching the CONTEXT "no extra libs preferred" constraint.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map TTL cache | `lru-cache` / `@tanstack/query` | Overkill; adds a dependency for ~30 lines of logic. The project deliberately hand-rolls small caches (see `names.svelte.ts` cache, edge discovery cache). REJECT. |
| Module-level runes singleton | SvelteKit `load` + `depends`/`invalidate` | Heavier; doesn't preserve scroll/page state as cleanly; fights the existing all-client store pattern. REJECT. |
| Persisting search state to localStorage | sessionStorage / in-memory only | CONTEXT says in-memory is the floor; cross-route (not cross-session) is the requirement. In-memory module state survives nav within a session and is the simplest correct choice. Persisted is allowed but unnecessary. |

**Installation:** None. `npm`/`pnpm install` not invoked this phase.

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages**. All four items are implemented with the already-present Svelte 5 / SvelteKit toolchain. slopcheck / registry verification skipped (nothing to verify).

## Architecture Patterns

### System Architecture Diagram

```
                         D-02: searchSession store (client-only runes singleton)
                         ┌──────────────────────────────────────────────┐
                         │ q, results[], page, hasMore, scrollY, searched │
                         └──────────────────────────────────────────────┘
                              ▲ read on mount        │ write on every change
                              │ (instant restore)    ▼
   User types query  ──►  search/+page.svelte  ──►  run() / loadMore()
        │                       │                         │
        │  D-01: loading &&      │                        ▼
        │  results.length===0    │                  searchAll(kw, page, prefs, signal)   ◄── catalog.ts
        │  → show skeleton       │                        │
        ▼                        │             D-04: TTL Map cache wraps here
   [skeleton rows] / [results]   │             key = norm(kw)|sourcesEnabled|page
                                 │                        │ miss → fan-out
                                 │                        ▼
                                 │     Promise.allSettled([netease, qq, kuwo, joox].search)
                                 │                        │
                                 │              each adapter → /api/<source>/...  (proxy)
                                 │                        │
                                 │       D-03: quality ladder honors settings.defaultQuality
                                 │       (pickBestPlayUrl / pickJooxPlayUrl / level / Meting)
                                 ▼
                          player.setQueue(results) + player.play(track)

   Discovery / Home / Up-Next paths (picks.ts, similar.ts, discovery.resolveStub,
   buildDiversePicks, buildSimilarQueue) ALL call searchAll too → all benefit from D-04.

   Discovery LIST endpoints (getChartTopTracks etc → /api/lastfm/discovery) are
   ALREADY edge-cached (Cloudflare Cache API, per-method TTL). Client cache here = latency only.
```

### Recommended Project Structure
```
src/lib/
├── stores/
│   └── searchSession.svelte.ts   # NEW (D-02) — mirror overlays.svelte.ts shape
├── services/
│   ├── catalog.ts                # EDIT (D-04) — wrap searchAll with TTL cache
│   └── ttl-cache.ts              # NEW (D-04) — tiny reusable Map<string,{v,exp}> helper (pure, testable)
└── sources/
    ├── qq.ts                     # EDIT (D-03) — pickBestPlayUrl honors quality pref
    ├── joox.ts                   # EDIT (D-03) — pickJooxPlayUrl honors quality pref
    ├── kuwo.ts                   # EDIT (D-03) — level param from quality pref
    └── netease.ts                # EDIT (D-03) — see note: Meting may not expose tiers
src/lib/proxy/
    └── joox.ts                   # MAYBE EDIT (D-03) — JOOX_BR tier-set; see pitfall
src/routes/(app)/search/+page.svelte  # EDIT (D-01 + D-02 consumer)
```

### Pattern 1: Runes-class singleton store (for D-02)
**What:** A `class` with `$state` fields, exported as a single instance. SSR-guarded.
**When to use:** Any shared cross-component / cross-route reactive state.
**Example:**
```typescript
// Source: existing src/lib/stores/overlays.svelte.ts (verbatim pattern)
const HAS_WINDOW = typeof window !== 'undefined';

class SearchSession {
  q = $state('');
  results = $state<Track[]>([]);
  page = $state(1);
  hasMore = $state(false);
  scrollY = $state(0);
  searched = $state(false);   // so restore knows "we have a prior search"
}
export const searchSession = new SearchSession();
```
The page reads these on mount (instant restore, no refetch) and writes them on every state change. Note `settings.load()` uses a `browser` guard + a `loaded` flag — mirror that discipline. (Source: `src/lib/stores/settings.svelte.ts:47-48`, `overlays.svelte.ts:28`.)

### Pattern 2: In-memory TTL Map cache (for D-04)
**What:** `Map<key, { value, expiresAt }>` with a `get`/`set` that respects TTL.
**When to use:** Memoizing idempotent fetches where staleness is acceptable.
**Example:**
```typescript
// Pattern mirrors the EDGE cache in /api/lastfm/discovery/+server.ts (TTL map),
// adapted to a client in-memory Map. Pure + node-testable.
type Entry<T> = { value: T; expiresAt: number };
const store = new Map<string, Entry<unknown>>();

export function cached<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value as T);
  const p = factory();
  // Only cache on success; on reject, drop so the next call retries.
  p.then((v) => store.set(key, { value: v, expiresAt: Date.now() + ttlMs })).catch(() => {});
  return p;
}
```

### Anti-Patterns to Avoid
- **Module-level mutable state that bleeds across SSR requests.** On Cloudflare SSR, a top-level `let`/`Map`/`$state` is shared across all concurrent requests for the worker's lifetime. The existing stores avoid leaking *user* state by only ever *writing* inside `browser`-guarded paths (`settings.load`/`save` early-return when `!browser`; `names.resolve` returns input when `!browser`). The D-02 store MUST follow this: never write search state during SSR. Reads during SSR return harmless empty defaults. (Verified: `settings.svelte.ts:48`, `names.svelte.ts:80`.)
- **Caching audio URLs in the D-04 cache.** Source CDN URLs are short-lived/expiring (Out-of-Scope note in REQUIREMENTS.md). D-04 caches *search/discovery metadata results* (the `searchAll` SearchResult), NOT resolved playable URLs. `ensureTrackDetails` / `resolve()` must stay un-cached.
- **Concatenating load-more results.** The pagination contract is *cumulative superset* (page N is a superset of N-1); the page REPLACES `results` with the new superset (`search/+page.svelte:79-86`). The D-04 cache must cache per `(query, sourcesEnabled, page)` so it returns the correct superset for each page — do NOT cache "the latest superset" under a page-less key (see pitfall below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive cross-route state | A custom event bus / `writable()` legacy store | Runes-class singleton (D-02 pattern above) | Project standard; `overlays`/`player`/`settings` all do this |
| Request memoization | `lru-cache` / TanStack Query | ~30-line TTL Map (D-04 pattern) | Adds a dep for trivial logic; project hand-rolls small caches deliberately |
| Skeleton shimmer | A new spinner component / animation | The shipped `.skel` CSS in `search/+page.svelte:201-229` | D-01 explicitly says REUSE; reduce-motion already handled at line 227 |
| Source dedupe / best-quality pick | Re-implementing in the cache layer | `dedupeBest()` (already applied in the page after `searchAll`) | Dedupe lives in the page, not catalog — cache the raw `searchAll` result *before* dedupe so the page's `dedupeBest(..., preferredSource)` still runs on cache hits |

**Key insight:** Every search-like data path (search page, `resolveStub`, `buildDiversePicks`, `buildSimilarQueue`) calls `searchAll(keyword, page)` in `catalog.ts`. Wrapping that one function gives D-04 coverage of all four items for free — no per-source or per-service cache duplication.

## Common Pitfalls

### Pitfall 1: D-03 — the `br`/level params are NOT what selects playback quality
**What goes wrong:** Planner assumes "set `JOOX_BR` to the 128k tier and netease/qq/kuwo `br` likewise" and edits constants. Nothing changes, because the client ladders still pick the top (lossless) tier from whatever the upstream returns.
**Why it happens:** CONTEXT D-03 describes the levers as "JOOX `br` tier… netease/qq/kuwo bitrate/quality params" — but the *real* selection is the client-side quality ladder, not the request param.
**Root-cause map (VERIFIED from source):**
- **QQ** — `pickBestPlayUrl` (`src/lib/sources/qq.ts:65-87`) tries `song_play_url_sq → pq → accom → hq → standard → fq → fallback` in that fixed order, returning the FIRST present. To target 128–160k, prefer `song_play_url_standard` (STD) ahead of sq/pq/hq when the pref is `'128'`. There is no request-side bitrate param for QQ (the tang endpoint returns all tiers in one detail response). **Lever = ladder reorder in qq.ts, not a param.**
- **JOOX** — `JOOX_QUALITY_ORDER` (`src/lib/sources/joox.ts:110-122`): `Atmos全景声, 无损FLAC, Hi-Res无损, 母带无损, OGG 320, MP3 320, AAC 192, OGG 192, MP3 128, AAC 96, AAC 48`. The 128–160k band = **`AAC 192` / `OGG 192` / `MP3 128`** (192k and 128k bracket the 128–160 target; there is no exact 160 tier). To target it, skip the lossless + 320 tiers and start probing from `MP3 128` (or `AAC 192` for the upper edge). The proxy `JOOX_BR=4` (`src/lib/proxy/joox.ts:21`) is a *tier-set selector*, not a single-bitrate request — it makes all the above tiers available; changing it risks the lossless tiers disappearing AND will break `proxy.test.ts:27,42` which assert `br=4`. **Recommended lever = ladder start-index in joox.ts; leave `JOOX_BR=4` alone (or change it only with the test updated).**
- **Kuwo** — `level=zp` is requested in BOTH the adapter (`src/lib/sources/kuwo.ts:96`) and the proxy default (`src/lib/proxy/kuwo.ts:37`). `zp` = "臻品/lossless". Kuwo's API supports level tiers; a lower tier (e.g. `level=128k` / `128kmp3` — **[ASSUMED]**, the cenguigui kw-api's exact non-`zp` level token is undocumented in-repo and needs verification against the live endpoint) yields a smaller MP3. **Lever = the `level` param value in kuwo.ts; the proxy already passes `searchParams.get('level') || 'zp'` through, so the adapter can send the new level with no proxy edit.** Note `kuwo.test.ts:110` asserts `level=zp` — that test will need updating if the default level changes.
- **Netease** — the Meting proxy (`/api/netease/url?id=`) returns whatever quality Meting decides; the repo passes NO bitrate param and Meting's `qijieya` instance is **[ASSUMED]** not to honor a `br=` query (Meting historically maps a fixed quality). **Likely lever: none available client-side without changing the Meting instance.** Netease may simply not be tunable here — document it as "best-effort, may stay at Meting default" (consistent with the honest `defaultQualityNote` already in the i18n strings).
**How to avoid:** Scope D-03 as "wire `settings.defaultQuality` into each source's ladder, default it to `'128'`" — and accept per-source best-effort (QQ + JOOX are tunable via ladder; Kuwo via level token pending verification; Netease likely fixed). The existing `defaultQualityNote` ("Best-effort — sources don't all expose bitrate; biases selection where known") is already the honest framing for this.
**Warning signs:** Tests `qq.test.ts:130`, `kuwo.test.ts:102`, `joox.test.ts:168/203` assert `quality === 'lossless'`. If D-03 changes the *default* ladder these will fail and must be updated to reflect the new default tier (or the tests should pass an explicit `'lossless'` pref).

### Pitfall 2: D-03 — `defaultQuality` setting exists but is DEAD CODE
**What goes wrong:** Planner adds a *new* quality setting, duplicating the existing one.
**Why it happens:** Not obvious that the segmented control on `/settings/playback` does nothing.
**Verified:** `settings.defaultQuality` (`settings.svelte.ts:35`) is read/written/persisted and has a full UI (`/settings/playback/+page.svelte:11-16,26,39-45`) with values `'auto' | 'lossless' | '320' | '128'`, but `grep` confirms **no source/catalog/player code ever reads it**. The only references are the store, the settings page, and i18n strings.
**How to avoid:** D-03 should (a) WIRE the existing `settings.defaultQuality` into the source ladders, and (b) change its DEFAULT from `'auto'` to `'128'` (`settings.svelte.ts:35` and the `?? 'auto'` fallback at line 69). Do not introduce a parallel setting. Note the adapters currently take no quality argument — `SourceAdapter.resolve(track, signal)` (`types.ts:64`) would need either a new param (touches the registry contract + all four adapters + their tests + `ensureTrackDetails`) OR the adapters can import `settings` directly the way `picks.ts`/`similar.ts`/`names.svelte.ts` already do (`import { settings } from '$lib/stores/settings.svelte'`). The import approach is lower-blast-radius and matches existing precedent — **recommend the adapters read `settings.defaultQuality` directly** rather than threading a param through the registry.

### Pitfall 3: D-04 — caching breaks the cumulative-superset pagination contract
**What goes wrong:** Caching "the result of the last `searchAll`" under a key that ignores `page` returns page-1 data when the page wants page-3's superset (or vice versa), silently capping infinite scroll or returning stale supersets.
**Why it happens:** The page calls `searchAll(kw, 1)` then `searchAll(kw, 2)`, each returning a *cumulative superset* (each adapter multiplies `limit` by page — `netease.ts:45`, `qq.ts:96`, `kuwo.ts:54`). The page replaces `results` with whichever superset is larger.
**How to avoid:** Cache key MUST include page: `key = norm(query) + '|' + enabledSourcesKey + '|' + page`. Each `(query, page)` pair caches its own superset. The `loadMore` "sources exhausted when `merged.length <= results.length`" check (`search/+page.svelte:79`) still works because each page is cached independently and the comparison is between supersets. Normalize the query (trim + lowercase) so "Jay" and "jay " share a cache entry — but be aware the adapters search the *raw* keyword, so normalization is for the cache KEY only, not the upstream call (pass the original keyword to `searchAll`).

### Pitfall 4: D-04 — double-caching the already-edge-cached discovery list endpoints
**What goes wrong:** Adding a client cache on top of `/api/lastfm/discovery` (which is already edge-cached per `discovery/+server.ts:251-283` with per-method TTLs of 1h/6h/24h) could compound staleness or be redundant.
**Why it happens:** CONTEXT D-04 says "search AND discovery." But "discovery" in this codebase splits into two kinds: (a) the Last.fm LIST calls (`getChartTopTracks` etc → `/api/lastfm/discovery`, ALREADY edge-cached), and (b) the `searchAll`-based resolution (`resolveStub`, `buildDiversePicks`, `buildSimilarQueue` — NOT cached).
**How to avoid:** Put the D-04 cache at the `searchAll` seam in `catalog.ts`. That automatically covers all the `searchAll`-driven "discovery" (picks/similar/resolveStub) without touching the edge-cached Last.fm list path. A *separate, optional* short client cache on `lastfm.ts`'s `fetchList` is fine (it dedupes within a session before the round-trip even reaches the edge cache) but is a latency optimization, not a correctness requirement — keep TTL short (≤ the edge TTL) to avoid compounding staleness.

### Pitfall 5: D-02 — breaking infinite-scroll reset-on-new-query
**What goes wrong:** Lifting state to the store but forgetting that a NEW query must reset `page`/`hasMore`/`results`/`scrollY`, re-running the freshly-search behavior.
**Why it happens:** The current `run()` resets `page=1; hasMore=results.length>0` (`search/+page.svelte:54-55`) on every search. Moving state to the store must preserve this: a new query OVERWRITES the session, a same-query mount RESTORES it.
**How to avoid:** In the page's mount logic, only restore from the store when `searchSession.q` is non-empty AND `searchSession.searched` is true. The `run()` function writes the fresh state into the store (replacing prior). The AbortController (`ac`/`moreAc`) stays page-local (it's a transient, not session state). Restore `scrollY` after the results render (use `tick()` then `window.scrollTo`, since the window scrolls — `root: null` in the IO at `search/+page.svelte:110`).

### Pitfall 6: D-02 — scroll restore timing on a window-scrolled list
**What goes wrong:** Setting `window.scrollTo(0, savedY)` on mount before the results `{#each}` has rendered/measured leaves scroll at 0.
**Why it happens:** Results render reactively after mount; the document height isn't there yet when `onMount` fires.
**How to avoid:** Restore scroll AFTER results are in the DOM — `await tick()` then `window.scrollTo(0, searchSession.scrollY)`, or use an `$effect` that fires once results.length matches the restored set. Save `scrollY` on `onDestroy`/navigation via `window.scrollY`. (The list scrolls the window, confirmed by `root: null` + `rootMargin` on the IntersectionObserver.)

## Code Examples

### D-01: First-load skeleton (the minimal change)
The skeleton block currently lives inside the `{:else}` (results) branch, gated by `{#if loadingMore}` (`search/+page.svelte:151-164`). The initial-load branch is `{#if loading}<p class="muted">{t('search.searching')}</p>` (line 133-134). The minimal change: render the SAME skeleton rows when `loading && results.length === 0`. Extract the skeleton `<li>` into a snippet or duplicate it under the loading branch:
```svelte
<!-- Source: adapt existing skel block from search/+page.svelte:151-164 -->
{#if loading && results.length === 0}
  <ul class="list">
    <li class="skel-wrap" aria-label={t('search.searching')}>
      {#each Array(6) as _, i (i)}
        <span class="row skel" aria-hidden="true">
          <span class="art"></span>
          <span class="meta"><span class="bar bar-title"></span><span class="bar bar-artist"></span></span>
        </span>
      {/each}
    </li>
  </ul>
{:else if searched && results.length === 0}
  <p class="muted">{t('search.empty')}</p>
{:else}
  ... existing results list ...
{/if}
```
The `.skel` CSS (incl. `@media (prefers-reduced-motion: reduce)` at line 227) is already present and applies unchanged. Best practice: factor the skeleton row into a Svelte `{#snippet}` so D-01 and the load-more block share one definition (avoids the "two skeletons" CONTEXT warns against).

### D-04: catalog.ts cache wrap (the seam)
```typescript
// Source: wrap the existing searchAll in src/lib/services/catalog.ts:24
import { cached } from './ttl-cache';
const SEARCH_TTL_MS = 5 * 60 * 1000; // discretion: minutes; results change infrequently

export async function searchAll(keyword, page = 1, prefs = {}, signal?) {
  const enabledKey = Object.keys(getEnabledAdapters(prefs)).join(','); // sources dimension
  const key = `${keyword.trim().toLowerCase()}|${enabledKey}|${page}`;
  // NOTE: an AbortSignal makes caching tricky — only cache when no signal, OR
  // cache the resolved value (not the promise) and ignore the signal on a hit.
  return cached(key, SEARCH_TTL_MS, () => searchAllUncached(keyword, page, prefs, signal));
}
```
**Caveat:** `searchAll` takes an `AbortSignal`. A cache hit returns instantly (no fetch to abort) so that's fine; a cache MISS still honors the signal. Don't cache the in-flight promise across *different* signals if abort semantics matter — simplest correct approach is to cache the resolved `SearchResult` value only.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy `index.html` `state{}` + imperative renderers | Svelte 5 runes-class singletons | Phase 1–4 rebuild | D-02 store must follow runes pattern, not the legacy global object |
| `defaultQuality` shipped but unwired | (to be wired by D-03) | quick task 260606-4pn | D-03 reuses, doesn't recreate, the setting |
| No client request cache | (to be added by D-04) | this phase | Edge cache already exists for Last.fm lists |

**Deprecated/outdated:**
- The `index.html` desktop monolith referenced throughout CONTEXT/STACK no longer exists in the repo (it was the source-of-truth for the port; the live app is fully ported to `src/`). All file:line citations in this research are against the CURRENT `src/` tree, not `index.html`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Kuwo kw-api accepts a non-`zp` `level` token (e.g. `128k`/`128kmp3`) for a lower-bitrate MP3 | Pitfall 1 (Kuwo) | If no such token exists, Kuwo can't be down-tiered via request param; falls back to "Kuwo stays lossless, best-effort" — D-03 still ships for QQ/JOOX |
| A2 | The Meting/qijieya Netease proxy does NOT honor a `br=`/quality query param (returns a fixed quality) | Pitfall 1 (Netease) | If it DOES, Netease becomes tunable and D-03 can add the param; if not, Netease stays at Meting default (acceptable per honest best-effort note) |
| A3 | JOOX `br=4` is a tier-SET selector (makes all tiers available) rather than a single-bitrate request | Pitfall 1 (JOOX) | If `br` is actually a single-bitrate selector, changing it (not the ladder) would be the lever — but that breaks `proxy.test.ts` and risks losing tiers; ladder reorder is safer regardless |

**Verification path for A1/A2/A3:** A short live-call spike against each upstream (`/api/kuwo/detail?...&level=<token>`, `/api/netease/url?id=<id>&br=<n>`, `/api/joox/detail?...&br=<n>`) during planning or as a Wave-0 task would confirm the exact tunable tokens. These are external upstream contracts not documented in-repo beyond `INTEGRATIONS.md`.

## Open Questions

1. **Exact non-lossless level token for Kuwo (A1).**
   - What we know: `level=zp` = lossless; the proxy passes any `level` through (`kuwo.ts:37`).
   - What's unclear: the token string for a ~128–160k MP3 tier.
   - Recommendation: spike a live `/api/kuwo/detail` call with candidate tokens, OR accept Kuwo-stays-lossless and tune only QQ + JOOX (which are confirmed tunable via ladder).

2. **Should adapters take a quality param, or read `settings` directly?**
   - What we know: `picks.ts`, `similar.ts`, `names.svelte.ts` all `import { settings }` directly; `SourceAdapter.resolve` signature is `(track, signal)` with no quality slot.
   - Recommendation: adapters read `settings.defaultQuality` directly (lower blast radius — no registry-contract change, no param threading through `ensureTrackDetails`). Keep the ladder logic pure-testable by extracting a `pickByQualityPref(tiers, pref)` helper that takes the pref as an argument (so tests pass it explicitly).

3. **TTL values (discretion).**
   - Recommendation: search results ~5 min (volatile-ish, user re-searches); the optional `lastfm.ts` client cache ≤ its edge TTL (so ≤1h charts). Discovery `searchAll`-resolution inherits the 5-min search TTL.

## Environment Availability

> SKIPPED — this phase has no new external dependencies. All work uses the existing Svelte/SvelteKit/Vitest toolchain already installed and passing (201 tests). No CLI tools, services, or runtimes beyond the project's own are required.

## Validation Architecture

> nyquist_validation is `true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3 `[VERIFIED: package.json]` |
| Config file | `vite.config.ts` (single `projects: [{ name: 'server', environment: 'node' }]`; `expect.requireAssertions: true`) `[VERIFIED]` |
| Quick run command | `pnpm test` (= `vitest --run`) |
| Full suite command | `pnpm test && pnpm check` (svelte-check) |

**Critical:** there is NO jsdom/client test project — everything runs under the `node` project. `.svelte.test.ts` files run there too (the SvelteKit Vite plugin transforms `$state` for node). So D-02's store and D-04's cache must be **node-unit-testable as pure logic** (the existing `player.svelte.test.ts` proves runes-class logic tests headless). The skeleton (D-01) is component markup with no node-testable seam — verify manually / via the `loading && results.length===0` boolean unit if extracted.

### Phase Requirements → Test Map
| Item | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04 | TTL cache: hit within TTL returns cached value without invoking factory; expiry re-invokes; key includes page | unit | `pnpm test src/lib/services/ttl-cache.test.ts` | ❌ Wave 0 |
| D-04 | `searchAll` second call (same kw/page) does not re-fan-out (spy on `SOURCES.*.search` called once) | unit | `pnpm test src/lib/services/catalog.test.ts` | ✅ extend existing |
| D-03 | `pickByQualityPref(tiers, '128')` selects the 128–160 tier; `'lossless'` selects top; QQ/JOOX ladders honor pref | unit | `pnpm test src/lib/sources/qq.test.ts src/lib/sources/joox.test.ts` | ✅ extend (update lossless asserts) |
| D-03 | `settings.defaultQuality` defaults to `'128'` | unit | `pnpm test` (add to a settings test) | ❌ Wave 0 (no settings test file today) |
| D-02 | `searchSession` stores/restores q/results/page/hasMore; new query resets | unit | `pnpm test src/lib/stores/searchSession.svelte.test.ts` | ❌ Wave 0 |
| D-01 | skeleton shows on `loading && results.length===0` | manual / boolean unit | — (component) | n/a |

### Sampling Rate
- **Per task commit:** `pnpm test <touched test file>`
- **Per wave merge:** `pnpm test` (full vitest, currently 201 tests)
- **Phase gate:** `pnpm test && pnpm check` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/services/ttl-cache.test.ts` — covers D-04 cache helper (hit/miss/expiry/key)
- [ ] `src/lib/stores/searchSession.svelte.test.ts` — covers D-02 store store/restore/reset
- [ ] Extend `src/lib/services/catalog.test.ts` — assert cache prevents re-fan-out + page-keyed correctness (must not break the existing 3 fan-out tests — they call `searchAll` repeatedly with `vi.spyOn` mocks, so the cache could make later assertions see stale spies; **the cache must be resettable/clearable in tests**, e.g. export a `__clearSearchCache()` for `afterEach`)
- [ ] Extract `pickByQualityPref()` pure helper so D-03 quality selection is unit-testable without mocking fetch
- [ ] Update `qq.test.ts:130-131`, `kuwo.test.ts:102-103`, `joox.test.ts:168-169,203` — they assert `quality==='lossless'`; if the DEFAULT pref changes to `'128'` these must either pass an explicit `'lossless'` pref or assert the new default tier

**Landmine:** `proxy.test.ts:27,42` assert the JOOX upstream URL contains `br=4`. Recommended D-03 approach (ladder reorder, leave `JOOX_BR=4`) keeps these green. If the plan instead changes `JOOX_BR`, these two assertions must be updated.

## Security Domain

> `security_enforcement` is not set in config (treated as enabled). Assessing applicability.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched (Last.fm auth is Phase 11) |
| V3 Session Management | no | No server sessions; D-02 "session" is client in-memory only |
| V4 Access Control | no | No new endpoints or privileged operations |
| V5 Input Validation | minimal | Search keyword already `encodeURIComponent`'d at every adapter (`netease.ts:46`, `qq.ts:97`, etc.); cache KEY normalization is internal-only, never reaches an upstream URL |
| V6 Cryptography | no | None |
| V7 Logging | yes (preserve) | D-03 JOOX edits must NOT log the token or built upstream URL (existing rule, `proxy/joox.ts:12-13`) — only relevant if the plan touches `proxy/joox.ts` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSR module-state leakage (one user's search shown to another) | Information Disclosure | Client-only writes via `browser`/`typeof window` guard (D-02 store mirrors `settings`/`names`) — see Anti-Patterns |
| Cache poisoning across queries | Tampering | Page-and-source-keyed cache key; cache the value, not cross-query state |
| Token leak if D-03 touches the JOOX proxy | Information Disclosure | No logging of token/URL (existing `proxy/joox.ts` discipline); prefer the client-ladder approach that doesn't touch the proxy at all |

**Net:** Low security surface. The only live concern is the SSR module-state leakage class (mitigated by the established browser-guard pattern) and preserving the JOOX no-log rule IF the proxy is edited (avoidable by using the ladder approach).

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/lib/sources/{netease,qq,kuwo,joox}.ts` — search/resolve + quality ladders (D-03)
- `src/lib/proxy/{netease,qq,kuwo,joox}.ts` — upstream URL build + JOOX_BR=4 (D-03)
- `src/lib/services/catalog.ts` — `searchAll` seam (D-04)
- `src/lib/services/{picks,similar,discovery,lastfm}.ts` — all call `searchAll` / discovery (D-04 scope)
- `src/lib/stores/{settings,player,overlays,names}.svelte.ts` — runes-singleton + browser-guard patterns (D-02), dead `defaultQuality` (D-03)
- `src/routes/(app)/search/+page.svelte` — current search state, skeleton, infinite scroll (D-01, D-02)
- `src/routes/(app)/settings/playback/+page.svelte` — existing `defaultQuality` UI (D-03)
- `src/routes/api/lastfm/discovery/+server.ts` — existing edge TTL cache (D-04 reference + double-cache pitfall)
- `vite.config.ts` — single node test project (Validation Architecture)
- `src/routes/api/proxy.test.ts`, `src/lib/sources/{qq,kuwo,joox}.test.ts` — test landmines asserting `br=4` / `lossless`
- `.planning/codebase/INTEGRATIONS.md:67-222` — authoritative upstream API quality-tier documentation

### Secondary
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `14-CONTEXT.md` — phase scope + decisions + history

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Upstream bitrate-param semantics for Kuwo `level` tokens and Netease/Meting `br` (A1/A2) — not verified against live endpoints this session; spike recommended

## Metadata

**Confidence breakdown:**
- D-01 skeleton reuse: HIGH — exact CSS + markup read, change is a one-line `{#if}` guard
- D-02 store pattern: HIGH — three working exemplars in-repo, SSR-guard discipline confirmed
- D-03 wiring location: HIGH — confirmed the ladders (not params) select quality, and `defaultQuality` is dead code; MEDIUM-LOW on the exact per-source tunable tokens (A1/A2/A3 assumptions)
- D-04 seam: HIGH — `searchAll` is the single confirmed funnel for all search/discovery-resolution paths; edge-cache interaction understood

**Research date:** 2026-06-06
**Valid until:** ~2026-07-06 (stable internal codebase; the only volatility is the external upstream bitrate-param contracts in the Assumptions Log)
