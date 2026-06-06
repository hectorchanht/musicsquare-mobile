---
phase: 14-search-data-responsiveness-first-load-search-skeleton-search
reviewed: 2026-06-06T00:00:00Z
depth: quick
files_reviewed: 9
files_reviewed_list:
  - src/lib/services/ttl-cache.ts
  - src/lib/services/catalog.ts
  - src/lib/sources/quality.ts
  - src/lib/sources/qq.ts
  - src/lib/sources/joox.ts
  - src/lib/sources/kuwo.ts
  - src/lib/stores/settings.svelte.ts
  - src/lib/search/search-history-logic.ts
  - src/lib/stores/searchHistory.svelte.ts
  - src/lib/stores/searchSession.svelte.ts
  - src/routes/(app)/search/+page.svelte
findings:
  critical: 1
  warning: 3
  info: 0
  total: 4
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-06-06
**Depth:** quick (pattern-matching + targeted logic trace for phase focus areas)
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The D-06 abort correctness is sound. The two-layer guard (`myAc.signal.aborted || kw !== q.trim()`) in the `onPartial` callback correctly suppresses stale partials after a new query. The cache-hit path fires `onPartial` synchronously (via `Promise.resolve`) so there is no window for the `kw`/`q` drift check to fail. The `wasMiss` flag is set synchronously inside the factory closure before the factory returns, so no microtask race exists there either.

SSR module-state discipline holds. `searchSession` writes are confined to browser-side event handlers and `onMount`; the `HAS_WINDOW` guard covers `setScroll`. `searchHistory.load()` and `save()` are both `browser`-guarded. `settings.defaultQuality` is read by source adapters only during `resolve()`, which is always client-side (playback), called after `settings.load()` runs in `+layout.svelte onMount`.

The `__clearSearchCache` export name signals test-only intent and is only re-exported via `catalog.ts` (not exposed in any route or public API surface), which is acceptable.

The Last.fm discovery edge-cache is independent of the `ttl-cache` module (it uses the Cloudflare Cache API in `+server.ts`). The client-side `ttl-cache` only wraps `searchAllUncached`, so there is no double-cache on the discovery path.

Four findings follow — one blocker (crash on tampered localStorage), three warnings.

---

## Critical Issues

### CR-01: Malformed `localStorage` entry crashes `recordQuery` and breaks the search form

**File:** `src/lib/search/search-history-logic.ts:39`

**Issue:** `parseSearchHistory` returns the parsed value as-is if `Array.isArray(v)` without validating the shape of individual entries. If a stored entry is `null`, a number, or an object missing the `query` field (tampered storage, a future schema change, or data written by a same-origin tool), `recordQuery`'s `.filter()` call crashes:

```ts
// search-history-logic.ts:39
const without = list.filter((e) => e.query.toLowerCase() !== norm);
// → TypeError: Cannot read properties of undefined (reading 'toLowerCase')
//   or: Cannot read properties of null (reading 'query')
```

This crash propagates uncaught up through `searchHistory.add(kw)` (called at `+page.svelte:60` _before_ the `try` block in `run()`), causing the form submit handler to throw and the search UI to break entirely for that user until they manually clear storage. `T-14-03` is cited as the threat this code guards against, but the guard stops at the array level, not the entry level.

**Fix:** Filter malformed entries inside `parseSearchHistory`:

```ts
export function parseSearchHistory(raw: string | null): SearchHistoryEntry[] {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is SearchHistoryEntry =>
        e !== null && typeof e === 'object' &&
        typeof e.query === 'string' && typeof e.ts === 'number'
    );
  } catch {
    return [];
  }
}
```

---

## Warnings

### WR-01: `run()` catch block silently maps network errors to the "no results" UI

**File:** `src/routes/(app)/search/+page.svelte:84-88`

**Issue:** The catch block in `run()` does not distinguish a user-initiated abort (`AbortError`) from a genuine network failure:

