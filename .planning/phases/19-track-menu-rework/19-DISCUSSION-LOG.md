# Phase 19: Track Menu Rework - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 19-track-menu-rework
**Areas discussed:** Gated-action feedback, Remix scope & placement, Header layout, Long-press release

---

## Gated-action feedback (MENU-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Tap now, auto-runs on resolve | Button stays tappable; tap kicks off resolve, inline spinner on the row, fires automatically once `detailsLoaded && uid`. | ✓ |
| Disabled until resolved | Data-gated buttons render disabled (dimmed) until resolve, then enable; early tap does nothing. | |
| Tap → 'preparing…' toast | Tappable; early tap shows a toast and completes silently — no per-row spinner. | |

**User's choice:** Tap now, auto-runs on resolve (resolve-then-act with inline spinner).
**Notes:** Inverts today's behavior where `loading` hides all buttons behind a 9-row skeleton. Matches MENU-01 wording "gated resolve-then-act … complete gracefully once data arrives."

---

## Remix scope & placement (QUEUE-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Replace — fresh genre queue | Clear up-next, play this track, regenerate from it; cleanest "remix from this song". | |
| Replace but keep manual pins | Clear the generated up-next but preserve user-pinned/manual adds (mirrors 260606-5ug regen-on-fresh-play). | ✓ |
| Insert after current | Keep existing up-next; splice genre-gen after this track. | |

**User's choice:** Replace but keep manual pins.
**Notes:** Maps onto the existing `player.play(track,{fresh:true})` → `regenerate(seed)` path, which already preserves `manualUids` and emits `dedupeBest([seed, ...manualEntries, ...auto])`. Only new work: force `effectiveUpnextMode === 'generated'` regardless of per-context setting (D-06). Icon TBD (Shuffle taken).

---

## Header layout (MENU-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Remove Like row; artist row taps through | Like → header; artist row (line 2) navigates to artist page; drop Go-to-artist list row. | |
| Remove Like row; rows display-only | Like → header; header is display-only; keep Go-to-artist as a list row. | ✓ |
| Keep mid-list Like too | Header Like + a duplicate Like row in the list. | |

**User's choice:** Remove mid-list Like row; like+close top-right; header rows display-only; keep Go-to-artist as a list row.
**Notes:** Two-row marquee header (song / artist). New X close affordance converges on the single dismiss path. Skeleton matches the 2-row shape.

---

## Long-press release (MENU-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Suppress post-long-press click too | Once long-press opens the menu, swallow the synthetic finger-up click AND clear active/focus/hover. | ✓ |
| Clear visual state only | Just fix the stuck highlight; trust the existing tap/long-press split. | |
| You decide (research platforms) | Claude researches iOS Safari vs Android Chrome and picks. | |

**User's choice:** Suppress the post-long-press click + clear active/focus/hover.
**Notes:** Applies at the long-press trigger sites (home tiles / track rows / compact rows), not inside TrackMenu. Exact mechanism (blur + pointercancel + suppress-next-click vs CSS guards) → research/planning.

---

## Claude's Discretion

- Remix icon choice; exact inline-spinner visual; precise gated-vs-ungated action set (apply `detailsLoaded && uid`); long-press cleanup mechanism; whether Share is gated.

## Deferred Ideas

- None — discussion stayed within phase scope.
