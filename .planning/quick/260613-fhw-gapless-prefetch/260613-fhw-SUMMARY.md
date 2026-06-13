---
phase: quick-260613-fhw
plan: 01
subsystem: playback-resilience
tags: [prefetch, never-stop, search-fanout, gapless, GAPLESS-PREFETCH]
status: checkpoint-paused
requires:
  - searchAllUncached fan-out (catalog.ts)
  - prefetchNext / ensureAhead / primeNext (player.svelte.ts)
  - ensureTrackDetails readiness guard (catalog.ts)
provides:
  - sleep(ms) native-Promise delay helper (proxy/http.ts)
  - SEARCH_STAGGER_MS staggered search fan-out (catalog.ts)
  - bounded forward-resolve prefetchNext loop (player.svelte.ts)
affects:
  - every search/discovery path (resolveStub, buildDiversePicks, buildSimilarQueue, search page)
  - never-stop auto-advance reliability
tech-stack:
  added: []
  patterns:
    - "staggered concurrent fan-out via shared sleep() (no hand-rolled AbortController)"
    - "bounded, abortable, stale-guarded forward-resolve prefetch"
key-files:
  created: []
  modified:
    - src/lib/proxy/http.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "SEARCH_STAGGER_MS = 200ms — single small value in the 150-300ms band; total added latency for K sources is ~200*(K-1), partials still stream via onPartial."
  - "PREFETCH_MAX_CANDIDATES = 4 — bounds the forward-resolve loop so a stretch of failing sources never spins forever and never blocks play()."
  - "backoff() now delegates to the new exported sleep() — one delay primitive, no behavior change."
  - "Stagger skip-on-abort decrements pending but suppresses the partial (existing abort guard), so a superseded query stops firing new searches while pending still reaches 0."
metrics:
  duration: ~10 min
  tasks_completed: 2
  tasks_total: 3
  completed: 2026-06-13
---

# Phase quick-260613-fhw Plan 01: Gapless Prefetch & Staggered Fan-out Summary

Staggered the concurrent multi-source search fan-out (so proxies are not all hit in the same instant) and hardened `prefetchNext` into a bounded, abortable forward-resolve loop that keeps resolving the next song through queue candidates until it lands one with a real `audioUrl` — surviving a single-source transient hiccup instead of stalling auto-advance.

## What Was Built

### Task 1 — Inter-source search stagger (commit 45ed5e3)
- `src/lib/proxy/http.ts`: exported `sleep(ms): Promise<void>` using the same native `new Promise((r) => setTimeout(r, ms))` pattern as the private `backoff` (no AbortController). `backoff` now delegates to `sleep`.
- `src/lib/services/catalog.ts`: added `export const SEARCH_STAGGER_MS = 200`. In `searchAllUncached`, adapter at index `idx` now `await sleep(SEARCH_STAGGER_MS * idx)` before its `.search()` call. Adapter 0 fires immediately; once launched, searches still overlap (staggered start, not serialization). A query aborted DURING the stagger window re-checks `sig.aborted` after the sleep and skips launching later adapters, while `pending` accounting still reaches 0 and the existing `.finally` abort guard suppresses post-abort partials. `interleave`, `searchAll` (cache wrapper), and the `{ perSource, interleaved }` return shape are unchanged.
- `src/lib/services/catalog.test.ts`: added a `searchAllUncached inter-source stagger` describe — `sleep` timing, the 150-300ms band, staggered launch ordering (adapter[1] not invoked until the timer advances by `SEARCH_STAGGER_MS`), unchanged final membership, and abort-during-window stopping later adapters.

### Task 2 — Bounded forward-resolve prefetchNext (commit 642f4f5)
- `src/lib/stores/player.svelte.ts`: added `private static PREFETCH_MAX_CANDIDATES = 4` near `FAILURE_CAP`. Rewrote `prefetchNext()` from a single-candidate pre-resolve into a bounded forward-resolve loop over indices `i+1 .. min(i+MAX, length-1)`:
  - skips a candidate whose `ensureTrackDetails` REJECTS (transient proxy failure) → `continue`;
  - skips a candidate that resolves WITHOUT an `audioUrl` → `continue` (cover is best-effort and never disqualifies);
  - lands the first playable candidate, writes the resolved track back into its slot located FRESHLY by uid (never a closed-over index) and only if still ahead of the recomputed current, then `prewarmNextAssets`;
  - preserves every guard: end-of-queue no-op, immediate-next already-complete short-circuit, in-flight dedupe keyed to the immediate-next uid, single `prefetchController` abort (a superseding prefetch aborts the loop), `seedUid` stale-guard checked AFTER every await, `finally` clears the in-flight guard only if it still points at the claimed uid;
  - never throws, never bumps `playGen`, never calls `next()`/`runFallback`/`tripLoopGuard` — a pure pre-resolve optimization that composes with the never-stop chain.
