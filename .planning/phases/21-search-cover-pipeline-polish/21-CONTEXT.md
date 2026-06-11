# Phase 21: Search & Cover Pipeline Polish - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Search returns the right songs with artwork and a sensible focus, and the playing track always has a cover:

1. **Search scoring tune (SRCH-01)** — result scoring boosts shorter (non-cover) titles and artists recurring across results, heavily penalizes sub-60s 試聽 preview clips, and never falsely penalizes sources that don't report duration.
2. **Result cover fallback (SRCH-02)** — search results with empty covers resolve through the cover fallback chain.
3. **Empty-query autofocus (SRCH-03)** — when the search page shows nothing because the query is empty, the input is auto-focused without breaking cross-nav search-state restoration.
4. **Playing-track cover guarantee (COVER-01)** — the playing track's cover always renders in now-playing, the nowbar, and MediaSession even when the source returns none.
5. **Lazy uid/name-keyed cover cache (COVER-02)** — covers resolve lazily when scrolled into view and are cached (uid first, then name key) so the same song never refetches.

Depends on Phase 16 (cover fallback wires into the player for nowbar/MediaSession). Does NOT redesign the search page UI, touch the in-flight ql0 autocomplete work's logic, or change playback semantics.

</domain>

<decisions>
## Implementation Decisions

### Search scoring (SRCH-01)
- **D-01:** **Full re-sort by score.** After dedupeBest, the search list is sorted by score descending — display order = score order. Not a stable nudge.
- **D-02:** **Re-sort on every streaming partial.** Each `onPartial` re-runs dedupe + score + sort (matches the existing dedupe-per-partial pattern). Brief reshuffle while sources settle is accepted.
- **D-03:** **試聽 clips sink to bottom — never hidden, no badge.** Heavy penalty pushes sub-60s tracks below all normal tracks; they stay reachable if they're the only result. Sources that don't report duration are NOT penalized (requirement-locked).
- **D-04:** **Penalty dominates.** The 試聽 penalty outweighs any boost combination — a sub-60s clip never ranks above a full track of the same song. Boosts only re-order among non-penalized tracks.
- **D-05:** **Artist-frequency boost = cross-source presence.** Boost artists that appear in results from 2+ different sources (real-artist signal), not raw row count (one source's cover-spam can't inflate it).
- **D-06:** **Short-title boost = query-length proximity.** Boost titles whose length is close to the query's — searching 稻香 favors 稻香 over 稻香 (翻唱版); a long title the user actually typed isn't punished.
- **D-07:** **One scoring brain — fold new signals into `scoreMatch`,** shared by the search page AND resolveStub/fallback paths. This touches the playback resolution path: the planner MUST add regression tests guarding resolveStub/tryFallback wrong-song behavior (existing score-match + fallback test suites stay green; new fixtures cover the new signals). Note: artist-frequency is a result-set-level signal — scoreMatch will need optional set-context (e.g. a precomputed artist→sources map) while staying pure/node-testable.
- **D-08:** **Synthetic test fixtures.** No specific real-world failing queries supplied; build fixtures per scoring rule (試聽 clip vs full track, cover variant vs clean title, cross-source artist vs single-source, missing-duration source neutrality).

### Cover fallback chain (SRCH-02 + COVER-01)
- **D-09:** **`resolvedCover` lives on the player store** (`player.svelte.ts`). Set from `track.cover`, else cover-cache read, else async fallback chain; NowPlaying, Nowbar, and `buildArtwork` (MediaSession) all read this one field. MediaSession metadata refreshes when the async resolve lands.
- **D-10:** **Chain order stays Deezer → iTunes → CN** (verified during discussion: Deezer `cover_xl` = 1000px via edge-cached own proxy beats iTunes 600px direct fetch). Reuse the `cover-backfill.ts` tier mechanics: https-only SOLID guard, per-tier never-throw, cache writes.
- **D-11:** **Bump the iTunes upgrade token from `600x600bb` to `1200x1200bb`** in `itunes-cover.ts upgradeArtwork` so tier-2 hits are sharp on the full-screen now-playing cover.
- **D-12:** **Placeholder while resolving / on total miss: existing seeded-gradient `fallbackCover`** on surfaces; MediaSession keeps `/favicon.svg` as final fallback (current `buildArtwork` behavior). No new placeholder asset.

