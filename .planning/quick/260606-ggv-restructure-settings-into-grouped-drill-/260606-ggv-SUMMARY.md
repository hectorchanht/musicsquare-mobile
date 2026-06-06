---
phase: quick-260606-ggv
plan: 01
subsystem: settings-ia + recently-played-history
tags: [settings, routing, history, i18n, svelte5-runes, tdd]
requires:
  - settings.svelte.ts (shared store, load/save)
  - library.svelte.ts (counts + clearAll for Data route)
  - player.svelte.ts (play() hook point)
  - i18n module (t(), identical key sets)
  - TrackMenu + use:longpress + names.dn (history rows)
provides:
  - grouped drill-in settings IA (/settings index + 7 per-group routes)
  - local recently-played history store (runes singleton over a pure logic module)
  - history recording edge from player.play()
  - disabled Last.fm coming-soon placeholder route
  - new i18n key set across en / zh-Hant / zh-Hans
affects:
  - src/routes/(app)/settings/* (restructured)
  - src/lib/stores/player.svelte.ts (one-way history edge)
tech-stack:
  added: []
  patterns:
    - "pure node-testable logic module + runes singleton wrapper (mirrors i18n pure helpers vs t())"
    - "one SvelteKit route per settings group (deep-linkable drill-in, real browser back)"
    - "one-way store edge: player imports history, history imports neither player nor library"
key-files:
  created:
    - src/lib/history/history-logic.ts
    - src/lib/history/history-logic.test.ts
    - src/lib/stores/history.svelte.ts
    - src/routes/(app)/settings/general/+page.svelte
    - src/routes/(app)/settings/translation/+page.svelte
    - src/routes/(app)/settings/playback/+page.svelte
    - src/routes/(app)/settings/history/+page.svelte
    - src/routes/(app)/settings/lastfm/+page.svelte
    - src/routes/(app)/settings/data/+page.svelte
    - src/routes/(app)/settings/about/+page.svelte
  modified:
    - src/routes/(app)/settings/+page.svelte
    - src/lib/stores/player.svelte.ts
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
decisions:
  - "History entry = minimal Track replay slice; volatile fields (audioUrl/lrc/lrcUrl/detailsLoaded) omitted so they re-resolve on replay."
  - "player.play() records BEFORE audio resolution so the play lands even if resolution errors."
  - "Last.fm route is a disabled placeholder only — real auth reserved for v1.1 Phase 11."
metrics:
  duration_min: 6
  tasks: 6
  files_changed: 15
  completed: 2026-06-06
---

# Quick Task 260606-ggv: Grouped drill-in settings + recently-played history Summary

Restructured the single-scroll settings page into a deep-linkable, grouped drill-in IA (one SvelteKit route per group), added a local recently-played History feature (pure node-testable logic module + runes singleton wrapper + player recording hook + list UI), and added a disabled Last.fm "coming soon" placeholder — all new chrome i18n'd across en / zh-Hant / zh-Hans.

## What changed

- **`/settings` index → group list.** Now renders 7 rows (icon + title + description + chevron), each `goto()`-ing its sub-route, in order: general, translation, playback, history, lastfm, data, about. The back button keeps its `goto('/')` behavior.
- **7 per-group sub-routes** under `src/routes/(app)/settings/<group>/+page.svelte`, each with a back button → `/settings` (label `settings.backToSettings`) and `settings.load()` on mount:
  - **general** — App language, Accent color, Reduce motion.
  - **translation** — Lyrics translation, Translate names, Translate mode.
  - **playback** — Default quality, Default source, Auto-expand on play.
  - **history** — recently-played list (NEW).
  - **lastfm** — disabled coming-soon placeholder (NEW).
  - **data** — library counts, Clear cached top picks, Clear library (with flash toast).
  - **about** — about line.
  - Every relocated section keeps its `<h2>`, `t(...)` calls, arrays/handlers, and save-on-change behavior verbatim. The old "Playback & motion" section was split: reduce-motion → general, auto-expand → playback (both reuse the `settings.playbackMotion` heading).
- **History feature (NEW, local-only):**
  - `src/lib/history/history-logic.ts` — PURE module (no runes): `HISTORY_CAP` (50), `HISTORY_KEY` (`openmusic:history:v1`), `HistoryEntry` type, `toEntry()` (minimal whitelist), `recordEntry()` (dedupe-by-uid → replay-moves-to-top, most-recent-first, cap), `parseHistory()` (corrupt-safe → `[]`).
  - `src/lib/history/history-logic.test.ts` — 11 Vitest cases: prepend order, no-mutation, dedupe-replay-to-top, cap drop-oldest, explicit-cap, serialize whitelist (volatile fields omitted), parse round-trip + null/malformed/non-array.
  - `src/lib/stores/history.svelte.ts` — runes singleton wrapping the pure module (`entries`, `load()`, `record()`, `clear()`, private SSR-guarded `save()`). Imports nothing from player/library (one-way edge → no circular dep).
  - `src/lib/stores/player.svelte.ts` — `play()` calls `history.record(track)` early (before resolution).
  - history route lists entries (reuses the library `.row` markup + `TrackMenu` + `use:longpress` + `names.dn` + fallback cover), tap-to-play (`setQueue` + `play`), Clear-history button, empty state.
- **Last.fm placeholder** — disabled `.item` button + "coming soon" pill + muted note. No auth, no network/fetch, no secret, no env access. Comment notes v1.1 Phase 11 owns real auth.
- **i18n** — added an identical new key set to all three dicts (7 group titles + 7 descriptions, `backToSettings`, 5 `history.*` keys, 5 `lastfm.*` keys). en = natural English; zh translations follow the existing settings tone.

## Verification

- `pnpm check` → 0 errors, 0 warnings (after each code task, final run clean).
- `pnpm test` (full `--run` suite) → 13 files, 89 tests pass, including the new `history-logic.test.ts` (11) and the existing i18n key-parity / no-blank tests.
- Sanity grep confirmed: every pre-existing setting is reachable via exactly one group route; `player.play()` matches `history.record`; `/settings` index has all 7 `goto('/settings/<group>')` targets; history store imports nothing from player/library.

## TDD Gate Compliance

Task 1 followed RED → GREEN: the test file was written first and confirmed failing (`Cannot find module './history-logic'`), then the pure module made it pass (11/11). No refactor pass needed. (Per-task commits combine RED+GREEN into one `feat` commit per the quick-task convention; the plan frontmatter is `type: execute`, not a plan-level `type: tdd` gate, so no separate `test(...)` gate commit was required.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript cast in the Task-1 test flagged by `pnpm check`**
- **Found during:** Task 2 (its `pnpm check` gate surfaced an error in the already-committed Task-1 test file).
- **Issue:** `toEntry(track) as Record<string, unknown>` — svelte-check (strict) rejected the direct cast ("neither type sufficiently overlaps").
- **Fix:** Changed to `as unknown as Record<string, unknown>`.
- **Files modified:** `src/lib/history/history-logic.test.ts`
- **Commit:** 8c53244 (folded into the Task-2 commit, since it was my own code surfaced by the Task-2 gate).

### Tooling note (not a code deviation)

- The plan's `<verify>` blocks use `pnpm test --run <path>`, but the project's `test` script is already `vitest --run`, so `pnpm test --run` errors with "Unknown option: 'run'". Targeted runs used `pnpm test -- <path>`; full-suite runs used `pnpm test`. No script was changed.

## Known Stubs

- **Last.fm route** (`src/routes/(app)/settings/lastfm/+page.svelte`) is an intentional disabled placeholder — no data source wired by design. Real auth is owned by v1.1 Phase 11 (documented in CONTEXT.md + STATE.md blockers + an in-file comment). This is the explicitly-scoped intentional stub, not an oversight.

## Threat surface notes

No new external surface introduced. History persists only track metadata the app already stores, in `localStorage` (`openmusic:history:v1`); `parseHistory` is corrupt-safe (T-ggv-01) and `recordEntry` caps growth at 50 (T-ggv-03). The Last.fm placeholder adds no secret/network/env (T-ggv-02 accepted). No new dependencies installed (T-ggv-SC).

## Self-Check: PASSED

All 11 created files + the modified `/settings` index exist on disk; all 6 task commits (aaf62a9, 8c53244, 1f9fef9, 37020fe, 6dfd75a, fa142b2) exist in git history. `pnpm check` 0 errors/0 warnings; `pnpm test` 89/89 green.
