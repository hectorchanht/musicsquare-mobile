---
phase: 14
plan: 01
subsystem: search-data-services
tags: [ttl-cache, quality-ladder, search-history, progressive-streaming, runes]
requires:
  - searchAll seam (catalog.ts)
  - settings.defaultQuality (was dead code)
  - history pure-logic/runes split pattern
provides:
  - "ttl-cache: cached(key, ttlMs, factory) + __clearSearchCache()"
  - "catalog.searchAll: page-keyed TTL memoization + optional onPartial streaming + PartialSearchResult"
  - "quality.pickByQualityPref(tiers, pref): pure band-first ladder reorder"
  - "settings.defaultQuality default '128' wired into QQ/JOOX/Kuwo ladders"
  - "search-history-logic: recordQuery/parseSearchHistory + SEARCH_HISTORY_KEY/CAP"
  - "searchHistory.svelte: thin runes wrapper (entries/add/clear/load)"
affects:
  - src/lib/services/catalog.ts (callers: search page, picks, similar, discovery, NowPlaying, artist)
  - src/lib/sources/{qq,joox,kuwo}.ts (resolve quality selection)
tech-stack:
  added: []
  patterns:
    - "In-memory TTL Map cache wrapping a single seam (mirrors edge discovery cache)"
    - "Pure-logic + thin runes-wrapper split (mirrors history-logic/history.svelte)"
    - "Additive trailing optional param for non-breaking streaming (mirrors signal? addition)"
    - "Adapters import settings directly rather than threading a resolve param"
key-files:
  created:
    - src/lib/services/ttl-cache.ts
    - src/lib/services/ttl-cache.test.ts
    - src/lib/sources/quality.ts
    - src/lib/sources/quality.test.ts
    - src/lib/search/search-history-logic.ts
    - src/lib/search/search-history-logic.test.ts
    - src/lib/stores/searchHistory.svelte.ts
    - src/lib/stores/searchHistory.svelte.test.ts
    - src/lib/stores/settings.svelte.test.ts
  modified:
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/sources/qq.ts
    - src/lib/sources/joox.ts
    - src/lib/sources/kuwo.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/sources/qq.test.ts
    - src/lib/sources/joox.test.ts
    - src/lib/sources/kuwo.test.ts
decisions:
  - "D-03: client-ladder reorder (not br/level constant edit); JOOX_BR=4 untouched so proxy.test.ts stays green; adapters import settings directly"
  - "D-04: TTL cache at the searchAll seam, key includes page, 5-min TTL, __clearSearchCache() exported for test afterEach; final merged superset cached, not partials"
  - "D-05: distinct symbol (searchHistory) + key (openmusic:search-history:v1) from play-history; cap 12; pure-logic + runes-wrapper split"
  - "D-06: optional trailing onPartial param (non-breaking); accumulate→re-interleave→emit; abort guard in .finally; cache HIT fires onPartial once with pending:0"
metrics:
  duration_min: 8
  tasks: 4
  files: 18
  tests_added: 45
  completed: 2026-06-06
---

# Phase 14 Plan 01: Search & Data Service Layer Summary

D-04 page-keyed TTL memoization of `searchAll`, D-06 progressive `onPartial` streaming refactor of the same seam, D-03 wiring of the previously-dead `settings.defaultQuality` (now default `'128'`) into the QQ/JOOX/Kuwo quality ladders via a pure `pickByQualityPref` helper, and the D-05 pure search-history logic plus its thin runes store — all node-unit-testable with zero new dependencies.

## What Was Built

### Task 1 — D-04 TTL cache + page-keyed `searchAll` memoization (`672447a`)
- `ttl-cache.ts`: `cached(key, ttlMs, factory)` caches the RESOLVED value only (a rejection is never cached → next call retries; an AbortSignal is moot on a hit). `__clearSearchCache()` resets the module-level Map for tests.
- `catalog.ts`: split into the exported `searchAll` (cache wrapper) + private `searchAllUncached`. Key = `${keyword.trim().toLowerCase()}|${enabledSources}|${page}` — page-included (Pitfall 3), normalized for the key only (raw keyword still sent upstream). Re-exported `__clearSearchCache`; the catalog test `afterEach` now clears it so the 3 fan-out spy tests never see a stale cached SearchResult.
- Tests: hit/miss/expiry(fake timers)/reject-not-cached/clear + no-re-fan-out/page-key-distinctness/normalized-key-sharing.