- `src/lib/stores/player.svelte.test.ts`: added a `Player_PREFETCH_MAX_CANDIDATES` mirror and four tests — skips a rejecting candidate and lands the next playable; skips a no-`audioUrl` candidate and lands the next; respects the candidate cap (at most N resolve attempts, queue unchanged on all-fail); aborts and writes nothing when current changes mid-loop. Existing dedupe/stale-current tests preserved.

## Verification Results

- `npx vitest --run` (FULL suite): **810 passed, 60 files, 0 failed.**
- `npx vitest --run src/lib/services/catalog.test.ts`: 18 passed.
- `npx vitest --run src/lib/stores/player.svelte.test.ts`: 92 passed.
- `npm run check` (svelte-check): **0 errors, 0 warnings.**
- `grep "export function sleep" src/lib/proxy/http.ts` → match (line 83).
- `grep "SEARCH_STAGGER_MS" src/lib/services/catalog.ts` → match (export at line 25, used in `searchAllUncached`).
- `grep "PREFETCH_MAX_CANDIDATES" src/lib/stores/player.svelte.ts` → match (static at line 137, used in the loop at line 1172).

TDD cycle followed: for both tasks the new tests were written first and confirmed RED (4 stagger tests failing on missing `sleep`/`SEARCH_STAGGER_MS`/stagger; 2 forward-resolve tests failing where the old code wrote back an unplayable resolved track and gave up), then GREEN after implementation.

## Deviations from Plan

None — both auto tasks executed exactly as written. No Rule 1-4 deviations were needed.

## Known Stubs

None. No placeholder data or unwired components were introduced.

## CHECKPOINT REACHED — Task 3 (human-verify, device-only)

**Type:** human-verify
**Plan:** quick-260613-fhw / 01
**Progress:** 2/3 tasks complete

Task 3 is an on-device verification step. It CANNOT be performed in this environment — it requires a real iOS Safari + Android Chrome device with a live audio stack and live CDNs. Node/vitest cannot observe the audio element's `canplay`/byte-buffering or the user-felt first-search latency. The two auto tasks are committed and the full node suite is green; the device-only `canplay`/streaming + latency confirmation is what remains.

### What the user must verify on a real device

1. **Run locally on a phone (or deployed preview):** `cd /Users/laichan/code/tung/openmusic && npm run dev`, then open on an iOS Safari device AND an Android Chrome device.
2. **First-search feel:** search a common song. Confirm results still appear promptly — the ~200ms stagger must NOT feel slower than before; partial results should still stream in as each source lands.
3. **Never-stop reliability:** start a song and let it auto-advance through several tracks. Lock the screen for part of it to confirm background audio still advances. Confirm the player keeps moving forward to a song that actually plays rather than stalling on an unresolved next track.
4. **Transient-failure repro:** play through the stretch where the previously-reported stall happened (a song that "plays when tapped but stalled on auto-advance"). Confirm auto-advance now lands a playable next song instead of stalling.
5. **No regression:** confirm manual next/prev, repeat-one, the loop-guard "stopped" notice on a genuinely dead track, and offline behavior are all unchanged.

**Resume signal:** Type "approved" if first-search feel is unchanged AND auto-advance reliably lands playable songs on-device, or describe the issues observed.

## Self-Check: PASSED

- src/lib/proxy/http.ts — FOUND (modified, `sleep` exported)
- src/lib/services/catalog.ts — FOUND (modified, `SEARCH_STAGGER_MS`)
- src/lib/services/catalog.test.ts — FOUND (modified, stagger describe)
- src/lib/stores/player.svelte.ts — FOUND (modified, `PREFETCH_MAX_CANDIDATES` + loop)
- src/lib/stores/player.svelte.test.ts — FOUND (modified, 4 forward-resolve tests)
- Commit 45ed5e3 (Task 1) — FOUND
- Commit 642f4f5 (Task 2) — FOUND