### Lazy cover cache (COVER-02)
- **D-13:** **Two-layer key in the SAME localStorage store** (`openmusic:cover-cache:v1`): new `uid:`-prefixed entries (e.g. `uid:netease-12345`) coexist with matchKey name entries — mirrors the proven disjoint `artist:` prefix trick. Read uid → fall back to name key; on resolve write BOTH. No migration needed.
- **D-14:** **Reusable `lazyCover` Svelte action wired into ALL track lists this phase** — search results, library, album, artist pages. IntersectionObserver fires the fallback chain only for rows scrolled into view.
- **D-15:** **Also repair broken cover URLs,** not just empty ones — a dead/expired CDN cover URL re-resolves through the chain. PLUMBING NOTE: rows currently render covers as CSS `background-image` on a `<span>`, which fires no error event; the action needs an `<img>`-probe / `new Image()` preload check (or a render switch to `<img>`) to detect dead URLs.
- **D-16:** **No cache eviction.** Values are tiny URL strings; the existing Data-tab clear-cover-cache button is the recovery path; quota errors already degrade to no-op.

### Empty-query autofocus (SRCH-03)
- **D-17:** **Focus on every empty-state visit.** onMount: if `searchSession` has no prior search (q empty, nothing restored) → focus the input. A restored session NEVER steals focus (this is the "without breaking restoration" guard).
- **D-18:** **Accept iOS keyboard restriction.** Programmatic focus guarantees focus ring + caret; the keyboard pops where the OS allows (Android Chrome yes, iOS Safari sometimes no). No gesture-chained nav hack. Success criterion = input focused.
- **D-19:** **Autofocus shows the recent-searches list.** Focusing sets `inputFocused = true`, which already opens the D-05 recents suggestions — keep that, zero special-casing.

### Claude's Discretion
- Exact scoring weights/constants (calibrated against the D-08 fixtures, within the D-04 penalty-dominates invariant).
- New-module vs extend-in-place shape for the set-context scoring (as long as it stays pure + node-testable like `score-match.ts`).
- IntersectionObserver rootMargin/threshold, unobserve timing, and in-flight de-dupe in the `lazyCover` action; concurrency stays capped (reuse `mapWithConcurrency` CAP idiom — never unbounded fan-out).
- How broken-URL detection is implemented (Image() probe vs `<img>` onerror render switch), per-list.
- Where in `play()`/resolve flow `resolvedCover` is set/cleared and how the MediaSession refresh is sequenced.

</decisions>

<specifics>
## Specific Ideas

