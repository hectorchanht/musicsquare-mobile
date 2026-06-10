---
phase: 17-up-next-sourcing-settings-plumbing
plan: 02
subsystem: playback-queue
tags: [queue, gesture, svelte-action, player-store, up-next]
requires:
  - "17-01: queueContext $state field + per-context fresh-play resolver + nowplaying.clearQueue i18n key (all 15 locales)"
  - "dragClose.ts capture-after-slop tap-preserving idiom + createVelocityTracker (gestures/velocity.ts)"
  - "buildSimilarQueue(track, excludeUids) / buildDiversePicks(count, excludeUids) exclude-set params"
provides:
  - "swipeRemove action: horizontal axis-locked swipe-to-remove (capture-after-slop, flick + distance threshold, vertical-yields-to-grip, tap-preserving)"
  - "player.removeFromQueue(uid): filter + session-exclude (removedUids) + unpin (manualUids)"
  - "player.clearQueue(): keep only current, clear pins, no immediate refill (D-08/D-09)"
  - "removedUids session-Set threaded into regenerate exclude + ensureAhead have sets, reset on fresh play (D-10)"
  - "NowPlaying Up-Next: use:swipeRemove on rows + Clear button in queue-tab header"
affects:
  - "src/lib/stores/player.svelte.ts (queue-mutation surface)"
  - "src/lib/components/NowPlaying.svelte (Up-Next list + subnav header)"
tech-stack:
  added: []
  patterns:
    - "X-axis structural mirror of dragClose.ts (capture-after-slop, never on pointerdown)"
    - "side-Set discipline: removedUids plain Set (NOT $state), mirrors manualUids"
    - "single-write-path: removeFromQueue/clearQueue re-read this.queue at write-time (Pitfall 1)"
key-files:
  created:
    - "src/lib/actions/swipeRemove.ts"
    - "src/lib/actions/swipeRemove.test.ts"
  modified:
    - "src/lib/stores/player.svelte.ts"
    - "src/lib/stores/player.svelte.test.ts"
    - "src/lib/components/NowPlaying.svelte"
decisions:
  - "swipeRemove default threshold = 96px, FADE_DISTANCE = 120px, SLOP = 8, FLICK_V = 0.5 (mirrors dragClose constants)"
  - "removedUids excluded from BOTH generators (regenerate + ensureAhead), not just the live queue snapshot — a swiped-away song stays gone for the session even after it left the queue array"
  - "Clear button gated on player.queue.length > 1 (hidden when only the current track remains — nothing to clear)"
  - "swipeRemove test runs headless in the node project (fake node + synthetic PointerEvent records), mirroring dragReorder.test.ts — no jsdom"
metrics:
  duration: ~6 min
  tasks: 3
  files: 5
  completed: 2026-06-11
---

# Phase 17 Plan 02: Up-Next Queue Management (swipe-remove + clear) Summary

Direct queue curation for Up-Next: a horizontal axis-locked swipe-to-remove gesture, a Clear button, and two new player methods (`removeFromQueue`/`clearQueue`) backed by a session-scoped `removedUids` exclusion set so a swiped-away song does not regenerate back in.

## What Was Built

