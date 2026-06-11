# Phase 21: Search & Cover Pipeline Polish - Research

**Researched:** 2026-06-11
**Domain:** Search result scoring (pure TS), cover-resolution pipeline reuse, Svelte 5 IntersectionObserver action, player-store cover guarantee, MediaSession refresh sequencing
**Confidence:** HIGH (everything is in-repo extension; the only LOW areas — IntersectionObserver action shape + broken-URL detection — are documented and have established repo precedents)

## Summary

Phase 21 is almost entirely an **extension of existing, well-tested in-repo modules** — there is no new library, no new external dependency, and no new infrastructure. Five threads: (1) fold three new signals into the pure `scoreMatch` brain and sort the search list by score; (2) wire empty result covers through the existing `cover-backfill` chain; (3) empty-query autofocus — **already shipped** (commit `78b585d`/`f5cdab7`, lives in `search/+page.svelte` onMount lines 316-321); (4) a player-store `resolvedCover` field that guarantees artwork in NowPlaying/Nowbar/MediaSession; (5) a reusable `lazyCover` Svelte action with a uid-first/name-keyed cache.

**The single biggest finding that changes the plan:** there is **NO `duration` field anywhere** — not on the `Track` type, not in any source adapter's search response, not in any proxy reshape. The 試聽 sub-60s penalty (SRCH-01) cannot read a duration that does not exist. The current state is that **every** source is a "source that doesn't report duration," so per D-03 the penalty would never fire. To make the 試聽 penalty meaningful at all, duration must be **plumbed end-to-end** (proxy reshape → adapter `Track` → optional `Track.duration` field) for whichever upstream sources actually return it — this is real plumbing work, not a pure-logic tweak, and it is the phase's only genuinely uncertain area. The planner must decide scope here (see Open Questions Q1).

Two other findings: (a) **all four target surfaces render covers as CSS `style:background-image` on a `<span>`** (search, library, album, artist) — confirming the D-15 plumbing note: a `background-image` fires no `error` event, so broken-URL detection needs a `new Image()` probe; (b) the autofocus success criterion (SRCH-03) is **already met** — the plan should verify/harden it (and reconcile with the now-committed ql0 typeahead), not rebuild it.

**Primary recommendation:** Treat this as 5 small, independent threads. Sequence the SRCH-01 work as "plumb duration first, then score" if duration is in-scope; otherwise ship the title/artist boosts and a duration-ready-but-dormant penalty. Build `lazyCover` as a classic closure-return-destroy `Action` (the repo idiom) wrapping an `IntersectionObserver`, reusing `backfillCovers` semantics (CAP, skip-cached, never-throw). Add `resolvedCover` to the player store fed sync-from-cache / async-from-chain with a MediaSession re-fire on landing. SRCH-03 is verify-only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Search scoring (SRCH-01)**
- **D-01:** Full re-sort by score. After dedupeBest, the search list is sorted by score descending — display order = score order. Not a stable nudge.
- **D-02:** Re-sort on every streaming partial. Each `onPartial` re-runs dedupe + score + sort (matches the existing dedupe-per-partial pattern). Brief reshuffle while sources settle is accepted.
- **D-03:** 試聽 clips sink to bottom — never hidden, no badge. Heavy penalty pushes sub-60s tracks below all normal tracks; they stay reachable if they're the only result. Sources that don't report duration are NOT penalized (requirement-locked).
- **D-04:** Penalty dominates. The 試聽 penalty outweighs any boost combination — a sub-60s clip never ranks above a full track of the same song. Boosts only re-order among non-penalized tracks.
- **D-05:** Artist-frequency boost = cross-source presence. Boost artists that appear in results from 2+ different sources (real-artist signal), not raw row count (one source's cover-spam can't inflate it).
- **D-06:** Short-title boost = query-length proximity. Boost titles whose length is close to the query's — searching 稻香 favors 稻香 over 稻香 (翻唱版); a long title the user actually typed isn't punished.
- **D-07:** One scoring brain — fold new signals into `scoreMatch`, shared by the search page AND resolveStub/fallback paths. This touches the playback resolution path: the planner MUST add regression tests guarding resolveStub/tryFallback wrong-song behavior (existing score-match + fallback test suites stay green; new fixtures cover the new signals). Note: artist-frequency is a result-set-level signal — scoreMatch will need optional set-context (e.g. a precomputed artist→sources map) while staying pure/node-testable.
- **D-08:** Synthetic test fixtures. No specific real-world failing queries supplied; build fixtures per scoring rule (試聽 clip vs full track, cover variant vs clean title, cross-source artist vs single-source, missing-duration source neutrality).

**Cover fallback chain (SRCH-02 + COVER-01)**
- **D-09:** `resolvedCover` lives on the player store (`player.svelte.ts`). Set from `track.cover`, else cover-cache read, else async fallback chain; NowPlaying, Nowbar, and `buildArtwork` (MediaSession) all read this one field. MediaSession metadata refreshes when the async resolve lands.
- **D-10:** Chain order stays Deezer → iTunes → CN (verified during discussion: Deezer `cover_xl` = 1000px via edge-cached own proxy beats iTunes 600px direct fetch). Reuse the `cover-backfill.ts` tier mechanics: https-only SOLID guard, per-tier never-throw, cache writes.
- **D-11:** Bump the iTunes upgrade token from `600x600bb` to `1200x1200bb` in `itunes-cover.ts upgradeArtwork` so tier-2 hits are sharp on the full-screen now-playing cover.
- **D-12:** Placeholder while resolving / on total miss: existing seeded-gradient `fallbackCover` on surfaces; MediaSession keeps `/favicon.svg` as final fallback (current `buildArtwork` behavior). No new placeholder asset.

