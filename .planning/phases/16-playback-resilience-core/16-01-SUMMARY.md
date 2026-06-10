---
phase: 16-playback-resilience-core
plan: 01
status: complete
subsystem: playback
requirements: [PLAY-10]
tags: [repeat, player-store, nowplaying, migration]
dependency_graph:
  requires: []
  provides:
    - "2-state repeatMode ('off' | 'one') in player.svelte.ts"
    - "2-state cycleRepeat toggle (off <-> one)"
    - "restore() repeat-all -> off migration (D-11)"
    - "next() end-of-queue path with no repeat-all wrap (structural half of D-12)"
    - "2-state NowPlaying repeat button (off/one)"
  affects:
    - "16-02 (resilience-core builds against the narrowed 'off' | 'one' type)"
tech_stack:
  added: []
  patterns:
    - "Svelte 5 runes $state field type narrowing"
    - "strict allow-list migration on untrusted localStorage restore"
key_files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/NowPlaying.svelte
decisions:
  - "D-10: repeat is exactly 2 states (off / repeat-one); repeat-all removed in favor of auto-generated up-next"
  - "D-11: persisted repeatMode 'all' (or missing/tampered) collapses to 'off' on restore via strict allow-list"
  - "D-12 (structural half): removed the repeat-all wrap in next(); ensureAhead grow-and-advance is the sole end-of-queue continuation. The runtime break-to-off on total source failure lands in 16-02."
  - "D-03: left the now-dead 'nowplaying.repeatModeAll' i18n key in all locales untouched (no 15-locale churn for zero behavior gain)"
metrics:
  duration: ~10m
  completed: 2026-06-10
  tasks: 2
  files: 3
---

# Phase 16 Plan 01: Repeat 2-State Collapse Summary

Collapsed the repeat control from 3 states (off/one/all) to exactly 2 (off/repeat-one) across the player store and the NowPlaying UI, with a strict allow-list restore migration that maps any persisted repeat-all (or missing/tampered value) to off.

## What Was Built

- **`player.svelte.ts` repeatMode field** narrowed from `$state<'off' | 'one' | 'all'>` to `$state<'off' | 'one'>`, with the comment rewritten to document that repeat-all was removed in favor of auto-generated up-next (`ensureAhead`/`regenerate`).
- **`cycleRepeat()`** rewritten as a strict 2-state toggle: `off -> one -> off` (was the tri-state `off -> one -> all -> off`).
- **restore() payload type** narrowed to `repeatMode?: 'off' | 'one'`.
- **restore() migration (D-11)**: assignment replaced with `this.repeatMode = payload.repeatMode === 'one' ? 'one' : 'off'` — an allow-list so only an explicit `'one'` survives; persisted `'all'`, missing, or arbitrary tampered values collapse to the safe `'off'` default. Satisfies threat T-16-01.
- **next() end-of-queue path (D-12 structural half)**: removed the `if (this.repeatMode === 'all' && this.queue.length > 0) { this.play(this.queue[0]); return; }` wrap, so the only end-of-queue continuation is the `ensureAhead().then(...)` grow-and-advance branch. Comment updated; the `ended` repeat-one branch (loop the current track) was left intact.
- **NowPlaying.svelte repeat button**: dropped the `'all'` arm of the `aria-label` ternary so it reads `player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : t('nowplaying.repeat')`. `class:on`, `onclick={() => player.cycleRepeat()}`, and the icon block (Repeat1 / Repeat) were unchanged. The dead `'nowplaying.repeatModeAll'` i18n key was intentionally left in all locales (D-03).
- **Tests**: added a `describe('player repeat — 2-state (PLAY-10)')` block (7 tests) covering the cycle (off->one, one->off, strict 2-state loop), the restore migration (`'all'`->off, `'one'` stays, missing->off), and the no-wrap end-of-queue behavior. To make the restore path runnable headless, the test file mocks `$app/environment` to `browser: true` and stubs an in-memory `localStorage` global (cleared per test).

## Deviations from Plan

**1. [Rule 3 - Blocking] 16-PATTERNS.md referenced by the plan does not exist in this worktree**
- **Found during:** Task 1 `<read_first>` step.
- **Issue:** The plan's `<read_first>` and `<context>` reference `.planning/phases/16-playback-resilience-core/16-PATTERNS.md`, but only `16-01/02/03-PLAN.md`, `16-CONTEXT.md`, and `16-DISCUSSION-LOG.md` are present.
- **Resolution:** Proceeded using the plan's own `<interfaces>` and per-task `<action>` blocks, which fully specify every line, type, and migration needed. No scope change. No file created.

**2. [Rule 3 - Blocking] Test harness needed `browser: true` + a `localStorage` shim to exercise restore()**
- **Found during:** Task 1 (writing restore-migration tests).
- **Issue:** Under the vitest `node` project, `browser` from `$app/environment` is `false`, so `restore()`/`persist()` early-return — the migration assignment never runs, making the D-11 behavior untestable as written.
- **Fix:** Added `vi.mock('$app/environment', () => ({ browser: true }))` plus a minimal in-memory `localStorage` via `vi.stubGlobal`, cleared in `beforeEach`. This is the only way to drive the restore migration headless; the existing 12 player tests still pass (play() is stubbed, so persist() side-effects are inert there).
- **Files modified:** src/lib/stores/player.svelte.test.ts
- **Commit:** 4623302

**3. Verify command syntax**
- The plan's verify uses `pnpm test --run <path>`, but the project's `test` script is already `vitest --run`, so `--run` is rejected. Ran `pnpm test <path>` (suite-scoped) and `pnpm test` (full) instead — equivalent behavior.

## Commits

- `4623302` feat(16-01): collapse repeatMode to 2-state in player store + restore migration
- `756bab8` feat(16-01): update NowPlaying repeat button to 2 states

## Verification Evidence

- `pnpm test src/lib/stores/player.svelte.test.ts` -> 19 passed (12 existing + 7 new).
- `pnpm test` (full suite) -> 41 files, 426 tests passed.
- `pnpm check` -> 0 errors, 0 warnings.
- `grep -c "'all'" src/lib/stores/player.svelte.ts` -> 0.
- `grep -n "repeatModeAll" src/lib/components/NowPlaying.svelte` -> no match.
- `grep -n "repeatMode = $state" src/lib/stores/player.svelte.ts` -> `repeatMode = $state<'off' | 'one'>('off');`.
- `grep -n "payload.repeatMode === 'one'" src/lib/stores/player.svelte.ts` -> line 204 (restore migration).

## Known Stubs

None.

## Threat Flags

None — no new security-relevant surface introduced. The restore migration tightens T-16-01 (allow-list) and adds no new boundary.

## Self-Check: PASSED

- `src/lib/stores/player.svelte.ts` — FOUND (modified, committed in 4623302)
- `src/lib/stores/player.svelte.test.ts` — FOUND (modified, committed in 4623302)
- `src/lib/components/NowPlaying.svelte` — FOUND (modified, committed in 756bab8)
- Commit `4623302` — FOUND in git log
- Commit `756bab8` — FOUND in git log
