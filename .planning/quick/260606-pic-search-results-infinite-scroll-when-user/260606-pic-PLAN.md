---
phase: quick-260606-pic
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/(app)/search/+page.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
autonomous: false
requirements: [QUICK-260606-pic]
must_haves:
  truths:
    - "After a search, scrolling to the bottom of the results auto-loads the next batch without tapping anything"
    - "While the next batch is in-flight, skeleton placeholder rows appear at the end of the list as the loading state"
    - "A second concurrent batch never fires while one is already loading"
    - "When the sources stop yielding net-new tracks, loading stops (no infinite firing at the end)"
    - "Starting a new search resets pagination and tears down the old observer"
    - "Navigating away tears down the IntersectionObserver (no leak / no fire after unmount)"
  artifacts:
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "Infinite-scroll search results with skeleton loading state via IntersectionObserver sentinel"
      contains: "IntersectionObserver"
    - path: "src/lib/i18n/en.ts"
      provides: "search.loadingMore key"
      contains: "search.loadingMore"
  key_links:
    - from: "src/routes/(app)/search/+page.svelte sentinel <li>"
      to: "loadMore() → searchAll(kw, page+1)"
      via: "IntersectionObserver callback"
      pattern: "IntersectionObserver"
---

<objective>
Add infinite scroll to the search results page: when the user scrolls to the bottom of the
result list, automatically fetch the next page of cross-source results and append the net-new
tracks. While a batch is in-flight, render skeleton placeholder rows at the end of the list as
the loading state.

Purpose: The search page currently fetches exactly one page (`searchAll(kw, 1)`) and stops. On
mobile the user expects the list to keep growing as they scroll, like YouTube Music / Spotify.

Output: An upgraded `src/routes/(app)/search/+page.svelte` plus three i18n string additions.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<pagination_mechanism>
CONCRETE pagination mechanism (verified — read before coding):

`searchAll(keyword, page, prefs?, signal?)` in `src/lib/services/catalog.ts` already accepts a
`page` param and passes it to every adapter's `search(keyword, page, signal)`.

EACH source paginates by LIMIT-MULTIPLICATION, NOT a disjoint page window:
  - netease/qq/kuwo: `requestLimit = Math.max(1, page||1) * 10` (verified in
    src/lib/sources/{netease,qq,kuwo}.ts) — page 2 asks for 20 rows, page 3 for 30, etc.
  - joox: IGNORES page (`_page`) — always returns its fixed set.

CONSEQUENCE — this is the load-bearing fact for the implementation:
  `searchAll(kw, N).interleaved` is a CUMULATIVE SUPERSET of `searchAll(kw, N-1).interleaved`
  (it contains the earlier rows PLUS more). It is NOT a fresh disjoint window.

THEREFORE the correct "load more" behavior is:
  1. Call `searchAll(kw, nextPage, ...)`.
  2. `dedupeBest(r.interleaved, settings.preferredSource)` → this is the FULL deduped list.
  3. REPLACE `results` with this full list (do NOT concatenate — concatenation would
     duplicate every prior row). `{#each results as t (t.uid)}` keys by stable uid so Svelte
     reuses existing DOM rows and only the genuinely new tail rows mount.

hasMore DETECTION (no count field from the API): compare the new deduped length to the
previous length. If `newResults.length <= prevLength`, the sources have stopped yielding
net-new unique tracks (joox is fixed; the CN sources cap out) → set `hasMore = false` and stop
observing. Otherwise keep `hasMore = true`.
</pagination_mechanism>

<reuse_note>
IMPORTANT — the planning constraint claimed album/[name] and artist/[name] "already implement
scroll-to-bottom load-more with hasMore/page state". This is INCORRECT and was verified false:
both pages call `searchAll(n, 1)` exactly ONCE inside a `$effect` and render a static list (see
src/routes/(app)/artist/[name]/+page.svelte:62-73 and album/[name]/+page.svelte:63-88). There
is NO existing infinite-scroll helper, NO IntersectionObserver anywhere in src/, and NO shared
scroll action (src/lib/actions/ has only dragClose.ts + longpress.ts). There is also NO existing
skeleton component (src/lib/components/ = Logo, NowPlaying, TagChips, TrackMenu). So this plan
BUILDS the pattern fresh, inline in the search page — do not hunt for a non-existent helper.

The SCROLL CONTAINER is the WINDOW/document, not a nested element: `.content` in
src/routes/(app)/+layout.svelte is `flex: 1` with no `overflow`/fixed height. So an
IntersectionObserver with default `root: null` (viewport) is correct; use a `rootMargin` to
prefetch slightly before the true bottom.
</reuse_note>

<interfaces>
From src/lib/services/catalog.ts:
```typescript
export interface SearchResult {
  perSource: SettledSourceResult[];   // [{source, status:'ok'|'error', tracks, error?}]
  interleaved: Track[];               // deduped (by colon uid), round-robin in registry order
}
export async function searchAll(
  keyword: string, page?: number,
  prefs?: Partial<Record<SourceId, boolean>>, signal?: AbortSignal
): Promise<SearchResult>;
```

