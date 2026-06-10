---
phase: 16-playback-resilience-core
plan: 03
status: checkpoint-pending
subsystem: playback
requirements: [PLAY-07, PLAY-08]
tags: [resilience, toast, notice, i18n, loop-guard, offline, layout-host]
dependency_graph:
  requires:
    - "16-02 (player.notice channel: PlayerNotice kind/msg/reason/count/title/action)"
    - "16-02 (token keys player.notice.skip/loopGuard/offline + recoverFromStop action)"
  provides:
    - "layout-level toast host in (app)/+layout.svelte that reactively renders player.notice"
    - "skip/loop-guard/offline toast i18n keys across all 15 locales"
  affects: []
tech_stack:
  added: []
  patterns:
    - "store→UI one-way reactive read in a layout (mirrors player.error → Nowbar)"
    - "$effect-driven local toast host with snapshot state for exit transitions"
    - "auto-dismiss (skip) vs persistent + action-button (stopped) toast variants"
key_files:
  created: []
  modified:
    - src/routes/(app)/+layout.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/vi.ts
    - src/lib/i18n/th.ts
decisions:
  - "D-02/D-03: skip notice uses toast.skippedMany when count>1 (batched) else toast.skipped with {title}; NO action button on skip toasts"
  - "D-04/D-05: loop-guard 'stopped' notice is persistent (no timer) + a Retry button wired to notice.action (the store's recoverFromStop); offline 'stopped' has no action so no button shows"
  - "D-01: silent same-song failover — no host branch; 16-02 emits no notice for it so the host naturally stays silent"
  - "D-03: 5 new keys total, reusing none-needed; real translations in all 15 locales with {title}/{count} tokens verbatim"
  - "Host renders from a local snapshot (`host`) so the fly-out transition still plays after the store clears player.notice on a real `playing` event"
metrics:
  duration: ~20m
  completed: 2026-06-10
  tasks: 3 (2 implementation committed; Task 3 human-verify pending)
  files: 16
---

# Phase 16 Plan 03: Never-Stop Feedback Toast Host Summary

Rendered the player's never-stop feedback as a layout-level toast host in the `(app)` shell that reactively consumes the `player.notice` channel from 16-02: auto-dismissing batched skip toasts (PLAY-07), a persistent loop-guard toast with a working Retry button wired to the store's recovery action (PLAY-08), and an offline notice — with successful same-song failover staying silent (D-01). Added the 5 minimal skip/loop-guard/offline i18n keys across all 15 locales.

## What Was Built

### Task 1 — minimal toast i18n keys in all 15 locales (commit 38390b0)
- Added exactly 5 keys to the `toast.*` block of every locale dict:
  - `toast.skipped` = "Couldn't play · {title} — skipped" (D-02 single-skip wording)
  - `toast.skippedMany` = "{count} songs skipped" (D-02 batched wording)
  - `toast.playbackStopped` = "Playback stopped — couldn't load songs" (D-04 loop-guard)
  - `toast.retry` = "Retry" (D-04/D-05 Retry button)
  - `toast.offlineNoDownloads` = "You're offline — no downloaded songs to play" (D-08 offline)
- Real translations provided for `zh-Hant`/`zh-Hans` (CJK primary audience) and the other 12 locales (es/fr/de/pt/it/ru/tr/ar/hi/id/vi/th) — matching the project convention that all locales carry real translations, not English fallbacks.
- `{title}` and `{count}` interpolation tokens kept IDENTICAL (untranslated) across every locale.
- Key/value quote style matched per file: `en`/`zh-Hant`/`zh-Hans` use single-quoted keys (values with an apostrophe use double quotes, mirroring `home.unplayable`); the other 12 use double-quoted keys/values.

### Task 2 — layout-level toast host (commit 1594d70)
- Added a `$effect` in `(app)/+layout.svelte` that one-way reads `player.notice` (mirrors the documented `player.error → Nowbar` convention) and drives a local `host` snapshot:
  - **kind 'skip' (D-02/D-03):** brief AUTO-DISMISSING pill (2500ms), NO action button. `count` is always ≥1; `count > 1` renders `t('toast.skippedMany', { count })`, else `t('toast.skipped', { title })`. The dismiss timer is cleared + restarted on each new skip notice, so a burst REPLACES rather than stacks (single channel + cleared timer).
  - **kind 'stopped' (D-04/D-05/D-08):** PERSISTENT pill (no auto-dismiss timer). Loop-guard (`reason !== 'offline'`) → `t('toast.playbackStopped')` + a Retry button whose onclick calls `host.action?.()` (the store-provided `recoverFromStop`) then clears the host. Offline (`reason: 'offline'`) → `t('toast.offlineNoDownloads')` with NO Retry button (the notice carries no action).
  - **Silent failover (D-01):** there is intentionally no branch — 16-02 emits no notice for successful same-song failover, so the host shows nothing. A code comment documents this.
