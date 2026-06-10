# Phase 18: Sleep Timer - Research

**Researched:** 2026-06-11
**Domain:** Client-side timer/scheduling in a Svelte 5 runes singleton player store, integrated with a single-`<audio>`-element engine, background-tab timer throttling, iOS volume read-only constraint, and a third TrackMenu sub-sheet.
**Confidence:** HIGH — every integration point read directly against the live `player.svelte.ts` (1482 lines), `TrackMenu.svelte`, `overlays.svelte.ts`, `Nowbar.svelte`, `settings.svelte.ts`, and `i18n/`. Platform facts (iOS `volume` read-only, background-tab throttling, audio-exempt-from-intensive-throttling) verified against MDN/WebKit/Chrome-for-Developers. This phase is policy + wiring + UI on the existing engine; zero net-new runtime deps.

## Summary

Phase 18 adds a sleep timer with two modes — minutes-based (5/10/15/30/45/60) and end-of-track — that stops playback by **pausing in place** (D-02), with an optional ~10s volume fade where the platform honors `audio.volume` writes (D-01). It is the single sanctioned way playback stops by itself, deliberately inverting the Phase 16 "never-stop" posture. The hard requirement is that the stop must **suppress `next()`** and must never touch the Phase 16 failure machinery (`consecutiveFailures`, `errorBurst`, `runFallback`, `tripLoopGuard`, skip-burst notices) — the timer pause is intentional, not a failure.

The timer engine must use an **absolute wall-clock deadline** (`Date.now() + ms`), not a tick-counting `setTimeout`, because background tabs throttle timers. The crucial discovery: an actively-playing audio page is *exempt from intensive throttling* (audible-in-last-30s exemption) so a `setInterval` countdown is acceptable *while playing*, but the robust backstop is to re-check `Date.now() >= deadline` inside the existing `timeupdate` listener — `timeupdate` fires ~4×/sec while audio plays even when backgrounded/locked, and the store already has that listener wired (player.svelte.ts:589). This gives an effectively-free, throttle-proof deadline check that fires promptly whenever audio is producing output.

