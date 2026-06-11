---
phase: 18-sleep-timer
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/lib/services/sleep-timer.ts
  - src/lib/services/sleep-timer.test.ts
  - src/lib/stores/sleepTimer.svelte.ts
  - src/lib/stores/sleepTimer.svelte.test.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/components/SleepTimerSheet.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/Nowbar.svelte
  - src/lib/components/NowPlaying.svelte
  - src/routes/(app)/+layout.svelte
  - src/lib/i18n/en.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-06-11
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 18 adds the sleep timer: a pure helper module (`sleep-timer.ts`), a leaf runes store
(`sleepTimer.svelte.ts`), four expiry seams in the player engine, the timer UI (global sheet,
track-menu entry, nowbar/now-playing indicators) and i18n.

The structural separation is clean and the explicit hazards called out for this phase mostly hold
up under scrutiny:

- **Leaf-store discipline:** verified. `sleepTimer.svelte.ts` imports ONLY the pure helpers from
  `$lib/services/sleep-timer` and nothing from the player. The player imports the store, never the
  reverse. No circular dependency.
- **Absolute-deadline math:** verified. `computeDeadline` is wall-clock absolute and the `timeupdate`
  authority re-derives from it, so bg-tab throttling can't drift the deadline. The 1s tick only
  drives the display readout and recomputes from the absolute deadline each tick (no accumulation).
- **i18n parity:** verified. All four keys (`timer.minutes`, `timer.endOfTrack`, `timer.cancel`,
  `menu.sleepTimer`) exist in en plus all 14 other locale files. `lookupKey` also falls back to en.
- **decideEndedAction precedence:** verified. `sleep-stop` correctly returns before the repeat-one
  rewind and before `next()`; minutes/off modes leave the ended branch unchanged.

However, the **volume-fade lifecycle has a real re-entrancy defect** that the unit tests cannot
catch because the test harness fires `timeupdate` exactly once while production fires it ~4x/sec
throughout the fade. This is the BLOCKER below. Several robustness/overlay-balance warnings follow.

## Critical Issues

### CR-01: Minutes-mode volume fade re-enters every `timeupdate`, corrupting `preFadeVolume` and glitching audio

**File:** `src/lib/stores/player.svelte.ts:572-598` (entry), `700-708` (the re-triggering listener)

**Issue:**
`expireSleepTimer()` starts the ~10s volume fade but does **not** cancel the sleep timer — the timer
is only cancelled ~10s later inside `finishExpiry()`. Meanwhile the `timeupdate` listener (line 705)
re-checks `sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)` on every
tick. Because the deadline is in the past and the timer is still `'minutes'` for the entire fade,
**every `timeupdate` (≈4×/sec while audio plays) re-enters `expireSleepTimer()`**.

Each re-entry does three damaging things:

1. `this.preFadeVolume = audio.volume` (line 585) snapshots the *already-faded* volume (e.g. 0.92,
   then 0.84, …). When `finishExpiry()` finally restores `this.preFadeVolume` (line 606), it restores
   a degraded value, not the user's original 1.0 — so playback volume is permanently lowered on the
   next track.
2. `disarmFadeTimer()` + a fresh `setInterval` with a new `start = Date.now()` (lines 588-593) means
   the fade keeps restarting; with `timeupdate` arriving faster than `FADE_MS`, `elapsed >= FADE_MS`
   is reached far later than the intended 10s (or repeatedly resets).
3. `canFadeVolume(audio)` (line 583) write-probes `audio.volume = 0` then restores on **every**
   re-entry, momentarily slamming volume to 0 several times a second → audible stutter during the
   fade the feature is supposed to make smooth.

The `wakeTimer` backstop (line 649-654) compounds this: it also calls `expireSleepTimer()`, adding
another re-entry around the same instant.

The existing test (`player.svelte.test.ts:1250-1270`) passes only because `vi.useFakeTimers()` +
a single `audio.fire('timeupdate')` never reproduces the repeated real `timeupdate` firehose.

**Fix:** Guard `expireSleepTimer()` against re-entry while a fade is already in flight, and/or
suppress the timeupdate expiry check once the stop has begun. The simplest correct fix is an
early-return when a fade is already running:

```ts
expireSleepTimer() {
	if (this.fadeTimer) return; // already stopping — re-entry from the timeupdate firehose
	if (!this.audio) { sleepTimer.cancel(); return; }
	if (this.audio.paused) { sleepTimer.cancel(); return; }
	const audio = this.audio;
	if (canFadeVolume(audio)) {
		this.preFadeVolume = audio.volume; // now snapshotted exactly once
		const start = Date.now();
		const FADE_MS = 10_000;
		this.fadeTimer = setInterval(() => {
			const elapsed = Date.now() - start;
			audio.volume = fadeVolumeAt(elapsed, FADE_MS, this.preFadeVolume);
			if (elapsed >= FADE_MS) this.finishExpiry();
		}, 200);
	} else {
		this.finishExpiry();
	}
}
```

Add a regression test that fires `timeupdate` multiple times across the fade window (advancing
fake timers between fires) and asserts `pause` is called once, `preFadeVolume`/restored volume is
the original, and `canFadeVolume`'s probe is not re-run mid-fade.

## Warnings

### WR-01: TrackMenu → SleepTimerSheet handoff can desync overlay/history depth

**File:** `src/lib/components/TrackMenu.svelte:189`, `src/lib/components/SleepTimerSheet.svelte:51-56`, `src/lib/stores/overlays.svelte.ts:59-108`

