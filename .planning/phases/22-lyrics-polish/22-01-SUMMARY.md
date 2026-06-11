---
phase: 22-lyrics-polish
plan: 01
subsystem: ui
tags: [lyrics, lrc, unicode-script, vitest, pure-functions]

# Dependency graph
requires:
  - phase: prior lyrics subsystem (lrc.ts / NowPlaying.svelte)
    provides: parseLRC, splitParenLines, LyricLine interface, fromParen render plumbing
provides:
  - dominantScript(text) — \p{Script}/u codepoint classifier (han/kana/hangul/latin/other)
  - reorderPairs(lines) — original-above-translation reorder within same-timestamp groups (D-04/D-05)
  - splitParenLines widened to 9 bracket pairs with script-mismatch gate (D-07/D-08/D-09, never-drop)
  - lineSeekFraction(time,duration) — pure seek-math helper (LYR-01)
affects: [22-02 (NowPlaying.svelte composes parse→reorder→split, per-line tap-seek via lineSeekFraction)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ES2018 Unicode property escapes (\\p{Script=...}/u) for dominant-script detection — no library, no hand-rolled codepoint ranges"
    - "Pair-aware bracket alternation regex (each open matched to its own close) to avoid cross-pairing"
    - "Structural never-drop guarantee: only script-mismatched bracket clauses are extracted, so originals can never be hidden"
    - "Pure array→array lyric transforms stay DOM-free and node-fixture-tested in lrc.ts (CLAUDE.md BACKEND-REUSE seam)"

key-files:
  created: []
  modified:
    - src/lib/services/lrc.ts
    - src/lib/services/lrc.test.ts

key-decisions:
  - "reorderPairs treats Han as the app's translation-target locale: when a song contains ANY non-Han script, the foreign script is the original language even if Han is the per-line count majority. Pure-CN songs (no foreign script) keep Han dominant but have no mismatched siblings, so reorder is a no-op regardless."
  - "Any-kana-presence ⇒ kana (A1): a kanji-heavy JP line is classified Japanese, not Han, so JP/CN disambiguation holds."
  - "splitParenLines computes the main-body script once (line with all brackets removed) and splits a clause out only when its script differs; same-script clauses survive inside the stripped main text (never-drop, LYR-05)."
  - "Used a pair-aware alternation regex over a single character class (Pitfall 4) so 愛（love）【chorus】 pairs （with） and 【with】, never （with】."

patterns-established:
  - "reorder-before-split ordering locked: reorderPairs defined and run before splitParenLines"
  - "lineSeekFraction extracted as pure helper so LYR-01 seek math is unit-testable independent of the player store"

requirements-completed: [LYR-04, LYR-05, LYR-01]

# Metrics
duration: 7 min
completed: 2026-06-12
---

# Phase 22 Plan 01: Pure Lyric Logic Summary

**dominantScript Unicode classifier, reorderPairs original-above-translation reorder, 9-bracket-pair script-aware splitParenLines (never-drop), and a pure lineSeekFraction helper — all DOM-free and fixture-tested in lrc.ts.**

## Performance

- **Duration:** ~7 min
- **Completed:** 2026-06-12
- **Tasks:** 2 (both TDD)
- **Files modified:** 2

## Accomplishments
- `dominantScript(text): Script` — counts codepoints via `\p{Script=Han|Hiragana|Katakana|Hangul|Latin}/u`; any-kana-wins heuristic (A1) disambiguates JP from CN.
- `reorderPairs(lines)` — computes a song-dominant "original language" baseline over all line bodies, then moves the original line above its translation within each same-timestamp group; pure-single-script songs pass through unchanged; stable for non-reordered siblings; idempotent.
- `splitParenLines` widened from `()（）` to all 9 bracket pairs (（）()【】[]［］「」『』〈〉《》) with a pair-aware regex; clauses are split out as `fromParen` ONLY on a script mismatch with the main body — same-script clauses (backing vocals, same-language quotes) stay inline (structural never-drop, LYR-05). Whole-line bracket/section markers ([Chorus], 【副歌】) still pass through unsplit (D-09).
- `lineSeekFraction(time, duration)` — returns `time/duration` or `null` when duration ≤ 0 / non-finite (LYR-01 seek math, consumed by 22-02).
- lrc test suite extended to 36 tests (from 13); full project suite 747 tests green; `pnpm check` 0 errors / 0 warnings.

## Task Commits

Each task was committed atomically (TDD: test + impl folded per task):

1. **Task 1: dominantScript + reorderPairs (D-04/D-05) with fixtures** — `eb72664` (feat)
2. **Task 2: widen splitParenLines to 9 bracket pairs + script gate; lineSeekFraction (D-07/D-08/D-09/LYR-01)** — `72d79cc` (feat)

_Note: RED (failing tests) and GREEN (implementation) were verified in-sequence within each task; the failing-test and implementation edits were folded into a single per-task feat commit since the test and source live in the same two-file change set._

## Files Created/Modified
- `src/lib/services/lrc.ts` — added `type Script`, `dominantScript`, `reorderPairs` (above splitParenLines), `lineSeekFraction`; rewrote `splitParenLines` body with `BRACKET_RE` pair-aware alternation + script-mismatch gate (whole-line passthrough retained).
- `src/lib/services/lrc.test.ts` — added `describe('dominantScript')`, `describe('reorderPairs')` (incl. idempotency), extended `describe('splitParenLines')` (9 pairs, mismatch split, never-drop, mixed-bracket, whole-line passthrough), `describe('lineSeekFraction')`, and a cross-function pipeline idempotency test.

## Decisions Made
- **Han = translation target, not original (reorderPairs baseline):** Counting alone ties or mislabels bilingual groups (1 original + 1–2 translation fragments). In this Chinese-music app the original is the foreign-script line; pure-CN songs simply have no foreign script and produce no reorder. This made all CN-above-EN/JP/KR fixtures and the pure-CN no-op pass with one consistent rule. (See Issues Encountered for the iteration.)
- **Pair-aware alternation regex** chosen over a single bracket character class to prevent （…】 cross-pairing (RESEARCH Pitfall 4), locked by the `愛（love）【chorus】` fixture.
- **Main-body script computed from the all-brackets-removed line**, so the mismatch gate compares each clause against the line's dominant language rather than against a fragment.

## Deviations from Plan

None - plan executed exactly as written.

(One non-source operational step was required: `pnpm install --frozen-lockfile` to populate this worktree's `node_modules` — worktrees do not inherit the parent checkout's installed dependencies. This restored existing lockfile dependencies only; no package was added. Not a code deviation.)

## Issues Encountered
- **reorderPairs song-dominant tie-breaking (resolved during Task 1 GREEN):** The first implementation used a Han-favouring max-count, which mislabeled the CN line as the "original" in even 2-line bilingual groups and in the 3-line (2 CN + 1 EN) group. Resolved by ranking any present foreign script (kana > hangul > latin) above Han for the song-dominant baseline; Han only wins when no foreign script exists (pure-CN), where reorder is a guaranteed no-op. All 6 reorderPairs fixtures then passed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All pure lyric logic for Phase 22 is landed, exported, DOM-free, and green. Plan 22-02 can compose `splitParenLines(reorderPairs(parseLRC(...)))` in the `lines` $derived and wire per-line tap-seek via `lineSeekFraction(line.time, player.duration)`.
- `reorderPairs` defined before `splitParenLines` (reorder-before-split ordering locked).
- No blockers.

## Self-Check: PASSED
- `src/lib/services/lrc.ts` — FOUND
- `src/lib/services/lrc.test.ts` — FOUND
- Commit `eb72664` (Task 1) — FOUND
- Commit `72d79cc` (Task 2) — FOUND
- `pnpm exec vitest run src/lib/services/lrc.test.ts` — 36 passed
- `pnpm exec vitest run` (full) — 747 passed
- `pnpm check` — 0 errors / 0 warnings

---
*Phase: 22-lyrics-polish*
*Completed: 2026-06-12*