From src/lib/services/dedupe.ts (already imported in the page):
```typescript
export function dedupeBest(tracks: Track[], preferred: SourceId): Track[];
```

From src/lib/sources/types.ts — Track.uid is "Stable across reorder/paginate" (line 35-ish),
so it is safe as the `{#each}` key and for dedupe across pages.

Existing page state to KEEP (src/routes/(app)/search/+page.svelte):
  q, results, loading, searched, someFailed, ac (AbortController), run(), fallbackCover(),
  menuTrack/menuOpen, TrackMenu wiring, longpress.
</interfaces>

@src/routes/(app)/search/+page.svelte
@src/lib/services/catalog.ts
@src/lib/i18n/en.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add load-more pagination state + loadMore() to the search page script</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <action>
In the `<script>` block of the search page, extend the existing state and search flow to support
paged loading. Do NOT remove or rename the existing reactive state (q, results, loading, searched,
someFailed, ac) or the TrackMenu/longpress wiring.

Add new `$state`:
  - `page = $state(1)` — last page successfully loaded.
  - `loadingMore = $state(false)` — true ONLY while a NEXT-page batch is in flight (distinct
    from the initial `loading`, which the first-search spinner uses).
  - `hasMore = $state(false)` — whether another batch might yield net-new tracks.
  - `let moreAc: AbortController | null = null` — a SEPARATE abort controller for load-more
    requests so it never collides with the initial-search `ac`.

Modify `run()` (the initial search): after a successful `searchAll(kw, 1, {}, ac.signal)` +
`dedupeBest`, RESET pagination — `page = 1`, and set `hasMore = results.length > 0` (assume more
may exist whenever the first page returned anything; the loadMore guard will flip it off when a
page stops growing). On the catch/empty path set `hasMore = false`. Also `moreAc?.abort()` at the
top of `run()` so an in-flight load-more from a previous query is cancelled when a new search
starts.

Add `async function loadMore()`:
  - GUARD: return immediately if `loadingMore || loading || !hasMore || !searched` is true, or if
    `q.trim()` is empty. (Prevents duplicate fetches while a batch is loading, firing past the end,
    and firing before any search.)
  - Set `loadingMore = true`. Compute `const next = page + 1`. Capture `const kw = q.trim()` BEFORE
    awaiting (race guard).
  - `moreAc?.abort(); moreAc = new AbortController();`
  - `try`: `const { interleaved } = await searchAll(kw, next, {}, moreAc.signal);`
    `const merged = dedupeBest(interleaved, settings.preferredSource);`
    RACE GUARD: if `kw !== q.trim()` (user typed/searched something else mid-fetch), bail without
    touching state. Otherwise: if `merged.length <= results.length` → `hasMore = false` (sources
    exhausted, no net-new). Else → `results = merged; page = next;` (REPLACE with the cumulative
    superset — see pagination_mechanism; never concatenate).
  - `catch`: if the error is an AbortError, do nothing; otherwise leave `results` as-is and set
    `hasMore = false` (stop hammering a failing source).
  - `finally`: `loadingMore = false`.

Add a teardown helper for the observer that Task 2 wires (declare `let io: IntersectionObserver |
null = null` and an `onDestroy(() => io?.disconnect())` import from 'svelte'); the observer
creation itself is Task 2.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -8</automated>
  </verify>
  <done>pnpm check passes with no new errors; the page script has page/loadingMore/hasMore state, a guarded loadMore() that replaces (not appends) results and flips hasMore off when a page stops growing, run() resets pagination + aborts in-flight load-more, and an onDestroy disconnects the observer.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the IntersectionObserver sentinel + skeleton rows in the template, add i18n key</name>
  <files>src/routes/(app)/search/+page.svelte, src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts</files>
  <action>
TEMPLATE (search page, inside the existing `{:else}` branch that renders `<ul class="list">`):

1. Add a sentinel element at the END of the results `<ul>` (after the `{#each}`), rendered only
   when `hasMore` is true: an empty `<li class="sentinel" bind:this={sentinelEl}></li>`. Declare
   `let sentinelEl = $state<HTMLLIElement | null>(null)` in the script.

2. SKELETON loading state: when `loadingMore` is true, render a small fixed set (e.g. 4) of
   skeleton placeholder rows AFTER the real rows, matching the existing `.row` visual language —
   a `.art` square + two stacked muted bars (title + artist) with a subtle shimmer. Reuse the
   existing `.list`/`.row`/`.art`/`.meta` sizing so the skeletons line up with real rows. Add a
   `.skel` modifier and shimmer keyframes in the `<style>` block (respect reduce-motion:
   the app uses a reduce-motion setting — gate the shimmer animation behind
   `@media (prefers-reduced-motion: reduce)` to disable it). Use `t('search.loadingMore')` as an
   `aria-label`/visually-hidden cue on the skeleton container for screen readers.

