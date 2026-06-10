# Phase 16: Playback Resilience Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 16-playback-resilience-core
**Areas discussed:** Failure/skip feedback, Loop-guard stop state, Repeat migration + edge, Stall timeout

---

## Failure/skip feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Silent | Seamless source swap, no notification; quality badge updates quietly | ✓ |
| Subtle toast | Brief "switched source" toast on every successful failover | |
| Only on quality drop | Toast only when fallback source is lower quality | |

**User's choice:** Silent failover

| Option | Description | Selected |
|--------|-------------|----------|
| Per-skip, batch bursts | One toast per skipped song; consecutive skips collapse into one | ✓ |
| Always one per song | Every skipped song gets its own toast even in a burst | |
| Quiet summary only | No per-skip toasts; only the loop-guard sticky toast | |

**User's choice:** Per-skip with burst batching

| Option | Description | Selected |
|--------|-------------|----------|
| Plain info | Title + "skipped", auto-dismiss; Retry lives on loop-guard toast | ✓ |
| With Retry action | Each skip toast has a Retry button re-queuing that song | |

**User's choice:** Plain info

---

## Loop-guard stop state

| Option | Description | Selected |
|--------|-------------|----------|
| Pause + sticky toast w/ Retry | Pause on last failed track; persistent toast with Retry; nowbar normal | ✓ |
| Nowbar error state | Nowbar/NP flip into visible error style + sticky toast | |
| Quiet pause | Just pause, no sticky toast | |

**User's choice:** Pause + sticky toast w/ Retry

| Option | Description | Selected |
|--------|-------------|----------|
| Retry current, once | Gesture resets counter, retries current track through all sources | |
| Skip ahead + resume chain | Gesture jumps to next track, re-arms full never-stop chain | ✓ |
| Regenerate queue | Gesture discards dead tail, regenerates up-next from last played | |

**User's choice:** Skip ahead + resume chain

| Option | Description | Selected |
|--------|-------------|----------|
| Finish buffer, pause at fail | Current track plays out; pause + offline toast on next resolve fail | |
| Pause immediately | Pause the moment navigator.onLine flips false | |
| Auto-switch to downloads | Rebuild up-next from downloaded tracks, keep playing | ✓ |

**User's choice:** Auto-switch to downloads (playback-level only; SW/app-shell + offline UI surfaces stay in Phase 24)

---

## Repeat migration + edge

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate to 'off' | Auto-generated up-next is repeat-all's semantic successor | ✓ |
| Migrate to 'one' | Keeps a repeat behavior active but changes meaning | |

**User's choice:** Migrate persisted 'all' → 'off'

| Option | Description | Selected |
|--------|-------------|----------|
| Stop + toast | Respect explicit intent: user asked for THIS song forever | |
| Break repeat + skip | Never-stop wins: repeat off, toast, continue with up-next | ✓ |

**User's choice:** Break repeat + skip

---

## Stall timeout

| Option | Description | Selected |
|--------|-------------|----------|
| ~15s timeout → failover | No audio within ~15s of start = failure → failover chain | ✓ |
| ~30s lenient | More slack on slow networks, longer dead-CDN waits | |
| Error events only | No timeout; hung CDN = indefinite silence | |

**User's choice:** ~15s initial-load timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Just buffer, no failover | Mid-track stall = network blip; failover would restart at 0:00 | ✓ |
| Failover after long stall | Fail over after ~30s mid-track buffering | |

**User's choice:** Just buffer, no failover

---

## Claude's Discretion

- Exact counter cap (~5), burst-collapse window, stall timeout constant (~15s ±)
- Toast wording / i18n key reuse vs new keys
- Offline downloads-queue builder location + track ordering
- tryFallback AbortController × stall timeout interaction

## Deferred Ideas

- Full offline UI surfaces + SW app-shell — Phase 24
- Per-context up-next sourcing setting — Phase 17
- Mid-track stall failover with position resume — v1.3 candidate