**Task 1 — `swipeRemove` action (`e8833fb`)**
A new Svelte action that is a structural X-axis mirror of `dragClose.ts`:
- Records start on `pointerdown` but NEVER captures there (tap-preservation — a sub-slop press still reaches the row's `onclick` tap-to-play).
- In `move()`: below slop on both axes → stays a tap; vertical-dominant (`|ddy| > |ddx|`) → goes passive so the GripVertical reorder / scroll runs; horizontal commit → `setPointerCapture` + live `translateX` slide + opacity fade (D-07).
- On release: past the distance `threshold` (96px) OR a fast flick (`|velocity| > 0.5` px/ms with `|dx| > 8`) → `onremove()`; otherwise springs back to `translateX(0)`.
- `touch-action: pan-y` keeps vertical scroll/pan with the browser, yields only the horizontal axis.
- 8 unit tests cover all 6 plan behaviors plus `enabled:false` inert + `touch-action` set/clear.

**Task 2 — player queue methods + exclusion (`004d464`)**
- `removeFromQueue(uid)`: adds to `removedUids`, deletes from `manualUids`, filters `this.queue` (re-read at write-time, Pitfall 1), persists.
- `clearQueue()`: `this.queue = this.current ? [this.current] : []`, clears `manualUids`, persists — and deliberately does NOT regenerate/ensureAhead (D-09: the exhaust engine refills only near end-of-track).
- `removedUids` (plain `Set`, NOT `$state`) unioned into `regenerate`'s `buildSimilarQueue` exclude set AND `ensureAhead`'s `buildDiversePicks` `have` set (D-10/QUEUE-02). Cleared at the top of the `opts?.fresh` play branch (session-scoped, never persisted).
- 9 new player tests; 47 pre-existing tests unchanged and green.

**Task 3 — NowPlaying wiring (`ed6d6dc`)**
- `use:swipeRemove={{ onremove: () => player.removeFromQueue(track.uid) }}` on the existing `.q-row` button; the GripVertical child button keeps its own pointer handlers + `stopPropagation`, so the swipe's axis-lock yields vertical to the grip and taps still play.
- A `Clear` button (`Trash2` icon) in the queue-tab subnav header, gated on `tab === 'queue' && player.queue.length > 1`, calling `player.clearQueue()`. Consumes Plan 01's `nowplaying.clearQueue` key — no locale files edited.

## How to Verify

Automated (all green):
- `pnpm vitest run src/lib/actions/swipeRemove.test.ts` — 8/8
- `pnpm vitest run src/lib/stores/player.svelte.test.ts` — 56/56
- `pnpm svelte-check` — 0 errors, 0 warnings
- Full suite: 494/494 across 45 files

Manual (device, per VALIDATION.md): swipe partial → spring back; swipe full or flick → removes; tap → plays; vertical grip drag → still reorders; Clear → only current survives, then re-grows near end-of-track; a removed song does not reappear until the next fresh play.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Sub-slop tap assertion over-strict**
- **Found during:** Task 1 GREEN run (1 of 8 tests failed).
- **Issue:** The tap-preservation test asserted `transform` must not contain `translateX` at all. A sub-slop press leaves `dragging=true`, so `up()` runs the (harmless) spring-back branch and sets `transform = 'translateX(0)'` — exactly what `dragClose` does too. The resting `translateX(0)` is benign (no capture, no remove, click still fires).
- **Fix:** Relaxed the assertion to allow `''` or `'translateX(0)'` (no NON-ZERO slide), keeping the load-bearing guarantees (`onremove` not called, capture count 0) intact.
- **Files modified:** `src/lib/actions/swipeRemove.test.ts`
- **Commit:** `e8833fb`

### Implementation notes (not deviations)

- The TDD tasks (1 and 2) committed test + implementation together as `feat` commits (single atomic deliverable per task) rather than separate `test`/`feat` gate commits — the action/methods are the deliverable and RED was verified before GREEN in-session for both.
- Added two module mocks (`$lib/services/similar`, `$lib/services/picks`) to `player.svelte.test.ts` so the `removedUids` exclude-set argument is observable. Both default to `[]`, matching the real "sources dry → adds nothing" outcome the existing end-of-queue / ensureAhead tests already assert — no behavior change to existing tests (verified: 47/47 still green).

## Threat Surface

T-17-04 (gesture arbitration), T-17-05 (queue-mutation memory), T-17-06 (queue-mutation race) all mitigated as planned:
- swipeRemove captures only after slop, handles `pointercancel`, yields vertical — no stuck/hijacked gestures; sub-slop reaches `onclick`.
- `removeFromQueue`/`clearQueue` only mutate the `queue` array + reset Sets; introduce NO `createObjectURL`/blob.
- Both methods re-read `this.queue`/`this.current` at write-time; never assign from a closed-over snapshot.
- No package installs this phase (T-17-SC N/A).

No new threat surface introduced (no network endpoints, auth paths, or trust-boundary changes). No threat flags.

## Known Stubs

None. No hardcoded empty data flows to UI; no placeholder text introduced.

## Self-Check: PASSED

- Created files present: `swipeRemove.ts`, `swipeRemove.test.ts`, `17-02-SUMMARY.md`.
- Modified files present in HEAD tree: `player.svelte.ts`, `player.svelte.test.ts`, `NowPlaying.svelte`.
- Commits present: `e8833fb`, `004d464`, `ed6d6dc`, `ccfbe66`.
