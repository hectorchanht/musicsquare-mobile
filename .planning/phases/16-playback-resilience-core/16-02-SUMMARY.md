---
phase: 16-playback-resilience-core
plan: 02
status: complete
subsystem: playback
requirements: [PLAY-07, PLAY-08, PLAY-09]
tags: [resilience, failover, loop-guard, stall-watchdog, offline, prefetch, player-store]
dependency_graph:
  requires: ["16-01 (2-state repeatMode 'off' | 'one')"]
  provides:
    - "player.notice reactive channel (PlayerNotice: kind/msg/reason/count/title/action) for the 16-03 toast host"
    - "consecutive-failure counter + FAILURE_CAP=5 loop-guard with sticky Retry notice"
    - "~15s initial-load stall watchdog (armStall/disarmStall + hasPlayedSinceSrc)"
    - "rejected-play()-as-failure detection via the stall watchdog"
    - "offline gate in runFallback (no counter burn, no network) + handleOffline downloads switch"
    - "buildOfflineQueue pure service (src/lib/services/downloads-queue.ts)"
    - "prefetch-on-ended on the offline-blob play branch (online path already had it)"
    - "fallback.ts onlySource derived from SOURCES (true single-source isolation for 6+ sources)"
  affects:
    - "16-03 (toast host reads player.notice; this plan defines the exact shape)"
tech_stack:
  added: []
  patterns:
    - "store→UI one-way reactive notice channel (mirrors player.error → Nowbar)"
    - "generation-guarded async resilience paths (playGen snapshot + re-check)"
    - "absolute timer + flag-gated watchdog (initial-load vs mid-track distinction)"
    - "pure never-throw service builder (mirrors picks.ts/similar.ts)"
key_files:
  created:
    - src/lib/services/downloads-queue.ts
    - src/lib/services/downloads-queue.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/services/fallback.ts
decisions:
  - "D-02/D-04/D-05: total source failure runs handleTotalFailure — breaks repeat-one, increments the counter, batched skip + next() below cap, sticky loop-guard Retry notice at cap (5)"
  - "D-06: a real `playing` event resets the counter + clears a stopped notice; a rejected play() is routed to the stall watchdog rather than swallowed"
  - "D-07/D-08/D-09: offline gate at the top of runFallback (no counter burn, no network); handleOffline switches up-next to downloads or pauses with an offline notice; player-scope only"
  - "D-13/D-14: ~15s watchdog armed only on initial-load src-set (play blob + CDN branches), disarmed on first playing/timeupdate; reresolveCurrent deliberately does NOT arm"
  - "D-15: prefetch fires on every track change incl. auto-advance; no second <audio> element"
  - "notice.msg carries a stable token key (player.notice.skip/loopGuard/offline); structured count+title fields let 16-03 own wording per D-03 (store stays i18n-free)"
metrics:
  duration: ~25m
  completed: 2026-06-10
  tasks: 3
  files: 5
---

# Phase 16 Plan 02: Playback Resilience Core Summary

Added the never-stop resilience policy on top of the existing failover/prefetch engine in `player.svelte.ts`: a consecutive-failure counter with a 5-skip loop-guard, a store-level `notice` channel for sticky/skip toasts, a ~15s initial-load stall watchdog that treats silent no-audio starts (incl. rejected iOS `play()`) as failures, an offline short-circuit that switches up-next to downloads without burning the loop-guard, prefetch on the auto-advance path, and a registry-derived single-source isolation fix in `fallback.ts`.

## What Was Built

### Task 1 — notice channel + loop-guard + skip-on-total-failure (commit c94f267)
- **`PlayerNotice` interface + `notice = $state<PlayerNotice | null>(null)`** — the store→UI channel the 16-03 toast host reads one-way (mirrors `player.error → Nowbar`). See the contract section below.
- **`consecutiveFailures` (plain field) + `FAILURE_CAP = 5`** — internal loop-guard budget, never read reactively (the UI reads `notice`).
- **`handleTotalFailure(failed)`** replaces the old `runFallback` total-failure exit (`this.error = …; this.clearMedia()`): D-12 break repeat-one → 'off' first; increment the counter; **at/over the cap** pause + `clearMedia` + sticky `{ kind:'stopped', reason:'loop-guard', action: recoverFromStop }` and do NOT advance; **below the cap** `emitSkipNotice(title)` + `next()`.
- **`recoverFromStop()`** (Retry / tap-play, D-05): reset counter, clear the stopped notice, `next()` (skip AHEAD, re-arm — not retry-current, not regenerate).
- **`emitSkipNotice(title)`** (D-02): batches N skips within `SKIP_BURST_WINDOW_MS` (1500) into one notice carrying a rising `count`.
- **`play` listener** (D-06): resets the counter + clears a stopped notice on a real `playing` event.