**Lazy cover cache (COVER-02)**
- **D-13:** Two-layer key in the SAME localStorage store (`openmusic:cover-cache:v1`): new `uid:`-prefixed entries (e.g. `uid:netease-12345`) coexist with matchKey name entries — mirrors the proven disjoint `artist:` prefix trick. Read uid → fall back to name key; on resolve write BOTH. No migration needed.
- **D-14:** Reusable `lazyCover` Svelte action wired into ALL track lists this phase — search results, library, album, artist pages. IntersectionObserver fires the fallback chain only for rows scrolled into view.
- **D-15:** Also repair broken cover URLs, not just empty ones — a dead/expired CDN cover URL re-resolves through the chain. PLUMBING NOTE: rows currently render covers as CSS `background-image` on a `<span>`, which fires no error event; the action needs an `<img>`-probe / `new Image()` preload check (or a render switch to `<img>`) to detect dead URLs.
- **D-16:** No cache eviction. Values are tiny URL strings; the existing Data-tab clear-cover-cache button is the recovery path; quota errors already degrade to no-op.

**Empty-query autofocus (SRCH-03)**
- **D-17:** Focus on every empty-state visit. onMount: if `searchSession` has no prior search (q empty, nothing restored) → focus the input. A restored session NEVER steals focus (the "without breaking restoration" guard).
- **D-18:** Accept iOS keyboard restriction. Programmatic focus guarantees focus ring + caret; the keyboard pops where the OS allows. No gesture-chained nav hack. Success criterion = input focused.
- **D-19:** Autofocus shows the recent-searches list. Focusing sets `inputFocused = true`, which already opens the recents suggestions — keep that, zero special-casing.

### Claude's Discretion
- Exact scoring weights/constants (calibrated against the D-08 fixtures, within the D-04 penalty-dominates invariant).
- New-module vs extend-in-place shape for the set-context scoring (as long as it stays pure + node-testable like `score-match.ts`).
- IntersectionObserver rootMargin/threshold, unobserve timing, and in-flight de-dupe in the `lazyCover` action; concurrency stays capped (reuse `mapWithConcurrency` CAP idiom — never unbounded fan-out).
- How broken-URL detection is implemented (Image() probe vs `<img>` onerror render switch), per-list.
- Where in `play()`/resolve flow `resolvedCover` is set/cleared and how the MediaSession refresh is sequenced.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-01 | Result scoring boosts shorter titles + cross-result artists, heavily penalizes sub-60s 試聽 clips, no false penalty for sources without duration | `scoreMatch` (`score-match.ts`) is the pure brain to extend (D-07). **BLOCKER:** no `duration` field exists anywhere (see Runtime/Plumbing Inventory) — the 試聽 penalty requires plumbing duration end-to-end first. Title/artist boosts are pure-logic additions. Set-context (artist→sources map) computed once per result set, passed into a new optional `scoreMatch` arg. |
| SRCH-02 | Search results with empty covers resolve via the cover fallback chain | `backfillCovers` (`cover-backfill.ts`) already does Deezer→iTunes→CN with CAP/skip-cached/never-throw. The `lazyCover` action (D-14) is the new caller; search rows render `.art` as `style:background-image` (line 481). |
| SRCH-03 | Empty-query → input auto-focused, without breaking cross-nav restoration | **ALREADY IMPLEMENTED** — `search/+page.svelte` onMount lines 316-321 focus `queryInputEl` only when `!q.trim()` AFTER the `searchSession.hasPrior` restore. Verify-and-harden only; reconcile with committed ql0 typeahead + recents (D-19). |
| COVER-01 | Playing track's cover always renders in NowPlaying, Nowbar, MediaSession even with no source cover | New `resolvedCover` field on `player.svelte.ts` (D-09). NowPlaying line 84-86 / Nowbar line 84-86 read `np.cover` today; `buildArtwork(track.cover)` (media-session.ts) feeds MediaSession at player.svelte.ts ~1296/1355. All three repointed at `resolvedCover`. |
| COVER-02 | Covers resolve lazily on scroll + cached uid-first then name-key, never refetch | `lazyCover` action + `cover-cache.ts` two-layer key (D-13). `coverCacheKey` (matchKey) + new `uid:`-prefixed entry mirror the proven `artist:` prefix (cover-cache.ts lines 38-40). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Result scoring (boost/penalty) | Pure service (`score-match.ts`) | — | Must stay node-Vitest-testable; no I/O, no runes (existing invariant) |
| Set-context (artist→sources map) | Pure service | Search page (`+page.svelte`) computes + passes it | Result-set-level signal; page owns the result set, service stays pure |
| Search result sort | Search page browser handler (`run`/`loadMore`/`onPartial`) | — | Page owns the live result set + race guards; sort slots into the existing dedupe step |
| Cover resolution chain | Pure service (`cover-backfill.ts`) | Deezer proxy (`/api/deezer/*`), iTunes direct | Never-throw, capped, edge-cached; new callers only |
| Lazy cover trigger | Client action (`lazyCover` use: directive) | IntersectionObserver (browser API) | Per-row viewport detection is a DOM concern; the action is the reusable seam |
| Cover cache (uid + name) | Pure service (`cover-cache.ts`) + localStorage | — | Already the matchKey store; D-13 adds a disjoint uid key family |
| `resolvedCover` guarantee | Player store (`player.svelte.ts`) | media-session.ts `buildArtwork` (pure) | Store owns playback state + the single field all 3 surfaces read |
| MediaSession metadata refresh | Player store (browser-guarded `ms`) | media-session.ts (pure builders) | Store wraps the DOM MediaSession API behind its SSR/feature guard |
| Empty-query autofocus | Search page onMount | `searchSession.hasPrior` (store) | Already shipped; page-local DOM focus gated on the session store |

## Standard Stack

### Core
No new packages. Everything is in-repo + browser-native.

