# Phase 19: Track Menu Rework - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Rework the existing reusable bottom-sheet `src/lib/components/TrackMenu.svelte` so it:
1. Opens instantly on an unresolved stub with **all** action buttons visible; actions that need resolved data gate themselves (`detailsLoaded && uid`) and complete once data arrives (MENU-01).
2. Has a **two-row marquee header** (song / artist) with **like + close top-right**, and a skeleton matching the new shape (MENU-02).
3. Adds a **"Remix"** action that plays the triggering track first and seeds a genre-generated up-next from it (QUEUE-04).
4. Opening by **long-press** leaves **no stuck focus/active state** under the finger (MENU-03).

This reworks the existing menu — it does NOT add new menu capabilities beyond Remix, and does NOT touch the sleep-timer wiring (Phase 18-03) or the now-playing surfaces (Phase 20).
</domain>

<decisions>
## Implementation Decisions

### Gated-action resolve-then-act (MENU-01)
- **D-01:** Remove the current "`loading` hides ALL buttons behind 9 `.mi-skel` rows" gate. All action buttons render immediately when the menu opens — even on a discovery stub (home long-press) before the real Track resolves.
- **D-02:** Actions whose effect needs resolved fields are **gated on `detailsLoaded && uid`**. Tapping a gated action before resolve is allowed (resolve-then-act): it kicks off the resolve, shows a small **inline spinner on that row**, and the action **fires automatically** once data arrives. Actions that operate on the stub object alone are NOT gated and work immediately. Apply the rule per-action (Download / Detail / Remix-play are gated because they need `audioUrl`/resolved details; Play next / Add to queue / Like / Add to playlist / Go to artist work on the stub).
- **D-03:** **Double-action dedupe** — exactly one resolve is in flight per action; a second tap while a row is spinning is a no-op. On resolve failure: clear the spinner and toast gracefully (never a stuck spinner). This is a named constraint in the ROADMAP UI hint.

### Remix (QUEUE-04)
- **D-04:** Remix plays the triggering track first, then rebuilds up-next as a genre-generated queue seeded from it. **Reuse the existing fresh-play regenerate path** — `player.play(track, { fresh: true })` → `regenerate(seed)` → `buildSimilarQueue` — which already yields `dedupeBest([seed, ...manualEntries, ...auto])`. Do NOT build a new queue mechanism.
- **D-05:** **Replace but keep manual pins** — clear the auto/generated portion of up-next but preserve user-pinned / manually-added tracks via the existing `manualUids` discipline (the regenerate path already filters `manualEntries`). The prior generated tail is discarded.
- **D-06:** Remix must **always generate**, regardless of the user's per-context up-next setting (QUEUE-03 `'same-list'` vs `'generated'`). Set a Remix `queueContext` (or otherwise force `effectiveUpnextMode === 'generated'`) so an explicit Remix never falls back to same-list. Exact mechanism → planning/research.
- **D-07:** Remix is a **gated action** (needs `audioUrl` to play the seed) — same resolve-then-act treatment as D-02. Placement: in the queue-actions cluster near Play-next / Add-to-queue. Icon: a distinct one (Shuffle is already taken by `shuffleQueue`) — Claude's discretion. Feedback: toast on trigger.

### Header layout & skeleton (MENU-02)
- **D-08:** Header becomes **two rows** — row 1 song name, row 2 artist name — each `use:marquee` (overflow-only animate). Follow the NowPlaying analog + the project marquee rule: a `marquee-inner` child with the parent locked `flex` / `min-width: 0` / `max-width`; the marquee CSS keyframe lives in this component (the action only toggles `.marquee-on` + `--marquee-dx`). Replaces the single `{title} · {artist}` ellipsis line.
- **D-09:** **Like (heart) + Close (X) sit top-right** of the header, side by side. Like moves OUT of the action list — **remove the mid-list Like row** to avoid duplication. The X is a NEW explicit close affordance (today close is scrim/drag only); it only flips state false and converges on the single dismiss path (the `$effect` cleanup → `overlays.dismiss`), exactly like the existing detail-modal X.
- **D-10:** Header rows are **display-only (not tappable)**. Keep "Go to artist" as its own action row — do NOT make the artist row tap through.
- **D-11:** The opening **skeleton matches the new 2-row header shape** (two stacked bars sized to title/artist). Home stubs already carry title/artist so header text is usually present immediately; the skeleton covers the brief pre-data / marquee re-measure window and keeps layout from jumping.

### Long-press release (MENU-03)
- **D-12:** After a long-press opens the menu: **clear any stuck active/focus/hover** on the trigger element under the finger AND **suppress the synthetic click/tap** that fires on finger-up so the row does not also play/navigate (no double action). This applies at the long-press **trigger sites** (home tiles, track rows, compact rows), not inside TrackMenu. Exact mechanism (blur + `pointercancel` + suppress-next-click vs CSS hover guards) → research/planning per iOS Safari vs Android Chrome long-press→click behavior.

