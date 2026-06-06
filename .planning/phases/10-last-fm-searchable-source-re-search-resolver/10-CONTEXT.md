# Phase 10: Last.fm-searchable Source (re-search resolver) - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Make Last.fm-discovered tracks reliably playable. **RESCOPED** at discussion time because Phase 9 shipped most of this phase early:

- **LFSRC-02** (resolve `{artist,title}` → playable audio via searchAll + dedupeBest, graceful miss) — **ALREADY DELIVERED** in Phase 9 as `resolveStub` (`src/lib/services/discovery.ts`), used by home tap-to-play + album tracklist.
- **LFSRC-01** (formal `'lastfm'` SourceId registered in both registries) — **DROPPED / satisfied-by-pattern** (see D-01). `resolveStub` IS the resolver; discovery already browses Last.fm; a registered `'lastfm'` source in the unified search bar adds little for the cost of widening `SourceId`.
- **LFSRC-03** (best-match scoring) — the ONLY new work this phase: upgrade `resolveStub` from blind `dedupeBest[0]` to a scored pick so taps play the right track, not a karaoke/cover/live variant.

So Phase 10's deliverable = **resolution QUALITY (LFSRC-03 scoring)**. Auth-independent. GD Studio `ytmusic` stays out (v2).
</domain>

<decisions>
## Implementation Decisions

### Phase shape / requirement disposition (the rescope)
- **D-01:** Phase 10 = **LFSRC-03 scoring only**. Mark **LFSRC-02 = done** (Phase 9 `resolveStub`) and **LFSRC-01 = satisfied-by-pattern / dropped** (resolveStub is the de-facto Last.fm resolver; no formal `'lastfm'` SourceId — avoids widening `SourceId`/`SOURCES` for marginal unified-search value). **FLAG for roadmapper/planner:** update ROADMAP Phase 10 + REQUIREMENTS traceability — LFSRC-02 Complete (Phase 9), LFSRC-01 moved to satisfied-differently or backlog, LFSRC-03 the live requirement. Kept as a (slim) phase, not collapsed to a quick task (user choice).

### Best-match scoring (LFSRC-03)
- **D-02:** Replace `resolveStub`'s blind `dedupeBest(...)[0]` with a **scored pick** over the `searchAll` results:
  1. **Penalize variant keywords** — down-rank results whose title contains cover / karaoke / live / instrumental / remix / "sped up" / "8d" / tribute / re-recorded (etc.) UNLESS the Last.fm query itself asked for that variant.
  2. **Artist+title similarity** — prefer results whose normalized artist+title closely matches the Last.fm `{artist,title}` (reuse the `matchKey` / normalization primitive from `src/lib/services/match-key.ts`); exact-ish beats loose.
  3. **Tie-break by existing ranking** — keep `dedupeBest`'s `preferredSource` + quality ranking as the FINAL tie-break among similarly-scored candidates.