| Module/API | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| `IntersectionObserver` | Browser-native | Lazy cover-in-view trigger | Already used in `search/+page.svelte` (infinite-scroll sentinel, lines 335-347) — exact precedent to copy |
| `new Image()` probe | Browser-native | Broken-URL detection (D-15) | Already used in `player.svelte.ts preloadNextCover` (line 1156) and `NowPlaying.svelte` cover-adopt preload — established repo idiom |
| Svelte 5 `Action` type | `svelte` 5.56.2 | `lazyCover` use: directive | All repo actions (longpress, coverSwipe, dragScroll, swipeRemove) use the same `Action<Node, Param, Events>` closure-return-destroy shape |
| Vitest | `^4.1.3` | Pure-logic + action tests | `score-match.test.ts`, `cover-cache.test.ts`, `longpress.test.ts` already pass under the node project |

### Supporting (existing modules being extended/reused)
| Module | Purpose | Phase 21 role |
|--------|---------|---------------|
| `score-match.ts` | Pure variant-penalty + similarity scorer | Extend with 3 new signals (D-07) — keep CR-01/CR-02/WR-02 invariants |
| `cover-backfill.ts` | Deezer→iTunes→CN tier chain, CAP=6 pool, never-throw | `lazyCover` + `resolvedCover` are NEW CALLERS; reuse `isSolidCover`, the tier wrapper, `mapWithConcurrency` |
| `cover-cache.ts` | Flat localStorage Record, matchKey + `artist:` prefix | Add `uid:` prefix key family (D-13) |
| `itunes-cover.ts` | iTunes search cover, `upgradeArtwork` 100→600 token | Bump token to 1200x1200bb (D-11) |
| `media-session.ts` | Pure `buildArtwork` artwork ladder | No change to signature; player feeds it `resolvedCover` instead of `track.cover` |
| `discovery.ts` `mapWithConcurrency` | Order-preserving capped async pool | Reuse for any per-batch lazy resolve fan-out (never unbounded) |
| `deezer.ts` `deezerSongCover` | Tier-1 cover resolver, 7d TTL memo | Reused as-is inside backfill |
| `searchSession.svelte.ts` `hasPrior` | Restore-vs-fresh gate | Already drives the SRCH-03 autofocus guard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `new Image()` probe for broken URL | Switch `.art` `<span>` → `<img onerror>` | `<img>` gives a native error event but is a markup change on 4 pages + restyle of `.art`; the `Image()` probe is a smaller blast radius and matches the existing preload idiom. **Recommend `Image()` probe.** D-15 leaves it to discretion per-list. |
| Extend `scoreMatch` in place | New `score-context.ts` module wrapping it | In-place keeps "one brain" literal (D-07); a wrapper keeps the existing signature pristine for resolveStub. **Recommend optional 3rd arg on `scoreMatch`** (a `SetContext` object) — additive, existing 2-arg callers unaffected, stays pure. |
| Classic `Action` closure | Svelte 5.29+ `@attach` / `$effect` action | Svelte docs now nudge `@attach`, but EVERY existing repo action uses the classic closure-return-destroy shape. **Recommend classic closure** for consistency + node-testability (the test files mount actions manually). |

**Installation:** None. No `npm install`.

## Package Legitimacy Audit

> Not applicable — Phase 21 installs **zero** external packages. All work extends in-repo TypeScript modules and uses browser-native APIs (`IntersectionObserver`, `Image`). slopcheck/registry verification is moot.

## Architecture Patterns

### System Architecture Diagram

```text
                          SEARCH-01 (scoring)                         COVER pipeline (SRCH-02 / COVER-01/02)
                          ───────────────────                         ──────────────────────────────────────

  user query                                                   row scrolled into view
      │                                                                │
      ▼                                                                ▼
  searchAll (catalog) ──onPartial──┐                          use:lazyCover action
      │                            │                                   │  (IntersectionObserver, root:null)
      ▼                            ▼                                   ▼
  dedupeBest  ───────────►  [NEW] computeSetContext             cover present + loads OK? ──yes──► done (no fetch)
  (collapse dupes)          (artist→Set<source>)                       │ no / empty / broken (Image() probe, D-15)
      │                            │                                   ▼
      ▼                            ▼                            cover-cache read:  uid: key → name key (D-13)
  [NEW] sort by                                                        │ hit                    │ miss
  scoreMatch(q, cand, ctx) ◄───────┘                                   ▼                         ▼
      │   (D-01/D-02 every partial)                              paint cached cover       backfillCovers chain
      │   penalty dominates (D-04)                                                         Deezer → iTunes(1200) → CN
      ▼                                                                                          │ SOLID https
  results[] → render (.art background-image)                                                     ▼
                                                                                          write BOTH keys (uid+name)
                                                                                          onResolved → reactive repaint

  COVER-01 (playing track):  play()/resolve ──► resolvedCover = track.cover ?? cacheRead ?? (async) chain
                                                       │
                                                       ├─► NowPlaying .cover  (reads resolvedCover)
                                                       ├─► Nowbar .np-art      (reads resolvedCover)
                                                       └─► buildArtwork(resolvedCover) → ms.metadata  (re-fire on async land, D-09)
```

### Recommended Module Layout

```
src/lib/
├── services/
│   ├── score-match.ts        # EXTEND — add optional SetContext 3rd arg + 3 new signals
│   ├── score-context.ts      # OPTIONAL NEW — pure computeSetContext(results) → artist→Set<source>
│   ├── cover-cache.ts        # EXTEND — add uidCoverCacheKey / get/set by uid (D-13)
│   ├── cover-backfill.ts     # REUSE — new callers only; possibly export a single-item resolve helper
│   └── itunes-cover.ts       # EDIT — upgradeArtwork token 600→1200 (D-11)
├── actions/
│   └── lazyCover.ts          # NEW — Action<HTMLElement, LazyCoverParam> wrapping IntersectionObserver
├── stores/
│   └── player.svelte.ts      # EXTEND — resolvedCover field + set/clear in play()/playStub + ms re-fire
└── routes/(app)/
    ├── search/+page.svelte   # EDIT — sort step in run/loadMore/onPartial; use:lazyCover on rows
    ├── library/+page.svelte  # EDIT — use:lazyCover on the 4 list render sites
    ├── album/[name]/+page.svelte   # EDIT — use:lazyCover
    └── artist/[name]/+page.svelte  # EDIT — use:lazyCover
```