- "Would iTunes respond with better covers than Deezer?" — checked during discussion: Deezer `cover_xl` 1000px + edge-cached proxy vs iTunes 600px direct. Resolution: keep Deezer tier 1, bump iTunes to 1200px (D-10/D-11).
- 稻香-style example locked the short-title semantics: searching 稻香 must favor 稻香 over 稻香 (翻唱版) / DJ版 variants (D-06).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs exist for this phase. Canonical references are in-repo requirements plus the load-bearing modules this work extends.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — SRCH-01..03 (## Search), COVER-01..02 (## Covers)
- `.planning/ROADMAP.md` — Phase 21 goal, Success Criteria 1–5, Research flag (LOW: IntersectionObserver + name-key cache documented; scoring is pure logic)

### Scoring (MUST read)
- `src/lib/services/score-match.ts` — the pure scoring brain D-07 extends (similarity + variant penalty, VARIANT_KEYWORDS, weight consts); its CR-01/CR-02/WR-02 invariants must survive
- `src/lib/services/dedupe.ts` — `dedupeBest` (quality + source-rank winner pick, appearance order) that runs BEFORE the new sort; `sameSongKey` used by fallback
- `src/lib/services/match-key.ts` — artist-first normalization both scoring and cache keys reuse
- `src/lib/services/discovery.ts` — `resolveStub` (scoreMatch consumer) + `mapWithConcurrency`
- `src/lib/services/fallback.ts` — `tryFallback` (dedupeBest + sameSongKey consumer); D-07 regression-test surface

### Cover pipeline (MUST read)
- `src/lib/services/cover-backfill.ts` — the Deezer→iTunes→CN tier chain, SOLID https guard, CAP=6 pool D-10 reuses
- `src/lib/services/cover-cache.ts` — the matchKey-keyed store D-13 extends with the `uid:` layer; the `artist:` prefix precedent
- `src/lib/services/itunes-cover.ts` — `upgradeArtwork` token swap D-11 bumps to 1200x1200bb
- `src/lib/services/deezer.ts` + `src/routes/api/deezer/search/+server.ts` — tier-1 resolver (cover_xl≥big≥medium pick, edge cache, client TTL memo)
- `src/lib/services/media-session.ts` — `buildArtwork` (favicon.svg fallback) that D-09 feeds with `resolvedCover`
- `src/lib/stores/player.svelte.ts` — where `resolvedCover` lands; existing cover touchpoints: `pendingTrack.cover` (~146, 1154), MediaSession metadata writes (~1243, ~1302), `library.adoptCover` (~1280)

### Surfaces & session
- `src/routes/(app)/search/+page.svelte` — result rows (`.art` span, CSS background-image — D-15 plumbing note), per-partial dedupe path, `searchSession` restore + scroll (~300–325), `inputFocused`/recents (D-17/D-19); ql0 autocomplete code in-flight on this page — coordinate, don't clobber
- `src/lib/stores/searchSession.svelte.ts` — `hasPrior` gate for D-17
- `src/lib/components/NowPlaying.svelte`, `src/lib/components/Nowbar.svelte` — `fallbackCover` gradient helpers + cover render sites D-09/D-12 touch
- `src/routes/(app)/library/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`, `src/routes/(app)/artist/[name]/+page.svelte` — the other D-14 lazyCover wiring targets (each has its own `fallbackCover` gradient)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`cover-backfill.ts` tier machinery** — per-tier never-throw wrapper, `isSolidCover` https guard, `mapWithConcurrency` CAP=6 pool, skip-cached + de-dupe pre-pass: the lazyCover action and player resolvedCover chain are new callers, not new chains.
- **`cover-cache.ts` prefix-key precedent** — `artist:` prefix proves disjoint key families coexist in one flat record; `uid:` layer copies it.
- **`score-match.ts` weight-const + pure-function pattern** — named tuning consts, node-Vitest-tested; new signals follow it.
- **`searchSession.hasPrior`** — the exact gate D-17 needs to distinguish blank landing from restore.
- **`buildArtwork(cover)`** — already null-safe with favicon fallback; just feed it `resolvedCover`.
- **Existing per-page `fallbackCover` gradient helpers** — D-12 placeholder is already rendered everywhere.

### Established Patterns
- **Never-throw resolver posture** — every cover/network helper returns null on any failure; a miss leaves the gradient. New code must keep this.
- **https-only `<img src>` guard (T-0bb-01)** — only `https:` URLs are cached/rendered; never CSS `url()` for resolved values (note: current rows DO use style:background-image for track.cover — the lazyCover work must not introduce injection surface when touching this).
- **Race guards** — `sig.aborted || kw !== q.trim()` stale-query checks on every async commit in the search page; per-partial re-sort (D-02) must keep them.
- **Marquee + skeleton project rules** — any new row UI uses use:marquee, skeletons match loaded count/size.
- **localStorage try/catch no-op posture** — cover-cache reads/writes never throw; uid layer inherits.

### Integration Points
- **Search page `run()`/`loadMore()`/`onPartial`** — where dedupe currently runs; the score+sort step inserts there (D-01/D-02).
- **`resolveStub` + `tryFallback`** — D-07's shared-scoring blast radius; regression tests required.
- **`player.svelte.ts` resolve path** — where `resolvedCover` is set (sync from track.cover/cache, async from chain) and MediaSession metadata re-fires; `library.adoptCover` already propagates landed covers.
- **Track-row markup on 4 pages** — where the `lazyCover` action attaches (search, library, album, artist).
- **In-flight ql0 autocomplete** (uncommitted on `search/+page.svelte` + i18n dicts) — planner must sequence Phase 21 search-page edits after/around it.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 21-search-cover-pipeline-polish*
*Context gathered: 2026-06-11*