### Task 2 — stall watchdog + rejected-play()-as-failure (commit 268037b)
- **`STALL_TIMEOUT_MS = 15000` + `stallTimer` + `hasPlayedSinceSrc`** mirror the `SEEK_ERROR_WINDOW_MS` field pattern.
- **`armStall()`/`disarmStall()`** — gen-guarded ~15s timer; on fire (if not superseded, `!hasPlayedSinceSrc`, and `current`) it calls `runFallback(current)` (D-13). Disarmed on first `playing`/`timeupdate` (D-14 "we are actually playing"), and on `error`/`ended`.
- **Armed at the two initial-load src-set sites in `play()`** (blob branch + CDN branch): `hasPlayedSinceSrc = false; armStall()`. `reresolveCurrent` deliberately does NOT arm (seek-recovery re-attach, not initial load).
- **Rejected `play()` (D-06):** the two play() `.catch` sites now route a rejection to the stall watchdog (comment-documented) instead of a silent no-op; the watchdog is the failure detector for the iOS "play() rejected, no audio, no error event" case (Pitfall 3).

### Task 3 — offline gate + downloads switch + prefetch-on-ended (commit 2b757ca)
- **Offline gate** at the very top of `runFallback`: `if (navigator.onLine === false) { this.handleOffline(); return; }` — early-returns BEFORE the `gen`/counter logic, so offline never burns the loop-guard and never touches the network (D-08).
- **`handleOffline()`** (D-07/D-08/D-09): builds an up-next from `library.downloads` via `buildOfflineQueue`; with downloads it switches the queue (`dedupeBest([current, ...offline])`) and plays the first (play()'s existing offline-blob branch streams from the IDB blob, reusing the single `cachedBlobUrl` revoke discipline — Pitfall 13); with no downloads it pauses + sets `{ kind:'stopped', reason:'offline' }`. Player-scope only — shell/SW/route guards stay Phase 24.
- **`src/lib/services/downloads-queue.ts` (`buildOfflineQueue`)** — pure, synchronous, never-throws; registry-order (most-recent-download-first), exclude-set, intra-list dedupe.
- **Prefetch-on-ended (PLAY-09/D-15):** the online ended→next→play() path already fired `prefetchNext` at play()'s tail; added `ensureAhead` + `prefetchNext` to the offline-blob play branch (which previously `return`ed early) so the downloaded-queue auto-advance also tops up + prefetches. No second `<audio>` element introduced.
- **`fallback.ts onlySource`** now derives its false-defaults from `Object.keys(SOURCES)` instead of a hardcoded 4-id list — `fivesing`/`jamendo` (and future sources) were leaking into a "single-source" fallback because `getEnabledAdapters` treats an absent `prefs[id]` as "fall through to enabled." Now every registered source is explicitly isolated.

## player.notice contract (for 16-03)

```ts
interface PlayerNotice {
  kind: 'skip' | 'stopped';
  msg: string;                              // stable token key (see below)
  reason?: 'loop-guard' | 'offline';        // 'stopped' only
  count?: number;                           // 'skip' only — batched skip count (D-02)
  title?: string;                           // 'skip' only — last-skipped track title
  action?: () => void;                      // 'stopped'/loop-guard only — Retry (skip ahead + reset + re-arm)
}
```

- **Token keys emitted by the store** (i18n-free per D-03; 16-03 maps these via `t()`):
  - `'player.notice.skip'` — auto-skip after a track failed all sources. Use `count` + `title` to render e.g. "{count} songs skipped". Auto-dismissing, no action.
  - `'player.notice.loopGuard'` — sticky, no auto-dismiss; carries `action` (Retry). Set when `consecutiveFailures >= 5`.
  - `'player.notice.offline'` — sticky, no auto-dismiss; no action. Set when offline with no downloads.
- **Lifecycle:** `kind:'stopped'` notices are cleared automatically by the `play` listener on a real `playing` event (success reset). The host should render `null` as "nothing to show".

## Advance paths verified to fire prefetchNext (PLAY-09 / D-15)

- **Fresh user play** (`play(track, { fresh:true })`): online CDN/blob branch → tail `void this.prefetchNext()` (existing, line ~921).
- **Auto-advance ended → next() → play(queue[i+1])** (non-fresh, online): same tail `prefetchNext` (existing). Verified by the new `ended → next() auto-advance reaches play()` test.
- **Offline-blob play branch** (downloaded track / offline downloads-queue advance): previously returned BEFORE the tail; now fires `ensureAhead` + `prefetchNext` before returning (added this plan).
- **Fallback success** (`play(swap, { fromFallback:true })`): online CDN/blob branch → same tail `prefetchNext` (existing).
- **next()/prev() user skips**: route through `play()` (non-fresh) → same tail.

No second `<audio>` element exists (`grep "new Audio(" → none`); the single-element invariant is preserved.

## Deviations from Plan

**1. Test verify command syntax (carried from 16-01)**
- The plan's `<verify>` blocks use `pnpm test --run <path>`, but the project `test` script is already `vitest --run`, so `--run <path>` is rejected. Ran `pnpm test <path>` (suite-scoped) and `pnpm test` (full) instead — equivalent.

**2. [Rule 3 - Blocking] node_modules missing in the worktree**
- The worktree had no `node_modules`; `pnpm test`/`pnpm check` failed with "vitest: command not found". Ran `pnpm install` (116 packages, all reused from the store — no new deps added). This is environment setup, not a scope change.

**3. [Rule 1 - Bug] fallback.ts onlySource isolation bug (in-scope, flagged by the plan)**
- The plan flagged this as a conditional ("widen if needed"). It WAS needed: the registry now has 6 sources but `onlySource` only defaulted 4 to false, so `fivesing`/`jamendo` leaked into single-source fallbacks via `getEnabledAdapters`'s fall-through. Fixed by deriving the defaults from `SOURCES` (future-proof). Mitigates the self-DoS surface (T-16-03) by keeping each fallback attempt to exactly one source.

**4. handleTotalFailure / handleOffline extracted as private methods**
- The plan described the logic inline in the runFallback exit. I extracted `handleTotalFailure` and `handleOffline` as private methods for testability (driven directly via bracket access) and readability. The runFallback exit calls them. No behavior change vs. the plan's spec.

**5. prefetch-on-ended addition was minimal**
- The online ended→next path already reached prefetchNext (verified, no change needed). The only path that needed the explicit `void this.prefetchNext()` add was the offline-blob play branch, which `return`ed before the tail. Documented all verified paths above.

## Verification Evidence

- `pnpm test src/lib/stores/player.svelte.test.ts` → 33 passed (19 pre-existing + 14 new resilience tests across 3 new describe blocks).
- `pnpm test src/lib/services/downloads-queue.test.ts` → 5 passed.
- `pnpm test` (full suite) → 42 files, 445 tests passed (was 41/426 before).
- `pnpm check` → 0 errors, 0 warnings.
- Grep gates (all hold):
  - `grep "notice = \$state"` → `notice = $state<PlayerNotice | null>(null);`
  - `grep "consecutiveFailures"` → field + increment in handleTotalFailure + reset in play listener
  - `grep "FAILURE_CAP"` → `private static FAILURE_CAP = 5;` + the cap branch
  - `grep "recoverFromStop"` → Retry/recovery method
  - `grep "this.repeatMode = 'off'"` → present inside handleTotalFailure (D-12)
  - `grep "STALL_TIMEOUT_MS = 15000"` → constant present
  - `grep "armStall|disarmStall|hasPlayedSinceSrc"` → arm/disarm + flag + disarm calls in play/timeupdate/error/ended
  - `grep -c "this.armStall()"` → 2 (blob + CDN branches in play())
  - reresolveCurrent body → no armStall (correct)
  - `grep "navigator.onLine === false"` → gate at the top of runFallback
  - `grep "handleOffline"` → offline handler present
  - `grep "new Audio("` → none (single-element invariant)
  - `grep "Object.keys(SOURCES)"` (fallback.ts) → onlySource widening present

## Known Stubs

None. The `notice.msg` token strings (`player.notice.skip`/`loopGuard`/`offline`) are an intentional contract for 16-03 to resolve via `t()` — the store is intentionally i18n-free per D-03, and 16-03 owns the wording + the i18n keys. This is not a stub that blocks this plan's goal (the resilience engine + notice contract are complete and tested); the toast UI is explicitly 16-03's scope.

## Threat Flags

None — no new security-relevant surface. This plan is policy + wiring on the existing engine with zero net-new runtime dependencies. The `onlySource` fix tightens T-16-03 (self-DoS isolation); the offline gate adds the T-16-03 network short-circuit; the loop-guard caps auto-skips (T-16-03); the stall watchdog catches the iOS-reject case (T-16-05); the offline switch reuses the single `cachedBlobUrl` revoke discipline (T-16-06).

## Self-Check: PASSED

- `src/lib/stores/player.svelte.ts` — FOUND (modified, committed in c94f267 / 268037b / 2b757ca)
- `src/lib/stores/player.svelte.test.ts` — FOUND (modified, committed across all three)
- `src/lib/services/fallback.ts` — FOUND (modified, committed in 2b757ca)
- `src/lib/services/downloads-queue.ts` — FOUND (created, committed in 2b757ca)
- `src/lib/services/downloads-queue.test.ts` — FOUND (created, committed in 2b757ca)
- Commit `c94f267` — FOUND in git log
- Commit `268037b` — FOUND in git log
- Commit `2b757ca` — FOUND in git log
