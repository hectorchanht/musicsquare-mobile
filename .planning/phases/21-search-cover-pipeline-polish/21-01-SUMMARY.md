---
phase: 21-search-cover-pipeline-polish
plan: 01
subsystem: search-scoring
tags: [scoring, search, qq, duration, tdd, pure-logic]
requires:
  - matchKey (src/lib/services/match-key.ts)
  - Track / SourceId types (src/lib/sources/types.ts)
provides:
  - "Track.duration optional field (seconds)"
  - "QQ resolve() maps song_play_time → Track.duration"
  - "computeSetContext / SetContext (pure cross-source artist map + queryLen)"
  - "scoreMatch optional 3rd SetContext arg + 試聽 penalty + short-title/artist boosts"
  - "SHORT_CLIP_SEC / PREVIEW_PENALTY / SHORT_TITLE_BOOST_MAX / ARTIST_FREQ_BOOST consts"
affects:
  - "Plan 04 (search page) — wires computeSetContext + scoreMatch ctx into the live result set"
tech-stack:
  added: []
  patterns:
    - "Additive-optional Track field (mirrors Last.fm tags?/bio? precedent); not in serialize whitelist"
    - "Pure node-Vitest-testable scoring module (no $state/$app/I/O), import-light"
    - "Derived tuning constant (PREVIEW_PENALTY) instead of two independent magnitudes (Pitfall 2)"
key-files:
  created:
    - src/lib/services/score-context.ts
    - src/lib/services/score-context.test.ts
  modified:
    - src/lib/sources/types.ts
    - src/lib/sources/qq.ts
    - src/lib/sources/qq.test.ts
    - src/lib/sources/__fixtures__/qq.detail.json
    - src/lib/services/score-match.ts
    - src/lib/services/score-match.test.ts
decisions:
  - "QQ duration plumbed in resolve() (not search): live tang search returns NO length; the detail body exposes song_play_time (numeric seconds). This is the only QQ surface that reports duration."
  - "PREVIEW_PENALTY derived = SIM_EXACT + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1 = 16, guaranteeing D-04 penalty-dominance for any boost combination."
metrics:
  duration: ~6 min
  completed: 2026-06-11
  tasks: 3
  files: 6
---

# Phase 21 Plan 01: Search Scoring — 試聽 Penalty + Cross-Source/Short-Title Boosts + QQ Duration Summary

Folded three set-relative search-scoring signals (sub-60s 試聽 penalty, short-title proximity boost, cross-source artist boost) into the pure `scoreMatch` brain behind an additive-optional `SetContext` 3rd arg, and plumbed `Track.duration` end-to-end for QQ via the detail body's `song_play_time` — so the preview penalty is demonstrable, not dormant, while the existing 2-arg `resolveStub`/`tryFallback` callers stay byte-identical.

## What Was Built

- **`Track.duration?: number`** (seconds) — additive/optional, mirroring the Last.fm `tags?`/`bio?` precedent. `undefined` means "source did not report a length" and is NEVER penalized (D-03). Not added to any serialize whitelist.
- **QQ duration plumbing** — `qq.resolve()` maps the detail body's numeric `song_play_time` onto `Track.duration`, guarded (`typeof === 'number' && > 0`) so a non-numeric / negative / zero upstream value becomes `undefined` (T-21-01 tampering mitigation; D-03). `proxy/qq.ts` needed no change — it is a D-09 passthrough that forwards the upstream body untouched.
- **`score-context.ts`** — new pure module exporting `SetContext { artistSources: Map<string, Set<SourceId>>; queryLen: number }` and `computeSetContext(rows, query)`. Artist map keyed artist-only via `matchKey(artist, '')` (mirroring `artistCoverCacheKey`); the value Set de-dupes sources so 5 rows from one source stays size 1 (D-05 — cross-source presence, not row count). `queryLen = query.trim().length`.
- **`scoreMatch` extended** — optional 3rd `ctx?: SetContext` arg. Base `similarity − variantPenalty` is byte-unchanged for 2-arg callers. The 試聽 penalty fires off duration alone (independent of ctx); the short-title (D-06 proximity) and cross-source-artist (D-05) boosts fire only when ctx is supplied.

## Upstream Field Confirmation (Task 1 acceptance)

Confirmed against the **live** `/api/qq/...` upstream (`tang.api.s01s.cn/music_open_api.php`):