### Pattern 1: Optional set-context arg on the pure scorer (D-07)
**What:** Keep `scoreMatch(query, candidate)` working for the 2-arg resolveStub/fallback callers; add an optional 3rd `ctx` arg carrying the precomputed result-set signals.
**When to use:** Search-page sort passes `ctx`; resolveStub/tryFallback call without it (unchanged).
**Example:**
```typescript
// Source: extends src/lib/services/score-match.ts (existing pure module)
export interface SetContext {
  /** artist matchKey → set of distinct source ids that returned that artist (D-05). */
  artistSources: Map<string, Set<SourceId>>;
  /** the user's query text length, for short-title proximity (D-06). */
  queryLen: number;
}

export function scoreMatch(
  query: { artist: string; title: string },
  candidate: Track,
  ctx?: SetContext            // ← additive; existing callers unaffected
): number {
  let s = similarity(query, candidate) - variantPenalty(query, candidate);
  // D-04: penalty DOMINATES — apply it last as a large flat subtraction so no boost
  // combination can lift a sub-60s clip above a full track. Only fires when duration
  // is known AND < ~60 (D-03: unknown duration is NEVER penalized).
  if (typeof candidate.duration === 'number' && candidate.duration > 0 && candidate.duration < SHORT_CLIP_SEC) {
    s -= PREVIEW_PENALTY;        // PREVIEW_PENALTY > max(all boosts + SIM_EXACT)
  }
  if (ctx) {
    s += shortTitleBoost(query, candidate, ctx.queryLen);          // D-06
    s += artistFrequencyBoost(candidate, ctx.artistSources);       // D-05 (2+ sources)
  }
  return s;
}
```
**Invariant note:** `PREVIEW_PENALTY` must be a constant strictly larger than `SIM_EXACT (10) + maxShortTitleBoost + maxArtistBoost` so D-04 holds for any boost combination. Add a fixture asserting it.

### Pattern 2: Sort slots into the existing dedupe step (D-01/D-02)
**What:** After every `dedupeBest(...)` in `run()`/`loadMore()`/`onPartial`, compute set-context once and `.sort()` by score descending.
**Where:** `search/+page.svelte` lines 222, 225, 275 (the three dedupe call sites). Race guards (`myAc.signal.aborted || kw !== q.trim()`) already wrap these — keep them.
**Example:**
```typescript
// Source: src/routes/(app)/search/+page.svelte run() onPartial (line ~222)
function rankList(rows: Track[], query: string): Track[] {
  const ctx = computeSetContext(rows, query);           // pure, once per settle
  // Stable sort: scoreMatch is deterministic; ties keep dedupeBest's appearance order.
  return [...rows].sort((a, b) => scoreMatch({ artist: query, title: query }, b, ctx)
                                 - scoreMatch({ artist: query, title: query }, a, ctx));
}
// onPartial:
results = rankList(dedupeBest(partial.interleaved, settings.preferredSource), kw);
```
**Note:** the search query is a free-text string, NOT a parsed {artist,title}. `scoreMatch`'s similarity term keys off `matchKey(query.artist, query.title)` — for search you pass the raw keyword into both, or split heuristically. Title/artist-boost + 試聽 penalty are the dominant signals here; the similarity term degrades gracefully (it just won't exact-match). The planner should confirm the query→{artist,title} mapping for the search path (Open Question Q2).

### Pattern 3: `lazyCover` action over IntersectionObserver (classic closure idiom)
**What:** A reusable `use:lazyCover={{ track, onResolved }}` action that observes the row, and on first intersection resolves a cover (cache → chain) if the track has no/broken cover. Unobserve after first fire; de-dupe in-flight.
**Example:**
```typescript
// Source: src/lib/actions/lazyCover.ts (NEW) — mirrors longpress.ts / the search sentinel IO
import type { Action } from 'svelte/action';

export interface LazyCoverParam {
  track: Track;
  onResolved: (uid: string, url: string) => void;   // page bumps a reactive map → repaint
}

export const lazyCover: Action<HTMLElement, LazyCoverParam> = (node, param) => {
  let done = false;
  const io = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting || done) return;
    done = true;
    io.unobserve(node);                    // resolve once per row
    void resolveCoverForRow(param!.track, param!.onResolved);   // never-throw; CAP-respecting
  }, { root: null, rootMargin: '200px 0px' });   // prefetch slightly early (discretion)
  io.observe(node);
  return { destroy() { io.disconnect(); } };
};
```
**Broken-URL detection (D-15):** inside `resolveCoverForRow`, if `track.cover` is non-empty, probe it with `new Image()` (`onload` → keep, `onerror` → treat as empty and run the chain). This matches `preloadNextCover` (player.svelte.ts:1156). The repo's existing `Image()` preload is the precedent — no new dependency.
**Concurrency:** if a page wants to fan out a batch, route through `mapWithConcurrency(rows, CAP, ...)` — never `Promise.all` over every visible row (Pitfall 11). A per-row action firing one resolve each, capped by the small viewport window, is naturally bounded; an explicit in-flight `Set<uid>` de-dupe prevents two observers racing the same song.

