---
phase: 21-search-cover-pipeline-polish
plan: 04
subsystem: search-page
tags: [search, scoring, lazy-cover, autofocus, svelte-action, wiring]
requires:
  - scoreMatch 3-arg + computeSetContext (Plan 01 — score-match.ts / score-context.ts)
  - lazyCover action + resolveCoverForTrack helper (Plan 02 — actions/lazyCover.ts)
  - dedupeBest / dedupeBestWithDeezer (existing)
  - searchSession store (D-02 restore) / searchHistory store (D-05 recents)
provides:
  - "rankList(rows, query) — pure score-based full re-sort wired into all 4 dedupe commit sites"
  - "use:lazyCover on search result rows + resolvedCovers reactive repaint map (SRCH-02/COVER-02)"
  - "hardened empty-query autofocus that opens recents on a fresh visit (SRCH-03/D-19)"
affects:
  - "search/+page.svelte is the live consumer for the Plan-01 scoring brain + Plan-02 lazyCover"
tech-stack:
  added: []
  patterns:
    - "Pure local rankList helper: computeSetContext once, sort a COPY descending by scoreMatch; deterministic so equal scores keep dedupeBest appearance order (stable in practice)"
    - "Reactive resolved-cover map ($state<Record<string,string>>) reassigned via immutable spread in onResolved to repaint a single row"
    - "Score+sort runs INSIDE the existing myAc.signal.aborted || kw !== q.trim() race guards (Pitfall 3); restore path stays order-preserving (Pitfall 6)"
key-files:
  created:
    - .planning/phases/21-search-cover-pipeline-polish/21-04-SUMMARY.md
  modified:
    - src/routes/(app)/search/+page.svelte
decisions:
  - "query→{artist,title} mapping: raw trimmed keyword fed into BOTH slots ({ artist: kw, title: kw }) per researcher Q2/A4 — similarity degrades to token-overlap (still useful) while the short-title/artist-frequency boosts + 試聽 penalty are the dominant search-list signals"
  - "lazyCover attached to the .art span (not the row button) so the row's use:longpress + onclick are untouched; resolvedCovers prefers the resolved url then t.cover then gradient fallback"
  - "Autofocus hardened by ALSO setting inputFocused = true (not just .focus()) so D-19 recents open even if the programmatic focus does not synchronously fire onfocus"
metrics:
  duration: ~8 min
  completed: 2026-06-11
  tasks: 3 (of 4; Task 4 is a human-verify checkpoint)
  files: 1
---

# Phase 21 Plan 04: Search-Page Wiring (Scoring + Lazy Covers + Autofocus) Summary

Wired the Plan-01 scoring brain and Plan-02 lazyCover action into the live search page: the result list now re-sorts by `scoreMatch` after every dedupe (inside the existing race guards, persisted in sorted order, restore left order-preserving), each result row's cover resolves lazily on scroll-into-view via `use:lazyCover` with a reactive repaint map, and the already-shipped empty-query autofocus was verified and hardened to also open the recents list. Output is the edited `search/+page.svelte` only — zero new dependencies.

## What Was Built

### Task 1 — Score+sort step in run/onPartial/loadMore (commit fe24a65)
- Added a pure local `rankList(rows: Track[], query: string): Track[]`: computes `computeSetContext(rows, query)` once, builds `qObj = { artist: query, title: query }` (raw trimmed keyword into BOTH slots — researcher Q2/A4), and returns `[...rows].sort((a,b) => scoreMatch(qObj, b, ctx) - scoreMatch(qObj, a, ctx))` descending.
- Wrapped every `results = dedupeBest(...)` with `rankList`, keeping each inside its existing race guard:
  - **onPartial** (`if (myAc.signal.aborted || kw !== q.trim()) return;` then `results = rankList(dedupeBest(partial.interleaved, ...), kw)`)
  - **run() final** (`results = rankList(dedupeBest(interleaved, ...), kw)`)
  - **Deezer-boost post-paint swap** (inside its `myAc.signal.aborted || kw !== q.trim()` guard: `results = rankList(boosted, kw)`)
  - **loadMore()** (`const merged = rankList(dedupeBest(interleaved, ...), kw)` — rankList is pure; the subsequent `if (kw !== q.trim()) return` guard still prevents a superseded batch from assigning)
