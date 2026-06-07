# Quick Task 260607-gte: NowPlaying + Playback Resilience - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Task Boundary

4-part Now Playing / playback resilience expansion:
- **Cross-source fallback** on play failure (deferred backlog item SRC-FB-01).
- **Real shuffle + tri-state repeat** wired through queue ordering + auto-advance.
- **Shared-element morph expand** (nowbar → NowPlaying) + new swipe-up gesture.
- **Keyboard shortcuts** (Space/←/→) on the NowPlaying overlay.
</domain>

<decisions>
## Implementation Decisions

### Animation approach (Part 3)
- **Hand-rolled FLIP** (locked via AskUserQuestion). Snapshot getBoundingClientRect of nowbar
  cover/title/artist BEFORE expansion, snapshot the final NowPlaying slot positions, then animate
  transform+scale (and font-size for the text) from old→new on a single morph element.
- Finger-follow on swipe-up: drag distance drives a `progress` (0..1) that interpolates between
  the snapshots; release commits forward (`progress >= 0.5`) or back. Reverse on collapse uses the
  same primitive.
- Other NowPlaying chrome (top bar, progress, transport, grip, subnav, panel) fades + scales in
  from `opacity:0 / scale(0.96)` keyed off the same progress.
- Reduce-motion: skip the morph and snap into place (set progress = 1 instantly).
- Why: crossfade pairs can't easily run finger-follow; the nowbar stays mounted under the
  expanded overlay; FLIP gives continuous gestural control + reverse.

### Repeat semantics (Part 2)
- **Industry-standard tri-state** (locked via AskUserQuestion): `off → one → all → off`.
  - `one`: current track loops forever (until the user advances or changes mode).
  - `all`: queue loops at the end (wrap from last to first).
  - `off`: today's behavior.
- Wired through: `<audio>` `ended` handler / `player.next()` end-of-queue path.
- Lucide icons: `Repeat` (muted) when off · `Repeat1` (accent) when one · `Repeat` (accent) when all.

### Shuffle semantics (Part 2)
- Fisher-Yates on `player.queue` slice AFTER `indexOf(current)+1`. Current track + history pinned.
- Toggling off does NOT restore the original order (user-specified). The shuffled queue stays as is.
- Persistence: in-memory only — matches the rest of the queue's lifecycle.

### Cross-source fallback (Part 1) — Claude's Discretion
- Order: ALL enabled sources except the one that failed, with `settings.defaultSource` (if any)
  tried FIRST among the remaining. Cap = each remaining source tried at most once per fallback
  attempt (no infinite loops).
- Reuse: `searchAll(query, 1, {sources: [s]})` → `dedupeBest` → `ensureTrackDetails` (already used
  by `resolveStub`).
- Supersedence: each fallback honors a generation counter (mirrors `pendingGen` in playStub); a
  newer `play()` aborts the fallback and discards stale results.
- History: `history.record(track)` already runs at the top of `play()` for the ORIGINAL track —
  the fallback try does NOT re-record (history is the user's intent, not the resolved fallback).
- Error gate: only after ALL sources exhausted does the existing `player.error = '…'` show.

### Keyboard shortcuts (Part 4) — Claude's Discretion
- Window-level listener attached on NowPlaying mount, removed on unmount (NowPlaying only renders
  while `player.expanded === true`, so mount==overlay-open).
- Suppressed when:
  - `document.activeElement` is an `<input>`/`<textarea>` (not all are content sites — guard).
  - `document.activeElement.isContentEditable` is true.
  - An IME composition is active (`compositionstart` flag).
- Mappings: `Space` → `player.toggle()` (preventDefault to stop page scroll); `ArrowLeft` →
  `player.prev()`; `ArrowRight` → `player.next()`.

</decisions>

<specifics>
## Specific Ideas

- For the morph: do NOT animate width/height (jank). Animate `transform: translate + scale` of
  the cover (the visual size is `scale × baseWidth`), and animate font-size of the title/artist
  via a CSS var driven from JS (the scale ratio between nowbar font and NP font).
- The "swipe up from nowbar" gesture conflicts with the page's vertical scroll. Threshold: deltaY
  must exceed 6px AND start within the nowbar's hit area; otherwise treat as a tap → existing click
  handler runs.
- `dragClose` action (existing) already handles drag-down-to-dismiss — reuse where possible,
  reverse direction for swipe-up to expand.

</specifics>

<canonical_refs>
## Canonical References

- STATE.md note: `SRC-FB-01 source fallback on play failure (cross-source matching)` — deferred to v2.
- Existing `resolveStub` (services/discovery.ts) for the searchAll + dedupeBest pattern.
- Existing `pendingGen` generation guard on `player.playStub` for the supersedence pattern.
- `app.css` `:root[data-reduce-motion]` rule already kills transitions/animations globally.

</canonical_refs>
