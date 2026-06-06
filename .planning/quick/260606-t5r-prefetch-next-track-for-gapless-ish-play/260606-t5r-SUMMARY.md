---
phase: quick-260606-t5r
plan: 01
subsystem: playback
tags: [player, prefetch, gapless, queue, abort-controller]
requires:
  - "src/lib/services/catalog.ts ensureTrackDetails(track, signal) — idempotent, accepts AbortSignal"
  - "src/lib/stores/player.svelte.ts queue/current/indexOf/play() seams"
provides:
  - "Player.prefetchNext() — best-effort pre-resolve of the next track, fired from play()"
affects:
  - "next() / track-end advance latency (near-instant when prefetch landed)"
tech-stack:
  added: []
  patterns:
    - "void this.prefetchNext() fired best-effort from play() (mirrors ensureAhead/regenerate)"
    - "AbortController + seedUid/slot recheck stale-guard before writing resolved back into queue"
    - "in-flight dedupe via a plain (non-$state) prefetchingUid field"
key-files:
  created: []
  modified:
    - "src/lib/stores/player.svelte.ts"
    - "src/lib/stores/player.svelte.test.ts"
decisions:
  - "Prefetch target = queue[indexOf(current)+1] EXACTLY (mirrors next()); no play-mode branching invented."
  - "prefetchNext never grows the queue — auto-grow stays owned by ensureAhead()/next(); fired AFTER ensureAhead in play() so a freshly-grown tail is prefetched on the next tick."
  - "No second <audio> element / byte-warmer — pre-resolving details is the must-have; the iOS single-element constraint stands (audio byte-warming explicitly out of scope)."
  - "catalog.ts left untouched — ensureTrackDetails already accepts a signal and is idempotent."
metrics:
  duration: 2 min
  completed: 2026-06-06
---

# Quick Task 260606-t5r: Prefetch Next Track for Gapless-ish Play Summary

Pre-resolves the NEXT queue track (audioUrl + lyrics) while the current song plays, so `next()` / track-end advance hits an idempotent no-op resolve and starts near-instantly — no proxy round-trip on advance, zero new audio elements.

## What Was Built

A private `prefetchNext()` on the `Player` store plus two private fields (`prefetchingUid`, `prefetchController`), fired best-effort as `void this.prefetchNext()` at the end of `play()`'s try block (after `ensureAhead`/`regenerate`, so a freshly-grown tail exists to prefetch on the next tick).

The user-felt latency on advance is the per-source proxy round-trip inside `ensureTrackDetails` (resolve audioUrl + lyrics), NOT byte buffering. Because `ensureTrackDetails` is idempotent (its readiness guard short-circuits a `detailsLoaded` track) and `play()` syncs the resolved track back into `queue[i]`, pre-resolving the next entry means the later `play()` short-circuits = instant start.

`prefetchNext()` selection mirrors `next()` exactly: `target = queue[indexOf(current) + 1]` with no play-mode branching. Four guards, all tested:

1. **No-op at end / no current** — `indexOf(current) < 0` or `nextIndex >= queue.length` returns silently (growth is `ensureAhead`'s job, not prefetch's).
2. **Skip already-complete** — if the target's readiness guard (`detailsLoaded && audioUrl && (lrc || !lrcUrl)`) is already satisfied, no resolve fires.
3. **In-flight dedupe** — `prefetchingUid` (a plain field, NOT `$state`, so no reactivity) tracks the uid being resolved; a second prefetch of the same target uid is a no-op.
4. **Stale-guard** — an `AbortController` aborts a superseded prefetch; on settle it only writes `queue[slot] = resolved` when `current.uid === seedUid` AND `queue[slot].uid === target.uid`, otherwise discards silently. The whole body is wrapped so it never throws.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add prefetchNext() to Player store + fire from play() | 25eb5f8 | src/lib/stores/player.svelte.ts |
| 2 | Node unit tests for prefetchNext | 01b2ed2 | src/lib/stores/player.svelte.test.ts |

## Tests Added

`describe('player.prefetchNext — pre-resolve next track for gapless-ish play')` (5 cases). Mocks `$lib/services/catalog.ensureTrackDetails`; a `stub()` helper builds an UNRESOLVED Track (`detailsLoaded:false, audioUrl:null`) so the readiness guard does not short-circuit. Tests drive the private method via bracket access (`player['prefetchNext']()`) for determinism.

1. Pre-resolves the next track and writes the resolved clone back into `queue[1]` — asserts `ensureTrackDetails` called once with `(stub, expect.any(AbortSignal))` and `queue[1].detailsLoaded === true` / audioUrl set.
2. No-op at end of queue (current is the last entry) — `ensureTrackDetails` NOT called.
3. No-op when next track is already `detailsLoaded` — `ensureTrackDetails` NOT called.
4. In-flight dedupe — two prefetch calls, never-settling deferred, `ensureTrackDetails` called exactly once.
5. Discards a stale resolve when `current` changes mid-resolve — `queue[1]` left unchanged (still the unresolved stub).

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `pnpm check` (svelte-kit sync + svelte-check): **0 errors, 0 warnings** (4012 files).
- `pnpm test`: **222/222 passed** (26 files) — was 217 before, +5 new prefetch cases.
- Task 1 gate (`svelte-check --tsconfig ./tsconfig.json`): clean.
- Task 2 gate (`vitest --run player.svelte.test.ts`): 12/12 in-file.

## Threat Surface

No new external surface. Prefetch issues the SAME proxy call `play()` already makes (`ensureTrackDetails` → `SOURCES[source].resolve`), no new input parsing, no new dependencies (uses existing `ensureTrackDetails` + native `AbortController`).

- **T-t5r-01 (DoS — redundant resolves):** mitigated — in-flight dedupe by `prefetchingUid` + skip-when-complete + abort-prior-on-supersede; at most one prefetch resolve in flight, only for genuinely unresolved tracks.
- **T-t5r-02 (Tampering — stale clobber):** mitigated — write-back guarded by `current.uid === seedUid` AND `queue[slot].uid === target.uid`; AbortController cancels the superseded resolve.

## Known Stubs

None. (The test-only `stub()` helper builds an unresolved Track fixture; it is not a UI/runtime stub.)

## Self-Check: PASSED

- FOUND: src/lib/stores/player.svelte.ts (modified, prefetchNext present)
- FOUND: src/lib/stores/player.svelte.test.ts (modified, prefetch describe present)
- FOUND commit: 25eb5f8 (Task 1)
- FOUND commit: 01b2ed2 (Task 2)
