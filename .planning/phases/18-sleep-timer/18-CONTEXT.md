# Phase 18: Sleep Timer - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can set a sleep timer (5/10/15/30/45/60 minutes or "end of track") from the track menu and trust playback to stop when it expires, while seeing an active-timer indicator they can cancel or change at any time. Requirement: TIMER-01.

**Pre-locked by roadmap/STATE (not re-discussed):**
- Durations: 5/10/15/30/45/60 min + end-of-track (verified against Spotify)
- Entry point: track menu
- Timer engine uses an **absolute-timestamp deadline** (not a naive `setTimeout` countdown) to survive background-tab timer throttling
- Expiry stop must **suppress `next()`** — must not collide with the Phase 16 skip-loop guard (the stop is intentional; never counts as a failure, never triggers failover/auto-advance)

Out of this phase: TrackMenu structural rework (Phase 19 — but the sleep-timer action lands in the menu now and Phase 19 keeps it), now-playing gestures (Phase 20).

</domain>

<decisions>
## Implementation Decisions

### Expiry behavior
- **D-01:** Fade-out where possible: ~10s volume fade then pause on platforms that honor `audio.volume` writes (Android/desktop); iOS Safari falls back to instant pause (`volume` is effectively read-only on iOS media elements — feature-detect, don't UA-sniff). Fade applies to minutes-based timers; end-of-track mode ends at the natural track boundary (no fade needed).
- **D-02:** Expiry = pause in place. Track, queue, and position all kept; tapping play resumes exactly where it stopped. Volume restored to the pre-fade level after pausing.
- **D-03:** End-of-track mode beats repeat-one: stop at the end of the current play-through, suppressing the repeat-one rewind branch for that `ended` event (mirrors Phase 16 D-12 — explicit intent wins).
- **D-04:** Timer expires while the user already paused manually → clear the timer silently (no fade, no toast); indicator disappears. Resuming later plays normally with no timer.
- **D-05:** Any playback gesture DURING the fade (play/pause toggle, next/prev, seek) aborts the stop: volume restores, playback continues, timer cleared — the user is clearly awake.

### Active indicator
- **D-06:** Indicator lives on BOTH surfaces: a compact moon badge on the nowbar AND a fuller readout inside the expanded NowPlaying.
- **D-07:** Indicator shows icon + live countdown (mm:ss remaining, or an "end of track" label in that mode). NowPlaying shows the full countdown; nowbar may be icon-only if space is tight.
- **D-08:** Indicator is tappable on either surface — tap opens the same timer sheet (fastest cancel/change path; no need to re-find the track menu).
- **D-09:** Expiry is silent: no toast; the indicator disappears and the player shows its normal paused state. (User is likely asleep; zero new expiry i18n keys.)

### Set/cancel/change UX
- **D-10:** Duration picker = sub-sheet opened from a "Sleep timer" track-menu item — exact `pickerOpen` precedent already in TrackMenu.svelte (playlist picker). Listing: 5/10/15/30/45/60 min + end-of-track.
- **D-11:** With a timer active, the sheet header shows live remaining time, the active duration is highlighted, tapping a different duration restarts the timer fresh from that duration, and an explicit Cancel row sits at the bottom.
- **D-12:** Setting a duration: sheet closes, indicator appears — the countdown IS the confirmation. No toast.

### Persistence & edge semantics
- **D-13:** Timer is in-memory only — page reload/app relaunch clears it. (Playback can't auto-resume after reload anyway; a persisted deadline would mostly fire against an already-paused player.) No storage key.
- **D-14:** The minutes-based deadline is absolute wall-clock and unaffected by track changes, skips, or queue swaps (Spotify behavior). End-of-track mode follows whatever is playing when the end arrives — a manual skip just moves the goalpost to the new track's natural end (skip does NOT cancel the timer).

### Claude's Discretion
- Exact fade duration (~10s ±) and curve; volume-write feature-detection mechanism
- Countdown update cadence (1s tick vs derived from existing timeupdate sync) and exact nowbar badge placement/styling
- Timer sheet row ordering/wording; which minimal i18n keys to add (menu item, "End of track", "Cancel" — keep 15-locale parity cost low; reuse existing keys where possible)
- Media Session / lock-screen state sync at expiry (should read paused — reuse existing `syncPlaybackState` path)
- Where the timer state lives (player store field vs tiny dedicated module) — must respect `playGen` discipline and the suppress-`next()` lock

</decisions>

<specifics>
## Specific Ideas

- iOS Safari constraint drives D-01: `audio.volume` writes are ignored on iOS — the fade must feature-detect and degrade to instant pause, never appear broken.
- "Never-stop" posture (Phase 16) inverts here on purpose: this is the ONE sanctioned way playback stops by itself — the user said it in Phase 16: "The music should never stop by itself except sleep timer is up or offline suddenly."

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research
- `.planning/research/SUMMARY.md` — v1.2 synthesis: engine invariants (single audio element, playGen discipline)
- `.planning/research/PITFALLS.md` — background-tab timer throttling pitfall; gesture/axis idioms

### Prior phase context (decisions this phase must not violate)
- `.planning/phases/16-playback-resilience-core/16-CONTEXT.md` — never-stop engine, skip-loop guard, repeat-one (D-10/D-12), ended-handler ownership
- `.planning/phases/17-up-next-sourcing-settings-plumbing/17-CONTEXT.md` — queue/context decisions, settings patterns

### Requirements
- `.planning/REQUIREMENTS.md` — TIMER-01 (line ~120)

### Code seams (verified this session)
- `src/lib/stores/player.svelte.ts` — `ended` handler + repeat-one branch (~621, the end-of-track hook), pause sites (~1147 toggle), `syncPlaybackState`/Media Session sync (~700), skip-loop guard + failure accounting (Phase 16)
- `src/lib/components/TrackMenu.svelte` — action list (~178-189), `pickerOpen` sub-sheet precedent (~195-201), scrim/dismiss pattern
- `src/lib/components/Nowbar.svelte` — compact indicator badge lands here
- `src/lib/components/NowPlaying.svelte` — fuller countdown readout lands here
- `src/lib/stores/overlays.svelte.ts` — back-to-close stack; new sub-sheet follows the pickerOpen precedent (Phase 19 blocker note: single dismiss path, `$effect` dep on `open` only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pickerOpen` sub-sheet pattern in TrackMenu.svelte: scrim + sheet + LIFO overlay dismissal — the timer sheet is a third instance of this exact shape
- `ended` event handler (player.svelte.ts:621): end-of-track mode hooks here, alongside (and with priority over) the repeat-one branch
- `syncPlaybackState()` + Media Session helpers: expiry pause reuses the existing paused-state sync — lock screen reads paused for free
- `dragClose` action + overlays stack: sheet dismissal idioms already wired into all TrackMenu sheets
- i18n `t()` with 15-locale `Dict` parity: every new key costs 15 translations — keep timer keys minimal

### Established Patterns
- `playGen` monotonic guard on every async playback path — the deadline-fire path must check it
- Single `<audio>` element invariant; `audio.volume` manipulation for the fade must not assume a second element or Web Audio graph
- Phase 16 failure accounting: rejected/paused states from the timer must never increment `consecutiveSkips` or trigger `runFallback`
- Stores never import the player from services; settings/config defaults live in `src/lib/config/defaults.ts` (no timer entry needed — D-13 in-memory)

### Integration Points
- TrackMenu action list → new "Sleep timer" item (Phase 19 will restyle the menu but keeps this action)
- `ended` handler → end-of-track stop branch BEFORE the repeat-one branch (D-03)
- Nowbar + NowPlaying → indicator badge/readout, both tappable → timer sheet
- Pause path → fade controller → `audio.pause()` → volume restore; gesture listeners (toggle/next/seek) → fade abort (D-05)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 18-sleep-timer*
*Context gathered: 2026-06-11*