- **D-03:** **No score threshold / always play the top-scored result.** Scoring only RE-RANKS; it never nulls out a found result for being "low score." `resolveStub` returns `null` ONLY when `searchAll` yields zero results (the existing graceful-miss path, success criterion #3, unchanged).
- **D-04:** **Duration sanity check is SKIPPED.** It would require surfacing the Last.fm track duration through the discovery shape (extra plumbing) for low marginal value. Explicitly out.

### Source coverage
- **D-05:** **GD Studio `ytmusic` stays DEFERRED to v2** (LFSRC-FB-01). The CN-source re-search resolver is the v1.1 path. If ever pulled in → its own feasibility spike (`s`-checksum drift, 50 req/5 min cap, instance failover, Western-catalog match rate).

### Claude's Discretion (planner/executor)
- Exact scoring weights + the variant-keyword list (English + common CJK variant terms).
- Where the scoring lives: extend `resolveStub` in `discovery.ts` directly vs a small `scoreMatch(query, candidate)` helper it calls (lean toward a pure, unit-testable helper).
- `resolveStub` is the SINGLE change point — both home tap-to-play AND the album-page tracklist resolve go through it, so one change covers both surfaces (no per-page edits needed).
- Whether to also feed the scorer the original search query string for the "did the user ask for this variant?" check.
</decisions>

<specifics>
## Specific Ideas

- Don't play karaoke/cover/live when the user tapped the real song — that's the whole point of LFSRC-03.
- Keep it lazy/on-tap (Phase 9 D-03) — scoring runs on the single tapped item's `searchAll` results, never a shelf-wide fan-out.
- Pure-reuse `catalog.ts`/`dedupe.ts` as before; the scorer wraps/orders their output, it doesn't replace dedupe.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's contract
- `.planning/ROADMAP.md` §"Phase 10: Last.fm-searchable Source" — goal + 4 success criteria + security note (Pitfall 7 wrong-song). NOTE: criteria reflect pre-rescope LFSRC-01/02; D-01 supersedes (LFSRC-02 done, LFSRC-01 dropped).
- `.planning/REQUIREMENTS.md` — LFSRC-01/02/03 wording + traceability (needs the D-01 status update)

### Research
- `.planning/research/PITFALLS.md` — Pitfall 7 (wrong-song resolution / playing covers — the LFSRC-03 motivation) + threat T-lfm-04 (scoped to the deferred ytmusic path)
- `.planning/research/SUMMARY.md` + `.planning/research/ARCHITECTURE.md` — re-search resolver design, the 9↔10 coupling

### Phase 9 (where LFSRC-02 shipped — read to extend, don't duplicate)
- `.planning/phases/09-discovery-hot-picks-tab/09-CONTEXT.md` — D-03 (tap-to-play via resolveStub), the rescope flag in its Deferred section
- `.planning/phases/09-discovery-hot-picks-tab/09-01-SUMMARY.md` — resolveStub as shipped

### Code (the change surface)
- `src/lib/services/discovery.ts` — `resolveStub` (line ~23) — the SINGLE function to upgrade with scoring
- `src/lib/services/catalog.ts` (`searchAll`) + `src/lib/services/dedupe.ts` (`dedupeBest`) — pure reuse; the scorer orders their output
- `src/lib/services/match-key.ts` — `matchKey`/normalization for the artist+title similarity score
- `src/lib/stores/settings.svelte.ts` — `preferredSource` (final tie-break)

### Project-level
- `.planning/PROJECT.md` — v1.1 milestone, local-first/edge-only constraints
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveStub` (`discovery.ts`) — the ONE function to change; both home + album resolve-on-tap flow through it, so a single scoring upgrade covers every surface.
- `dedupeBest` (`dedupe.ts`) — keep as the final tie-break ranking; the scorer pre-orders/penalizes before it (or re-ranks its output).
- `matchKey` (`match-key.ts`) — normalization for artist+title similarity scoring.
- `searchAll` (`catalog.ts`) — unchanged source of candidate Tracks.

### Established Patterns
- resolveStub is lazy/on-tap, best-effort, never throws, returns null only on a true miss (Phase 9 D-03). Scoring must preserve all of that.
- `Track` candidates carry title/artist/album/quality/source — the scorer reads title for variant-keyword penalties + artist/title for similarity.

### Integration Points
- No new endpoint, no registry change (LFSRC-01 dropped). Purely a `discovery.ts` resolution-quality upgrade + a unit-testable scoring helper. No UI change (callers already handle the returned Track / null).
</code_context>

<deferred>
## Deferred Ideas

- **LFSRC-01 formal `'lastfm'` SourceId adapter** — dropped from v1.1 (D-01). Revisit ONLY if a "search Last.fm catalog in the unified search bar" feature is later wanted; would widen `SourceId`/`SOURCES`.
- **Duration sanity scoring** (D-04) — skipped; would need Last.fm duration surfaced through discovery.
- **GD Studio `ytmusic`** Western-catalog resolver — v2 / LFSRC-FB-01, own spike.

No scope creep raised — discussion narrowed scope (rescope), didn't expand it.
</deferred>

---

*Phase: 10-last-fm-searchable-source-re-search-resolver*
*Context gathered: 2026-06-06*