3. OBSERVER: in an `$effect`, create the IntersectionObserver when `sentinelEl` exists and tear it
   down/recreate when `sentinelEl` changes. `io = new IntersectionObserver((entries) => { if
   (entries[0]?.isIntersecting) loadMore(); }, { root: null, rootMargin: '400px 0px' });` then
   `io.observe(sentinelEl)`. The `$effect` cleanup (return () => io?.disconnect()) MUST disconnect
   before re-observing, so a new search / hasMore toggle never leaves a stale observer. (root:null
   = viewport because the WINDOW scrolls — see reuse_note.) Keep the `onDestroy` disconnect from
   Task 1 as the unmount safety net.

I18N: add ONE new key `'search.loadingMore'` to ALL THREE dicts (en is the source-of-truth that
defines TranslationKey, so en.ts MUST get it or `t('search.loadingMore')` is a compile error):
  - en.ts: `'search.loadingMore': 'Loading more…'`
  - zh-Hant.ts: `'search.loadingMore': '載入更多…'`
  - zh-Hans.ts: `'search.loadingMore': '加载更多…'`
Place each next to the existing `'search.searching'` key for tidiness.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -8 && pnpm test 2>&1 | tail -10</automated>
  </verify>
  <done>pnpm check passes; pnpm test still green (i18n key-parity test passes — all three dicts have search.loadingMore so no missing-key failure); the template renders a hasMore-gated sentinel <li>, an IntersectionObserver (root:null, rootMargin prefetch) that calls loadMore() on intersect and disconnects on effect-cleanup, and skeleton rows shown while loadingMore with reduce-motion-gated shimmer.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
Infinite scroll on the search results page: scrolling toward the bottom auto-fetches the next
cross-source batch (via searchAll page-increment + dedupe-replace), with skeleton placeholder rows
as the in-flight loading state. Guards prevent duplicate concurrent fetches, firing past the end of
results, and observer leaks on new-search / navigation.
  </what-built>
  <how-to-verify>
1. Run `pnpm dev` and open the app on a phone-sized viewport (DevTools device mode).
2. Go to the Search tab, search a broad term with many results (e.g. "周杰伦" or "love").
3. Scroll to the bottom of the results: confirm skeleton rows appear briefly and then MORE real
   tracks load and replace the skeletons — the list grows, no duplicate rows appear.
4. Keep scrolling repeatedly: confirm it eventually STOPS loading (no endless skeleton flashing)
   once the sources are exhausted.
5. Scroll fast / spam-scroll the bottom: confirm only ONE batch loads at a time (not several
   stacked requests — check the Network tab: no overlapping /api/*/search bursts per trigger).
6. Run a NEW search while results are showing: confirm the list resets to page 1 and infinite
   scroll still works for the new term (no leftover rows from the old query).
7. Navigate away to Home mid-scroll: confirm no console errors about setting state after unmount.
8. (Optional) Toggle reduce-motion (settings or OS): confirm the skeleton shimmer is disabled.
  </how-to-verify>
  <resume-signal>Type "approved" or describe what's off (e.g. duplicates, double-fetch, never stops).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/*/search proxy | Search keyword + page → same-origin SvelteKit proxy → upstream CN music APIs. Untrusted upstream JSON crosses back. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pic-01 | Denial of Service | loadMore() auto-fetch loop | mitigate | In-flight `loadingMore` guard + `hasMore=false` stop condition + AbortController on new search prevent unbounded/overlapping fetch storms (the core guard set in Task 1). |
| T-pic-02 | Denial of Service | IntersectionObserver | mitigate | `rootMargin` prefetch + single-batch guard; observer disconnected on effect-cleanup and onDestroy so it cannot fire after unmount. |
| T-pic-03 | Tampering | upstream search JSON (new pages) | accept | Per-source adapters already contract-guard (throw on drift) and searchAll isolates failures via allSettled; no new injection surface — results render as text/background-image only, same as the existing page. No PII, read-only display. |
| T-pic-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies are installed by this plan (IntersectionObserver is a native browser API; svelte's onDestroy is already in the dep tree). No package-manager action → legitimacy gate N/A. |
</threat_model>

<verification>
- `pnpm check` is clean (no new type errors).
- `pnpm test` stays green (i18n key-parity test passes with the new search.loadingMore key in all three dicts; no other tests touched).
- Manual checkpoint (Task 3) confirms the scroll-to-load, skeleton state, single-batch guard, end-of-results stop, new-search reset, and unmount cleanup.
</verification>

<success_criteria>
- Scrolling to the bottom of search results auto-loads the next batch (no tap required).
- Skeleton placeholder rows show while a batch is in flight, matching the app's row visual language.
- Only one batch ever loads at a time; loading stops when sources stop yielding net-new tracks.
- A new search resets to page 1; the observer is torn down on new-search and on navigation/unmount.
- No new dependencies; no new type-check or test failures.
</success_criteria>

<output>
Create `.planning/quick/260606-pic-search-results-infinite-scroll-when-user/260606-pic-SUMMARY.md` when done.
</output>