- Because `results` is always the sorted list, `persistSession()` already stores sorted order (Pitfall 6). The onMount restore (`results = searchSession.results`) was left untouched — order-preserving so the restored scroll offset lands correctly.

### Task 2 — use:lazyCover on result rows + reactive resolved-cover map (commit c63e43d)
- Added `let resolvedCovers = $state<Record<string, string>>({});`.
- Attached `use:lazyCover={{ track: t, onResolved: (uid, url) => { resolvedCovers = { ...resolvedCovers, [uid]: url }; } }}` to each result row's `.art` span.
- `.art` background-image now prefers the resolved cover: `(resolvedCovers[t.uid] ?? t.cover) ? url(...) : fallbackCover(t)`. Resolved values are https-only (Plan 02 `isSolidCover` gate) and rendered through the existing background-image sink (T-0bb-01 — no widening).
- The row's `use:longpress` + `onclick` (play + setListQueue) sit on the parent `<button class="row">` and are untouched; lazyCover stacks on the inner `.art` span.

### Task 3 — Verify-and-harden empty-query autofocus (commit f34ecde)
- The `if (!q.trim()) queryInputEl?.focus();` call was already onMount-only, after the `hasPrior` restore, gated on `!q.trim()` (D-17 — a restored prior query is non-empty so focus is not stolen). Confirmed there is NO `$effect` keyed on `q` that calls `.focus()` (the only `$effect` is the IntersectionObserver).
- Hardened for D-19: set `inputFocused = true` alongside the focus call so the recent-searches list opens on a fresh empty visit even if the programmatic `.focus()` does not synchronously fire the `onfocus` handler.
- iOS keyboard restriction accepted (D-18) — success criterion is the focused input (ring + caret); no gesture-chained nav hack added. ql0 typeahead untouched.

## query → {artist, title} Mapping (output requirement)

The raw trimmed search keyword is passed into **both** the artist and title slots: `{ artist: kw, title: kw }`. In `scoreMatch` this makes the `similarity` term a token-overlap measure (the query has no separate artist/title split on the search page), while the set-relative signals folded in by Plan 01 — the sub-60s 試聽 `PREVIEW_PENALTY` (off duration alone), the short-title proximity boost, and the cross-source artist-frequency boost (both via the supplied `SetContext`) — become the dominant re-ordering forces, which is exactly the intended search-list behavior.

## Expected Live Scoring Behavior (for Task 4 verification)

- **稻香**: a clean short title (稻香) should rank above long cover variants (稻香 (翻唱版) / DJ版) via the short-title proximity boost + the variant penalty in the base score.
- **試聽-clip query**: a QQ track whose resolved `song_play_time` is < 60s carries `Track.duration` < `SHORT_CLIP_SEC`; the derived `PREVIEW_PENALTY` (16) dominates every boost combination so the clip sinks to the bottom, never above a full track (D-04). Note: QQ duration is only populated after `resolve()` (search rows carry no length — Plan 01 finding), so a clip's sink may settle once its detail resolves.
- A brief reshuffle as sources stream in is expected and accepted (D-02).

## Verification

- `pnpm check` — 0 errors, 0 warnings (4108 files) after each task.
- `pnpm test -- score-match score-context discovery fallback lazyCover dedupe` — **77/77 passing** (the D-07 regression set + lazyCover + dedupe all green; no behavioral regression from the wiring).
- Manual checkpoint (Task 4) is the remaining gate: live scoring order on 稻香 / a 試聽 query, lazy covers resolving + caching (no refetch on re-scroll), and fresh-vs-restored autofocus.

## Deviations from Plan

None — plan executed exactly as written (Tasks 1–3). No package installs (zero new deps, T-21-SC not applicable). Threat mitigations T-21-08 (rank inside race guards), T-21-03/T-0bb-01 (https-only resolved covers via existing sink), and T-21-05 (per-row viewport-bounded lazyCover) are all satisfied by the wiring as specified.

## Self-Check: PASSED

- FOUND: src/routes/(app)/search/+page.svelte (rankList helper + 4 call sites, use:lazyCover, resolvedCovers, hardened autofocus)
- FOUND commits: fe24a65 (Task 1), c63e43d (Task 2), f34ecde (Task 3)
- `pnpm check` clean; regression suite 77/77 green