### Pattern 4: `resolvedCover` on the player store (D-09)
**What:** A single `resolvedCover = $state<string | null>(null)` field. Set synchronously in `play()`/`playStub` from `track.cover ?? getCachedCover(...) ?? getCachedCoverByUid(...)`, then kick the async chain; on landing, write the field AND re-fire `ms.metadata`.
**Where:** `play()` already builds `ms.metadata` at lines 1292-1298 (offline path) and 1351-1357 (network path), and calls `library.adoptCover(resolved)` (line 1333). The async-land re-fire mirrors the existing `dedupeBestWithDeezer` post-paint swap pattern in the search page.
**Sequencing (discretion D-09):**
1. On `play()` entry: `this.resolvedCover = track.cover ?? coverCacheRead(track) ?? null` (sync, instant).
2. Build `ms.metadata` with `buildArtwork(this.resolvedCover)` (replaces `buildArtwork(track.cover)` / `buildArtwork(resolved.cover)`).
3. If `resolvedCover` is still null, fire the chain guarded by the play-generation (`myGen === this.playGen`); on a SOLID result set `this.resolvedCover = url`, call `library.adoptCover`, and re-assign `ms.metadata` (a fresh `MediaMetadata` — the OS only repaints on a new metadata object, not field mutation).
4. NowPlaying/Nowbar repoint `np?.cover` reads → `player.resolvedCover` (with their own gradient fallback for D-12).

### Anti-Patterns to Avoid
- **Penalizing unknown duration:** D-03 is requirement-locked. Only subtract `PREVIEW_PENALTY` when `duration` is a finite number `> 0` AND `< ~60`. `undefined`/`null`/`0` = "unknown" = no penalty.
- **Boost that can beat the penalty:** D-04 — keep `PREVIEW_PENALTY` strictly greater than the maximum total boost + similarity. Assert with a fixture.
- **Raw row-count artist boost:** D-05 — count DISTINCT sources, not rows. One source spamming covers must not inflate.
- **CSS `url()` for resolved covers:** the security guard (T-0bb-01) is `<img src>`-only for *resolved* values; current rows use `style:background-image` for the *source* `track.cover`. Keep resolved covers https-only (`isSolidCover`) and never widen the injection surface. The `lazyCover` resolve writes only SOLID https URLs to cache.
- **Unbounded fan-out:** never `Promise.all` over the whole list — reuse `mapWithConcurrency`/CAP.
- **Mutating `ms.metadata` fields in place:** assign a NEW `MediaMetadata` to trigger the OS repaint.
- **Re-grabbing focus on `q` clear:** SRCH-03 focus lives in onMount, NOT a `$effect` keyed on `q` — clearing the input mid-session must NOT re-steal focus (already done correctly; preserve it).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cover tier chain | A new Deezer/iTunes/CN resolver | `backfillCovers` / its tier wrapper | Already has https guard, per-tier never-throw, CAP=6, skip-cached, edge-cache (cover-backfill.ts) |
| Concurrency cap | Manual semaphore / Promise.all batching | `mapWithConcurrency` (discovery.ts) | Order-preserving, never-throws, the repo CAP idiom |
| Cover cache | A new localStorage store | `cover-cache.ts` + a `uid:` prefix | Disjoint-prefix coexistence already proven by `artist:` |
| MediaSession artwork ladder | A new artwork array builder | `buildArtwork` (media-session.ts) | Pure, node-tested, favicon fallback for D-12 |
| Broken-image detection | A fetch HEAD probe | `new Image()` onload/onerror | No CORS/cost; matches `preloadNextCover` precedent; HEAD often blocked on CDN covers |
| Restore-vs-fresh gate | A new "first visit" flag | `searchSession.hasPrior` | Exactly the SRCH-03 D-17 gate; already wired |
| Identity normalization | A new key function | `matchKey` (artist-first) | Single source of truth for cache + scoring keys |

**Key insight:** Phase 21's entire cover half is "add new callers to a mature chain," and its scoring half is "add signals to a mature pure function." The risk is NOT building the wrong thing — it's (a) the missing `duration` plumbing and (b) keeping the D-04 penalty-dominance + D-03 unknown-neutrality invariants provable.

## Runtime / Plumbing State Inventory

> This is a polish/extension phase, not a rename. The relevant "hidden state" is **missing data plumbing** that the success criteria assume exists.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Missing data field (BLOCKER for SRCH-01)** | `Track.duration` does NOT exist (`src/lib/sources/types.ts` — no duration field). No source adapter (`netease.ts`, `qq.ts`, `kuwo.ts`, `joox.ts`, `jamendo.ts`, `fivesing.ts`) maps a duration. No proxy reshape (`src/lib/proxy/*.ts`) carries one. | To make the 試聽 penalty fire: add optional `duration?: number` (seconds) to `Track`; plumb it from each upstream source that reports it (proxy reshape → adapter search/resolve). **Decide scope** (Q1). Without this, D-03 means the penalty is permanently dormant. |
| **Cover render mechanism (D-15 confirm)** | All 4 surfaces render `.art`/`.np-art`/`.cover` as `style:background-image={t.cover ? url(...) : fallbackCover}` — search:481, library:161/186/203/234, album:503, artist:378, NowPlaying:84, Nowbar:84. A `background-image` fires NO error event. | Broken-URL detection needs `new Image()` probe (or per-list `<img onerror>` switch). Confirmed plumbing note D-15. |
| **Stored cover cache (COVER-02)** | `openmusic:cover-cache:v1` flat Record, keys = `matchKey(artist,title)` + `artist:`-prefixed. No `uid:` keys yet. | Add `uid:`-prefix get/set (D-13); read uid→name; write BOTH on resolve. No migration (additive disjoint family). |
| **Player store field (COVER-01)** | No `resolvedCover` field on `player.svelte.ts`. Surfaces read `player.current.cover` / `np.cover` directly; `buildArtwork(track.cover)`/`buildArtwork(resolved.cover)` feed MediaSession. `library.adoptCover` already propagates landed covers (library.svelte.ts:87). | Add `resolvedCover = $state<string|null>`; repoint NowPlaying/Nowbar/buildArtwork; set/clear in play()/playStub; re-fire ms.metadata on async land. |
| **SRCH-03 autofocus** | ALREADY SHIPPED — `search/+page.svelte` onMount lines 316-321 (commits `78b585d`, `f5cdab7`). Gated on `!q.trim()` after the `hasPrior` restore. | Verify-and-harden + write a regression check; do NOT rebuild. Reconcile with the committed ql0 typeahead block + recents (D-19). |
| **ql0 typeahead (sequencing note from CONTEXT)** | The "uncommitted ql0 work" referenced in CONTEXT is **already committed** (`40e08c4 feat(ql0-02)`, present in `search/+page.svelte` lines 72-111, 403-432). `git status` shows ONLY `.planning/HANDOFF.json` modified. | No live uncommitted conflict. The sequencing concern is resolved — Phase 21 search-page edits build ON the committed ql0 code, not around in-flight work. |

