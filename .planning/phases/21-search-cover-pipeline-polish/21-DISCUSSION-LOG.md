# Phase 21: Search & Cover Pipeline Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 21-search-cover-pipeline-polish
**Areas discussed:** Search scoring behavior, Cover fallback chain, Lazy cover cache (uid/name), Empty-query autofocus

---

## Search scoring behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Full re-sort by score (Recommended) | Sort entire deduped list by score descending | ✓ |
| Stable nudge only | Keep interleave order; score only demotes junk / promotes strong matches | |
| You decide | Claude picks during planning | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sink to bottom (Recommended) | Heavy penalty pushes 試聽 below all normal tracks; nothing disappears | ✓ |
| Hide entirely | Filter out sub-60s tracks | |
| Sink + label | Sink plus a 試聽 badge on the row | |

| Option | Description | Selected |
|--------|-------------|----------|
| Search page only (Recommended) | New scoring re-orders the search list only; resolveStub untouched | |
| Share with resolveStub | Fold signals into scoreMatch — one scoring brain | ✓ |
| You decide | Claude decides after reading call sites | |

| Option | Description | Selected |
|--------|-------------|----------|
| Re-sort every partial (Recommended) | Each onPartial re-runs dedupe+score+sort; brief reshuffle | ✓ |
| Sort only at settle | One final re-sort when all sources land | |
| You decide | Claude checks reshuffle feel vs skeleton dwell | |

| Option | Description | Selected |
|--------|-------------|----------|
| Cross-source presence (Recommended) | Boost artists appearing in 2+ different sources | ✓ |
| Raw row count | Boost by result-row count regardless of source | |
| Row count, capped | Raw frequency capped (e.g. max +3) | |

| Option | Description | Selected |
|--------|-------------|----------|
| Closest to query length (Recommended) | Query-relative title-length proximity | ✓ |
| Absolute length penalty | Graded penalty per extra char | |
| Suffix-junk detector | Penalize un-asked-for bracketed/dashed suffixes | |

| Option | Description | Selected |
|--------|-------------|----------|
| No specific ones | Claude builds synthetic fixtures per scoring rule | ✓ |
| Yes, let me type them | User lists real failing queries as fixtures | |

| Option | Description | Selected |
|--------|-------------|----------|
| Penalty dominates (Recommended) | 試聽 penalty outweighs any boost combo | ✓ |
| Pure sum, tuned | All signals sum; boosts can rescue penalized tracks | |
| You decide | Claude calibrates against fixtures | |

**User's choice:** Full re-sort, sink-to-bottom, shared with resolveStub, re-sort per partial, cross-source artist boost, query-length-proximity title boost, synthetic fixtures, penalty dominates.
**Notes:** Sharing with resolveStub accepted despite playback-path risk — regression tests mandated in CONTEXT.md (D-07).

---

## Cover fallback chain

| Option | Description | Selected |
|--------|-------------|----------|
| Player store field (Recommended) | resolvedCover on player.svelte.ts; all 3 surfaces read one field | ✓ |
| Per-surface resolution | Each surface resolves independently | |
| You decide | Claude picks during planning | |

| Option | Description | Selected |
|--------|-------------|----------|
| Gradient + keep last resort (Recommended) | Existing seeded-gradient while resolving; favicon.svg MediaSession fallback | ✓ |
| App-logo placeholder art | New branded placeholder asset everywhere | |
| You decide | Claude picks per existing idiom | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse chain as-is (Recommended) | Deezer→iTunes→CN unchanged | |
| CN-first for search rows | Try the row's own CN source album art first | |
| (Other) Verify iTunes vs Deezer quality first | User asked Claude to check which returns better covers and reorder if iTunes wins | ✓ |

Follow-up after verification (Deezer cover_xl=1000px edge-cached vs iTunes 600px direct):

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Deezer→iTunes→CN + bump iTunes to 1200px (Recommended) | Deezer stays tier 1; iTunes token swap 100x100bb→1200x1200bb | ✓ |
| Keep chain, leave iTunes at 600px | No itunes-cover.ts change | |
| Switch to iTunes first anyway | iTunes tier 1 despite lower res | |

**User's choice:** Player-store resolvedCover, gradient placeholder, Deezer-first chain confirmed by evidence + iTunes 1200px bump.
**Notes:** User initially hypothesized iTunes covers might beat Deezer; resolved by checking both resolvers' actual resolutions and caching posture.

---

## Lazy cover cache (uid/name)

| Option | Description | Selected |
|--------|-------------|----------|
| Two-layer same store (Recommended) | 'uid:' prefixed entries alongside matchKey entries in one record | ✓ |
| Separate uid store | New localStorage key for uid→cover | |
| You decide | Claude picks; uid-first read locked either way | |

| Option | Description | Selected |
|--------|-------------|----------|
| Search results only (Recommended) | Phase-scoped; other lists adopt later | |
| All track lists now | Reusable lazyCover action: search + library + album + artist | ✓ |
| Search + library | Middle ground | |

| Option | Description | Selected |
|--------|-------------|----------|
| Empty covers only (Recommended) | Chain fires only when track.cover is empty + cache miss | |
| Also fix broken covers | Detect dead CDN URLs and re-resolve | ✓ |
| You decide | Claude scopes per-list | |

| Option | Description | Selected |
|--------|-------------|----------|
| No eviction (Recommended) | Tiny values; Data-tab clear button is recovery | ✓ |
| Size cap + prune | Cap entries, prune oldest; needs timestamps | |
| You decide | Claude assesses growth | |

**User's choice:** Two-layer same store, all lists now, broken-URL repair included, no eviction.
**Notes:** Broken-cover detection flagged as plumbing: rows render CSS background-image (no error events) — needs Image()-probe or `<img>` switch (captured in D-15).

---

## Empty-query autofocus

| Option | Description | Selected |
|--------|-------------|----------|
| Every empty-state visit (Recommended) | onMount: no prior session → focus; restored session never focuses | ✓ |
| First visit per session only | Focus once per app session | |
| You decide | Claude tests iOS keyboard feel | |

| Option | Description | Selected |
|--------|-------------|----------|
| Accept OS behavior (Recommended) | Focus ring + caret guaranteed; keyboard where OS allows | ✓ |
| Gesture-chained focus | Intercept nav tap to pop iOS keyboard | |
| You decide | Claude escalates only if iOS never pops | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, show recents (Recommended) | Blank landing focused WITH recents visible | ✓ |
| Focus without recents | Suppress recents until real user tap | |

**User's choice:** Every empty-state visit, accept iOS restriction, recents shown on autofocus.
**Notes:** None.

---

## Claude's Discretion

- Exact scoring weights/constants (within penalty-dominates invariant, calibrated on fixtures)
- Module shape for set-context scoring (pure + node-testable required)
- IntersectionObserver tuning + in-flight de-dupe in lazyCover action (concurrency capped)
- Broken-URL detection mechanism (Image() probe vs `<img>` onerror)
- resolvedCover set/clear sequencing in play()/resolve flow + MediaSession refresh

## Deferred Ideas

None — discussion stayed within phase scope.