- **Search** response rows expose only `song_title`, `pay`, `song_mid`, `singer_name` — **no duration/interval field**. The plan's Assumption A1 contingency applies: duration is not in QQ search.
- **Detail** response exposes `song_play_time: 223` (numeric **seconds**) and `duration: "00:03:43"` (display string). `song_play_time` is the numeric-seconds field plumbed onto `Track.duration`.

The plan's Task 1 originally targeted the search push block; because QQ search genuinely carries no length, duration is plumbed in `resolve()` where it actually exists — at least one source now carries duration end-to-end, so the penalty is not dormant (deviation Rule 3, documented below).

## Tuning Constants (Task 3 acceptance)

| Const | Value | Role |
|-------|-------|------|
| `SHORT_CLIP_SEC` | 60 | strictly below → 試聽 clip; at threshold = full track |
| `SHORT_TITLE_BOOST_MAX` | 3 | max D-06 short-title proximity reward |
| `ARTIST_FREQ_BOOST` | 2 | flat D-05 reward for artist in 2+ sources |
| `PREVIEW_PENALTY` | 16 (derived) | `SIM_EXACT(10) + SHORT_TITLE_BOOST_MAX(3) + ARTIST_FREQ_BOOST(2) + 1` |

`PREVIEW_PENALTY` is a **derived** constant (not an independently-chosen magnitude), guaranteeing a sub-60s clip carrying every boost still scores strictly less than a clean unboosted full track for ANY boost combination (D-04 penalty-dominance, Pitfall 2 avoided). This invariant is test-asserted.

## Deviations from Plan

### Auto-fixed / Adapted Issues

**1. [Rule 3 - Blocking] QQ duration plumbed in `resolve()` instead of `search()`**
- **Found during:** Task 1 (live upstream verification per Assumption A1)
- **Issue:** Plan Task 1 instructed mapping a search-row `interval` field onto `duration` in the `search()` push block. The live tang search response carries no length field at all.
- **Fix:** Mapped the detail body's numeric `song_play_time` (seconds) onto `Track.duration` in `qq.resolve()` — the only QQ surface that reports duration. This is the plan's own A1 contingency ("plumb the cheapest source that does"). The penalty is demonstrable end-to-end (a QQ track's duration is populated once resolved), and synthetic test fixtures prove D-04/D-03 directly.
- **Files modified:** src/lib/sources/qq.ts, src/lib/sources/__fixtures__/qq.detail.json (added `song_play_time: 223`)
- **Commit:** 0d9feb4

**2. [Rule 1 - Test bug] Corrected an over-strict D-03 test assertion**
- **Found during:** Task 3 GREEN
- **Issue:** The first-draft D-03 test asserted an undefined-duration candidate scores identically with and without ctx — but ctx legitimately adds the short-title boost, so that assertion was wrong (it conflated "unknown duration adds no penalty" with "ctx adds nothing").
- **Fix:** Reworded the test to compare an undefined-duration candidate against an identical full-length (223s) candidate — both must score equal because neither is a sub-60s clip, correctly isolating the D-03 unknown-neutrality claim.
- **Files modified:** src/lib/services/score-match.test.ts
- **Commit:** 5e20d13

`proxy/qq.ts` was inspected and left unchanged (D-09 passthrough preserves `song_play_time`).

## Verification

- `pnpm check` — 0 errors, 0 warnings (4106 files)
- `pnpm test -- score-match score-context discovery fallback` — 69/69 green
- Full suite: `pnpm test` — **687/687 passing**
- D-03 (unknown-neutrality), D-04 (penalty-dominance + derived invariant), D-05 (cross-source not row-count), D-06 (query-length proximity), D-07 (2-arg regression) all test-asserted
- 2-arg `scoreMatch(query, candidate)` signature preserved; discovery.ts/fallback.ts pass no new arg

## TDD Gate Compliance

Each task followed RED → GREEN: a failing `test(21-01)` commit precedes its `feat(21-01)` commit (0239840→0d9feb4, 89e285d→e0d4249, ffcde18→5e20d13). No REFACTOR commits needed.

## Self-Check: PASSED

- FOUND: src/lib/services/score-context.ts
- FOUND: src/lib/services/score-context.test.ts
- FOUND: src/lib/sources/types.ts (duration?: number)
- FOUND commits: 0239840, 0d9feb4, 89e285d, e0d4249, ffcde18, 5e20d13