**Nothing found in category — Live service config / OS-registered state / Secrets:** None — this is a client-side polish phase. No external service config, OS registration, or secret references are touched (verified: no env var, no proxy registry, no scheduler change in scope).

## Common Pitfalls

### Pitfall 1: The 試聽 penalty silently never fires
**What goes wrong:** SRCH-01 ships, tests pass on synthetic fixtures, but in production NO real sub-60s clip is ever de-ranked.
**Why it happens:** No source actually sets `Track.duration`, so the `typeof duration === 'number'` guard (correctly) skips every real track per D-03.
**How to avoid:** Plumb duration for at least one real source before declaring SRCH-01 done; add a fixture that proves a known-duration clip sinks AND a manual check against a real query that returns 試聽 clips. If duration plumbing is descoped, document the penalty as dormant-by-design.
**Warning signs:** All fixtures use hand-set `duration`; no adapter test sets it.

### Pitfall 2: Boost beats penalty (D-04 violation)
**What goes wrong:** A 試聽 clip of an exact-match, multi-source, short-title song scores above a full track.
**Why it happens:** `PREVIEW_PENALTY` set too small relative to `SIM_EXACT + boosts`.
**How to avoid:** Make `PREVIEW_PENALTY` a derived/asserted constant > `SIM_EXACT + maxBoostSum`. Add a fixture: "penalized clip with every boost < clean track with no boost."
**Warning signs:** Penalty and boost magnitudes are independently chosen with no invariant test.

### Pitfall 3: Per-partial re-sort drops race guards (D-02)
**What goes wrong:** A superseded query's partial re-sorts and clobbers the newer query's results.
**Why it happens:** Inserting the sort step but forgetting the existing `myAc.signal.aborted || kw !== q.trim()` guard around the dedupe→sort assignment.
**How to avoid:** Keep the sort INSIDE the guarded block (lines 221-223 pattern). The sort is pure + cheap, so re-running it per partial is fine.

### Pitfall 4: MediaSession doesn't repaint on async cover land
**What goes wrong:** `resolvedCover` updates, NowPlaying shows art, but the OS lock-screen still shows the favicon/old art.
**Why it happens:** Mutating `ms.metadata.artwork` in place — the OS only re-reads on a NEW `MediaMetadata` assignment.
**How to avoid:** On async land, assign `ms.metadata = new MediaMetadata({ ..., artwork: buildArtwork(resolvedCover) })`, generation-guarded (`myGen === playGen`) so a superseded resolve can't paint stale art.

### Pitfall 5: lazyCover re-fetches / fans out unbounded
**What goes wrong:** Fast scrolling fires the chain for every row; or scrolling a row back into view re-resolves.
**Why it happens:** No unobserve-after-first-fire, no in-flight de-dupe, no CAP.
**How to avoid:** `io.unobserve(node)` on first intersection; an in-flight `Set<uid>` guard; cache-first read (uid→name) before any network; respect the chain's CAP.

