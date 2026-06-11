# Phase 20: Now-Playing Surface & Gestures - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the now-playing surface behave like a native app via gestures, layered onto the existing Phase 15 expand/collapse sheet without breaking it:

1. **Cover swipe = prev/next (NP-01)** — horizontal swipe on the cover plays previous (left→right) / next (right→left), axis-locked so the sheet's vertical collapse and plain cover taps keep working.
2. **Half-open scroll containment (NP-02)** — in the half state, scrolling the panel never scrolls the page behind it; scroll always applies to the front layer.
3. **Tap cover closes subnav (NP-03)** — in the half state, tapping the cover dismisses the subnav panel.
4. **Top running-line loader (NP-04)** — a "running line" indicator (like the nowbar's) shows at the very top of the now-playing view while a track loads.
5. **Nowbar swipe = prev/next (NP-05)** — the same horizontal swipe on the nowbar mini-player changes track.

This LAYERS gestures onto the existing now-playing surface. It does NOT redesign the sheet, the tabs/subnav content, the transport controls, or the queue/lyrics panels. It does NOT introduce a gesture library — it reuses the Phase 15 slop/axis-lock idiom.

</domain>

<decisions>
## Implementation Decisions

### Cover swipe feedback (NP-01)
- **D-01:** **Carousel peek.** During the horizontal drag the cover follows the finger and the prev/next album art **peeks in from the edge**, then **snaps** to the committed track (YT Music / Spotify feel). Neighbors are known via the queue (`queue[i-1]` / `queue[i+1]`), so render up to 3 covers during the drag. Most-native of the options; accepted as the heaviest (3-cover render + edge handling).
- **D-02:** **Rubber-band resist at true queue boundaries.** Where there is genuinely no neighbor to show, the cover drags with resistance and **springs back — no track change**. "Next" almost always has a neighbor (auto-generated up-next), so the only true resist case is **"prev" on the very first track** (note: `player.prev()` already restarts the song if `currentTime > 3`). Apply native-feeling edge logic: resist where there's nothing, commit where the player can advance/generate.
- **D-03:** **Direction is locked by the requirement** — left→right = `player.prev()`, right→left = `player.next()` (NP-01). Reuse the existing `player.prev()` / `player.next()` (Phase 16 semantics); do NOT add new advance functions.

### Tap cover closes subnav (NP-03)
- **D-04:** In the **half** state, a plain tap on the cover **collapses the sheet to `closed`** — the immersive cover view with no tab panel. Reuse the existing closed snap (the grip-down path already animates to `closed`). This applies in **half only** (the requirement scopes it there).
- **D-05:** **The cover arbitrates three gestures by the same slop/axis rule** — sub-slop **tap** → collapse to closed (D-04); horizontal drag past slop → prev/next carousel (D-01); vertical drag past slop → existing sheet collapse (`npTop*` handlers). A drag that stays under slop must still reach the tap handler (the ROADMAP pitfall: never `setPointerCapture` on `pointerdown`; commit axis in `pointermove` after slop; sub-slop movement still fires `onclick`).

### Nowbar swipe feedback (NP-05)
- **D-06:** **Track & snap-back** on the nowbar — content (thumb art + text) slides with the finger and springs back/out on commit. **No multi-cover carousel** on the small bar (the tiny art makes a peek unreadable). Lighter than the cover, still tactile.
- **D-07:** **Tap-to-expand must keep working.** The nowbar tap (sub-slop) still expands the now-playing surface; a horizontal drag past slop changes track. Same axis-lock arbitration as the cover (D-05) so tap and swipe don't collide.

### Commit threshold (NP-01 / NP-05)
- **D-08:** **Proportional distance + flick.** Keep the shared idiom — **8px slop** to engage, **0.5px/ms flick always commits** — but make the **distance threshold a fraction of the element width (~25–30%)** rather than a flat 96px. Same fraction applies on the narrower nowbar. Rationale: 96px is a small commit on a 320px+ cover and invites accidental skips; proportional keeps both surfaces consistent in feel. Reuse the `swipeRemove.ts` / `velocity.ts` mechanics; change only the distance basis.

### Claude's Discretion
- **Top running-line loader (NP-04):** reuse the nowbar's `.np-prog.indet > i.sliver` markup + `np-indet` keyframe, driven by the same `player.loading` state, positioned at the very top of the now-playing view. Exact placement (above the cover / at the view's top edge) and whether it renders in half as well as full — Claude's discretion.
- **Scroll containment (NP-02):** add `overscroll-behavior-y: contain` to the scrollable `.panel` (and `touch-action: pan-y` if needed) so the bounce stops at the panel's edges. Confirm against the half vs full layout. Mechanism is Claude's discretion within "scroll stays on the front layer".
- **Axis-arbitration mechanics:** whether the new horizontal branch is added inside the existing `npTopDown/Move/Up` handlers or extracted into a shared slop+axis prelude/action — Claude's discretion, as long as the no-capture-on-pointerdown / commit-axis-after-slop / sub-slop-reaches-onclick invariant holds.
- Carousel spring/snap easing and timings; rubber-band resistance curve.

