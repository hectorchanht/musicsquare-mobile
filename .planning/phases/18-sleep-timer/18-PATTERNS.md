# Phase 18: Sleep Timer - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 8 (2 new files, 1 new test, 1 optional new test, 4 modified, 15 locale dicts as 1 group)
**Analogs found:** 8 / 8 (every file has an exact or strong in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/services/sleep-timer.ts` (NEW) | utility (pure helpers) | transform | `src/lib/services/lrc.ts` / `src/lib/services/media-session.ts` | exact (pure node-testable service) |
| `src/lib/services/sleep-timer.test.ts` (NEW) | test | transform | `src/lib/services/lrc.test.ts` | exact |
| `src/lib/stores/sleepTimer.svelte.ts` (NEW) | store (runes singleton) | event-driven | `src/lib/stores/searchHistory.svelte.ts` (leaf store) | exact (leaf runes singleton, in-memory) |
| `src/lib/stores/sleepTimer.svelte.test.ts` (NEW, optional) | test | event-driven | `src/lib/stores/searchHistory.svelte.test.ts` | exact (headless node runes test) |
| `src/lib/stores/player.svelte.ts` (MODIFIED) | store (engine) | event-driven / request-response | self (existing `timeupdate`/`ended`/`syncPlaybackState`/`toggle` seams) | exact (extend in place) |
| `src/lib/stores/player.svelte.test.ts` (MODIFIED) | test | event-driven | self (existing mock harness) | exact (extend) |
| `src/lib/components/TrackMenu.svelte` (MODIFIED) | component (sheet) | request-response | self — `pickerOpen` sub-sheet (lines 154-158, 194-203) | exact (3rd instance of same shape) |
| `src/lib/components/Nowbar.svelte` (MODIFIED) | component (indicator) | request-response | self — `.np-btn` / progress sliver region | role-match |
| `src/lib/components/NowPlaying.svelte` (MODIFIED) | component (indicator) | request-response | self — `.transport` row (lines 717-725) + `.times` readout | role-match |
| `src/lib/i18n/*.ts` (15 files, MODIFIED) | config (locale dict) | transform | `en.ts` `menu.*` keys + `toast.skippedMany` interpolation | exact |

---

## Pattern Assignments

### `src/lib/services/sleep-timer.ts` (utility, pure transform) — NEW

**Analog:** `src/lib/services/lrc.ts` (pure, ported, exported functions, zero `$state`/DOM) and `src/lib/services/media-session.ts` (pure node-testable core that a runes store WRAPS).

**Module doc-comment + pure-function pattern** (`lrc.ts:1-43`) — copy this exact shape: a top comment stating PURE/no-runes/no-DOM, then plain `export function` declarations with JSDoc. `media-session.ts:1-12` is the canonical "pure core that the runes store wraps" framing to mirror in the doc header:
```typescript
// PURE Media Session helpers — NO runes, NO `$state`, NO `$app/environment`.
//
// This module is the node-Vitest-testable core ... The runes ... store merely WRAPS
// these helpers behind its SSR + feature-detection guard ...
// The throw-prone, branchy logic ... lives HERE so it can be unit-tested in the node
// project, keeping the runes store a thin caller.
```

**NaN/range-safe guard pattern** (`media-session.ts:54-60`) — the precedent for `isExpired`/`remainingMs`/`fadeVolumeAt` clamping. Copy the defensive-coercion style:
```typescript
export function safePositionState(duration: number, position: number): MediaPositionState | null {
	if (!Number.isFinite(duration) || duration <= 0) return null;
	let pos = position;
	if (!Number.isFinite(pos) || pos < 0) pos = 0;
	if (pos > duration) pos = duration;
	return { duration, position: pos, playbackRate: 1 };
}
```

**Functions to implement** (from RESEARCH Code Examples, all pure, deterministic):
- `computeDeadline(now, minutes): number` → `now + minutes * 60_000`
- `isExpired(now, deadline: number | null): boolean` → `deadline != null && now >= deadline`
- `remainingMs(now, deadline: number | null): number` → `deadline == null ? 0 : Math.max(0, deadline - now)`
- `fadeVolumeAt(elapsed, totalMs, startVol): number` → clamp `[0,1]`, `totalMs <= 0 → 0` (no divide-by-zero)
- `canFadeVolume(audio: HTMLAudioElement): boolean` → write-then-readback feature-detect; restore original in a `finally`/explicit restore (iOS read-only volume, Pattern 3)
- **`decideEndedAction(sleepMode, repeatMode): 'sleep-stop' | 'repeat-rewind' | 'advance'`** — extract the D-03 precedence as a pure function so it is unit-testable (highest-value test; locks "sleep beats repeat-one beats advance" in code).

> Note: `canFadeVolume` takes an `HTMLAudioElement` but performs no DOM *mutation* beyond a probe write that it restores — it stays node-testable via a fake `{ volume }` object (RESEARCH "feature detection is unit-testable via a fake element"). Keep the `Track`-style `import type` decoupling idiom from `media-session.ts:13` if any DOM lib type is referenced.

---

### `src/lib/services/sleep-timer.test.ts` (test) — NEW

**Analog:** `src/lib/services/lrc.test.ts` (1-85).

**Test-file structure** (`lrc.test.ts:1-25`) — copy verbatim: `import { describe, it, expect } from 'vitest'`, one `describe` per function, table-driven branch coverage, every `it` carries at least one `expect` (the `requireAssertions: true` Vitest constraint). Branch-coverage idiom to mirror:
```typescript
import { describe, it, expect } from 'vitest';
import { computeDeadline, isExpired, remainingMs, fadeVolumeAt, decideEndedAction } from './sleep-timer';

describe('computeDeadline', () => {
	it('adds minutes*60_000 to now for all six durations', () => {
		for (const m of [5, 10, 15, 30, 45, 60])
			expect(computeDeadline(1_000, m)).toBe(1_000 + m * 60_000);
	});
});
// isExpired boundary: now<deadline → false; now===deadline → true; now>deadline → true; null → false
// remainingMs: clamps to 0 at/after deadline; null → 0
// fadeVolumeAt: elapsed=0 → startVol; elapsed=totalMs → 0; midpoint → startVol*0.5; totalMs<=0 → 0
// decideEndedAction: sleep beats repeat-one (D-03); repeat-one beats advance; default advance
```
Cover the exact cases from RESEARCH "What must be test-proven" (deadline ×6, isExpired boundary, remainingMs clamp, fade curve+clamps, arbitration precedence).

---

### `src/lib/stores/sleepTimer.svelte.ts` (store, event-driven) — NEW

**Analog:** `src/lib/stores/searchHistory.svelte.ts` (1-56) — the canonical small leaf runes singleton. KEY divergence: sleepTimer is **in-memory only (D-13)** so it OMITS the `browser`/`localStorage` load/save plumbing entirely (no `import { browser }`, no `SEARCH_HISTORY_KEY`).

**Class + exported singleton shape** (`searchHistory.svelte.ts:17-55`) — copy the structure (`$state` fields, public mutator methods, `export const sleepTimer = new SleepTimer()` at the bottom):
```typescript
class SleepTimer {
	mode = $state<'off' | 'minutes' | 'end-of-track'>('off');
	deadline = $state<number | null>(null);     // Date.now()+ms — ABSOLUTE (D-14)
	selectedMinutes = $state<number | null>(null);
	remaining = $state(0);                       // driven by a 1s tick while active
	private tick: ReturnType<typeof setInterval> | null = null;

	get active() { return this.mode !== 'off'; }

	set(mode, minutes?) { /* compute deadline via computeDeadline; start 1s tick */ }
	restart() { /* re-set from selectedMinutes — fresh deadline (D-11) */ }
	cancel() { /* mode='off', deadline=null, clear tick (D-09 silent) */ }
}
export const sleepTimer = new SleepTimer();
```

**Leaf-store discipline (CRITICAL):** mirrors `searchHistory` and `overlays` — this store imports the PURE helpers from `sleep-timer.ts` and imports NOTHING from `player.svelte.ts` (RESEARCH: "Imports nothing from player (leaf store, mirrors `settings`/`overlays`)"). The player imports the timer store, never the reverse — this prevents a circular import. The `set/cancel/restart` countdown `setInterval` is a UI-cadence tick ONLY (drives `remaining`); it is NEVER the deadline authority (the `timeupdate` backstop in the player is). Anti-pattern from RESEARCH: do not count ticks toward the deadline.

---

### `src/lib/stores/sleepTimer.svelte.test.ts` (test, optional) — NEW

**Analog:** `src/lib/stores/searchHistory.svelte.test.ts` (1-42) — headless runes test under the node project.

**Headless-store test pattern** (`searchHistory.svelte.test.ts:8-32`) — copy: `import { describe, it, expect, beforeEach } from 'vitest'`, import the singleton, `beforeEach(() => sleepTimer.cancel())`, then assert state transitions on the in-memory `$state`:
```typescript
describe('sleepTimer store', () => {
	beforeEach(() => sleepTimer.cancel());
	it("set('minutes', 30) activates with mode/deadline set", () => {
		sleepTimer.set('minutes', 30);
		expect(sleepTimer.active).toBe(true);
		expect(sleepTimer.mode).toBe('minutes');
		expect(sleepTimer.deadline).not.toBeNull();
	});
	it('cancel() clears mode + deadline', () => { /* ... active===false, deadline===null */ });
	it('restart from a different duration resets the deadline fresh (D-11)', () => { /* ... */ });
});
```
Clean up any `setInterval` in `cancel()` so the node test does not leak a live timer. Mirror `searchHistory`'s SSR-guard note where relevant (no localStorage touch — but sleepTimer has none anyway).

---

### `src/lib/stores/player.svelte.ts` (store, event-driven) — MODIFIED

**Analog:** self — four existing seams, all read directly this session.

**(a) `timeupdate` backstop** — insert at the TOP of the existing listener (`player.svelte.ts:589-601`). Existing body for reference:
```typescript
el.addEventListener('timeupdate', () => {
	this.currentTime = el.currentTime || 0;
	this.syncPosition(el);
	this.hasPlayedSinceSrc = true;
	this.disarmStall();
	this.persistThrottled();
});
```
Prepend a `sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)` check that calls `this.expireSleepTimer()` then `return`s before the existing body (RESEARCH Pattern 1). `timeupdate` is the throttle-proof tick.

**(b) `ended` branch BEFORE repeat-one** — the existing handler (`player.svelte.ts:621-639`):
```typescript
el.addEventListener('ended', () => {
	this.playing = false;
	this.syncPlaybackState();
	this.disarmStall();
	if (this.repeatMode === 'one' && this.audio) {   // <-- NEW branch goes BEFORE this
		this.audio.currentTime = 0;
		void this.audio.play().catch(() => {});
		return;
	}
	this.next();
});
```
Insert the end-of-track branch immediately after `disarmStall()` and BEFORE the `repeatMode === 'one'` block (RESEARCH Pattern 2 / D-03): `if (sleepTimer.mode === 'end-of-track') { sleepTimer.cancel(); this.clearMedia(); return; }`. Use the existing `decideEndedAction()` pure helper to make the precedence explicit and testable. The `return` suppresses BOTH `next()` and the repeat-one rewind.

**(c) NEW `expireSleepTimer()` + fade lifecycle** — model on the pause/sync seam. Existing primitives to reuse:
- `syncPlaybackState()` (`player.svelte.ts:506-509`) and the `pause` listener (`:580-588`) — `audio.pause()` already fires `pause` → `syncPlaybackState()` → lock screen reads paused FOR FREE (D-09). Do NOT add new Media Session code.
- `clearMedia()` (`:512-518`) for end-of-track full clear.
- `disarmStall()` (`:540-545`) — class-field-timer + `clearTimeout` idiom to copy for the fade `setInterval` (`fadeTimer`/`clearInterval`).
Implement per RESEARCH "expireSleepTimer" example: `if (this.audio.paused) { sleepTimer.cancel(); return; }` (D-04 silent clear), `canFadeVolume()` gate → ~10s `fadeVolumeAt` interval → `finishExpiry()` (`audio.pause()` + restore `preFadeVolume` + `sleepTimer.cancel()`), else instant pause.
**MUST NOT** (RESEARCH Pitfall 2): call `this.next()`, bump `this.playGen` (`:953` shows the only legitimate bump point), or touch `this.consecutiveFailures` (`:116`) / `this.errorBurst` (`:129`) / `runFallback` (`:1220`) / `tripLoopGuard`. This is an intentional pause, not a failure.

**(d) fade-abort on gestures (D-05)** — add an `abortFade()` call at the top of `toggle()` (`:1144-1148`), `next()` (`:1150-1163`), `prev()` (`:1165-1174`), `seekFraction()` (`:1442-1471`). `abortFade()` clears `fadeTimer`, restores `preFadeVolume`, and `sleepTimer.cancel()` (user is awake). Centralize as one private method called from each entry point.

**Helpers/exports to reuse, not rebuild:**
- `fmtTime(s)` (`player.svelte.ts:89-94`) — NaN/Infinity-safe mm:ss for the countdown readouts (already exported). Convert `remaining`/`remainingMs` → seconds before passing.

---

### `src/lib/stores/player.svelte.test.ts` (test) — MODIFIED

**Analog:** self — the existing mock harness (`player.svelte.test.ts:1-63`).

**Mock + harness pattern to extend** (`:13-46`): `vi.mock` the service deps, the `vi.stubGlobal('localStorage', ...)` memStore, `vi.mock('$app/environment', () => ({ browser: true }))`, and the `mk(source, songid, artist, title)` Track factory (`:65-75`). Add assertions that after `player.expireSleepTimer()`: `next` is NOT called, `consecutiveFailures`/`errorBurst` are unchanged, and `playGen` did not bump (the STATE.md Phase 18 blocker, proven in code). This is an EXTEND, not a new file.

---

### `src/lib/components/TrackMenu.svelte` (component, sheet) — MODIFIED

**Analog:** self — the `pickerOpen` sub-sheet (the second of three sheets in this file). The timer sheet is a verbatim third instance.

**Imports to add** (`TrackMenu.svelte:1-16` block) — add `Moon` (or `Timer`/`AlarmClock`) to the `@lucide/svelte` import, `import { sleepTimer } from '$lib/stores/sleepTimer.svelte'`, and `import { fmtTime } from '$lib/stores/player.svelte'`. `untrack`, `fly`, `dragClose`, `overlays`, `t` are already imported.

**Local `$state` + close reset** (`:23, :34-37`):
```typescript
let pickerOpen = $state(false);   // existing — add: let timerOpen = $state(false);
function close() { pickerOpen = false; /* add: timerOpen = false; */ onclose(); }
```

**Overlay-registration `$effect` (Pitfall 6 — COPY EXACTLY)** (`:154-158`):
```typescript
$effect(() => {
	if (pickerOpen && track) {
		untrack(() => overlays.open("trackmenu-picker", () => (pickerOpen = false)));
		return () => untrack(() => overlays.dismiss("trackmenu-picker"));
	}
});
```
New effect: dep on `timerOpen` ONLY, `id = "trackmenu-timer"`, `untrack` around `overlays.open/dismiss`. Visibility gated by `{#if timerOpen}`, NOT by the effect (RESEARCH Pitfall 6 / `:143-147` comment explains why a `track`/countdown dep would churn history depth).

**Menu-item button** (`:185` is the exact `pickerOpen`-trigger precedent):
```svelte
<button class="mi" onclick={() => { pickerOpen = true; }}><ListPlus size={18} /> {t('menu.addToPlaylist')}</button>
```
Add a sibling: `<button class="mi" onclick={() => { timerOpen = true; }}><Moon size={18} /> {t('menu.sleepTimer')}</button>` (Phase 19 restyles the menu but keeps this action).

**Sub-sheet markup** (`:194-203` — copy verbatim, swap content):
```svelte
{#if pickerOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }}>
		<div class="menu-head">{t('menu.addToPlaylist')}</div>
		<button class="mi" onclick={() => addToPlaylist(pl.id)}><ListPlus size={18} /> {pl.name} <span class="count">{pl.tracks.length}</span></button>
	</div>
{/if}
```
Timer sheet (per RESEARCH "Timer sheet" example): header shows `· {fmtTime(sleepTimer.remaining / 1000)}` when active+minutes (D-11), `{#each DURATIONS as min}` rows with `class:on={sleepTimer.mode==='minutes' && sleepTimer.selectedMinutes===min}` and `{t('timer.minutes', { n: min })}` label, an end-of-track row `class:on={sleepTimer.mode==='end-of-track'}`, and `{#if sleepTimer.active}` a bottom Cancel row. Each duration tap calls `sleepTimer.set(...)` then `timerOpen = false` (D-12 — countdown is the confirmation, no toast). Reuse the existing `.mi`/`.scrim`/`.menu`/`.menu-head` classes — no new CSS class needed.

---

### `src/lib/components/Nowbar.svelte` (component, indicator) — MODIFIED

**Analog:** self — the play-button + progress-sliver region (`Nowbar.svelte:37-63`).

**Imports** — add `Moon` to `import { Play, Pause, Loader } from '@lucide/svelte'` (`:10`); add `import { sleepTimer } from '$lib/stores/sleepTimer.svelte'` and `import { fmtTime } from '$lib/stores/player.svelte'`.

**Placement** — RESEARCH (Open Question 2) recommends a small tappable badge to the LEFT of the `.np-btn` play button (`:58-62`), inside the existing flex row. Pattern to copy is the `.np-btn` button shape (`:188-201`) and the `t()`/`aria-label` idiom. Gate with `{#if sleepTimer.active}`; D-07 allows icon-only on the nowbar if tight (`{#if space}{fmtTime(sleepTimer.remaining / 1000)}{/if}`). `onclick` opens the same timer sheet — wire via a prop/callback or a shared overlay trigger so tapping reopens the TrackMenu timer sheet (D-08). Reuse `.np-btn`-style CSS (`:188-201`); add a small variant class if needed.

---

### `src/lib/components/NowPlaying.svelte` (component, indicator) — MODIFIED

**Analog:** self — the `.transport` row (`NowPlaying.svelte:717-725`) + the `.times` progress readout (`:711`).

**Transport-button pattern to copy** (`:717-725`):
```svelte
<div class="transport" bind:this={transportEl}>
	<button class="t" class:on={currentLiked} aria-label={...} onclick={toggleCurrentLike}><Heart size={20} .../></button>
	...
	<button class="t" class:on={player.repeatMode !== 'off'} aria-label={...} onclick={() => player.cycleRepeat()}>...</button>
</div>
```
Add a full countdown readout near the transport region (D-06/D-07: NowPlaying shows the FULL mm:ss). Use `fmtTime(sleepTimer.remaining / 1000)` for minutes mode, or a `t('timer.endOfTrack')` label in end-of-track mode. Gate with `{#if sleepTimer.active}`; make it tappable to reopen the timer sheet (D-08) using the `.t`/`class:on` button idiom and a `Moon` icon (import `Moon` from `@lucide/svelte` alongside the existing transport icons). `fmtTime` is already importable from `player.svelte.ts`.

---

## Shared Patterns

### Pure-core / runes-wrapper separation
**Source:** `src/lib/services/media-session.ts:1-12` (doc) + `src/lib/services/lrc.ts:1-43` (impl) + `src/lib/stores/searchHistory.svelte.ts` (wrapper).
**Apply to:** `sleep-timer.ts` (pure helpers) ↔ `sleepTimer.svelte.ts` (thin runes wrapper) ↔ `player.svelte.ts` (effectful caller). Branchy/throw-prone logic lives in the pure module so it is node-testable; the runes store and player are thin callers.

### Leaf-store discipline (no upward imports)
**Source:** `src/lib/stores/searchHistory.svelte.ts`, `src/lib/stores/overlays.svelte.ts`.
**Apply to:** `sleepTimer.svelte.ts` — imports the pure helpers only, never `player.svelte.ts`. The player imports the timer store. One-directional dependency prevents a cycle (RESEARCH "Stores never import the player from services").

### Overlay back-to-close registration (single dismiss path)
**Source:** `src/lib/components/TrackMenu.svelte:143-162` + `src/lib/stores/overlays.svelte.ts:59-108`.
**Apply to:** the new timer sub-sheet — `$effect` dep on the `timerOpen` boolean ONLY, `untrack(() => overlays.open/dismiss('trackmenu-timer', ...))`, visibility gated by `{#if timerOpen}`. The `$effect` cleanup is the ONLY `dismiss` caller (scrim/X/drag/back-gesture all converge there). History depth == stack depth invariant (Pitfall 6 / Phase 19 blocker).

### Media Session paused sync (reuse, don't rebuild)
**Source:** `src/lib/stores/player.svelte.ts:506-509` (`syncPlaybackState`) + `:580-588` (`pause` listener) + `:512-518` (`clearMedia`) + `src/lib/services/media-session.ts:66-69` (`playbackStateFor`).
**Apply to:** `expireSleepTimer()` / the end-of-track branch — calling `audio.pause()` fires the existing `pause` listener → `syncPlaybackState()` → lock screen reads paused for free (D-09). No new Media Session action handler.

### mm:ss formatting
**Source:** `src/lib/stores/player.svelte.ts:89-94` (`export function fmtTime`).
**Apply to:** every countdown readout (TrackMenu sheet header, Nowbar badge, NowPlaying readout). NaN/Infinity-safe; pass `remaining / 1000` (ms → s). Do not write a new formatter.

### Sheet dismiss gesture + transition
**Source:** `src/lib/components/TrackMenu.svelte:196` — `transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose }}`.
**Apply to:** the timer sub-sheet (verbatim).

### i18n 15-locale parity + single interpolation key
**Source:** `src/lib/i18n/en.ts:226-249` (`menu.*` keys) + `:257` (`toast.skippedMany: '{count} songs skipped'`) + `src/lib/i18n/index.ts:67-72,106-108` (`interpolate` / `t(key, params)` API).
**Apply to:** add ~4 keys to ALL 15 dicts at once (Pitfall 5): `menu.sleepTimer`, `timer.endOfTrack`, `timer.cancel`, `timer.minutes` ('{n} min' / '{n} minutes' — ONE interpolation key via `t('timer.minutes', { n: min })`, NOT six hardcoded strings). ZERO expiry-toast key (D-09). `en.ts` defines `TranslationKey`, so a key missing from any of the other 14 dicts is a `svelte-check` compile error.

### Class-field timer + clearTimeout/clearInterval lifecycle
**Source:** `src/lib/stores/player.svelte.ts:527-545` (`armStall`/`disarmStall`) and `searchHistory`/`TrackMenu` `toastTimer` (`TrackMenu.svelte:26-31`).
**Apply to:** the fade `setInterval` (`fadeTimer`) on the player and the 1s countdown `setInterval` (`tick`) on the timer store — always clear the prior timer before re-arming, and clear on cancel/expiry/abort.

---

## No Analog Found

None. Every file maps to an exact or strong in-repo analog. The only genuinely net-new logic (absolute-deadline math, volume-fade feature-detect, end-of-track arbitration) is pure and follows the established `lrc.ts`/`media-session.ts` pure-helper template; everything else is wiring into existing seams.

| File | Role | Data Flow | Status |
|------|------|-----------|--------|
| — | — | — | All files have analogs |

---

## Metadata

**Analog search scope:** `src/lib/stores/`, `src/lib/services/`, `src/lib/components/`, `src/lib/i18n/`
**Files scanned (read):** `searchHistory.svelte.ts`, `searchHistory.svelte.test.ts`, `media-session.ts`, `lrc.ts`, `lrc.test.ts`, `overlays.svelte.ts`, `player.svelte.ts` (targeted ranges: fmtTime 89-94, syncPlaybackState/clearMedia/armStall/attach 503-665, ended 621-639, toggle/next/prev 1144-1174, seekFraction 1442-1471), `player.svelte.test.ts` (1-75), `TrackMenu.svelte` (1-40 + grep map of pickerOpen/effect/markup), `Nowbar.svelte` (full), `NowPlaying.svelte` (transport/seek grep map), `i18n/index.ts`, `i18n/en.ts` (key grep), 15-locale dict file list confirmed
**Pattern extraction date:** 2026-06-11