### Pitfall 6: Search scroll restore broken by the sort
**What goes wrong:** A restored session re-sorts differently and the scroll offset lands on the wrong row.
**Why it happens:** Re-sorting restored `searchSession.results` on mount with a freshly-computed context that differs from when it was saved.
**How to avoid:** Persist the ALREADY-SORTED list to `searchSession` (sort before `persistSession()`), and on restore use the stored order as-is (don't re-sort). The restore path (lines 305-315) assigns `results = searchSession.results` directly — keep it order-preserving.

### Pitfall 7: uid cache key shape mismatch (D-13)
**What goes wrong:** Write `uid:netease-12345` but read with `uid:netease:12345` (colon) — never hits.
**Why it happens:** `makeUid` emits COLON form (`netease:123`), but CONTEXT D-13's example shows a HYPHEN (`uid:netease-12345`). The real uids are colon-delimited.
**How to avoid:** Build the key as `'uid:' + track.uid` directly (whatever delimiter `makeUid` produced), one helper, used for both get and set. Mirror `artistCoverCacheKey`'s single-helper discipline. Add a round-trip test.

## Code Examples

### Two-layer cover-cache key (D-13)
```typescript
// Source: extends src/lib/services/cover-cache.ts (mirrors artistCoverCacheKey, lines 38-40)
/** uid cover key — disjoint from matchKey + 'artist:' families (uids contain a ':' but never lead with 'uid:'). */
export function uidCoverCacheKey(uid: string): string {
  return 'uid:' + uid;            // e.g. 'uid:netease:12345678'
}
export function getCachedCoverByUid(uid: string): string | null {
  return readKey(uidCoverCacheKey(uid));
}
export function setCachedCoverByUid(uid: string, url: string): void {
  writeKey(uidCoverCacheKey(uid), url);
}
// Read order (caller): getCachedCoverByUid(uid) ?? getCachedCover(artist, title)
// Write on resolve: BOTH setCachedCoverByUid(uid,url) AND setCachedCover(artist,title,url)
```

### Distinct-source artist-frequency map (D-05)
```typescript
// Source: src/lib/services/score-context.ts (NEW, pure)
import { matchKey } from '$lib/services/match-key';
import type { SourceId, Track } from '$lib/sources/types';

export function computeSetContext(rows: Track[], query: string): SetContext {
  const artistSources = new Map<string, Set<SourceId>>();
  for (const r of rows) {
    const k = matchKey(r.artist, '');           // artist-only key
    (artistSources.get(k) ?? artistSources.set(k, new Set()).get(k)!).add(r.source);
  }
  return { artistSources, queryLen: query.trim().length };
}
// boost only when set.size >= 2 (cross-source presence, NOT raw count)
```

### iTunes token bump (D-11)
```typescript
// Source: src/lib/services/itunes-cover.ts upgradeArtwork (line 66) — one-token change
return clean.includes('100x100bb') ? clean.replace('100x100bb', '1200x1200bb') : clean;
// NOTE: existing itunes-cover.test.ts asserts '600x600bb' — that test MUST be updated to 1200x1200bb.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| iTunes 600x600bb tile | 1200x1200bb (D-11) | This phase | Sharp full-screen now-playing cover; update itunes-cover.test.ts |
| Cover keyed by name only | uid-first then name (D-13) | This phase | No cross-song collision; uid is exact, name is the fallback |
| Surface reads `track.cover` | Player `resolvedCover` (D-09) | This phase | One field, three surfaces, MediaSession included |
| Svelte action `@attach` (docs nudge 5.29+) | Classic `Action` closure (repo idiom) | n/a | Stay consistent with all existing repo actions; node-testable |

**Deprecated/outdated:**
- CLAUDE.md "Technology Stack" section describes the LEGACY `index.html` single-file desktop app (vanilla JS, no build, no framework). The actual phase-21 codebase is the **SvelteKit rewrite** (`src/`, Svelte 5.56, Vite 8, Vitest 4, Cloudflare adapter). Treat the CLAUDE.md stack section as historical context for the data-layer extraction only; the live conventions are the patterns in `src/lib/`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No upstream source currently returns a usable duration through the existing proxies | Runtime Inventory / Pitfall 1 | If a source DOES return duration in a field I didn't spot, the plumbing is smaller than estimated. Verified absence in adapter interfaces + proxy reshapes; not verified against live upstream payloads. |
| A2 | The OS MediaSession only repaints artwork on a new `MediaMetadata` object, not field mutation | Pitfall 4 / Pattern 4 | If field mutation worked, the re-fire is simpler. The new-object approach is the safe superset (always works) — low risk. |
| A3 | `new Image()` onerror reliably detects an expired CDN cover cross-origin | Pattern 3 / D-15 | Some CDNs return a 200 + placeholder image (no error). For those, broken detection silently misses — gradient stays. Acceptable degrade; matches existing preload posture. |
| A4 | The search free-text query maps acceptably onto `scoreMatch`'s {artist,title} similarity term | Pattern 2 / Q2 | scoreMatch was built for Last.fm {artist,title} stubs; a raw search keyword has no artist/title split. The title/artist BOOSTS + penalty still work; only the similarity reward degrades. Planner should confirm the mapping. |

## Open Questions

1. **How much of the `duration` pipeline is in scope for SRCH-01?**
   - What we know: No `Track.duration` exists; no source/proxy carries it. D-03 says unknown-duration sources are never penalized — so today the penalty is a no-op.
   - What's unclear: Whether the phase plumbs duration for the sources that report it (real work: proxy reshape + adapter + type field per source), OR ships the penalty logic dormant + the title/artist boosts now.
   - Recommendation: Plumb duration for at least the source(s) where it's cheapest upstream (QQ's `interval`, Netease/Kuwo song detail) so the 試聽 success criterion is demonstrable; otherwise the criterion can't be verified. Flag to the user via discuss if descoping. **This is the phase's main sizing decision.**

2. **What {artist,title} does the search path feed `scoreMatch`?**
   - What we know: `scoreMatch` similarity keys off `matchKey(query.artist, query.title)`. Search has a single free-text keyword, not a split.
   - What's unclear: Pass keyword into both fields? Split on a heuristic? Or rely only on boosts+penalty for search and keep similarity for resolveStub?
   - Recommendation: Pass the raw keyword as both `artist` and `title` (similarity degrades to token-overlap, which is still useful), and lean on the new short-title/artist-frequency boosts + 試聽 penalty for the search-list ordering. Confirm in planning.

3. **`<img>` switch vs `Image()` probe — uniform or per-list (D-15 discretion)?**
   - Recommendation: `Image()` probe uniformly (smaller blast radius, matches `preloadNextCover`), unless a surface already uses `<img>`. None do today — all use `style:background-image`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (nvm) | vitest / svelte-check / build | ✓ | v22.22.0 | — (shell default v16 breaks tooling — prefix PATH) |
| pnpm | install / scripts | ✓ | 8.15.5 | — |
| Vitest | run pure + action tests | ✓ | ^4.1.3 | — |
| Svelte | actions / runes | ✓ | 5.56.2 | — |
| `IntersectionObserver` | lazyCover | ✓ (browser-native; already used in search sentinel) | — | — |
| Deezer/iTunes proxies | cover chain | ✓ (existing `/api/deezer/*`, itunes direct) | — | CN-source tier 3 + gradient |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None new — the cover chain already degrades to gradient on total miss.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.3` (node project; transforms `$state` runes for `*.svelte.test.ts`) |
| Config file | `vite.config.ts` (`test.projects[0]`, `environment: 'node'`, include `src/**/*.{test,spec}.{js,ts}`) |
| Quick run command | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm test -- score-match cover-cache` (target files) |
| Full suite command | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm test` (vitest --run) |
| Type check | `export PATH="..."; pnpm check` (svelte-check) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | 試聽 sub-60s clip sinks below full track; boost can't beat penalty (D-04) | unit | `pnpm test -- score-match` | ✅ extend `score-match.test.ts` |
| SRCH-01 | Unknown-duration source NOT penalized (D-03) | unit | `pnpm test -- score-match` | ✅ extend |
| SRCH-01 | Cross-source artist boost (2+ distinct sources, not row count, D-05) | unit | `pnpm test -- score-context` | ❌ Wave 0 (new `score-context.test.ts`) |
| SRCH-01 | Short-title query-proximity boost (D-06) | unit | `pnpm test -- score-match` | ✅ extend |
| SRCH-01 | resolveStub/tryFallback wrong-song behavior unchanged (D-07 regression) | unit | `pnpm test -- discovery fallback` | ✅ `discovery.test.ts` / `fallback.test.ts` — must stay green |
| SRCH-02 | Empty cover → resolved via chain | unit + manual | `pnpm test -- cover-backfill` | ✅ extend (chain already tested); manual scroll check |
| SRCH-03 | Empty query focuses input; restored session does NOT | manual | onMount focus — no automated DOM harness | manual (jsdom-less project) |
| COVER-01 | resolvedCover feeds NowPlaying/Nowbar/MediaSession; favicon final fallback | unit (buildArtwork) + manual | `pnpm test -- media-session player` | ✅ extend `player.svelte.test.ts` for resolvedCover set/clear |
| COVER-02 | uid-first then name cache; write both; never refetch | unit | `pnpm test -- cover-cache` | ✅ extend `cover-cache.test.ts` |
| COVER-02 | lazyCover unobserve-once + in-flight de-dupe | unit (action) | `pnpm test -- lazyCover` | ❌ Wave 0 (new `lazyCover.test.ts`, mirror `longpress.test.ts` manual-mount) |

### Sampling Rate
- **Per task commit:** targeted `pnpm test -- <module>` for the touched module + `pnpm check`.
- **Per wave merge:** full `pnpm test` (all suites green — especially the D-07 regression set: score-match, discovery, fallback).
- **Phase gate:** full suite green + manual checks (SRCH-03 focus on a fresh vs restored visit; SRCH-02 scroll-reveal; COVER-01 lock-screen art on a no-cover source) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/services/score-context.test.ts` — covers SRCH-01 D-05 (distinct-source map)
- [ ] `src/lib/actions/lazyCover.test.ts` — covers COVER-02 action lifecycle (mirror `longpress.test.ts` IO-mock pattern)
- [ ] Extend `score-match.test.ts` — 試聽 penalty (D-03/D-04), short-title boost (D-06), penalty-dominance invariant
- [ ] Extend `cover-cache.test.ts` — uid key round-trip + uid→name read fallback (D-13)
- [ ] Extend `player.svelte.test.ts` — resolvedCover set-from-cover/cache/null + clear on play
- [ ] Update `itunes-cover.test.ts` — 600x600bb → 1200x1200bb assertion (D-11)
- [ ] Framework install: none — vitest/svelte already present

## Security Domain

> `security_enforcement` is not set to `false` in config (absent = enabled). This is a client-side polish phase with no auth/session/crypto surface; the relevant control is the existing cover-URL injection guard.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth in scope) |
| V3 Session Management | no | — (in-memory searchSession only, no credentials) |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Resolved cover URLs gated `https:`-only via `isSolidCover` (cover-backfill.ts:90); rendered as `<img src>` attribute, never CSS `url()`, for resolved values (T-0bb-01). Search query already `encodeURIComponent`'d at proxy boundaries. |
| V6 Cryptography | no | — (no secrets touched; no new env var) |

