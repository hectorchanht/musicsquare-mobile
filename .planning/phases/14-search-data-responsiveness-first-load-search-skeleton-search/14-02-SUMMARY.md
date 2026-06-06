---
phase: 14
plan: 02
subsystem: search-ux
tags: [runes-store, session-restore, search-history, progressive-streaming, skeleton, snippet]
requires:
  - "searchAll onPartial (catalog.ts, 14-01)"
  - "dedupeBest (dedupe.ts)"
  - "searchHistory store (14-01)"
  - "settings.preferredSource"
  - "overlays runes-singleton + SSR-guard pattern"
provides:
  - "searchSession: in-memory runes singleton (q/results/page/hasMore/scrollY/searched) with hasPrior/save/setScroll/reset, SSR-guarded"
  - "search page: D-01 first-load skeleton (one {#snippet}), D-02 instant cross-nav restore (no refetch) + scroll, D-05 tappable past-search suggestions, D-06 progressive streaming with two-layer abort guard"
affects:
  - "src/routes/(app)/search/+page.svelte (the live search UX)"
  - "src/lib/i18n/{en,zh-Hant,zh-Hans}.ts (search.recent / search.clear keys)"
tech-stack:
  added: []
  patterns:
    - "In-memory runes-class singleton for cross-route session state (mirrors overlays/player)"
    - "Browser-side-write discipline as the SSR module-state-leak mitigation (no persistence)"
    - "Single {#snippet} shared by two render branches (one skeleton style, D-01)"
    - "Two-layer stale-partial abort guard (captured myAc.signal.aborted || kw !== q.trim())"
key-files:
  created:
    - src/lib/stores/searchSession.svelte.ts
    - src/lib/stores/searchSession.svelte.test.ts
  modified:
    - src/routes/(app)/search/+page.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
decisions:
  - "D-02: searchSession is IN-MEMORY only (cross-route within a session, not persisted, not cross-reload); the SSR-leak (T-14-05) mitigation is browser-side-write discipline + HAS_WINDOW backstop on setScroll, NOT a localStorage guard"
  - "D-01: factored the shipped load-more skel rows into ONE {#snippet skeletonRows(count,label)}; first-load gate = loading && results.length===0; empty branch tightened to searched && !loading && results.length===0 so the skeleton wins during streaming"
  - "D-05: suggestions surface on inputFocused && q.trim()==='' && !searched && entries.length>0; 150ms blur-delay + onmousedown-preventDefault on each suggestion/clear button so a tap registers before blur closes the list; recorded on submit of a non-empty kw (zero-result queries still listed)"
  - "D-06: run() passes onPartial that re-runs dedupeBest per partial (REPLACE, not patch); results cleared at run() start so the D-01 skeleton shows until the first partial; loadMore stays blocking"
metrics:
  duration_min: 4
  tasks: 2
  files: 6
  tests_added: 6
  completed: 2026-06-06
---

# Phase 14 Plan 02: Search Page UX Summary

The four Phase-14 search-page behaviors converge on `search/+page.svelte`: D-01 first-load skeleton (reuse the shipped `.skel` rows via one `{#snippet}`), D-02 instant cross-navigation restore via a new in-memory `searchSession` runes singleton (no refetch, scroll-restored), D-05 tappable past-search suggestions wired to `searchHistory` + the `run()` entrypoint, and D-06 progressive streaming by passing `onPartial` to `searchAll` with a two-layer abort guard against stale partials. Two auto tasks shipped; the runtime behaviors await a blocking human-verify checkpoint (Task 3).

## What Was Built

