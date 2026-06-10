# Phase 18: Sleep Timer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 18-sleep-timer
**Areas discussed:** Expiry behavior, Active indicator, Set/cancel/change UX, Persistence & edges

---

## Expiry behavior

### What happens at the moment the timer expires?

| Option | Description | Selected |
|--------|-------------|----------|
| Instant pause | Clean pause at deadline; reliable everywhere (iOS Safari ignores audio.volume writes) | |
| Fade where possible | ~10s volume fade then pause on Android/desktop; iOS falls back to instant pause | ✓ |

### After expiry stops playback, what state is the player left in?

| Option | Description | Selected |
|--------|-------------|----------|
| Pause in place | Track, queue, position kept; play resumes where stopped; volume restored | ✓ |
| Stop + rewind | Pause and reset to 0:00; queue kept | |

### "End of track" mode while repeat-one is ON — what wins?

| Option | Description | Selected |
|--------|-------------|----------|
| Timer wins | Stop at end of current play-through; repeat-one suppressed for that ended event | ✓ |
| Repeat wins | Repeat keeps looping; timer never fires until repeat turned off | |

### Timer expires while user already paused manually?

| Option | Description | Selected |
|--------|-------------|----------|
| Clear timer silently | Already paused = goal achieved; timer + indicator clear, no fade/toast | ✓ |
| Keep timer armed | Deadline stays; fires later if user resumes before expiry | |

---

## Active indicator

### Where does the active-timer indicator live?

| Option | Description | Selected |
|--------|-------------|----------|
| Nowbar + NowPlaying | Moon badge on nowbar AND fuller readout in expanded NowPlaying | ✓ |
| NowPlaying only | Only in the expanded sheet | |
| Nowbar only | Compact badge near play button only | |

### What does the indicator show?

| Option | Description | Selected |
|--------|-------------|----------|
| Icon + countdown | Moon icon with live mm:ss (or "track end"); nowbar may be icon-only if tight | ✓ |
| Icon only | Static moon icon; remaining time only in the timer sheet | |
| Countdown text only | mm:ss text, no icon — ambiguous with track duration | |

### Is the indicator tappable?

| Option | Description | Selected |
|--------|-------------|----------|
| Tap opens timer sheet | Same duration sheet from either surface — fastest cancel/change | ✓ |
| Display only | Passive; cancel/change only via track menu | |

### Feedback when the timer fires?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent | Indicator disappears; normal paused state; zero new i18n keys | ✓ |
| One auto-dismiss toast | "Sleep timer ended" toast; costs 15-locale parity | |

---

## Set/cancel/change UX

### How does the duration picker present from the track menu?

| Option | Description | Selected |
|--------|-------------|----------|
| Sub-sheet | Menu item opens second sheet (pickerOpen precedent in TrackMenu.svelte) | ✓ |
| Inline expansion | Duration chips inside the same sheet; menu grows tall | |

### Timer active and user opens the timer sheet — what shows?

| Option | Description | Selected |
|--------|-------------|----------|
| Remaining + options | Live remaining in header, active duration highlighted, tap-another restarts fresh, Cancel row | ✓ |
| Plain list + cancel | Same list plus Cancel row; no remaining readout | |

### Feedback when user sets a duration?

| Option | Description | Selected |
|--------|-------------|----------|
| Sheet closes, indicator appears | Countdown is the confirmation; no toast, no new i18n | ✓ |
| Confirmation toast | "Sleep timer: 30 min" toast on set | |

---

## Persistence & edges

### Does an active timer survive a page reload / app relaunch?

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory only | Reload clears it; playback can't auto-resume post-reload anyway; no storage key | ✓ |
| Persist deadline | localStorage deadline, re-arm on restore; stale-deadline edge cases | |

### New songs / skips while a minutes-based timer runs?

| Option | Description | Selected |
|--------|-------------|----------|
| Timer unaffected | Absolute wall-clock deadline; track changes never touch it (Spotify behavior) | ✓ |
| Reset on fresh play | Fresh play restarts countdown — nonstandard, surprising | |

### End-of-track mode: user skips before the current track ends?

| Option | Description | Selected |
|--------|-------------|----------|
| End of whatever plays | Stop at the next natural track end, whichever track that is | ✓ |
| Skip cancels timer | Skip treated as "awake" — silent cancel risks surprising a drowsy user | |

### User interacts during the ~10s fade-out?

| Option | Description | Selected |
|--------|-------------|----------|
| Gesture aborts stop | Volume restores, playback continues, timer cleared | ✓ |
| Stop completes anyway | Fade finishes and pauses regardless | |

---

## Claude's Discretion

- Exact fade duration/curve; volume-write feature detection
- Countdown update cadence; exact nowbar badge placement/styling
- Timer sheet row ordering/wording; minimal i18n key set
- Media Session lock-screen sync at expiry (reuse syncPlaybackState)
- Timer state home (player store field vs tiny module), respecting playGen + suppress-next() lock

## Deferred Ideas

None — discussion stayed within phase scope.