</decisions>

<specifics>
## Specific Ideas

- The cover swipe should feel like **YouTube Music / Spotify** — the adjacent cover peeks in as you drag, not an instant button-like jump.
- Boundaries should feel native: a rubber-band resist when there's truly nothing to swipe to, not a dead non-response or a silent no-op.
- The nowbar is deliberately *lighter* than the full cover — slide-and-snap, not a mini carousel — because the art is too small to read a peek.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs exist for this phase. Canonical references are in-repo requirements, the ROADMAP UI hint, and the load-bearing in-code gesture invariants this work must not break.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — NP-01..NP-05 (## Now Playing), and AUD-05 (referenced by NP-05)
- `.planning/ROADMAP.md` — Phase 20 goal, Success Criteria 1–5, and the **UI hint / Research flag** (the cover-swipe vs sheet-collapse collision is the highest-risk interaction: never `setPointerCapture` on `pointerdown`; commit axis in `pointermove` after slop; sub-slop movement must still reach `onclick`)

### In-code gesture idiom & surfaces (MUST read)
- `src/lib/components/NowPlaying.svelte` — the surface being gestured. Existing **vertical collapse** handlers `npTopDown/npTopMove/npTopUp` on `.np-top` (~lines 361–406): `DRAG_SLOP = 8`, capture only after `dy > slop && |dy| > |dx|`, 120px collapse threshold. `SheetState = 'closed' | 'half' | 'full'`; grip/subnav drive `gripDown/gripMove/gripUp`; `selectTab()` auto-opens half. `.cover` element (~682–689); `.panel { overflow-y: auto }` (~901)
- `src/lib/components/Nowbar.svelte` — mini-player (NP-05 swipe target) and the **running-line loader** to reuse for NP-04: `.np-prog` / `.np-prog.indet > i.sliver` (~177–206), driven by `player.loading`
- `src/lib/stores/player.svelte.ts` — `next()` (~1336) and `prev()` (~1352, restarts on `currentTime > 3`); `queue`, `indexOf`, `current`, `ensureAhead`; `loading` state (~101, set true ~1131 / false ~1296)
- `src/lib/gestures/velocity.ts` — reusable px/ms velocity tracker (3-sample), for the flick threshold
- `src/lib/actions/swipeRemove.ts` — horizontal swipe action (8px slop, 96px / 0.5px/ms flick, axis-lock) — the closest existing analog to the cover/nowbar swipe; D-08 tunes its distance basis
- `src/lib/actions/dragClose.ts` — down-drag-to-dismiss action (120px / 0.5px/ms flick, 8px start) — the vertical-collapse analog the horizontal swipe must coexist with

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 15 slop/axis-lock idiom** (`NowPlaying.svelte` `npTop*` + `dragClose.ts`/`swipeRemove.ts`) — 8px slop, axis-dominance check, capture only after slop. The cover's new horizontal branch reuses this exact arbitration (D-05).
- **`velocity.ts`** — px/ms 3-sample tracker for the 0.5px/ms flick commit (D-08).
- **`swipeRemove.ts`** — horizontal swipe mechanics; the nowbar (D-06) and cover (D-01) build on it; only the distance basis changes (flat → proportional, D-08).
- **`.np-prog.indet > i.sliver` + `np-indet` keyframe** (Nowbar) — the exact running-line loader NP-04 reuses, driven by `player.loading`.
- **`player.next()` / `player.prev()` / `queue` / `indexOf` / `ensureAhead`** — prev/next semantics and the neighbor lookup the carousel peek needs (`queue[i±1]`).
- **`SheetState` machine + closed-snap path** — the target for tap-cover-collapse (D-04) already exists.

### Established Patterns
- **No `setPointerCapture` on `pointerdown`** — arm on down, claim (capture) only in `pointermove` after slop + axis dominance; sub-slop movement must still fire `onclick`. This is the load-bearing invariant for the cover (tap vs h-swipe vs v-swipe, D-05) and the nowbar (tap-expand vs h-swipe, D-07).
- **Axis dominance** — `|dx| > |dy|` claims the horizontal/track path; `|dy| > |dx|` keeps the vertical collapse. The two handlers must arbitrate, not race.
- **Marquee / skeleton project rules** unaffected here; gestures only.

### Integration Points
- **`.np-top` (cover container)** — where the new horizontal carousel branch coexists with the existing vertical collapse handlers.
- **`.panel`** — where NP-02 `overscroll-behavior-y: contain` lands.
- **Top of `.np` view** — where the NP-04 loader mounts (reusing the nowbar markup).
- **Nowbar root** — where the NP-05 swipe + tap arbitration attaches without breaking tap-to-expand.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Loader exact placement, scroll-lock CSS specifics, and the axis-arbitration code shape are Claude's discretion within this phase, not deferred to a future one.)

</deferred>

---

*Phase: 20-now-playing-surface-gestures*
*Context gathered: 2026-06-11*