- The host reads a local `host` snapshot (not `player.notice` directly in markup) so the `fly` exit transition still plays after the store clears `notice` to `null` on a real `playing` event.
- The store is never mutated from the layout — the host only reads `player.notice` and invokes `notice.action` (T-16-08 mitigation: the recovery path is fixed by the store, not constructed by the UI).
- CSS: fixed top pill mirroring `+page.svelte`'s `.toast` (dark backdrop, `border-radius: 999px`, `transition:fly`) but at `z-index: 90` to clear the nowbar (z:20) and tabbar (z:21); the sticky variant uses a wrapping flex row for message + Retry. Retry button uses the real `--color-primary` accent token.

### Task 3 — human verification (checkpoint, NOT executed)
Visual/interactive verification gate. Not performed by the executor; see the checkpoint report for exact steps.

## Deviations from Plan

**1. [Rule 3 - Blocking] node_modules missing in the worktree (carried from 16-01/16-02)**
- The fresh worktree had no `node_modules`; `pnpm test`/`pnpm check` failed with "vitest: command not found". Ran `pnpm install` (no new deps — same lockfile as the store). Environment setup, not a scope change.

**2. Verify command syntax (carried from 16-01/16-02)**
- The plan's `<verify>` blocks use `pnpm test --run <path>`, but the project `test` script is already `vitest --run`, so `--run <path>` is rejected. Ran `pnpm test <path>` (suite-scoped) and `pnpm test` (full) instead — equivalent.

**3. Accent token name corrected (Rule 3 - blocking-trivial)**
- The plan/PATTERNS examples did not name a specific accent CSS var. My first draft used `var(--color-accent, …)` which is not defined in `src/app.css`; the real accent token is `--color-primary` (#7c5cff). Switched the Retry button background to `var(--color-primary, #7c5cff)` so it picks up the actual theme accent rather than only the fallback. No behavior change to the resilience logic.

## player.notice contract consumed (from 16-02)

The host reads `player.notice: PlayerNotice | null`:
- `kind: 'skip'` — `count` (always ≥1, batched) + `title` (last-skipped). Auto-dismiss, no action.
- `kind: 'stopped'`, `reason: 'loop-guard'` — sticky; carries `action` (Retry → recoverFromStop).
- `kind: 'stopped'`, `reason: 'offline'` — sticky; no action.
- `null` — nothing to show (cleared by the store's `play` listener on a real `playing` event).

## Known Stubs

None. The host renders entirely from live `player.notice` store data. No hardcoded empty/placeholder values flow to the UI.

## Threat Flags

None — no new security-relevant surface. Toast text is interpolated via `t()` and rendered as Svelte text (auto-escaped, no `{@html}`), so a hostile `{title}` cannot inject markup (matches T-16-07 "accept" disposition — titles are already displayed across the app). The Retry button only invokes the store-provided `notice.action` closure; the UI cannot construct an arbitrary action (T-16-08 mitigation). The single-channel + cleared-timer host collapses skip bursts so toasts cannot flood (T-16-09).

## Verification Evidence

- `pnpm test src/lib/i18n/i18n.test.ts` → 11 passed (locale parity: en/zh-Hant/zh-Hans identical key sets).
- `pnpm test` (full suite) → 42 files, 445 tests passed (no regressions vs 16-02 baseline).
- `pnpm check` → 0 errors, 0 warnings (the `Dict = Record<TranslationKey, string>` parity type confirms all 15 dicts carry every new key).
- All 5 new keys present in all 15 locale files (grep gate, no MISSING output).
- `{title}`/`{count}` tokens present verbatim in all 15 locales.
- Task 2 greps:
  - `grep "player.notice"` in `+layout.svelte` → reactive read in the `$effect`.
  - `grep "n.action\|host.action\|host?.action"` → Retry wiring + markup guard.
  - `grep "toast.playbackStopped"` → sticky loop-guard message.
  - auto-dismiss `setTimeout`/`skipTimer` present ONLY in the skip branch (the stopped branch sets no timer).

## Self-Check: PASSED

- `src/routes/(app)/+layout.svelte` — FOUND (modified, committed in 1594d70)
- `src/lib/i18n/en.ts` (+ 14 other locales) — FOUND (modified, committed in 38390b0)
- Commit `38390b0` — present in git log (Task 1)
- Commit `1594d70` — present in git log (Task 2)

## Checkpoint Status

Task 3 is a `checkpoint:human-verify` gate (`gate="blocking"`). All implementation work (Tasks 1–2) is committed and this SUMMARY is committed with `status: checkpoint-pending`. The orchestrator should present the checkpoint report (returned by the executor) to the user; on "approved", mark this plan complete.
