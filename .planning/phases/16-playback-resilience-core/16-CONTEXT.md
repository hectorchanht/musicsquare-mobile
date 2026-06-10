# Phase 16: Playback Resilience Core - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Music never stops by itself: when a track fails, the player retries it across all other sources; when every source fails, it toasts and auto-skips; a consecutive-failure loop-guard (~5) stops the skip chain safely; the next track is always prefetched (URL resolve-ahead); repeat is reduced to 2 states (off / repeat-one). Requirements: PLAY-07, PLAY-08, PLAY-09, PLAY-10. Primary file: `src/lib/stores/player.svelte.ts` (failover/prefetch/generation engine already exists — this phase is policy + wiring + UI, not new subsystems).

Out of this phase: per-context up-next sourcing setting (Phase 17), sleep timer (Phase 18), offline app-shell / SW / offline UI surfaces (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Failure & skip feedback
- **D-01:** Successful source failover (same song keeps playing from another source) is SILENT — no toast; quality badge just updates. Current seamless behavior preserved.
- **D-02:** When a song fails ALL sources and is skipped: one plain info toast per skip ("Couldn't play · {title} — skipped" style), auto-dismissing. Consecutive skips collapse into a single batched toast ("{n} songs skipped") instead of stacking.
- **D-03:** Skip toasts carry NO action button. The Retry affordance lives only on the loop-guard sticky toast. Keep new i18n keys minimal — every key costs 15-locale parity (`Dict = Record<TranslationKey, string>`).

### Loop-guard stop state
- **D-04:** Guard trips at ~5 consecutive failed skips → player pauses on the last failed track; ONE persistent (sticky) toast with a Retry button ("Playback stopped — couldn't load songs"). Nowbar keeps its normal paused look — no special error styling.
- **D-05:** Recovery (tap play OR toast Retry) = skip ahead to the NEXT track, reset the counter, re-arm the full never-stop chain from there. (Not retry-current, not queue regeneration.)
- **D-06:** Counter resets on a successful `playing` event or explicit user gesture. Rejected `play()` promises count as failures (never silent `.catch(() => {})`) — locked at milestone level.

### Offline behavior (playback-level only)
- **D-07:** Sudden offline mid-playback → AUTO-SWITCH: rebuild up-next from downloaded tracks (library Downloads via existing blob-store) and keep playing. Current track finishes from buffer/blob if possible.
- **D-08:** Offline resolve failures do NOT burn the loop-guard counter — gate the failure chain on `navigator.onLine`. If offline AND no downloads exist, pause + offline toast.
- **D-09:** Scope split with Phase 24: this phase owns the PLAYER's offline switch (queue from downloads, counter gating). Phase 24 owns app-shell/SW, offline route guards, and offline UI surfaces.

### Repeat (2-state)
- **D-10:** Repeat control becomes off ↔ repeat-one toggle (remove 'all' from `cycleRepeat()` at player.svelte.ts:859 and the NowPlaying icon states).
- **D-11:** Persisted `repeatMode: 'all'` migrates to `'off'` at restore time (auto-generated up-next is the semantic successor of repeat-all). One-line mapping in the restore path.
- **D-12:** Repeat-one ON + the looping track fails all sources → BREAK repeat (set to off), toast, and continue with up-next. Never-stop wins over explicit repeat.

### Stall handling
- **D-13:** Stalled INITIAL load: if a newly started track produces no audio within ~15s, treat it as a failure → enter the source-failover chain. (Dead-but-not-erroring CDNs.) The now-playing running-line loader (Phase 20, NP-04) covers the wait visually; nowbar already has one.
- **D-14:** Mid-track stalls (buffer ran dry while playing): NO failover — just show buffering state and wait. Failing over would restart the song from 0:00 on another source.

### Prefetch (locked at milestone level)
- **D-15:** Prefetch = URL resolve-ahead of the next queue item (extend existing `prefetchNext()`), fired on track change. NO second `<audio>` element — single-element invariant is hard (iOS).

### Claude's Discretion
- Exact failure-counter cap value (~5), toast burst-collapse window, exact stall timeout constant (~15s ±)
- Toast wording and which existing i18n keys to reuse vs add
- Where the offline downloads-queue builder lives (player vs service) and how it orders tracks
- How `tryFallback` AbortController interacts with the new stall timeout

</decisions>

<specifics>
## Specific Ideas

- "The music should never stop by itself except sleep timer is up or offline suddenly" — the never-stop guarantee is the headline of this phase; everything else serves it.
- User explicitly wants prefetch so "music flow flawlessly without stop loading the song".
- Skip-burst toast batching mirrors how the user described it: notify, don't nag.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (grounds every decision above)
- `.planning/research/SUMMARY.md` — v1.2 synthesis: existing engine inventory, invariants (single audio element, playGen discipline), phase implications
- `.planning/research/PITFALLS.md` — P-FAILOVER pitfalls: infinite skip loop, iOS play() rejection after async src swap, stale-fallback races, generation-guard discipline
- `.planning/research/ARCHITECTURE.md` — integration points in player.svelte.ts (runFallback/tryFallback, prefetchNext, ensureAhead, ended/error handlers), build order rationale

### Code seams (verified this session)
- `src/lib/stores/player.svelte.ts` — error listener → runFallback (~line 421), ended handler + repeat-one (~406), cycleRepeat (~859), prefetchNext (~548), ensureAhead (~510), restore path (~156-200)
- `src/lib/services/fallback.ts` — tryFallback cross-source swap (already defensively wrapped, AbortController-based)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runFallback`/`tryFallback`: cross-source failover already implemented — this phase adds the skip-on-total-failure + counter policy on top
- `prefetchNext()`: resolve-ahead prefetch already exists with uid dedupe guard — verify trigger coverage (fires from play(); ensure ended→next path also prefetches)
- `ensureAhead()`/`buildSimilarQueue`: queue auto-growth already exists — exhaustion-regeneration policy hooks in here
- `playGen` monotonic generation guard: every new async playback path MUST check it
- Toast system + i18n keys exist (used in TrackMenu/NowPlaying); new keys cost 15-locale parity
- Downloads: blob-store + library Downloads list already power offline-first playback of downloaded tracks

### Established Patterns
- Persistence payload includes `repeatMode` — restore path is where 'all'→'off' migration lands
- Services never throw (null-return + degrade); stores never import the player
- Past-buffered-range seek already guarded so it doesn't kick off runFallback (player.svelte.ts:921)

### Integration Points
- `error` event listener + `play()` promise rejection → failure accounting (counter)
- `ended` handler → repeat-one branch → next() → prefetched URL handoff
- `navigator.onLine` gate wraps the whole failure chain (new `online` check; full online store may land here or Phase 24 — planner's call)
- NowPlaying repeat button → 2-state toggle + icon change

</code_context>

<deferred>
## Deferred Ideas

- Full offline UI surfaces (offline banners, downloads-promoted library views, SW app-shell) — Phase 24 (OFFL-01..03)
- Per-context up-next sourcing setting + config defaults — Phase 17 (QUEUE-03)
- Mid-track stall failover with position resume — would need range-request seek-on-fallback; revisit v1.3 if mid-track CDN deaths prove common

</deferred>

---

*Phase: 16-playback-resilience-core*
*Context gathered: 2026-06-10*