### Known Threat Patterns for {SvelteKit client / cover pipeline}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious cover URL injected into CSS `url()` | Tampering / XSS | Resolved covers https-only + `<img src>` attribute only (existing guard); never widen to `url()` for resolved values. Note: source `track.cover` already renders via `style:background-image` — Phase 21 must NOT route resolved/cached covers through a less-safe path. |
| Cover-cache poisoning (localStorage) | Tampering | Only SOLID https URLs written (`writeKey` no-op on empty; `isSolidCover` gate); values are URL strings only; clear-cover-cache recovery path exists (D-16) |
| Self-DoS via unbounded cover fan-out | DoS | `mapWithConcurrency` CAP + per-call `AbortSignal.timeout` + skip-cached + unobserve-once (lazyCover) |

## Sources

### Primary (HIGH confidence)
- In-repo modules (read directly): `score-match.ts`, `dedupe.ts`, `match-key.ts`, `discovery.ts`, `fallback.ts`, `cover-backfill.ts`, `cover-cache.ts`, `itunes-cover.ts`, `deezer.ts`, `media-session.ts`, `searchSession.svelte.ts`, `player.svelte.ts` (cover path), `search/+page.svelte`, `types.ts`, `longpress.ts`, and the existing test suites (`score-match.test.ts`, `cover-cache.test.ts`).
- `git log` / `git status` — confirmed SRCH-03 autofocus + ql0 typeahead already committed; only `.planning/HANDOFF.json` modified.
- `.planning/config.json` — nyquist_validation true, security_enforcement enabled (absent), ui_phase true.
- `vite.config.ts` test block — node project, include glob.

### Secondary (MEDIUM confidence)
- svelte.dev/docs/svelte/use — Svelte 5 action types + cleanup; `@attach` nudge for 5.29+ (chose classic closure for repo consistency).

### Tertiary (LOW confidence)
- None relied upon — every recommendation is backed by in-repo precedent.

## Metadata

**Confidence breakdown:**
- Scoring (SRCH-01): HIGH for the pure-logic boost/penalty design; MEDIUM-LOW for end-to-end demonstrability because no `duration` is plumbed yet (the phase's main scoping decision).
- Cover pipeline (SRCH-02/COVER-01/02): HIGH — pure extension of mature, tested modules; all render sites + the player cover path read directly.
- SRCH-03: HIGH — already implemented + located; verify-only.
- lazyCover action: HIGH — IntersectionObserver precedent (search sentinel) + Image()-probe precedent (preloadNextCover) + classic-action precedent (longpress) all in-repo.
- Pitfalls: HIGH — derived from the actual invariants (CR-01/CR-02/WR-02, T-0bb-01, Pitfall 11) documented in the modules.

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable — in-repo extension; the only drift risk is the ql0/search-page area continuing to change, so re-`git diff` `search/+page.svelte` at plan time)
