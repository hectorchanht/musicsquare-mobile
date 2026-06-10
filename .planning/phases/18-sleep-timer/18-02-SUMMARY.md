---
phase: 18-sleep-timer
plan: 02
subsystem: sleep-timer
tags: [sleep-timer, player-wiring, timeupdate-backstop, ended-arbitration, volume-fade, blocker-proof, tdd]
requires:
  - "computeDeadline / isExpired / remainingMs — absolute-deadline math (18-01)"
  - "fadeVolumeAt / canFadeVolume — fade curve + iOS read-only feature detect (18-01)"
  - "decideEndedAction — end-of-track-beats-repeat-one arbitration (18-01)"
  - "sleepTimer leaf runes store — mode/deadline + set/cancel (18-01)"
provides:
  - "player.expireSleepTimer() — the ONE sanctioned self-stop: pause-in-place + optional ~10s fade, never enters the Phase-16 failure machinery"
  - "timeupdate minutes-deadline backstop (throttle-proof expiry authority)"
  - "ended end-of-track branch placed BEFORE repeat-one (D-03 precedence in the engine)"
  - "abortFade() gesture-abort wired into toggle/next/prev/seekFraction (D-05)"
  - "player.onSleepTimerSet() — coarse secondary wake-timer backstop the UI arms after set('minutes')"
affects:
  - "Plan 18-03 (UI): TrackMenu/Nowbar/NowPlaying read sleepTimer state, call sleepTimer.set/cancel, and call player.onSleepTimerSet() after set('minutes') to arm the wake backstop"
tech-stack:
  added: []
  patterns:
    - "Class-field timer + clearInterval/clearTimeout lifecycle (mirrors armStall/disarmStall) for fadeTimer + wakeTimer"
    - "Pure-helper consumption: player is a thin effectful caller of sleep-timer.ts helpers"
    - "Leaf-store direction preserved: player imports sleepTimer store; store never imports player; UI bridges the wake-timer arm"
    - "TDD RED->GREEN for the engine wiring (failing blocker test first)"
key-files:
  created: []
  modified:
    - "src/lib/stores/player.svelte.ts"
    - "src/lib/stores/player.svelte.test.ts"
decisions:
  - "Wake-timer armed via a public player.onSleepTimerSet() the UI calls after set('minutes') — chosen over a player-owned $effect.root because the Player class uses zero $effect today; this keeps leaf-store direction (store never imports player) without introducing effect-root machinery"
  - "Blocker proven in code: expireSleepTimer/finishExpiry/abortFade contain NO this.next()/consecutiveFailures/errorBurst/playGen++/runFallback/tripLoopGuard (awk-region greps in verification); the sole playGen++ stays at its single site"
  - "Fade-path tests use vi.useFakeTimers()+advanceTimersByTime to step the ~10s fade deterministically; the D-05 abort test drives seekFraction (NOT next, which the beforeEach spies) so the REAL abortFade() runs"
  - "D-03 suppression asserted via a non-zero audio.currentTime before ended — proving the repeat-one rewind (which would set currentTime=0) did not run"
metrics:
  duration: ~10 min
  tasks: 2
  files: 2
  completed: 2026-06-11
---

# Phase 18 Plan 02: Sleep Timer Player Wiring Summary

Wired the sleep-timer expiry into the existing `player.svelte.ts` engine across the four seams research identified, and proved the STATE.md Phase-18 blocker in code: the expiry stop is an INTENTIONAL pause that is invisible to the Phase-16 never-stop failure machinery. Zero new packages — platform timer + audio APIs only, consuming the pure helpers + leaf store from 18-01.

## What Was Built

### Task 1 — Four player seams + expiry lifecycle (TDD RED→GREEN)

`src/lib/stores/player.svelte.ts` modified at four seams:

1. **Imports** — added `import { sleepTimer } from '$lib/stores/sleepTimer.svelte'` and `import { isExpired, fadeVolumeAt, canFadeVolume, decideEndedAction } from '$lib/services/sleep-timer'`.

2. **Private fields** — `fadeTimer` (the ~10s fade interval), `preFadeVolume` (snapshot for restore), and `wakeTimer` (coarse secondary backstop), modelled on the existing `stallTimer` class-field-timer idiom.