### Task 1 — D-02 `searchSession` runes store (`3586710`)
- `searchSession.svelte.ts`: a Svelte-5 runes-class singleton mirroring `overlays.svelte.ts`. Fields `q / results / page / hasMore / scrollY / searched` as `$state`. `get hasPrior()` = `q.trim().length > 0 && searched` (drives restore-vs-fresh). `save({...})` overwrites the five session fields (the reset-on-new-query path — a new query just calls `save` with fresh values). `setScroll(y)` is `HAS_WINDOW`-guarded; `reset()` returns all fields to defaults.
- **In-memory only** (D-02 floor): no localStorage. The SSR module-state-leak (T-14-05) mitigation is the documented browser-side-write discipline (the page only writes inside onMount/onDestroy/run/loadMore) plus the `HAS_WINDOW` backstop on the one imperative window-touching path (`setScroll`).
- Test (`searchSession.svelte.test.ts`, headless-runes / node project): default empty state, `save()` round-trip, `hasPrior` logic (false when q empty or searched false; true otherwise), second-`save()` overwrite (reset-on-new-query), `reset()` to defaults, and the SSR guard (`typeof window === 'undefined'` → `setScroll` no-ops, store still constructs).

### Task 2 — Wire the search page: D-01 / D-02 / D-05 / D-06 (`aa8a84f`)
- **D-01 skeleton:** factored the load-more skel `<li>` into `{#snippet skeletonRows(count, label)}` and `@render` it in BOTH a new `{#if loading && results.length === 0}` first-load branch (6 rows) and the existing `{#if loadingMore}` position (4 rows). No second skeleton style — the shipped `.skel` CSS (incl. the `prefers-reduced-motion` rule) is reused verbatim. The empty branch is tightened to `searched && !loading && results.length === 0` so the skeleton wins while results stream in.
- **D-02 restore:** `onMount` calls `searchHistory.load()`, then — when `searchSession.hasPrior` — restores `q/results/page/hasMore/searched` from the store with NO `searchAll` call, then `await tick()` + `window.scrollTo(0, searchSession.scrollY)` (scroll after results paint, Pitfall 6). `onDestroy` (browser-guarded) persists the live set + `window.scrollY`. `run()` and `loadMore()` call `persistSession()` after settling so a mid-stream navigation restores the freshest set. A new query overwrites the session via `save`.
- **D-05 suggestions:** `inputFocused` state bound via `onfocus`/`onblur`; on blur a 150 ms delay defers closing so a tap registers (each suggestion + the Clear button also `preventDefault` on `mousedown` so focus never leaves the input — belt-and-braces). When `inputFocused && q.trim() === '' && !searched && entries.length > 0`, a suggestions block renders below the form: a "Recent searches" heading, a "Clear" button (`searchHistory.clear()`), and `searchHistory.entries` as tappable rows that set `q = entry.query` then call `run()` (D-04 cache → instant). `searchHistory.add(kw)` is called in `run()` on submit of a non-empty trimmed kw. Added `search.recent` / `search.clear` i18n keys to all three dicts.
- **D-06 streaming:** `run()` passes a 5th `onPartial` arg to `searchAll` that, guarded by `if (myAc.signal.aborted || kw !== q.trim()) return;`, sets `results = dedupeBest(partial.interleaved, settings.preferredSource)` on each partial (re-derive, REPLACE — winner can change as a higher-quality source arrives). `results` is cleared at `run()` start so the D-01 skeleton shows until the first partial. The final await re-derives the authoritative superset; `loading` stays true until `finally` (submit button disabled). `loadMore()` stays blocking (skeleton covers it).

## Verification

- `pnpm test`: **281 passed / 281** (262 from 14-01 + 6 new searchSession headless-runes tests; the rest of the suite unchanged — no page-edit regression).
- `pnpm check` (svelte-check): **0 errors, 0 warnings** (4026 files) — typed `onPartial`, `searchSession`/`searchHistory` imports, `{#snippet}`/`@render` syntax, new i18n keys (a missing key would be a compile error since `t()` is typed against `en`).
- Grep assertions: `+page.svelte` references `searchSession` (11×), `searchHistory.add` / `.entries` / `.clear`, passes a 5th `onPartial` arg to `searchAll`, and the skeleton is a `{#snippet}` rendered in both branches (2× `@render skeletonRows`).

## Deviations from Plan

### Auto-added (Rule 2 — missing critical functionality)