### Claude's Discretion
- Remix icon choice; the exact inline-spinner visual; the precise gated-vs-ungated action set (apply the `detailsLoaded && uid` rule); the long-press cleanup mechanism; whether Share is gated (depends on whether `shareUrl(track)` needs resolved fields — it likely does not).
</decisions>

<specifics>
## Specific Ideas

- "Remix" = a deliberate reset to a fresh genre queue from this song, but it must not throw away tracks the user explicitly queued (Play Next / Add to Queue / reordered = manual pins).
- The menu must never wait on the network before appearing — buttons first, data fills in (inverts today's stub behavior, which hides everything behind a skeleton).
- Like + Close share the top-right corner (Spotify/YT-Music-style sheet header), title/artist stacked below.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs exist for this phase — the canonical references are in-repo requirements + the load-bearing in-code invariants that this rework must not break.

### Requirements
- `.planning/REQUIREMENTS.md` — MENU-01 / MENU-02 / MENU-03 (## Track Menu Modal) and QUEUE-04 (## Queue / Up-Next)
- `.planning/ROADMAP.md` — Phase 19 goal, Success Criteria 1–4, and the "UI hint / Research flag" note (overlay invariant, act-on-stub gating, marquee re-measure, double-action dedupe)
- `.planning/STATE.md` — Blockers/Concerns → Phase 19 overlay `$effect` history invariant

### In-code invariants & patterns (MUST read)
- `src/lib/stores/overlays.svelte.ts` — history==stack depth invariant; `open`/`dismiss`/`closeTop`/`navigateAway`; single dismiss path
- `src/lib/components/TrackMenu.svelte` — the component being reworked; the three `$effect` overlay registrations (dep `open`-only + `untrack()`), `{#if open && track}` guards, `pickerOpen`/`detailTrack` precedent
- `src/lib/components/SleepTimerSheet.svelte` — global-sheet + `pickerOpen`-precedent example (Phase 18-03)
- `src/lib/actions/marquee.ts` — overflow-only marquee action (`.marquee-on` + `--marquee-dx`)
- `src/lib/components/NowPlaying.svelte` — the marquee header analog (two-line marquee + `marquee-inner` pattern)
- `src/lib/stores/player.svelte.ts` — `play(track,{fresh})`, `regenerate(seed)`, `manualUids`, `queueContext`, `setQueue` (Remix wiring)
- `src/lib/services/similar.ts` — `buildSimilarQueue` (genre-similar generation)
- `src/lib/config/defaults.ts` — `QueueContext` type + `effectiveUpnextMode`
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`player.play(track, { fresh: true })` + `regenerate(seed)`** — already does "play seed, regenerate auto up-next from genre-similar, keep manual pins" (`dedupeBest([seed, ...manualEntries, ...auto])`). Remix is this path with a forced-generate context.
- **`player.manualUids`** — set of user-pinned uids that survive a fresh-play regeneration (Play Next / Add to Queue / reorder). Exactly the "keep manual pins" behavior (D-05).
- **`overlays` store** — `open`/`dismiss` for the new Close-X sub-affordance; `navigateAway` already used by Go-to-artist.
- **`use:marquee`** action — overflow-only animate; reuse for both header rows.
- **`ensureTrackDetails(track)`** — the resolve step the gated actions await (D-02); already used by Download/Detail.
- **`SleepTimerSheet` + `pickerOpen` pattern** — the precedent any new sub-sheet must follow (none expected for this phase — Remix needs no sub-sheet).

### Established Patterns
- **Overlay `$effect`**: dep is `open` (or `pickerOpen`/`detailTrack`) ONLY — never `track`; `untrack()` around `overlays.open/dismiss`; cleanup is the SOLE `dismiss` caller; `{#if open && track}` gates visibility. The stub→resolved `track` reassignment must NOT re-run the effect (history churn → over-pop to previous route).
- **`dedupeBest(..., settings.preferredSource)`** is the queue de-dup/quality tie-break — Remix output flows through it already.
- **Skeletons match loaded shape/count/size** (project rule) — the new header skeleton matches the 2-row shape; do not regress to a generic spinner.

### Integration Points
- Long-press trigger sites (home tiles, compact rows, track rows) — where MENU-03's stuck-state/click-suppression fix lands (NOT inside TrackMenu).
- `settings.effectiveUpnextMode(queueContext)` — the gate Remix must override to force generation (D-06).
</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Remix icon, inline-spinner visual, and the long-press cleanup mechanism are Claude's discretion within this phase, not deferred to a future one.)
</deferred>

---

*Phase: 19-track-menu-rework*
*Context gathered: 2026-06-11*