**Issue:**
Tapping "Sleep timer" runs `sleepTimer.sheetOpen = true; close();` synchronously. `close()` flips
`menuOpen = false` (parent), which triggers TrackMenu's `$effect` cleanup →
`overlays.dismiss('trackmenu-menu')`. Setting `sheetOpen = true` triggers SleepTimerSheet's
`$effect` → `overlays.open('trackmenu-timer')` → `history.pushState`. These two effects flush in the
same Svelte tick and the relative order is **not guaranteed** across components.

If SleepTimerSheet's `open` runs first, the stack becomes `[trackmenu-menu, trackmenu-timer]`; then
`dismiss('trackmenu-menu')` removes a **middle** entry but still calls `history.back()`
(`overlays.svelte.ts:101-107`), which pops the *timer's* freshly-pushed history state rather than the
menu's. Stack depth (1) and real history depth then diverge — exactly the "back gesture over-pops /
gets stuck" class of bug this codebase has fought before. The other two sheets handed off in this
codebase (picker/detail) open from WITHIN the same component whose `open` stays top, which is why
they don't hit this; the global sheet is the new case.

**Fix:** Defer opening the global sheet until after the menu has fully dismissed, e.g. close first
then open on the next tick (`tick().then(() => (sleepTimer.sheetOpen = true))`) or have
`overlays.dismiss` only `history.back()` when the dismissed entry is the current top (and otherwise
splice without a back()). Add a test/manual trace asserting `overlays.depth` and history length stay
equal across the menu→sheet handoff and a subsequent Back.

### WR-02: `ended` in repeat-one mode during an in-flight fade leaves the fade running with corrupted volume

**File:** `src/lib/stores/player.svelte.ts:740-769`

**Issue:**
A minutes-mode fade keeps the audio *playing* (it only pauses at `finishExpiry`). If the track
reaches its natural end mid-fade, the `ended` listener fires. For `decideEndedAction('minutes','one')
=== 'repeat-rewind'` it rewinds and calls `audio.play()` (lines 758-766) but never calls
`abortFade()`/`disarmFadeTimer()`. The fade interval survives the track change and continues lowering
the volume of the rewound track until `finishExpiry` pauses it — and (compounded by CR-01)
`preFadeVolume` is restored to a degraded value. The `advance` branch is safe because `next()` calls
`abortFade()`, but the repeat-rewind branch is not.

**Fix:** In the `ended` listener, for the non-`sleep-stop` branches that keep playback alive
(repeat-one rewind), do not silently continue a fade. Either let the minutes timer's own
`timeupdate`/wake authority re-stop on the next tick (after CR-01's re-entry guard, this is benign)
or explicitly `disarmFadeTimer()` and reset `audio.volume = this.preFadeVolume` before replaying so
the new track starts at full volume. Add coverage for "track ends naturally during a minutes fade".

### WR-03: Sheet header countdown depends on the 1s tick, so it can lag the actual readout by up to ~1s

**File:** `src/lib/components/SleepTimerSheet.svelte:63`, `src/lib/components/Nowbar.svelte:64`, `src/lib/components/NowPlaying.svelte:725`

**Issue:**
All three indicators render `fmtTime(sleepTimer.remaining / 1000)`, and `remaining` is only refreshed
by the store's 1s `setInterval`. When the sheet/now-playing is opened mid-second, the displayed
countdown can be up to ~1s stale relative to the live deadline, and there is a visible one-second
"freeze" before the first tick after open. Not incorrect, but the readout is derived from a cached
field rather than the authoritative `deadline`.

**Fix:** Derive the display from the deadline at render time where possible
(`fmtTime(remainingMs(Date.now(), sleepTimer.deadline) / 1000)` inside a `$derived` driven by a
shared ticking clock), or seed `remaining` immediately on open. Low risk; cosmetic.

### WR-04: `expireSleepTimer()` is public on the singleton with no guard against external misuse

**File:** `src/lib/stores/player.svelte.ts:572`

**Issue:**
`expireSleepTimer()` is a public method (needed for the test + the wake timer) but, unlike the
private fade/stall helpers, it has no internal idempotency guard (see CR-01). Any caller — the
timeupdate listener, the wake timer, a future UI affordance, or a test — can invoke it repeatedly and
trigger the re-entry damage. Tightening the guard (CR-01) also hardens this surface.

**Fix:** Land the CR-01 re-entry guard so the method is safe to call any number of times; consider
documenting that it is intentionally public only for the wake-timer/test seams.

## Info

### IN-01: `toggleShuffle` Fisher-Yates comment references dead code

**File:** `src/lib/stores/player.svelte.ts:1323-1324`

**Issue:** The comment `// Use ((Date.now() ^ idx) % range) is not a real CSPRNG …` describes an
approach that the code does not take (it uses `Math.random()`). Stale/misleading comment.

**Fix:** Trim the comment to just note that `Math.random()` is acceptable for shuffle UX.

### IN-02: Large commented-out CSS block left in `Nowbar.svelte::before`

**File:** `src/lib/components/Nowbar.svelte:102-106`

**Issue:** A commented-out `top/left/right/bottom: -10px` block plus a vague "Your background logic"
comment remain inside the `.nowbar::before` rule. Commented-out code / placeholder comments.

**Fix:** Remove the dead lines or implement them; keep the rule self-explanatory.

### IN-03: `gotoAlbum` in TrackMenu is defined but its only call site is commented out

**File:** `src/lib/components/TrackMenu.svelte:66-69` (definition), `190` (commented-out button)

**Issue:** `gotoAlbum()` is unused while the "Go to album" button is commented out (line 190). Dead
code path — either restore the button or drop the handler.

**Fix:** Remove `gotoAlbum` (and the commented button) or re-enable the feature. Note: this predates
Phase 18; flagged because the file is in scope.

---

_Reviewed: 2026-06-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