3. **`timeupdate` backstop** — at the TOP of the existing listener, before the `currentTime`/`syncPosition`/`persist` body: `if (sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)) { this.expireSleepTimer(); return; }`. `timeupdate` fires ~4×/sec while audio plays (exempt from intensive bg-tab throttling), making it the throttle-proof expiry authority against the ABSOLUTE deadline.

4. **`ended` branch** — immediately after `disarmStall()` and BEFORE the `repeatMode === 'one'` block: `const endedAction = decideEndedAction(sleepTimer.mode, this.repeatMode); if (endedAction === 'sleep-stop') { sleepTimer.cancel(); this.clearMedia(); return; }`. The `return` suppresses BOTH the repeat-one rewind and `next()` — end-of-track beats repeat-one (D-03).

5. **Expiry methods** —
   - `expireSleepTimer()` → no audio: cancel+return; already paused: cancel silently, no second pause (D-04); `canFadeVolume()` true: snapshot `preFadeVolume`, arm a 200ms `setInterval` ramping `audio.volume = fadeVolumeAt(elapsed, 10_000, preFadeVolume)`, calling `finishExpiry()` at `elapsed >= FADE_MS`; else (iOS read-only volume) instant `finishExpiry()`.
   - `finishExpiry()` → clear fade+wake timers, `audio.pause()` (fires the existing `pause` listener → `syncPlaybackState()` → lock screen reads paused for free, D-09), restore `preFadeVolume` (D-02), `sleepTimer.cancel()` (indicator disappears silently).
   - `abortFade()` (D-05) → when a fade is in flight: clear it, restore `preFadeVolume`, cancel the timer (user is awake). No-op otherwise.
   - `onSleepTimerSet()` → arms `wakeTimer = setTimeout(…, deadline - Date.now())` re-checking `isExpired()` on fire (RESEARCH Assumption A1 — catches the iOS screen-wake case where `timeupdate` stalled while locked). The `timeupdate` backstop stays the authority; this is a free belt-and-suspenders net.

6. **Gesture-abort** — `this.abortFade()` at the TOP of `toggle()`, `next()`, `prev()`, `seekFraction()`.

**Blocker compliance (STATE.md Phase-18):** `expireSleepTimer`/`finishExpiry`/`abortFade` contain NO `this.next()`, NO `consecutiveFailures`/`errorBurst`, NO `playGen++` (the sole bump stays at its one site), NO `runFallback`/`tripLoopGuard` — verified by awk-region greps. The expiry only pauses + restores volume + cancels the timer.

### Task 2 — Extend `player.svelte.test.ts` with the `sleep timer expiry` block (7 tests)

Extended (not replaced) the test file using the existing `makeFakeAudio()` + `player.attach()` harness, with a `makeSleepAudio()` adding a writable `volume` so the fade path is exercised. `next` observed via `vi.spyOn(player, 'next')`. Tests:

1. Minutes timeupdate at the deadline → fades (fake timers advance past `FADE_MS`) → pauses once, deactivates timer, restores volume, does NOT call `next()`.
2. Expiry does NOT route into `runFallback` (mock not called) and emits NO notice — the observable proxy for "failure counters untouched".
3. Non-expired minutes timeupdate runs the existing body (`currentTime` sync) unchanged.
4. **D-03**: end-of-track + `repeatMode='one'`, fire `ended` → pause, no replay (`audio.currentTime` stays 99, proving the rewind was suppressed), no `next()`, timer cancelled.
5. End-of-track inert when unarmed: repeat-one still rewinds (`currentTime=0`) + replays — `decideEndedAction` precedence holds the other direction too.
6. **D-04**: already-paused `expireSleepTimer()` cancels silently, no second pause.
7. **D-05**: a `seekFraction()` gesture mid-fade restores volume + cancels timer; advancing past `FADE_MS` never pauses (interval was cleared).

## Verification Results