### Task 2 — D-03 quality wiring, default `'128'` (`0c8ed2e`)
- `quality.ts`: pure `pickByQualityPref(tiers, pref)` — stable partition putting the pref band first; `'lossless'`/`'auto'` return the input order unchanged. Bands: `/128|192|aac/i`, `/320/i`, lossless vocabulary. Pref passed as an argument (no store mock needed).
- `settings.defaultQuality` default flipped `'auto'` → `'128'` (initializer + load fallback).
- QQ `pickBestPlayUrl`: promotes `song_play_url_standard` (STD ~128k) ahead of sq/pq/hq when pref is `'128'`; otherwise verbatim lossless-first ladder. Imports `settings` directly.
- JOOX `pickJooxPlayUrl`: probe order driven by `pickByQualityPref(JOOX_QUALITY_ORDER, settings.defaultQuality)`. `JOOX_BR=4` proxy constant left untouched.
- Kuwo `resolve`: requests `level=128k` when pref `'128'`, else `level=zp`. Best-effort (A1 token undocumented; proxy already forwards any `level`, no proxy edit).
- Tests: lossless landmine cases pinned with explicit `settings.defaultQuality='lossless'` (save/restore per case); new `'128'`-default cases (QQ→STD, JOOX→AAC 192, Kuwo→`level=128k`); settings default `'128'` assert; proxy `br=4` stays green.

### Task 3 — D-05 search-history (`188b495`)
- `search-history-logic.ts` (PURE): `recordQuery` (trim, ignore-empty, case-insensitive de-dupe→top, cap 12, most-recent-first, no mutation) + `parseSearchHistory` ([] on null/corrupt/non-array) + `SEARCH_HISTORY_KEY='openmusic:search-history:v1'` / `SEARCH_HISTORY_CAP=12`. Distinct symbol AND key from play-history.
- `searchHistory.svelte.ts`: thin runes wrapper (`entries`/`add`/`clear`/`load`), browser-guarded `load()`/`save()` (T-14-01 SSR module-state leak mitigation).
- Tests: pure-logic coverage (prepend/dedupe/ignore-empty/cap-12/no-mutation/trim; parse null/corrupt/non-array); store add/clear in-memory round-trip + SSR-guard no-throw + distinct-key invariant.

### Task 4 — D-06 progressive `searchAll` (`00c577c`)
- `PartialSearchResult { perSource, interleaved, pending }` exported.
- `searchAll`/`searchAllUncached` gain a trailing optional `onPartial` param (non-breaking — all other callers unchanged).
- `Promise.allSettled` replaced with per-adapter `.then/.catch/.finally`: each push into a running `acc`, re-`interleave(acc)` over the whole set, emit `onPartial({ perSource:[...acc], interleaved, pending })`. `.catch`-guarded so `Promise.all` never rejects (DATA-03 isolation preserved). `if (sig.aborted) return` in `.finally` drops partials for a superseded query. Cache HIT fires `onPartial` once with `pending:0` (uniform path).
- Tests: monotonic-growth/final-pending-0/both-uids, abort-suppression, onPartial-omitted-unchanged, cache-hit-fires-once; 3 original fan-out tests stay green.

## Verification

- `pnpm test`: **262 passed / 262** (was 217; +45 new across ttl-cache, quality, search-history-logic, searchHistory, settings, catalog).
- `pnpm check` (svelte-check): **0 errors, 0 warnings** (4022 files).
- proxy.test.ts `br=4` green; all `lossless` landmine asserts pinned explicitly; existing 3 catalog fan-out tests unchanged and green.

## Deviations from Plan

None — plan executed exactly as written. All four tasks followed the plan's actions, the documented landmine-test updates, and the D-03/D-04/D-05/D-06 decision constraints. No bugs, missing functionality, or blocking issues encountered (Rules 1–4 not triggered). No authentication gates.

## Known Stubs

None. All logic is wired and tested. The Kuwo `level=128k` token is BEST-EFFORT by design (decision A1 / D-03 honest `defaultQualityNote`), not a stub: the request is made and the response is honored; if the upstream ignores the token, Kuwo stays at its returned tier. This is documented in `kuwo.ts`, RESEARCH A1, and is acceptable per the plan.

## Notes for Plan 14-02 (consumer)

- `searchAll(kw, page, prefs, signal, onPartial)` — pass `onPartial` from `run()` for progressive render; `loadMore` may stay blocking.
- On each `onPartial`, the page must re-run `dedupeBest(partial.interleaved, settings.preferredSource)` (winner can change as a higher-quality source arrives) and re-derive `results` (REPLACE, not concatenate).
- Page abort guard still required in the handler (capture `q`/`ac`) in addition to the in-`searchAll` abort guard.
- `searchHistory` store: call `searchHistory.load()` in the search page `onMount`; `searchHistory.add(kw)` on submit of a non-empty trimmed query; `searchHistory.clear()` for clear-all.
- `settings.defaultQuality` now defaults `'128'` — the `/settings/playback` segmented control is now live.

## Self-Check: PASSED

All 9 created files exist on disk; all 4 per-task commits (`672447a`, `0c8ed2e`, `188b495`, `00c577c`) present in git history. `pnpm test` 262/262, `pnpm check` 0/0.
