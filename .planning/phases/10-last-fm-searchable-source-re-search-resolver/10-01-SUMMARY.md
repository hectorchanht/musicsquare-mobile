---
phase: 10-last-fm-searchable-source-re-search-resolver
plan: 01
subsystem: api
tags: [lastfm, resolver, scoring, matchKey, dedupe, vitest, tdd]

# Dependency graph
requires:
  - phase: 09-discovery-hot-picks-tab
    provides: "resolveStub (Last.fm {artist,title} → playable Track via searchAll + dedupeBest) — LFSRC-02"
  - phase: 01 (v1.0 data layer)
    provides: "searchAll (catalog.ts), dedupeBest (dedupe.ts), matchKey (match-key.ts)"
provides:
  - "Pure scoreMatch(query, candidate) best-match re-ranking helper + exported VARIANT_KEYWORDS (English + CJK)"
  - "resolveStub upgraded from blind dedupeBest[0] to a scored pick (clean title beats cover/karaoke/live/instrumental variant)"
  - "LFSRC traceability reconciled per D-01 (LFSRC-01 dropped, LFSRC-02 done in Phase 9, LFSRC-03 complete)"
affects: [discovery, tap-to-play, album-tracklist, lastfm-resolution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, node-vitest-testable scoring helper (like match-key.ts / dedupe.ts) — no $state/$app/I/O"
    - "Stable-max re-ranking: scoring re-orders, dedupeBest (quality + preferredSource) stays the final tie-break"

key-files:
  created:
    - src/lib/services/score-match.ts
    - src/lib/services/score-match.test.ts
  modified:
    - src/lib/services/discovery.ts
    - src/lib/services/discovery.test.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "Scorer lives in its own pure file src/lib/services/score-match.ts (CONTEXT discretion — pure + unit-testable over inlining in discovery.ts)"
  - "score = similarity(matchKey artist-first) − variantPenalty; weights as named consts (SIM_EXACT=10, VARIANT_WEIGHT=4) so similarity out-weighs a single variant hit but a clean exact match always beats a same-key variant"
  - "Stable max in resolveStub: only a STRICTLY higher score replaces the current best, so equal scores keep the earlier dedupeBest slot → dedupeBest order is the final tie-break (D-02)"
  - "No threshold, no source/quality logic in the scorer (D-03 + separation); 2-arg searchAll call and try/catch→null posture preserved verbatim (D-05)"

patterns-established:
  - "Variant-keyword penalty with query-asked-for-variant exception: scan candidate title for VARIANT_KEYWORDS not present in the query string"
  - "Reuse matchKey (artist-first normalization) for similarity rather than reimplementing norm()"

requirements-completed: [LFSRC-03]

# Metrics
duration: ~12min
completed: 2026-06-06
---

# Phase 10 Plan 01: Last.fm best-match scoring (LFSRC-03) Summary

**Pure `scoreMatch` helper (matchKey similarity − variant-keyword penalty, English + CJK) wired into `resolveStub` so a tapped Last.fm track resolves to the CLEAN studio cut, not a karaoke/翻唱/cover/live variant — dedupeBest preferredSource/quality stays the final tie-break.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-06T21:30Z (approx)
- **Completed:** 2026-06-06T21:36Z (approx)
- **Tasks:** 3
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Pure, deterministic `scoreMatch(query, candidate): number` re-ranking helper + exported editable `VARIANT_KEYWORDS` (cover/karaoke/live/instrumental/remix/… + CJK 翻唱/卡拉ok/现场/伴奏/纯音乐/…).
- `resolveStub` re-ranks the dedupeBest-ordered candidates by `scoreMatch` with a stable max — a karaoke/翻唱/cover variant ordered first by `dedupeBest[0]` no longer wins the tap (T-10-01 mitigation).
- "Query asked for the variant" exception: tapping a `Song (Live)` / `稻香 现场` track is NOT penalized for getting the live take.
- Graceful-miss / never-throws posture and the verbatim `searchAll(\`${artist} ${title}\`, 1)` 2-arg call preserved (D-03 / D-05).
- LFSRC traceability reconciled (D-01): LFSRC-01 dropped to backlog, LFSRC-02 marked done (Phase 9), LFSRC-03 complete; D-04 duration-check drop recorded.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 (RED): failing scoreMatch spec** - `37069ae` (test)
2. **Task 1 (GREEN): pure scoreMatch + VARIANT_KEYWORDS** - `9e831df` (feat)
3. **Task 2 (RED): failing resolveStub scoring cases** - `29da8bf` (test)
4. **Task 2 (GREEN): resolveStub scored pick** - `a2cb6a1` (feat)
5. **Task 3: reconcile LFSRC traceability (D-01)** - `9199195` (docs)

**Plan metadata:** (this SUMMARY commit — see final commit)

_Note: REFACTOR gate not needed — GREEN implementations were already clean._

## Files Created/Modified
- `src/lib/services/score-match.ts` - Pure `scoreMatch` (matchKey similarity − variant penalty) + exported `VARIANT_KEYWORDS`. No source/quality/threshold logic.
- `src/lib/services/score-match.test.ts` - 9 vitest cases: variant penalty (English + CJK), query-asked-for-variant exception, similarity ordering, exported-list shape, determinism.
- `src/lib/services/discovery.ts` - `resolveStub` upgraded to a scored stable-max pick over dedupeBest candidates; `scoreMatch` imported; null only on zero results; never throws.
- `src/lib/services/discovery.test.ts` - 4 new resolveStub cases (clean beats 翻唱-first, clean beats cover-first, equal-score dedupeBest tie-break, null-on-miss/never-throws); existing 4 cases unchanged + green.
- `.planning/REQUIREMENTS.md` - Phase 10 traceability rows + footnote (D-01 rescope, D-04 duration-check drop).
- `.planning/ROADMAP.md` - Phase 10 CONTEXT-D-01 surface note (criterion #4 N/A, #2 duration drop, #3 preserved).

## Decisions Made
- **Scorer in its own pure file** (`score-match.ts`) per CONTEXT discretion — unit-testable in isolation like `match-key.ts`/`dedupe.ts`.
- **Similarity via `matchKey` (artist-first) + graded per-component/token overlap**, not a reimplemented `norm` (norm is not exported). Exact key match = `SIM_EXACT` (10); per-component artist/title equality + latin-token overlap grade partial matches.
- **`VARIANT_WEIGHT` (4) < `SIM_EXACT` (10)** so a single un-asked variant keyword down-ranks a candidate but the similarity term still dominates; a clean exact match always beats a same-song variant.
- **Stable max (strictly-greater replacement)** makes the dedupeBest ordering the final tie-break for equal scores (D-02) without re-implementing quality/source ranking in the scorer.

## Deviations from Plan

None - plan executed exactly as written. No bugs, missing functionality, or blocking issues encountered; no architectural decisions required.

## Issues Encountered

- **Concurrent-session isolation (expected, not a problem):** The working tree carried uncommitted edits from other concurrent sessions — `catalog.ts` mid-adding an optional `onPartial` param to `searchAll` (backward-compatible; `resolveStub`'s 2-arg call is unaffected), `.planning/HANDOFF.json`, `.planning/STATE.md`, and untracked phase 14/15 dirs. All were left untouched. Only file-scoped `git add <my files>` was used (never `git add -A`). A concurrent `docs(14-01)` commit interleaved with my commits on `main` — harmless. `ROADMAP.md` was edited by a concurrent session between my read and write (caught by the edit-staleness guard); I re-read the Phase 10 section (unchanged) and re-applied my targeted edit cleanly.
- **No STATE.md update** performed (a concurrent session owns it, per the sequential-execution directive).

## TDD Gate Compliance

Both behavior-adding tasks followed RED → GREEN:
- Task 1: `test` commit `37069ae` (RED — module-missing failure) → `feat` commit `9e831df` (GREEN).
- Task 2: `test` commit `29da8bf` (RED — 2 variant-first cases failed under blind `dedupeBest[0]`) → `feat` commit `a2cb6a1` (GREEN).
RED was genuinely observed failing in both cases before implementation. REFACTOR gate not required.

## Verification

- `pnpm check` → 0 errors / 0 warnings (twice — after Task 1 and Task 2).
- `pnpm test` (full suite) → 275 passed across 33 files, no regressions, no concurrent-session test failures.
- `pnpm test -- discovery score-match` → 37 passed (the two touched suites green in isolation).
- Behavioral proof (T-10-01): a `稻香 翻唱` / `Song Cover` candidate ordered FIRST resolves to the CLEAN track via `resolveStub`.
- Graceful-miss proof (T-10-02): zero searchAll hits → null; searchAll throwing → null (never throws) — existing cases unchanged.
- Traceability proof: `grep "LFSRC-0" .planning/REQUIREMENTS.md` shows LFSRC-01 dropped / LFSRC-02 Complete / LFSRC-03 Complete; ROADMAP Phase 10 carries the D-01 surface note.

## Threat Surface Scan

No new threat surface. `scoreMatch` is a pure in-memory ranking function; `resolveStub` reuses the existing `searchAll` (already-deployed CN proxies). No new endpoint, secret, dependency, or external call (matches plan `<threat_model>` surface note; T-10-01 hardened, T-10-02 preserved, T-10-03 N/A — no install).

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LFSRC-03 delivered; Phase 10 scope (per D-01) complete. The Last.fm re-search resolver now plays the right song.
- Phase 11 (Signed-call Infrastructure & Auth) is independent of this work and unblocked.

## Self-Check: PASSED

All created/modified files exist on disk; all 5 task commits (`37069ae`, `9e831df`, `29da8bf`, `a2cb6a1`, `9199195`) verified in git history.

---
*Phase: 10-last-fm-searchable-source-re-search-resolver*
*Completed: 2026-06-06*
