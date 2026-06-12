---
phase: 23-ux-audit-homepage-artist-polish
plan: 03
subsystem: home-layout / settings
tags: [home, density, settings, compact-by-default, D-07, HOME-02]
requires:
  - home-layout.ts resolveSubset/resolveSectionOrder posture (quick-260606-w87)
  - settings.svelte.ts WR-10 3-touch-point pattern (Phase 17)
provides:
  - resolveSectionDensity pure resolver (D-07)
  - homeSectionDensity persisted override map (settings + defaults)
affects:
  - Plan 04 home page (consumes resolveSectionDensity, passes 'compact' globalDefault)
  - Plan 04 /settings/home UI (binds homeSectionDensity override map)
tech-stack:
  added: []
  patterns:
    - "Pure corrupt-input-fallback resolver (mirrors resolveSubset)"
    - "WR-10 3-touch-point settings pattern (field init / load guard / save+reset)"
    - "Object-not-array load guard (mirrors enabledSources / upnextPerContext)"
key-files:
  created: []
  modified:
    - src/lib/services/home-layout.ts
    - src/lib/services/home-layout.test.ts
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
decisions:
  - "resolveSectionDensity returns the per-section value only for exact 'comfortable'/'compact'; any other input falls to globalDefault (never blanks)"
  - "Compact-by-default (D-07) is achieved by Plan 04 passing 'compact' as globalDefault — this plan does NOT change the persisted homeDensity field semantics"
  - "homeSectionDensity uses the same object-not-array load guard as enabledSources (T-23-06)"
metrics:
  duration: ~10m
  completed: 2026-06-12
  tasks: 2
  files: 5
---

# Phase 23 Plan 03: Per-Section Density Plumbing Summary

Added the data/resolution layer for per-section home density (HOME-02 / D-07): a pure `resolveSectionDensity` resolver in `home-layout.ts` with corrupt-input fallback, plus a persisted `homeSectionDensity` override map wired through the Phase 17 WR-10 settings pattern with an object-not-array load guard. No UI — Plan 04 consumes both.

## What Was Built

### Task 1 — `resolveSectionDensity` resolver + compact-by-default (D-07)
- Added `export function resolveSectionDensity(sectionId, perSection, globalDefault): HomeDensity` to `src/lib/services/home-layout.ts`.
- Implementation: `const v = perSection?.[sectionId]; return v === 'comfortable' || v === 'compact' ? v : globalDefault;` — mirrors `resolveSubset`'s "unknown/garbage → fallback, never blank" posture.
- A per-section override wins only when it is exactly `'comfortable'` or `'compact'`; a missing key, an `undefined` map, or any garbage value falls back to `globalDefault`.
- Compact-by-default ships by the home page (Plan 04) passing `'compact'` as `globalDefault`; the persisted `homeDensity` field semantics are unchanged.
- Added 5 node-test cases to `home-layout.test.ts`: override-wins, empty-map fallback, garbage-value fallback, undefined-map fallback, and global-default passthrough (comfortable).
- Commit: `8dbbdae`

### Task 2 — `homeSectionDensity` settings plumbing (Phase 17 WR-10 pattern, D-07)
- `src/lib/config/defaults.ts`: added `homeSectionDensity: {} as Partial<Record<HomeSectionId, HomeDensity>>` to `HOME_DEFAULTS` (`HomeSectionId`/`HomeDensity` imports already present).
- `src/lib/stores/settings.svelte.ts` (3 touch points): (1) `homeSectionDensity` `$state` field init from `HOME_DEFAULTS`; (2) load guard copying the `enabledSources` object-not-array guard verbatim (Array/non-object → `{}`); (3) added to the `save()` JSON block and to `resetHome()`. Persists under the existing `KEY` (`openmusic:settings:v1`); imported `HomeSectionId` type.
- Added 4 node-test cases to `settings.svelte.test.ts`: default `{}`, valid-map load, array/non-object coercion to `{}` (T-23-06), and `resetHome()` restoring `{}`.
- Commit: `b88ee75`

## TDD Gate Compliance

Both tasks are `tdd="true"`. Each followed RED → GREEN:
- Task 1: tests added first, ran and failed (5 failed — function did not exist), then implementation made them pass (30/30).
- Task 2: tests added first, ran and failed (2 failed on the real field), then implementation made them pass (20/20).

Per-task commits combine the test + minimal implementation as a single `feat` commit (the test and impl for one resolver/field are one logical unit). No separate `test(...)` commit was created; the RED/GREEN sequence was verified live via vitest runs before each commit.

## Verification

- `pnpm check` (svelte-kit sync + svelte-check) — 0 errors, 0 warnings, 4251 files.
- `pnpm exec vitest run src/lib/services/home-layout.test.ts src/lib/stores/settings.svelte.test.ts` — 50 passed (2 files).
- T-23-06: stored Array/non-object `homeSectionDensity` coerces to `{}` (tested).
- T-23-07: `undefined` map and garbage per-section value both return `globalDefault` (tested); `resolveSectionDensity` never throws and never blanks.

## Deviations from Plan

**1. [Rule 3 - Blocking] Installed dependencies in the worktree**
- **Found during:** Task 1 verification (first vitest run).
- **Issue:** The worktree had no `node_modules`; `vitest` was not found.
- **Fix:** Ran `pnpm install --frozen-lockfile` (restores existing lockfile deps — NOT a new-package add, so within Rule 3 scope). No lockfile change.
- **Files modified:** none committed (node_modules is gitignored).
- **Commit:** n/a

No other deviations — both tasks executed as written.

## Known Stubs

None. Both artifacts are fully wired pure-logic/data-layer; Plan 04 consumes them.

## Self-Check: PASSED

- FOUND: src/lib/services/home-layout.ts
- FOUND: src/lib/services/home-layout.test.ts
- FOUND: src/lib/config/defaults.ts
- FOUND: src/lib/stores/settings.svelte.ts
- FOUND: src/lib/stores/settings.svelte.test.ts
- FOUND commit: 8dbbdae (Task 1)
- FOUND commit: b88ee75 (Task 2)