- `npm test -- src/lib/stores/player.svelte.test.ts` → **61/61 pass** (54 prior + 7 new sleep)
- `npm test -- src/lib/stores/player.svelte.test.ts -t sleep` → **7/7 pass**
- `npm test` full suite → **584/584 pass** (49 files; 577 prior + 7 new, no regression to Phase-16 resilience tests)
- `npm run check` (svelte-check) → **0 errors, 0 warnings** across 4089 files
- `grep -n "expireSleepTimer" player.svelte.ts` → matches (5)
- `grep -n "import { sleepTimer }" player.svelte.ts` → matches (line 23)
- `grep -c "isExpired" player.svelte.ts` → 4 (≥1; timeupdate backstop + wakeTimer re-check)
- `grep -c "abortFade" player.svelte.ts` → 6 (≥5: definition + disarmFadeTimer + 4 gesture call sites)
- ended-listener: `decideEndedAction` `'sleep-stop'` branch (line 749) precedes the `repeatMode === 'one'` block (line 758)
- Blocker awk-region grep: `expireSleepTimer`/`finishExpiry`/`abortFade` → CLEAN (no next/counters/playGen++/runFallback/tripLoopGuard)
- `grep -c "playGen++"` → 1 (sole legitimate bump preserved)

## TDD Gate Compliance

Task 1 followed RED→GREEN with explicit gate commits:
- RED: `284b556 test(18-02): add failing blocker test…` (verified failing — `expireSleepTimer`/backstop did not exist; pause not called)
- GREEN: `65d75b8 feat(18-02): wire sleep-timer expiry into player at four seams` (blocker tests pass)
- No REFACTOR commit — the GREEN implementation was already minimal.
- Task 2 (`a76c896`) extends the test block with the D-03/D-04/D-05 coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test correctness] Fade-path expiry tests need fake timers + a non-spied gesture**
- **Found during:** Task 1 RED→GREEN and Task 2.
- **Issue:** The plan's blocker behavior expects `audio.pause` after a minutes expiry, but on a writable-volume fake the `canFadeVolume`-true path defers `pause()` ~10s into a `setInterval` fade — so a synchronous `expect(pause).toHaveBeenCalled()` failed even with the implementation correct. Separately, the D-05 abort test originally drove `player.next()`, but `next` is replaced by `vi.spyOn(player,'next').mockImplementation(...)` in `beforeEach`, so the real `next()` body (and its `abortFade()`) never ran — volume read 0.96 instead of the restored 1.
- **Fix:** (a) The fade-path tests use `vi.useFakeTimers()` + `vi.advanceTimersByTime(10_200)` to step the fade deterministically to completion, then assert `pause` + restored volume; real timers restored in `finally`. (b) The D-05 abort test drives `player.seekFraction(0.5)` (a real, non-spied gesture entry point) so the genuine `abortFade()` runs. (c) The D-03 suppression assertion sets `audio.currentTime = 99` before firing `ended` so "still 99" proves the repeat-one rewind (which sets `currentTime=0`) did not run — a stronger proxy than the original "not 0" against a fake that already starts at 0.
- **Files modified:** src/lib/stores/player.svelte.test.ts
- **Commits:** 284b556 (RED), a76c896 (Task 2 coverage)

## Known Stubs

None. All four seams are fully wired; no placeholder values, no TODO/FIXME. The `onSleepTimerSet()` wake-timer arm is a real public method awaiting its caller in Plan 18-03's UI (documented below, not a stub).

## Notes for Downstream Plans

- **Plan 18-03 (UI):** after `sleepTimer.set('minutes', n)`, the UI MUST also call `player.onSleepTimerSet()` to arm the coarse secondary wake-timer backstop (the `timeupdate` listener is the authority, but `onSleepTimerSet` catches the iOS screen-wake-after-stall case). `sleepTimer.set('end-of-track')` / `sleepTimer.cancel()` need no wake-timer arm (a subsequent `onSleepTimerSet()` after an end-of-track set will just disarm any prior wake timer). Read `sleepTimer.active/mode/selectedMinutes/remaining`; format with `fmtTime(sleepTimer.remaining / 1000)`. No expiry toast (D-09) — the countdown is the confirmation (D-12).
- The fade is feature-detected per-platform via `canFadeVolume`: volume-honoring platforms get a ~10s ramp; iOS (read-only volume) instant-pauses. The UI need not branch on this.

## Self-Check: PASSED

- FOUND: src/lib/stores/player.svelte.ts (modified — expireSleepTimer/finishExpiry/abortFade/onSleepTimerSet + four seams)
- FOUND: src/lib/stores/player.svelte.test.ts (modified — `sleep timer expiry` block, 7 tests)
- FOUND commit 284b556 (RED blocker test)
- FOUND commit 65d75b8 (GREEN four-seam wiring)
- FOUND commit a76c896 (Task 2 D-03/D-04/D-05 coverage)