**1. [Rule 2 - Correctness] Added `search.recent` + `search.clear` i18n keys to all three dicts**
- **Found during:** Task 2 (D-05 suggestions UI).
- **Issue:** `t()` is typed against `en`'s keys, so the suggestions heading + Clear label needed real i18n keys or `pnpm check` would fail with a compile error. The plan's action described the suggestions UI but did not enumerate the i18n keys.
- **Fix:** Added `search.recent` ("Recent searches" / "最近搜尋" / "最近搜索") and `search.clear` ("Clear" / "清除" / "清除") to `en.ts`, `zh-Hant.ts`, `zh-Hans.ts`.
- **Files modified:** `src/lib/i18n/{en,zh-Hant,zh-Hans}.ts`.
- **Commit:** `aa8a84f`.

**2. [Rule 2 - Correctness] Guarded the `window.scrollY` READ in `onDestroy` with `typeof window !== 'undefined'`**
- **Found during:** Task 2 (D-02 onDestroy save).
- **Issue:** The plan's action wrote `searchSession.scrollY = window.scrollY` directly in `onDestroy`. While `searchSession.setScroll` is `HAS_WINDOW`-guarded internally, the `window.scrollY` READ itself happens at the call site before `setScroll`, which would throw a `ReferenceError` if `onDestroy` ever ran without a window (SSR-leak class, T-14-05).
- **Fix:** Wrapped the persist+scroll block in `if (searched && typeof window !== 'undefined')` and call `searchSession.setScroll(window.scrollY)` inside it. Matches the browser-side-write discipline the store documents.
- **Files modified:** `src/routes/(app)/search/+page.svelte`.
- **Commit:** `aa8a84f`.

No bugs (Rule 1), blocking issues (Rule 3), or architectural decisions (Rule 4) encountered. No authentication gates. No packages installed.

## Known Stubs

None. All four behaviors are wired and (where a node seam exists) tested. The three browser-runtime behaviors with no node test seam (D-01 skeleton render, D-02 scroll restore, D-05 focus/tap, D-06 visual streaming) are intentionally deferred to the Task-3 human-verify checkpoint per VALIDATION.md "Manual-Only Verifications" — that is the planned verification path, not a stub.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes. `searchSession` is in-memory module state; its only trust boundary (SSR leak, T-14-05) is mitigated by the documented browser-side-write discipline. The two-layer abort guard (T-14-06) is implemented in `run()`'s `onPartial` exactly as the threat register specifies. No new packages (T-14-SC: zero installs).

## Outstanding — Task 3 (blocking human-verify checkpoint)

Task 3 is a `checkpoint:human-verify` with `gate="blocking"` and the plan is `autonomous: false`. The auto tasks are complete and statically verified (`pnpm check` 0/0, `pnpm test` 281/281); this checkpoint confirms the four browser-runtime behaviors that have no node test seam. It is SURFACED to the operator, NOT self-approved. Verification steps (run `pnpm dev`, phone-width viewport):
1. **D-01:** search "jay" → shimmer skeleton rows appear before results, then yield to real rows; enable prefers-reduced-motion → shimmer stops (rows still show).
2. **D-06:** with Network tab open, results appear incrementally (first source before all four settle); search a different term mid-load → no old-query rows flash in.
3. **D-02:** after "jay" loads, go to Library/Home then back to Search → same query + results INSTANTLY, no spinner, NO new network request, scroll restored; change query → resets and searches fresh.
4. **D-05:** clear + focus the input (empty, pre-query) → past searches show as tappable rows; tap one → re-runs (cache-hit instant); tap Clear → list empties.

Resume signal: operator types "approved", or reports an issue to address before re-verifying.

## Self-Check: PASSED

- Created files exist: `src/lib/stores/searchSession.svelte.ts`, `src/lib/stores/searchSession.svelte.test.ts` — both present on disk.
- Commits exist: `3586710` (Task 1), `aa8a84f` (Task 2) — both in `git log`.
- `pnpm test` 281/281, `pnpm check` 0/0.
