# Phase 17: Up-Next Sourcing + Settings Plumbing - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Playing a song from any context fills up-next predictably — by default genre-similar generation (search results are NOT silently appended, and the nowbar does not auto-expand on track change) — the user can override sourcing per context ("same list" vs "genre-generated"), manage the queue directly (swipe-to-remove, clear-all), and the milestone's settings/config changes land together (per-context defaults in the config file, text-size 50–200% with live demo text, accent wiring verified/fixed); artist/album pages gain Deezer enrichment. Requirements: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-05, UX-03, UX-07, ENRICH-04.

Out of this phase: sleep timer (Phase 18), Remix track-menu action (Phase 19), nowbar horizontal swipe (Phase 20), row swipe-actions on main list surfaces (Phase 23), Last.fm auth (v1.3).

**Key code finding:** `queueContext` does NOT exist in `player.svelte.ts` — Phase 16 shipped without it. This phase must introduce playback-context tracking itself (which surface initiated the current queue).

</domain>

<decisions>
## Implementation Decisions

### Up-next sourcing & contexts
- **D-01:** Full context set gets per-context sourcing overrides: liked / search / downloads / playlist / album / artist / home-discovery / history. Each is a `'same-list' | 'generated'` entry in `src/lib/config/defaults.ts` (k3y pattern), ALL defaulting to `'generated'` (roadmap-locked global default).
- **D-02:** Override UI lives in Settings → Playback ONLY — one selector row per context, following the existing grouped drill-in settings pattern. No queue-header chip.
- **D-03:** "Same list" = snapshot at tap: tapping a track queues the visible list as it was at that moment (today's `setQueue(results)` behavior); later list/search changes never mutate the queue. The Phase 16 auto-generate-on-exhaust engine still refills when the snapshot runs out.
- **D-04:** With `'generated'` (the default) the queue on a fresh play = tapped track + genre-similar generation (existing `regenerate`/`buildSimilarQueue` path); search results are NOT appended.
- **D-05:** Auto-expand fix: keep the `autoExpandOnPlay` setting (default off) but fire it ONLY on explicit user-initiated plays — never on auto-advance, failover skip, or queue progression. (Today it fires inside `play()` at player.svelte.ts:902, hence the track-change auto-expand bug.)

### Queue management (QUEUE-05)
- **D-06:** Swipe-to-remove = full-row horizontal swipe, axis-locked: commit horizontal vs vertical after slop (same idiom as the Phase 20 cover-swipe rule — no `setPointerCapture` on `pointerdown`); the existing GripVertical drag stays vertical-reorder only.
- **D-07:** Swipe visual = slide + fade following the finger; past distance threshold OR a fast flick (existing `createVelocityTracker`) the row animates out and removes; below threshold it springs back. Reuse the dragClose/velocity idiom.
- **D-08:** Clear-all = visible "Clear" button in the Up-Next header. It wipes EVERYTHING including manual pins (`manualUids` resets) — only the currently-playing track survives (never-stop posture preserved).
- **D-09:** After clear, the queue stays empty until the current track nears its end — the existing ensureAhead/exhaust engine then generates more. No immediate refill; the user gets a window to build their own queue.
- **D-10:** Swipe-removed tracks are session-excluded from auto-generation: an in-memory removed-uid set that `buildSimilarQueue`/`ensureAhead` exclude, reset on session end or a fresh play.

### Settings: text-size + accent (UX-03, UX-07)
- **D-11:** Widen `FONT_SCALE_MIN/MAX` to 50/200 for ALL five sliders (title, artist, lyrics, NP-title, NP-artist). Persisted values stay valid — the clamp only widens.
- **D-12:** Demo text under each slider reads "example {name}" sourced from the current/last-played track — title sliders preview the real song name, artist sliders the real artist name; static example fallback when nothing has played yet.
- **D-13:** Accent (UX-07) = full audit + fix: sweep for hardcoded `#7c5cff`, un-updated `--color-primary-hover`, and surfaces ignoring the variable; the picker must visibly recolor progress bars, active tabs, chips, buttons app-wide. Derive the hover shade from the chosen accent automatically (no second picker).

### Deezer enrichment (ENRICH-04)
- **D-14:** Artist page: port everything useful Deezer provides (fan count, hi-res picture, related artists, albums/discography) — Claude decides exact fields + layout. Album page same posture (release date, fans, label, genres, hi-res cover, track count/duration). Everything degrades gracefully (section silently absent) when Deezer misses.
- **D-15:** Field precedence when Last.fm and Deezer overlap: best-quality wins, field-by-field — highest-resolution image wins regardless of source; counts shown side-by-side labeled by source only if both exist and differ meaningfully. Enrichment stays additive, never replaces good per-source data (Phase 8 rule).
- **D-16:** Add TWO new edge proxy routes, `/api/deezer/artist` + `/api/deezer/album`, following the existing own-origin Deezer proxy pattern (no key, never api.deezer.com from the client) with Cache API TTLs (long — artist/album data is stable).
- **D-17:** New Deezer sections get shape-matched skeletons while resolving (pre-aligns with Phase 23 UX-01 + the project's skeleton rules); skeleton disappears cleanly (no residue) on a Deezer miss.
- **D-18:** Deezer top-tracks do NOT become a second list — the playable artist top-tracks list stays the CN-source one; Deezer's ranking is used only as an ordering hint where titles match. No dead non-playable rows.

### Claude's Discretion
- Exact shape of the per-context setting object in defaults.ts and how the player learns its current context (the new context-tracking field design)
- Which Deezer fields earn a UI row and the exact artist/album layout (D-14 explicitly delegates "what and how")
- Hover-shade derivation math for the accent; swipe thresholds/constants (reuse existing velocity/slop values)
- Settings → Playback page ordering/grouping of the new per-context rows
- TTL values for the new Deezer routes (mirror existing discovery TTL posture)

</decisions>

<specifics>
## Specific Ideas

- "Port in whatever Deezer provides and you may decide what and how" — user wants maximal Deezer enrichment with layout discretion delegated.
- Clear means clear — manual pins go too; a clear that leaves rows behind "reads as a bug".
- A swiped-away song reappearing via regeneration "feels broken" — hence session-exclusion (D-10).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (grounds the queue/engine decisions)
- `.planning/research/SUMMARY.md` — v1.2 synthesis: existing engine inventory, invariants (single audio element, playGen discipline), phase implications
- `.planning/research/PITFALLS.md` — recommendation-loop (recently-played ring buffer) and queue-mutation race (`manualUids`) pitfalls flagged for this phase; axis-lock gesture rules (Pitfall 7)
- `.planning/research/ARCHITECTURE.md` — player.svelte.ts integration points (regenerate, ensureAhead, prefetchNext), build-order rationale

### Prior phase context
- `.planning/phases/16-playback-resilience-core/16-CONTEXT.md` — never-stop engine decisions this phase layers on (loop-guard, offline gating, prefetch D-15)

### Code seams (verified this session)
- `src/lib/stores/player.svelte.ts` — queue state (~157), setQueue (~702), removeFromQueue (~710), addToQueue (~719), manualUids (~459), regenerate (~1041), ensureAhead (~727), prefetchNext (~768), autoExpandOnPlay fire site (~902); NO queueContext field exists yet
- `src/lib/config/defaults.ts` — k3y central defaults pattern (per-context sourcing defaults land here)
- `src/lib/stores/settings.svelte.ts` — FONT_SCALE_MIN/MAX (52–53), accent → `--color-primary` (315), reset-group pattern
- `src/lib/services/similar.ts` — buildSimilarQueue/getSimilarArtists (Last.fm primary, Deezer related fallback, same-artist last resort)
- `src/lib/services/deezer.ts` — existing proxy client (search/chart/related); new artist/album routes mirror this
- `src/routes/(app)/search/+page.svelte` — line ~384: `setQueue(results); play(t)` — the append behavior QUEUE-01 replaces
- `src/lib/components/NowPlaying.svelte` — Up-Next list UI (drag-reorder grip, tr-hint); swipe-remove + Clear land here
- `src/lib/gestures/velocity.ts` — createVelocityTracker for flick detection

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `regenerate(seed)` + `buildSimilarQueue`: the generated-sourcing engine already exists — D-04 is mostly making it the default path for all contexts and NOT calling `setQueue(list)` first
- `manualUids` set: manual-pin preservation across regen already implemented; Clear (D-08) resets it
- `createVelocityTracker` + dragClose action: flick/slop gesture idiom for swipe-remove (D-06/07)
- Grouped drill-in settings routes + reset-group pattern: per-context rows follow `/settings/playback`
- Deezer proxy pattern (`/api/deezer/*` + ttl-cache `cached()`): template for the two new routes
- Shape-matched skeleton patterns from home/now-playing (memory: skeletons must match loaded count/size/length)

### Established Patterns
- Defaults in `src/lib/config/defaults.ts`, referenced by Settings class field init + reset methods (k3y)
- New i18n keys cost 15-locale parity — keep per-context labels minimal/reused
- Services never throw (null-return + degrade); enrichment additive, never replaces good data (Phase 8)
- `playGen` monotonic guard on every new async playback path
- Marquee rules (memory): long text uses `use:marquee` + marquee-inner, never static ellipsis — applies to any new Deezer text rows

### Integration Points
- Every `setQueue()` call site (search page, album, artist, library, home) must pass/declare its context so the player can pick sourcing per D-01
- `play(t, {fresh})` → regenerate: the generated path; same-list path = today's snapshot setQueue
- NowPlaying Up-Next header → Clear button; rows → swipe-remove gesture alongside existing reorder grip
- `settings.applyAccent` (~315) → audit consumers of `--color-primary` / `--color-primary-hover`
- Artist/album `+page.svelte` → new Deezer sections beside existing Last.fm enrichment

</code_context>

<deferred>
## Deferred Ideas

- Queue-header quick toggle chip for sourcing (settings-only won this phase; revisit if discoverability suffers)
- Undo toast on clear/remove — skipped for i18n cost; revisit in Phase 23 UX audit if wanted
- Persistent (cross-session) removed-uid exclusion list — session-only for now

</deferred>

---

*Phase: 17-up-next-sourcing-settings-plumbing*
*Context gathered: 2026-06-10*