**Primary recommendation:** Implement the timer as a small dedicated runes module (`src/lib/stores/sleepTimer.svelte.ts`) for the deadline/mode/countdown state, plus a **pure node-testable helper module** (`src/lib/services/sleep-timer.ts`) for deadline math, end-of-track arbitration, and fade-step computation. Wire three integration points into `player.svelte.ts`: (1) a deadline check at the top of the `timeupdate` listener (the backstop), (2) an end-of-track branch in the `ended` listener placed **before** the repeat-one branch (player.svelte.ts:628), and (3) a public `player`-side expiry method that pauses + suppresses advance without entering the failure chain. Volume fade must feature-detect via write-then-readback and degrade to instant pause on iOS. The timer sheet is a third instance of the exact `pickerOpen` overlay precedent already in `TrackMenu.svelte`. The indicator (moon badge + countdown) lands on `Nowbar.svelte` and in `NowPlaying.svelte`'s transport region, both tappable to reopen the sheet.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Expiry behavior**
- **D-01:** Fade-out where possible: ~10s volume fade then pause on platforms that honor `audio.volume` writes (Android/desktop); iOS Safari falls back to instant pause (`volume` is effectively read-only on iOS media elements — feature-detect, don't UA-sniff). Fade applies to minutes-based timers; end-of-track mode ends at the natural track boundary (no fade needed).
- **D-02:** Expiry = pause in place. Track, queue, and position all kept; tapping play resumes exactly where it stopped. Volume restored to the pre-fade level after pausing.
- **D-03:** End-of-track mode beats repeat-one: stop at the end of the current play-through, suppressing the repeat-one rewind branch for that `ended` event (mirrors Phase 16 D-12 — explicit intent wins).
- **D-04:** Timer expires while the user already paused manually → clear the timer silently (no fade, no toast); indicator disappears. Resuming later plays normally with no timer.
- **D-05:** Any playback gesture DURING the fade (play/pause toggle, next/prev, seek) aborts the stop: volume restores, playback continues, timer cleared — the user is clearly awake.

**Active indicator**
- **D-06:** Indicator lives on BOTH surfaces: a compact moon badge on the nowbar AND a fuller readout inside the expanded NowPlaying.
- **D-07:** Indicator shows icon + live countdown (mm:ss remaining, or an "end of track" label in that mode). NowPlaying shows the full countdown; nowbar may be icon-only if space is tight.
- **D-08:** Indicator is tappable on either surface — tap opens the same timer sheet (fastest cancel/change path; no need to re-find the track menu).
- **D-09:** Expiry is silent: no toast; the indicator disappears and the player shows its normal paused state. (User is likely asleep; zero new expiry i18n keys.)

**Set/cancel/change UX**
- **D-10:** Duration picker = sub-sheet opened from a "Sleep timer" track-menu item — exact `pickerOpen` precedent already in TrackMenu.svelte (playlist picker). Listing: 5/10/15/30/45/60 min + end-of-track.
- **D-11:** With a timer active, the sheet header shows live remaining time, the active duration is highlighted, tapping a different duration restarts the timer fresh from that duration, and an explicit Cancel row sits at the bottom.
- **D-12:** Setting a duration: sheet closes, indicator appears — the countdown IS the confirmation. No toast.

**Persistence & edge semantics**
- **D-13:** Timer is in-memory only — page reload/app relaunch clears it. No storage key.
- **D-14:** The minutes-based deadline is absolute wall-clock and unaffected by track changes, skips, or queue swaps (Spotify behavior). End-of-track mode follows whatever is playing when the end arrives — a manual skip just moves the goalpost to the new track's natural end (skip does NOT cancel the timer).

### Claude's Discretion
- Exact fade duration (~10s ±) and curve; volume-write feature-detection mechanism
- Countdown update cadence (1s tick vs derived from existing timeupdate sync) and exact nowbar badge placement/styling
- Timer sheet row ordering/wording; which minimal i18n keys to add (menu item, "End of track", "Cancel" — keep 15-locale parity cost low; reuse existing keys where possible)
- Media Session / lock-screen state sync at expiry (should read paused — reuse existing `syncPlaybackState` path)
- Where the timer state lives (player store field vs tiny dedicated module) — must respect `playGen` discipline and the suppress-`next()` lock

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TIMER-01 | User can set a sleep timer (5/10/15/30/45/60 min or end-of-track) from the track menu; playback stops at expiry; an active-timer indicator is visible and the timer can be cancelled/changed | Architecture Patterns (absolute-deadline engine + timeupdate backstop + ended-branch arbitration), Standard Stack (zero new deps), Code Examples (deadline math, fade feature-detect, expiry-suppresses-next), Common Pitfalls (background throttle, failure-machinery collision, fade-abort), Validation Architecture (pure-logic test map) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Timer deadline scheduling + countdown state | Browser / Client (runes store) | — | Pure client concern; in-memory only (D-13); no server involvement |
| Deadline expiry detection (backstop) | Browser / Client (`timeupdate` listener in player store) | — | Audio element's `timeupdate` is the throttle-proof tick; the engine already owns it |
| Expiry stop (pause + fade) | Browser / Client (player store method) | — | Must coordinate with `<audio>` element, `playGen`, Media Session — all player-owned |
| End-of-track arbitration vs repeat-one | Browser / Client (`ended` listener) | — | `ended` handler already owns repeat-one (player.svelte.ts:628); the new branch sits before it |
| Volume fade | Browser / Client (`audio.volume` writes) | — | Single-`<audio>` invariant; NO Web Audio API (verified: zero AudioContext/GainNode usage in src/) |
| Timer set/cancel/change UI | Browser / Client (TrackMenu sub-sheet) | — | Reuses `pickerOpen` overlay precedent |
| Active-timer indicator | Browser / Client (Nowbar + NowPlaying) | — | Reactive read of the timer store; both surfaces tappable |
| Pure deadline/fade/arbitration logic | Browser / Client (node-testable service) | — | Extractable pure functions → Vitest node project (no DOM) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none — platform only) | — | `Date.now()`, `setInterval`/`setTimeout`, `audio.volume`, `audio.pause()`, `HTMLMediaElement` events | The entire feature is platform timer + audio APIs. STATE.md: "zero net-new runtime deps" for all v1.2 PLAY/QUEUE work. `[VERIFIED: codebase grep]` |
| Svelte 5 runes | 5.56.2 | `$state` for reactive timer/countdown; `$derived` for mm:ss display | Matches every existing store (`player.svelte.ts`, `settings.svelte.ts`, `overlays.svelte.ts`). `[VERIFIED: package.json]` |
| `@lucide/svelte` | (installed) | Moon / timer icon for the indicator + menu item | Already the project's icon set (imported across TrackMenu/NowPlaying/Nowbar). Candidates: `Moon`, `Timer`, `Clock`, `AlarmClock` (all in lucide). `[VERIFIED: codebase grep]` |
| `vitest` | ^4.1.3 | Node-project unit tests for pure timer logic | Existing test infra; `*.svelte.test.ts` runs under the node project (sveltekit Vite plugin transforms runes). `[VERIFIED: vite.config.ts]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `$lib/i18n` `t()` | — | New keys for menu item + sheet labels (NOT expiry — D-09 is silent) | Minimal new keys across 15 locales (Pitfall 14) |
| `dragClose` action | — | Timer sheet dismiss (finger-follow translateY) | Reuse verbatim — already wired into all 3 TrackMenu sheets |
| `overlays` store | — | History-API back-to-close registration for the new sheet | Third `pickerOpen`-style instance |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `timeupdate`-based deadline backstop | Web Worker timer (unthrottled in background) | Worker timers survive throttling but add a worker file + message plumbing for a feature where "a few seconds late" is acceptable (Pitfall 10). Audio-playing pages are already exempt from *intensive* throttling, and `timeupdate` fires ~4×/sec during playback — so a Worker is unjustified complexity. NOT recommended. |
| `audio.volume` fade | Web Audio API `GainNode` ramp | Project invariant: single `<audio>` element, NO Web Audio graph (verified zero usage). A GainNode requires routing the element through an AudioContext (MediaElementSource), which itself has iOS unlock quirks and breaks the single-element model. NOT recommended — fade must be `audio.volume`-based or skipped (D-01). |
| Dedicated timer store + pure service | Inline fields on `player.svelte.ts` | The player store is already 1482 lines. A small dedicated `sleepTimer.svelte.ts` keeps it readable; the expiry *action* still lives on the player (it touches `audio`/`playGen`/Media Session). RECOMMENDED split — see Architecture. |

**Installation:**
```bash
# No new packages. Verify nothing is needed:
# (lucide + vitest + svelte already in package.json)
```

**Version verification:** No external packages are added. Confirmed `svelte@5.56.2`, `vitest@^4.1.3`, `vite@8.0.16` in `package.json`. `@lucide/svelte` is already imported throughout `src/lib/components/`. `[VERIFIED: codebase grep]`

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. All capabilities use platform APIs (`Date.now`, timers, `HTMLMediaElement`) plus already-installed deps (`svelte`, `@lucide/svelte`, `vitest`). slopcheck/registry verification is moot. No `## Package Legitimacy Audit` table needed.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────┐
   USER taps "Sleep     │  TrackMenu.svelte                            │
   timer" menu item ───►│   (3rd pickerOpen-style sub-sheet)          │
                        │   durations: 5/10/15/30/45/60 + end-of-track│
                        └───────────────┬─────────────────────────────┘
                                        │ set(mode, minutes?)
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │  sleepTimer.svelte.ts  (runes store, in-memory only)        │
        │   • mode: 'off' | 'minutes' | 'end-of-track'                │
        │   • deadline: number | null   (Date.now()+ms — ABSOLUTE)    │
        │   • remainingMs (derived from a 1s tick WHILE playing)      │
        │   • set/cancel/restart                                      │
        └───────┬─────────────────────────────────┬──────────────────┘
                │ reactive read                    │ deadline / mode read
                ▼                                   ▼
   ┌────────────────────────┐         ┌────────────────────────────────────┐
   │ Nowbar.svelte           │         │  player.svelte.ts (existing engine) │
   │  moon badge + mm:ss     │         │                                     │
   │  (tap → reopen sheet)   │         │  timeupdate listener (:589)  ◄── BACKSTOP
   │ NowPlaying.svelte       │         │    if minutes && Date.now()>=deadline │
   │  full countdown readout │         │      → player.expireSleepTimer()    │
   │  (tap → reopen sheet)   │         │                                     │
   └────────────────────────┘         │  ended listener (:621)              │
                                       │    [NEW BRANCH — BEFORE repeat-one] │
                                       │    if mode==='end-of-track'         │
                                       │      → pause + clear, NO next()     │
                                       │    else if repeatMode==='one' ...   │
                                       │                                     │
                                       │  expireSleepTimer():                │
                                       │    • optional ~10s volume fade      │
                                       │      (feature-detected; iOS=skip)   │
                                       │    • audio.pause()                  │
                                       │    • restore volume                 │
                                       │    • syncPlaybackState() → paused   │
                                       │    • DOES NOT touch next()/runFallback/
                                       │      consecutiveFailures/errorBurst │
                                       │                                     │
                                       │  toggle()/next()/prev()/seekFraction│
                                       │    [NEW: abort in-flight fade (D-05)]│
                                       └─────────────┬───────────────────────┘
                                                     ▼
                                       single <audio> element (.volume / .pause)