```ts
} catch {
    results = [];
    hasMore = false;
}
```

When `searchAll` throws for a non-abort reason (e.g. all four sources fail, or a network error kills the fetch), `someFailed` stays `false` (it is only set inside the `try` block at line 78). The page renders the same empty `<p class="muted">{t('search.empty')}</p>` that appears for a legitimate zero-result query. The user has no signal that a fetch error occurred rather than a genuine empty result set. Note that `loadMore()` at line 117-119 already does distinguish `AbortError` — `run()` should too.

**Fix:**

```ts
} catch (err) {
    // AbortError = superseded query; do nothing (new run() already reset state).
    if (err instanceof DOMException && err.name === 'AbortError') return;
    results = [];
    hasMore = false;
    someFailed = true; // surface the failure — same banner as partial source errors
}
```

---

### WR-02: `BAND_128` regex over-matches sub-128k JOOX tiers (`AAC 96`, `AAC 48`)

**File:** `src/lib/sources/quality.ts:15`

**Issue:** The regex `/128|192|aac/i` matches any string containing `aac` regardless of bitrate. JOOX has two tiers below 128k — `'AAC 96'` and `'AAC 48'` — that both match because of the `aac` branch. Under `pref='128'`, `pickByQualityPref` promotes these tiers into the `inBand` group and probes them _before_ lossless/320k tiers. The comment in the code declares the intent as the "128–160k band", but the regex definition does not match that intent.

In practice JOOX is probed in order, so a higher-bitrate tier that is reachable will still win if it appears earlier in the JOOX ladder... but the reordering logic does move `AAC 96`/`AAC 48` ahead of `OGG 320`/`MP3 320`/lossless tiers when `pref='128'`. A user requesting 128k quality could end up with a 48kbps stream if higher tiers are geo-blocked but `AAC 48` is reachable.

**Fix:** Exclude sub-128k AAC tiers with a more precise pattern:

```ts
/** 128–192k band — JOOX `AAC 192`/`OGG 192`/`MP3 128`, QQ STD (128kbps). */
const BAND_128 = /\b(128|192)\b|(?<!\d)(aac\s*(?:192|128))/i;
```

Or, simpler and explicit — avoid the broad `aac` branch entirely and rely on bitrate numbers only:

```ts
const BAND_128 = /128|192/i;
```

`AAC 96` and `AAC 48` will then sort into `rest` (probed after 128-band tiers), which matches the stated intent.

---

### WR-03: QQ `pickBestPlayUrl` silently ignores `'320'` preference

**File:** `src/lib/sources/qq.ts:72-105`

**Issue:** `pickBestPlayUrl` has an explicit early-return for `settings.defaultQuality === '128'` (line 75) but no corresponding path for `'320'`. When `pref='320'`, the function falls through to the legacy lossless-first ladder (`sq > pq > accom > hq > standard > fq`). A user who sets 320k quality receives lossless on QQ instead of the `song_play_url_hq` (~320kbps HQ tier), with no indication anything deviated from their preference. JOOX handles `'320'` correctly via `pickByQualityPref(JOOX_QUALITY_ORDER, settings.defaultQuality)`. QQ's inline conditional approach is inconsistent with JOOX/quality.ts and silently drops the user's intent.

**Fix:** Mirror the `'128'` pattern for `'320'`:

```ts
function pickBestPlayUrl(d: QQDetailItem): BestPlayUrl {
    if (settings.defaultQuality === '128' && d.song_play_url_standard) {
        return { url: d.song_play_url_standard, tag: 'standard', label: 'STD',
                 text: `STD ${d.kbps_standard || ''}`.trim() };
    }
    if (settings.defaultQuality === '320' && d.song_play_url_hq) {
        return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ',
                 text: `HQ ${d.kbps_hq || ''}`.trim() };
    }
    // ... existing lossless-first ladder unchanged
```

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
