# Phase 10: Last.fm-searchable Source - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 10-last-fm-searchable-source-re-search-resolver
**Areas discussed:** Phase shape (rescope), Scoring rules, No-match handling, ytmusic deferral
**Trigger:** Phase 10 flagged for rescope after Phase 9 shipped LFSRC-02 (tap-to-play resolveStub) early.

---

## Phase shape (the rescope)

| Option | Description | Selected |
|--------|-------------|----------|
| Scoring + drop formal adapter (Recommended) | Phase 10 = LFSRC-03 only; LFSRC-01 satisfied-by-pattern (resolveStub is the resolver); LFSRC-02 done in Phase 9 | ✓ |
| Scoring + build formal 'lastfm' source | LFSRC-03 + LFSRC-01 (Last.fm as a unified-search source) | |
| Shrink to a quick task | Collapse Phase 10 to one quick task | |

**User's choice:** Scoring + drop formal adapter (kept as a slim phase, not a quick task).
**Notes:** LFSRC-01 dropped to avoid widening SourceId/SOURCES for marginal unified-search value. Roadmap/requirements traceability needs a status update (flagged in CONTEXT D-01).

---

## Best-match scoring rules (LFSRC-03, multiSelect)

| Option | Selected |
|--------|----------|
| Penalize variant keywords (cover/karaoke/live/instrumental/remix...) | (no preference) |
| Artist+title similarity (matchKey normalization) | (no preference) |
| Duration sanity (±~10s; needs surfacing Last.fm duration) | (no preference) |
| Prefer source quality (preferredSource tie-break) | (no preference) |

**User's choice:** No preference → Claude's discretion.
**Resolved (CONTEXT D-02/D-04):** penalize variant keywords + artist+title similarity + preferredSource/quality tie-break; **duration sanity SKIPPED** (extra plumbing, low value).

---

## No-match handling

| Option | Description | Selected |
|--------|-------------|----------|
| Show 'no playable source' (Recommended) | Below score threshold → treat as miss | |
| Always play best guess | Always play top-scored, no threshold | ✓ |

**User's choice:** Always play best guess.
**Notes:** Scoring only re-ranks; resolveStub returns null only on zero searchAll results (existing graceful miss). No threshold gate (CONTEXT D-03).

---

## GD Studio ytmusic

| Option | Description | Selected |
|--------|-------------|----------|
| Keep deferred to v2 (Recommended) | Out of v1.1 (LFSRC-FB-01) | ✓ |
| Pull into Phase 10 with a spike | Add feasibility spike now | |

**User's choice:** Keep deferred to v2.

---

## Claude's Discretion
- Scoring weights + variant-keyword list (English + CJK variant terms).
- Scoring location: extend resolveStub vs a pure `scoreMatch` helper (lean helper, unit-tested).
- Single change point: resolveStub covers both home tap-to-play + album tracklist.

## Deferred Ideas
- LFSRC-01 formal 'lastfm' source adapter — dropped; revisit only if unified Last.fm search wanted.
- Duration sanity scoring — skipped.
- GD Studio ytmusic — v2 / LFSRC-FB-01.