```

The diagram traces the primary use case: tap menu item → set deadline in the timer store → indicator renders on both surfaces → `timeupdate` (or `ended` for end-of-track) detects expiry → player pauses with optional fade → indicator disappears, no toast.

### Component Responsibilities

| File | New / Modified | Responsibility |
|------|----------------|----------------|
| `src/lib/services/sleep-timer.ts` | NEW | PURE functions: `computeDeadline(now, minutes)`, `isExpired(now, deadline)`, `remainingMs(now, deadline)`, `fadeVolumeAt(elapsed, totalMs, startVol)` (step value), `canFadeVolume(audio)` (write-then-readback feature-detect). No DOM mutation, no `$state` — node-testable. |
| `src/lib/stores/sleepTimer.svelte.ts` | NEW | Runes singleton: `mode`/`deadline`/`active` `$state`; `set(mode, minutes?)`, `restart`, `cancel`; a 1s `setInterval` tick (started on set, stopped on cancel/expiry) driving a `remaining` `$state` for the countdown. In-memory only (D-13). Imports nothing from player (leaf store, mirrors `settings`/`overlays`). |
| `src/lib/stores/player.svelte.ts` | MODIFIED | (a) `timeupdate` listener: add a deadline backstop check at the top. (b) `ended` listener: add end-of-track branch BEFORE the repeat-one branch (:628). (c) NEW `expireSleepTimer()` method (pause + optional fade + restore + sync, suppress-next). (d) `toggle()`/`next()`/`prev()`/`seekFraction()`: abort an in-flight fade (D-05). |
| `src/lib/components/TrackMenu.svelte` | MODIFIED | New "Sleep timer" menu item + a 3rd `pickerOpen`-style sub-sheet (`timerOpen` $state + `$effect` registering with `overlays` — dep on `timerOpen` ONLY, `untrack` the overlays calls). |
| `src/lib/components/Nowbar.svelte` | MODIFIED | Moon badge + mm:ss countdown (icon-only if tight), tappable → reopen sheet. |
| `src/lib/components/NowPlaying.svelte` | MODIFIED | Full countdown readout near the transport row (:717), tappable → reopen sheet. |
| `src/lib/i18n/*.ts` (15 files) | MODIFIED | New keys: `menu.sleepTimer`, `timer.endOfTrack`, `timer.cancel`, a minutes-unit key (e.g. `timer.minutes` with `{n}` interpolation — NOT 6 hardcoded strings, Pitfall 14). NO expiry-toast key (D-09). |

### Recommended Project Structure
```
src/lib/
├── services/
│   └── sleep-timer.ts          # NEW — pure deadline/fade/arbitration helpers (node-tested)
│   └── sleep-timer.test.ts     # NEW — Vitest node project
├── stores/
│   └── sleepTimer.svelte.ts    # NEW — runes singleton (deadline/mode/countdown)
│   └── sleepTimer.svelte.test.ts # NEW — optional runes-state test (node project)
│   └── player.svelte.ts        # MODIFIED — timeupdate backstop, ended branch, expireSleepTimer()
├── components/
│   ├── TrackMenu.svelte        # MODIFIED — menu item + timer sub-sheet
│   ├── Nowbar.svelte           # MODIFIED — moon badge + countdown
│   └── NowPlaying.svelte       # MODIFIED — full readout
└── i18n/*.ts                   # MODIFIED — minimal new keys × 15 locales
```

### Pattern 1: Absolute-deadline timer with `timeupdate` backstop
**What:** Store `deadline = Date.now() + minutes*60_000`. Never count `setInterval` ticks toward the deadline. Detect expiry by checking `Date.now() >= deadline` inside the existing `timeupdate` listener (fires ~4×/sec while audio plays, even backgrounded/locked).
**When to use:** Minutes-based timers (D-14: absolute wall-clock, unaffected by track changes).
**Example:**
```typescript
// Source: derived from Chrome timer-throttling docs + existing player.svelte.ts:589
// In player.svelte.ts attach(), at the TOP of the existing timeupdate listener:
el.addEventListener('timeupdate', () => {
  // Sleep-timer backstop (D-14): timeupdate is the throttle-proof tick. A backgrounded
  // setInterval can be clamped to 1/min, but timeupdate keeps firing while audio plays.
  if (sleepTimer.mode === 'minutes' && sleepTimer.deadline != null
      && Date.now() >= sleepTimer.deadline) {
    this.expireSleepTimer();   // pause + fade + clear; DOES NOT call next()
    return;
  }
  // ... existing timeupdate body (currentTime, syncPosition, hasPlayedSinceSrc, persist) ...
});
```

### Pattern 2: End-of-track arbitration BEFORE repeat-one
**What:** In the `ended` listener, a `mode === 'end-of-track'` sleep timer pauses + clears INSTEAD of advancing — and it must run before the existing repeat-one rewind branch (D-03 mirrors Phase 16 D-12: explicit intent wins).
**When to use:** End-of-track mode only.
**Example:**
```typescript
// Source: player.svelte.ts:621-639 (existing ended listener), new branch prepended
el.addEventListener('ended', () => {
  this.playing = false;
  this.syncPlaybackState();
  this.disarmStall();
  // [NEW] End-of-track sleep timer (D-03): beats repeat-one. Stop at the natural boundary,
  // suppress BOTH next() and the repeat-one rewind. Intentional stop — NOT a failure.
  if (sleepTimer.mode === 'end-of-track') {
    sleepTimer.cancel();
    this.clearMedia();              // or syncPlaybackState — lock screen reads paused
    return;                          // <-- suppress next() AND repeat-one
  }
  // existing repeat-one branch
  if (this.repeatMode === 'one' && this.audio) { /* rewind + play */ return; }
  this.next();
});
```

### Pattern 3: Volume-fade feature detection (write-then-readback)
**What:** iOS Safari `audio.volume` is read-only — writes are ignored and reads always return `1`. Detect by writing a test value and reading it back; if it didn't change, skip the fade and pause instantly (D-01). Do NOT UA-sniff.
**When to use:** Before starting a minutes-based fade.
**Example:**
```typescript
// Source: MDN HTMLMediaElement.volume (iOS not supported) + Apple HTML5 Audio Guide
// Pure helper in sleep-timer.ts:
export function canFadeVolume(audio: HTMLAudioElement): boolean {
  const original = audio.volume;
  try {
    const probe = original === 0 ? 0.5 : 0;   // pick a value guaranteed to differ
    audio.volume = probe;
    const honored = Math.abs(audio.volume - probe) < 0.001;
    audio.volume = original;                    // always restore
    return honored;
  } catch {
    return false;
  }
}
```

### Anti-Patterns to Avoid
- **Tick-counting deadline:** Counting `setInterval` fires (e.g. 1800 ticks = 30 min) drifts badly when backgrounded — Chrome clamps to 1/min after 5 min hidden. Use the absolute `Date.now()` deadline instead.
- **A second `<audio>` for fade or any reason:** Breaks iOS + desyncs Media Session (Pitfall 4 from PITFALLS.md). Fade modifies `.volume` on the single existing element.
- **Routing expiry through `next()` / `runFallback`:** The expiry stop must NOT increment `consecutiveFailures`/`errorBurst`, must NOT emit skip notices, must NOT trip the loop-guard. It is an intentional pause, not a playback failure. Call a dedicated `expireSleepTimer()` that only pauses.
- **`$effect` depending on `track`/timer fields for overlay registration:** The timer sheet's overlay-registration `$effect` must depend on the open boolean ONLY, with `untrack` around `overlays.open/dismiss` (Pitfall 15, STATE.md Phase 19 blocker). Visibility gated by `{#if timerOpen}`.
- **UA-sniffing for iOS:** Brittle. Feature-detect volume writability (Pattern 3).
- **Bumping `playGen` on expiry:** Expiry pauses the *current* track in place (D-02) — it does not start a new play, so it must not bump `playGen`. (Resuming via `toggle()` later is a plain `audio.play()`, not a `play(track)`.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Throttle-proof background scheduling | A Web Worker timer harness | The existing `timeupdate` listener + absolute deadline | `timeupdate` already fires ~4×/sec during playback (even backgrounded); audio pages are exempt from intensive throttling. A Worker is overkill for "stop a few seconds late is fine." |
| Overlay back-to-close / history balance | New popstate wiring for the timer sheet | `overlays.svelte.ts` `open`/`dismiss` + `dragClose` action | Already solved with documented invariants (history depth == stack depth). Third instance of `pickerOpen`. |
| mm:ss formatting | A new formatter | `fmtTime(s)` exported from `player.svelte.ts:89` | NaN/Infinity-safe, already used everywhere. |
| Sheet dismiss gesture | New drag handler | `use:dragClose={{ onclose }}` | Finger-follow translateY + tap-preserving, wired into all 3 existing sheets. |
| Lock-screen paused state on expiry | New Media Session code | `syncPlaybackState()` (player.svelte.ts:506) | The `pause` event already fires `syncPlaybackState()`; calling `audio.pause()` gets it for free. |

**Key insight:** This phase is almost entirely *wiring into seams that already exist*. The only genuinely new code is the timer store, the pure helpers, and the indicator UI. Every hard problem (background throttling, overlay history, Media Session, mm:ss) already has a battle-tested solution in the codebase.

## Runtime State Inventory

> Not a rename/refactor/migration phase — this is greenfield feature work. Section included only to confirm there is no hidden runtime state to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — D-13 mandates in-memory only, NO localStorage key. Verified: no `openmusic:sleep*` key planned; `settings.svelte.ts` save() payload does NOT need a timer field. | none |
| Live service config | None — purely client-side. | none |
| OS-registered state | None — Media Session is read-only-synced via existing `syncPlaybackState`; no new action handler needed (expiry just pauses). | none |
| Secrets/env vars | None. | none |
| Build artifacts | None. | none |

**Nothing found in any category** — verified against D-13 (in-memory only) and the `settings`/`player` persist payloads.

## Common Pitfalls

### Pitfall 1: Sleep timer drifts or never fires in a backgrounded tab (PITFALLS.md Pitfall 10)
**What goes wrong:** A `setTimeout(stop, 30*60_000)` fires minutes late (or a `setInterval` countdown freezes) when the phone is in-pocket / screen locked.
**Why it happens:** Chrome clamps chained timers to ~1/min after the page is hidden 5 min (intensive throttling); `Date.now()` deltas stay accurate but the *callback* that checks them is throttled.
**How to avoid:** Absolute deadline (`Date.now()+ms`) + check it inside `timeupdate` (Pattern 1). `timeupdate` fires while audio plays regardless of background state, and an actively-audible page is exempt from *intensive* throttling. `[VERIFIED: Chrome for Developers timer-throttling docs]`
**Warning signs:** Music continues past the timer; countdown stalls then jumps.

### Pitfall 2: Expiry collides with the Phase 16 failure machinery (STATE.md Phase 18 blocker)
**What goes wrong:** Routing the stop through `next()` or `runFallback` increments `consecutiveFailures`/`errorBurst`, emits a skip toast, or trips the loop-guard — the intentional stop gets mistaken for a playback failure.
**Why it happens:** The never-stop engine treats any non-`playing` advance as a potential failure. The timer pause is the one sanctioned self-stop and is invisible to that accounting.
**How to avoid:** A dedicated `expireSleepTimer()` that ONLY calls `audio.pause()` + restores volume + `syncPlaybackState()`. It must NOT call `next()`, must NOT bump `playGen`, must NOT touch any failure counter. The `pause` event will fire `syncPlaybackState()` → lock screen reads paused (D-09). End-of-track mode `return`s before `next()` in the `ended` listener.
**Warning signs:** A skip toast appears at expiry; the loop-guard sticky toast shows; the next track starts playing after the timer "stopped" it.

### Pitfall 3: iOS volume fade silently no-ops, looking broken (D-01)
**What goes wrong:** A volume ramp does nothing on iOS (writes ignored, reads return 1) — the user hears full-volume audio then an abrupt cut, or the fade logic stalls waiting for a volume that never changes.
**Why it happens:** iOS keeps audio level under physical control; `HTMLMediaElement.volume` is effectively read-only.
**How to avoid:** Feature-detect with write-then-readback (Pattern 3) BEFORE starting the fade. If not honored → skip the fade and pause instantly. Never UA-sniff. `[VERIFIED: MDN HTMLMediaElement.volume "Not supported on iOS Safari"; Apple HTML5 Audio Guide]`
**Warning signs:** Works on desktop/Android, abrupt cut on iPhone — which is the *acceptable* fallback, but only if instant-pause is explicit, not an accidental stall.

### Pitfall 4: User interacts during the ~10s fade and the stop fights them (D-05)
**What goes wrong:** The user taps play/next/seek mid-fade; without an abort, volume keeps ramping to 0 or the pause still fires, so the "I'm awake" gesture loses.
**Why it happens:** The fade `setInterval` keeps running independent of user gestures.
**How to avoid:** `toggle()`, `next()`, `prev()`, `seekFraction()` must abort any in-flight fade: clear the fade interval, restore volume to the pre-fade level, and cancel the timer (D-05). Centralize via an `abortFade()` helper called from each gesture entry point.
**Warning signs:** Volume keeps dropping after the user tapped play; playback pauses right after a manual skip.

### Pitfall 5: New i18n keys break 15-locale parity (PITFALLS.md Pitfall 14)
**What goes wrong:** A missing key in any of the 15 dictionaries is a compile error (`Dict = Record<TranslationKey, string>`) or a visible fallback.
**Why it happens:** `en.ts` defines `TranslationKey`; every other dict must match.
**How to avoid:** Add keys to all 15 locales at once. Use a SINGLE minutes-unit key with `{n}` interpolation (the i18n helper supports `{token}` — see `toast.skippedMany: '{count} songs skipped'`), NOT 6 hardcoded "5 minutes"/"10 minutes" strings. D-09 means ZERO expiry keys. Likely total new keys: `menu.sleepTimer`, `timer.endOfTrack`, `timer.cancel`, `timer.minutes` (4 keys × 15 = 60 translations).
**Warning signs:** `svelte-check` errors on a `t('timer.x')` call; English leaks in a non-English UI.

### Pitfall 6: Overlay `$effect` over-dependency churns history (PITFALLS.md Pitfall 15, STATE.md Phase 19 blocker)
**What goes wrong:** The timer-sheet registration `$effect` depends on something that changes while open (e.g. the timer countdown) → cleanup `dismiss` (history.back) + body `open` (pushState) in one flush → history depth desyncs → Back gets stuck / over-pops.
**Why it happens:** The overlays stack requires history depth == stack depth.
**How to avoid:** Copy the `pickerOpen` precedent EXACTLY — effect dep = the `timerOpen` boolean ONLY, `untrack(() => overlays.open/dismiss(...))`, visibility gated by `{#if timerOpen}` (NOT by the effect). Single dismiss path (the `$effect` cleanup is the only `dismiss` caller). `[VERIFIED: TrackMenu.svelte:153-158]`
**Warning signs:** Back button double-closes or bounces to the wrong route after using the timer sheet.

## Code Examples

### expireSleepTimer (the intentional stop)
```typescript
// Source: derived from player.svelte.ts pause/syncPlaybackState seams + D-01/D-02/D-09
// NEW method on the Player class. Pauses in place, suppresses advance, never enters failure chain.
private fadeTimer: ReturnType<typeof setInterval> | null = null;
private preFadeVolume = 1;

expireSleepTimer() {
  if (!this.audio) { sleepTimer.cancel(); return; }
  // D-04: if the user already paused manually, just clear silently — no fade, no toast.
  if (this.audio.paused) { sleepTimer.cancel(); return; }
  const audio = this.audio;
  if (canFadeVolume(audio)) {
    // D-01: ~10s linear fade on platforms that honor volume writes, then pause.
    this.preFadeVolume = audio.volume;
    const start = Date.now();
    const FADE_MS = 10_000;
    this.fadeTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      audio.volume = fadeVolumeAt(elapsed, FADE_MS, this.preFadeVolume); // pure, clamped [0,1]
      if (elapsed >= FADE_MS) this.finishExpiry();
    }, 200);
  } else {
    this.finishExpiry();                 // iOS / unsupported → instant pause
  }
}
private finishExpiry() {
  this.abortFadeTimerOnly();
  this.audio?.pause();                   // fires `pause` event → syncPlaybackState() → lock screen paused
  if (this.audio) this.audio.volume = this.preFadeVolume; // D-02: restore for next play
  sleepTimer.cancel();                   // indicator disappears (D-09 silent)
}
// D-05: any playback gesture during the fade aborts the stop.
private abortFade() {
  if (this.fadeTimer) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.audio) this.audio.volume = this.preFadeVolume; // restore
    sleepTimer.cancel();                 // user is awake — clear timer
  }
}
```

### Pure helpers (node-testable, no DOM)
```typescript
// Source: src/lib/services/sleep-timer.ts (NEW) — pure, deterministic, Vitest node project
export function computeDeadline(now: number, minutes: number): number {
  return now + minutes * 60_000;
}
export function isExpired(now: number, deadline: number | null): boolean {
  return deadline != null && now >= deadline;
}
export function remainingMs(now: number, deadline: number | null): number {
  return deadline == null ? 0 : Math.max(0, deadline - now);
}
/** Linear fade: returns the volume to set at `elapsed` ms into a `totalMs` fade from `startVol` → 0. */
export function fadeVolumeAt(elapsed: number, totalMs: number, startVol: number): number {
  if (totalMs <= 0) return 0;
  const frac = Math.min(1, Math.max(0, elapsed / totalMs));
  return Math.min(1, Math.max(0, startVol * (1 - frac)));
}
```

### Timer sheet (3rd pickerOpen instance)
```svelte
<!-- Source: TrackMenu.svelte:194-203 (pickerOpen precedent) -->
<script lang="ts">
  import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
  let timerOpen = $state(false);
  // Registration effect — dep on `timerOpen` ONLY, untrack the overlays calls (Pitfall 6).
  $effect(() => {
    if (timerOpen) {
      untrack(() => overlays.open('trackmenu-timer', () => (timerOpen = false)));
      return () => untrack(() => overlays.dismiss('trackmenu-timer'));
    }
  });
  const DURATIONS = [5, 10, 15, 30, 45, 60];
</script>
<!-- new menu item in the action list -->
<button class="mi" onclick={() => { timerOpen = true; }}><Moon size={18} /> {t('menu.sleepTimer')}</button>

{#if timerOpen}
  <button class="scrim" aria-label={t('menu.close')} onclick={() => (timerOpen = false)}></button>
  <div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (timerOpen = false) }}>
    <div class="menu-head">
      {t('menu.sleepTimer')}
      {#if sleepTimer.active && sleepTimer.mode === 'minutes'}· {fmtTime(sleepTimer.remaining / 1000)}{/if}
    </div>
    {#each DURATIONS as min (min)}
      <button class="mi" class:on={sleepTimer.mode === 'minutes' && sleepTimer.selectedMinutes === min}
        onclick={() => { sleepTimer.set('minutes', min); timerOpen = false; }}>
        {t('timer.minutes').replace('{n}', String(min))}
      </button>
    {/each}
    <button class="mi" class:on={sleepTimer.mode === 'end-of-track'}
      onclick={() => { sleepTimer.set('end-of-track'); timerOpen = false; }}>{t('timer.endOfTrack')}</button>
    {#if sleepTimer.active}
      <button class="mi accent" onclick={() => { sleepTimer.cancel(); timerOpen = false; }}>{t('timer.cancel')}</button>
    {/if}
  </div>
{/if}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Naive `setTimeout(stop, ms)` for sleep timers | Absolute `Date.now()` deadline + event-driven re-check | Chrome 88 (Jan 2021) intensive timer throttling | A `setTimeout`-only timer fires minutes late when backgrounded; the deadline+`timeupdate` pattern is throttle-proof for a playing page. |
| Web Audio `GainNode` for fades | `audio.volume` ramp (with iOS feature-detect fallback) | N/A — project invariant | Project uses a single `<audio>` element and NO Web Audio API; a GainNode would break the model and add iOS unlock quirks. |

**Deprecated/outdated:**
- Do NOT rely on `setTimeout` precision for the deadline. It is fine as a *coarse* secondary trigger but the `timeupdate` deadline check is the authority.
- UA-sniffing for iOS volume support: replaced by write-then-readback feature detection.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | An actively-playing page checking the deadline in `timeupdate` fires reliably enough on iOS Safari when the screen is LOCKED (not just backgrounded-but-screen-on) | Architecture Pattern 1 | If iOS suspends `timeupdate` under a locked screen during background audio, the minutes-timer could fire late on wake. Phase 6 STATE.md blocker already flags iOS background-audio as unproven (real-device spike pending). Mitigation: a coarse `setTimeout(deadline-now)` as a secondary trigger costs nothing and catches the wake case. RECOMMEND adding the belt-and-suspenders `setTimeout`. `[ASSUMED — training + Chrome docs; iOS-lockscreen timeupdate cadence not device-verified this session]` |
| A2 | `@lucide/svelte` exports a `Moon` (and/or `Timer`/`AlarmClock`) icon | Standard Stack | Trivial — if a specific name is absent, another timer/moon glyph in lucide substitutes. `[ASSUMED — lucide ships these in general; exact export not grepped]` |
| A3 | The i18n `t()` helper supports `{token}` interpolation usable for `timer.minutes` with `{n}` | Pitfall 5 / Code Examples | `toast.skippedMany: '{count} songs skipped'` proves interpolation exists; the exact call signature (`t(key, {n})` vs `.replace`) should be confirmed against `i18n/index.ts interpolate`. Low risk. `[ASSUMED — interpolation confirmed to exist; exact API shape not fully read]` |

## Open Questions

1. **iOS locked-screen `timeupdate` cadence for a minutes-timer**
   - What we know: `timeupdate` fires ~4×/sec while audio plays; audio pages are exempt from *intensive* throttling; Chrome 88 throttling docs are HIGH-confidence for Chrome.
   - What's unclear: whether iOS Safari keeps firing `timeupdate` at a useful rate with the screen *locked* during background PWA audio (the contested Phase 6 area). If it pauses entirely, the minutes-timer would only fire on wake.
   - Recommendation: Add a coarse `setTimeout(() => check(), deadline - Date.now())` as a *secondary* trigger alongside the `timeupdate` backstop. It is free, and on iOS the timer firing on screen-wake-and-resume is the acceptable "stop a few seconds late" outcome. The planner should make this a single small task. End-of-track mode is unaffected (driven by `ended`, which always fires).

2. **Indicator placement in the nowbar layout**
   - What we know: D-06/D-07 want a moon badge + countdown on the nowbar; the nowbar is space-constrained (cover + meta + play button, with a progress sliver on top).
   - What's unclear: exact slot — between meta and play button, or overlaid on the progress sliver area.
   - Recommendation: Claude's discretion (D-07 allows icon-only on the nowbar if tight). A small badge to the LEFT of the play button is the lowest-risk slot; full mm:ss in NowPlaying near the transport row (:717).

## Environment Availability

> Skipped — no external dependencies. This phase is code/config-only changes against platform APIs and already-installed deps. (Per Step 2.6: "If the phase is purely code/config changes with no external dependencies, output SKIPPED.")

**Step 2.6: SKIPPED (no external dependencies identified)**

## Validation Architecture

> Nyquist validation is enabled (no `workflow.nyquist_validation: false` found).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.3 (single `server`/node project; sveltekit Vite plugin transforms runes) |
| Config file | `vite.config.ts` (test block; `projects: [{ name: 'server', environment: 'node' }]`) |
| Quick run command | `npm run test:unit -- src/lib/services/sleep-timer.test.ts` |
| Full suite command | `npm run test:unit` |
| Notable constraint | `test: { expect: { requireAssertions: true } }` — every test MUST contain at least one assertion or it fails. |

### What must be test-proven vs manually verified

**Test-proven (pure, node-testable — no DOM):**
- `computeDeadline(now, minutes)` — `now + minutes*60_000` for all 6 durations.
- `isExpired(now, deadline)` — boundary cases: `now < deadline` false, `now === deadline` true, `now > deadline` true, `deadline === null` false. (This is the throttle-proof check — proving the boundary protects against the "fires late vs never" class.)
- `remainingMs(now, deadline)` — clamps to 0 at/after deadline; null → 0.
- `fadeVolumeAt(elapsed, totalMs, startVol)` — `elapsed=0 → startVol`; `elapsed=totalMs → 0`; midpoint → `startVol*0.5`; clamps to `[0,1]`; `totalMs<=0 → 0` (no divide-by-zero).
- **End-of-track arbitration logic** — if extracted as a pure function `decideEndedAction(sleepMode, repeatMode)` returning `'sleep-stop' | 'repeat-rewind' | 'advance'`, prove sleep beats repeat-one (D-03), repeat-one beats advance, default advance. (Pure arbitration is the highest-value test — it locks the D-03 precedence in code.)
- (Optional, runes node project) `sleepTimer.svelte.ts` `set`/`cancel`/`restart` state transitions: `set('minutes', 30)` → `active === true`, `mode === 'minutes'`, `deadline` set; `cancel()` → `active === false`, `deadline === null`; `restart` from a different duration resets `deadline` fresh (D-11).

**Manually verified (DOM / device / timing — not unit-testable):**
- Volume fade actually ramps on Android/desktop and instant-pauses on iOS (real-device — feature detection is unit-testable via a fake element, but the *honored* path needs a real browser).
- Background-tab / locked-screen expiry timing (the Phase 6 contested iOS area — real-device spike).
- Indicator renders + is tappable on both Nowbar and NowPlaying; reopening the sheet shows live remaining time and highlights the active duration.
- D-05 gesture-aborts-fade feel (tap play mid-fade → volume restores, playback continues).
- Lock-screen / Media Session reads paused at expiry (D-09) — verify via OS media UI.
- D-04 (timer expires while already manually paused → silent clear).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIMER-01 | deadline math (6 durations + null) | unit | `npm run test:unit -- src/lib/services/sleep-timer.test.ts -t deadline` | ❌ Wave 0 |
| TIMER-01 | isExpired boundary (throttle-proof check) | unit | `npm run test:unit -- src/lib/services/sleep-timer.test.ts -t expired` | ❌ Wave 0 |
| TIMER-01 | fadeVolumeAt curve + clamps | unit | `npm run test:unit -- src/lib/services/sleep-timer.test.ts -t fade` | ❌ Wave 0 |
| TIMER-01 | end-of-track beats repeat-one (D-03) | unit | `npm run test:unit -- src/lib/services/sleep-timer.test.ts -t arbitration` | ❌ Wave 0 |
| TIMER-01 | timer store set/cancel/restart transitions | unit (runes/node) | `npm run test:unit -- src/lib/stores/sleepTimer.svelte.test.ts` | ❌ Wave 0 |
| TIMER-01 | expiry does NOT touch failure counters / next() | unit (player) | extend `src/lib/stores/player.svelte.test.ts` — assert `next` not called + counters unchanged after `expireSleepTimer()` | ⚠️ extend existing |
| TIMER-01 | set timer / stop at expiry / indicator / cancel / change end-to-end | manual | — (device) | manual |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- src/lib/services/sleep-timer.test.ts` (pure helpers, sub-second)
- **Per wave merge:** `npm run test:unit` (full suite — must stay green; currently ~171 tests passing per STATE.md)
- **Phase gate:** Full suite green + `npm run check` (svelte-check, including 15-locale i18n parity) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/services/sleep-timer.ts` — pure helpers (deadline/expired/remaining/fade/arbitration) for REQ TIMER-01
- [ ] `src/lib/services/sleep-timer.test.ts` — covers deadline math, isExpired boundary, fade curve, end-of-track arbitration
- [ ] `src/lib/stores/sleepTimer.svelte.ts` — runes store (covered by an optional `.svelte.test.ts` under the node project, mirroring `searchHistory.svelte.test.ts`)
- [ ] Extend `src/lib/stores/player.svelte.test.ts` — prove `expireSleepTimer()` pauses without incrementing `consecutiveFailures`/`errorBurst` and without calling `next()` (the STATE.md Phase 18 blocker, in code)
- [ ] Framework install: none — Vitest already configured

## Security Domain

> `security_enforcement` not found as `false` in config → treated as enabled. Assessed below; this phase has a near-empty security surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — client-only feature |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No protected resources |
| V5 Input Validation | yes (minor) | Duration values come from a FIXED enum (5/10/15/30/45/60 + end-of-track) chosen via buttons — no free-text input. The deadline math should still guard against `NaN`/negative (the pure helpers clamp; `remainingMs` floors at 0). No untrusted external input reaches the timer. |
| V6 Cryptography | no | No crypto; no secrets. The shuffle `Math.random` precedent confirms no CSPRNG is needed for UX. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Negative / NaN duration corrupting the deadline (no persisted source, but defensive) | Tampering | Pure helpers clamp; durations come from a fixed button enum, never free input. |
| Timer state leaking across SSR | Information disclosure | In-memory only (D-13); the store is a client singleton — mirror the `searchSession` HAS_WINDOW discipline if any browser-only field is touched during SSR. No persistence, so no SSR leak vector beyond store init. |
| New i18n key injection | (n/a) | Static literal keys only — no dynamic key construction. |

No new secrets, no server code, no network calls. Security posture: minimal — the only real control is input-validation-by-construction (fixed duration enum + clamped pure math).

## Sources

### Primary (HIGH confidence)
- Live codebase (read directly this session): `src/lib/stores/player.svelte.ts` (timeupdate :589, ended :621-639, pause/syncPlaybackState :506-518, toggle :1144, next :1150, fmtTime :89, playGen/failure machinery), `src/lib/components/TrackMenu.svelte` (pickerOpen :194-203, overlay `$effect` :153-158), `src/lib/stores/overlays.svelte.ts` (open/dismiss/navigateAway invariants), `src/lib/components/Nowbar.svelte`, `src/lib/components/NowPlaying.svelte` (transport :717), `src/lib/stores/settings.svelte.ts` (runes-class pattern, leaf-store discipline), `src/lib/config/defaults.ts` (QueueContext/UpnextMode), `src/lib/i18n/` (15 dicts, `Dict` parity, en.ts keys), `vite.config.ts` (Vitest node project + requireAssertions), `src/lib/stores/player.svelte.test.ts` (test mock pattern).
- `.planning/research/PITFALLS.md` Pitfall 10 (sleep timer background throttle + end-of-track vs auto-advance), Pitfall 14 (i18n parity), Pitfall 15 (`$effect` over-dep), Pitfall 4 (no second `<audio>`).
- `.planning/phases/16-playback-resilience-core/16-CONTEXT.md` (never-stop, loop-guard, repeat-one D-12 precedent), `.planning/STATE.md` Phase 18 blocker.
- MDN — HTMLMediaElement.volume ("Not supported on iOS Safari"): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume — iOS volume read-only, `.muted` works.
- Chrome for Developers — "Heavy throttling of chained JS timers beginning in Chrome 88": https://developer.chrome.com/blog/timer-throttling-in-chrome-88 — intensive throttling (1/min after 5 min hidden, chain ≥5, silent ≥30s); **audible-in-last-30s exemption**.

### Secondary (MEDIUM confidence)
- Apple — Safari HTML5 Audio and Video Guide (Device-Specific Considerations): iOS volume always under physical control. (Cross-verifies MDN.)
- GitHub mdn/browser-compat-data #13554 — confirms iOS Safari volume unsupported.

### Tertiary (LOW confidence)
- General community reports (rosswintle.uk, muxinc/media-chrome #913) that `.muted` works where `.volume` doesn't on iOS — corroborating, not load-bearing (the feature-detect handles it regardless).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all platform APIs + already-installed libs verified against package.json/codebase.
- Architecture: HIGH — every integration point read directly in the live store; the patterns are extensions of existing seams (timeupdate, ended, syncPlaybackState, pickerOpen overlays).
- Pitfalls: HIGH — sourced from the project's own PITFALLS.md + STATE.md blockers + verified platform behavior (iOS volume, Chrome throttling).
- One MEDIUM gap (A1): iOS locked-screen `timeupdate` cadence — mitigated by recommending a free secondary `setTimeout` trigger.

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable — platform behaviors and the codebase seams are not fast-moving; revisit only if the player store's ended/timeupdate listeners are refactored)
