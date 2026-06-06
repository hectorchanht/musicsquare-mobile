---
phase: quick-260606-rvy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/cover-cache.ts
  - src/lib/services/cover-cache.test.ts
  - src/lib/services/cover-backfill.ts
  - src/lib/actions/dragScroll.ts
  - src/lib/actions/dragScroll.test.ts
  - src/lib/actions/marquee.ts
  - src/lib/actions/marquee.test.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
autonomous: true
requirements: [FIX-A, FIX-B, FIX-C]

must_haves:
  truths:
    - "Chart/tag/geo tiles WITHOUT a Last.fm mbid eventually show a real CN-source album cover instead of a color block, resolved lazily after first paint."
    - "Resolved covers are cached in localStorage (openmusic:cover-cache:v1) keyed by normalized artist|title, so repeat visits/tiles render the cover instantly without re-searching."
    - "Background cover resolution is concurrency-capped (≤3 in-flight) and never blocks render; a miss leaves the gradient (never a broken image)."
    - "Horizontal discovery shelves can be dragged with mouse/pointer (touch already scrolls natively); a drag past threshold suppresses the tile click so dragging never plays a song."
    - "Tile song-title and artist labels that overflow the tile width marquee-bounce to reveal full text; non-overflowing labels stay static with ellipsis; reduced-motion users get static ellipsis."
    - "pnpm check and pnpm test stay green; pure logic (cover-cache get/set+key, drag-vs-tap threshold, overflow detection) is unit-tested."
  artifacts:
    - path: "src/lib/services/cover-cache.ts"
      provides: "Pure localStorage cover-cache get/set keyed by matchKey; openmusic:cover-cache:v1"
      contains: "getCachedCover"
    - path: "src/lib/services/cover-backfill.ts"
      provides: "Lazy concurrency-capped CN-source cover resolver that fills the cache"
      contains: "backfillCovers"
    - path: "src/lib/actions/dragScroll.ts"
      provides: "Pointer drag-to-scroll Svelte action with drag-vs-tap click suppression"
      contains: "dragScroll"
    - path: "src/lib/actions/marquee.ts"
      provides: "Overflow-detecting marquee-bounce Svelte action, reduced-motion aware"
      contains: "marquee"
    - path: "src/routes/(app)/+page.svelte"
      provides: "Home wired to cover-backfill, dragScroll on shelves, marquee on tile labels"
      contains: "backfillCovers"
  key_links:
    - from: "src/routes/(app)/+page.svelte"
      to: "src/lib/services/cover-backfill.ts"
      via: "onMount background call after cache apply / refresh"
      pattern: "backfillCovers"
    - from: "src/lib/services/cover-backfill.ts"
      to: "src/lib/services/catalog.ts + dedupe.ts"
      via: "searchAll → dedupeBest → top track .cover (mirrors resolveStub)"
      pattern: "searchAll"
    - from: "src/lib/services/cover-backfill.ts"
      to: "src/lib/services/cover-cache.ts"
      via: "writes resolved cover keyed by matchKey"
      pattern: "setCachedCover"
    - from: "src/routes/(app)/+page.svelte"
      to: "src/lib/actions/dragScroll.ts"
      via: "use:dragScroll on .albumrow elements"
      pattern: "use:dragScroll"
---

<objective>
Three home-discovery-tile UX features, follow-up to quick 260606-nza (which added CAA-by-mbid covers):

- FIX A — Real covers for tiles that still show color blocks (chart/tag/geo tracks with no Last.fm mbid): lazily resolve the cover from CN sources (searchAll → dedupeBest → top track `.cover`), concurrency-capped, cached in localStorage keyed by normalized artist|title.
- FIX B — Drag-to-scroll horizontal shelves with mouse/pointer + click-suppression so a drag never plays a song.
- FIX C — Marquee-bounce truncated tile labels (overflow → animate, else ellipsis; respect reduced-motion).

Purpose: Discovery tiles look complete (real art) and feel native (draggable shelves, readable labels) without breaking the existing optimistic tap-to-play or the never-block-render / never-broken-image contracts from nza.
Output: Two new services (cover-cache, cover-backfill), two new actions (dragScroll, marquee), three matching test files, and wiring into the home page + (cheaply) the artist page.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Contracts the executor needs. Already extracted from the codebase — do not re-explore. -->

From src/lib/services/lastfm.ts (the tile item shapes — note `image: string | null` and `mbid: string | null`):
```typescript
export interface DiscoveryTrack { artist: string; title: string; image: string | null; mbid: string | null; /* + others */ }
export interface DiscoveryArtist { name: string; image: string | null; mbid: string | null; /* + others */ }
```

From src/lib/services/discovery.ts (resolveStub mirrors the resolve path; mapWithConcurrency is the cap primitive — reuse, do NOT reinvent):
```typescript
export async function resolveStub(artist: string, title: string): Promise<Track | null>; // searchAll(`${artist} ${title}`,1) → dedupeBest(...,preferredSource)[0] ?? null; never throws
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>; // pool, order-preserving, swallows per-item errors → undefined slot
```

From src/lib/services/catalog.ts + dedupe.ts (the resolve primitives — pure reuse, do NOT modify):
```typescript
export async function searchAll(q: string, pages?: number): Promise<{ interleaved: Track[]; perSource: ... }>;
export function dedupeBest(tracks: Track[], preferred?: SourceId): Track[]; // [0] is the best-quality cross-source pick; .cover is real album art
```

From src/lib/services/match-key.ts (the normalization primitive — reuse as the cache key; artist-first `norm(artist)|norm(title)`):
```typescript
export function matchKey(artist: string, title: string): string; // e.g. matchKey('','') === '|'
```

From src/lib/stores/settings.svelte (the source preference dedupeBest takes):
```typescript
settings.preferredSource // SourceId | undefined
```

Existing localStorage cache idiom in src/routes/(app)/+page.svelte (mirror this try/catch + versioned-payload shape): saveCache/loadCache around `musicsquare:top-picks:v2`.
Existing action patterns to mirror: src/lib/actions/dragClose.ts (pointer down/move/up, tap-vs-drag guard via dy/velocity threshold, touch-action:none, update/destroy), src/lib/actions/longpress.ts (CustomEvent dispatch), src/lib/gestures/velocity.ts (pure, e.timeStamp-driven, node-testable).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Cover-cache (pure + tested) + lazy concurrency-capped CN-source cover-backfill</name>
  <files>src/lib/services/cover-cache.ts, src/lib/services/cover-cache.test.ts, src/lib/services/cover-backfill.ts</files>
  <behavior>
    cover-cache.ts (pure, browser-localStorage, node-testable with a localStorage stub):
    - `coverCacheKey(artist, title)` returns `matchKey(artist, title)` (reuse match-key.ts; do NOT reinvent normalization).
    - `getCachedCover(artist, title): string | null` reads `openmusic:cover-cache:v1` (a JSON `Record<string,string>`), returns the stored URL for the key or null; returns null on absent/corrupt/unavailable storage (try/catch, mirror +page.svelte loadCache).
    - `setCachedCover(artist, title, url)`: merges `{ [key]: url }` into the stored record and writes it back; no-op on empty/whitespace url; swallows quota/unavailable errors (mirror +page.svelte saveCache). Persists across calls within the same storage.
    - Test cases: set→get round-trips a URL; get returns null for an unknown key; the cache key folds case/whitespace (same key as matchKey, e.g. 'A','B (Live)' keys identically to 'a','b'); setCachedCover('a','b','') is a no-op (get still null); corrupt JSON in storage → get returns null (no throw); two different songs coexist in one record. Use a minimal in-memory localStorage stub (getItem/setItem on a Map) assigned to globalThis.localStorage in the test, OR import a tiny injectable — keep it pure/node-runnable like match-key.test.ts.
  </behavior>
  <action>
    Create `cover-cache.ts` per the behavior block: import `matchKey` from `./match-key`; CACHE_KEY constant `openmusic:cover-cache:v1`; export `coverCacheKey`, `getCachedCover`, `setCachedCover`. The stored shape is a flat `Record<string, string>` (key → cover URL) — simpler than the home shelf cache since values are tiny. All localStorage access wrapped in try/catch returning null / no-op on failure (these run only in browser handlers/onMount, never SSR).

    Create `cover-backfill.ts` — the lazy resolver that fills the cache. Export `async function backfillCovers(items, opts)` where `items` is an array of `{ artist: string; title: string }` (callers pass DiscoveryTrack rows; artist tiles are excluded — they goto the artist page, not a cover-bearing track). Behavior: (1) for each item compute the cache key and SKIP any item already cached (getCachedCover non-null) — never re-search a cached cover; (2) resolve the REMAINING items via `mapWithConcurrency(remaining, CAP, resolveOne)` with CAP=3 (≤2-3 in-flight per spec, reuse the existing primitive, do NOT Promise.all all 72); (3) `resolveOne` mirrors resolveStub's path — `searchAll(`${artist} ${title}`, 1)` then `dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null`; on a non-empty cover call `setCachedCover(artist, title, cover)` and return the key; never throw (try/catch → null, like resolveStub); (4) accept `opts.signal?: AbortSignal` and a `opts.onResolved?: (key: string, url: string) => void` callback so the page can update tiles reactively as each cover lands, and a `opts.max?: number` total cap (default ~24) so a cold visit does not fan out all tiles at once — slice `remaining` to `max`. Add a top-of-file comment explaining: PRIMARY cheap path (no rate limit, reuses CN-source infra), LAZY (post-paint), capped, cached; MusicBrainz no-mbid search stays DEFERRED; Last.fm album.getInfo album-art is a possible lower-priority future source but NOT added here.

    Do NOT modify catalog.ts, dedupe.ts, match-key.ts, or discovery.ts — they are pure reuse.
  </action>
  <verify>
    <automated>pnpm test -- cover-cache --run 2>&1 | tail -20 && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'cover-cache|cover-backfill' || echo "no type errors in new cover files"</automated>
  </verify>
  <done>cover-cache.test.ts passes; cover-cache.ts and cover-backfill.ts compile under TS strict; backfillCovers skips cached items, caps concurrency via mapWithConcurrency, writes resolved covers via setCachedCover, never throws.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: dragScroll action (drag-vs-tap threshold, tested) + marquee action (overflow detection, tested)</name>
  <files>src/lib/actions/dragScroll.ts, src/lib/actions/dragScroll.test.ts, src/lib/actions/marquee.ts, src/lib/actions/marquee.test.ts</files>
  <behavior>
    dragScroll.ts — export a pure helper `shouldSuppressClick(totalDx: number, threshold?: number): boolean` (default threshold 6px) returning `Math.abs(totalDx) > threshold`. The ACTION uses pointerdown → record startX + scrollLeft; pointermove → set `node.scrollLeft = startScrollLeft - (e.clientX - startX)` and accumulate total |dx|; pointerup/cancel → if the accumulated drag exceeded threshold, set a flag so the NEXT `click` event on the node (capture phase) is `preventDefault()`+`stopPropagation()`'d (mirror dragClose's tap-vs-drag guard) — this is what stops a shelf-drag from playing a song; then clear the flag. Set `node.style.cursor='grab'` / `'grabbing'` during drag; do NOT set touch-action:none (touch must keep native horizontal scroll — pointer drag is additive for mouse). update/destroy per the Action contract (remove listeners).
    dragScroll.test.ts: shouldSuppressClick(0) false, shouldSuppressClick(5) false, shouldSuppressClick(7) true, shouldSuppressClick(-20) true, custom threshold respected. (Pure threshold logic only — DOM drag is exercised manually.)

    marquee.ts — export a pure helper `isOverflowing(scrollWidth: number, clientWidth: number): boolean` returning `scrollWidth > clientWidth`. The ACTION: on mount + on a ResizeObserver callback, measure `node.scrollWidth` vs `node.clientWidth`; when overflowing AND `!matchMedia('(prefers-reduced-motion: reduce)').matches`, add a class (e.g. `marquee-on`) and set a CSS custom property for the scroll distance (`--marquee-dx`) so a keyframe bounce reveals the hidden text; otherwise remove the class (static ellipsis). Guard `typeof ResizeObserver` / `window.matchMedia` for SSR safety. destroy() disconnects the observer + removes the class. The CSS keyframes (alternate-direction bounce using `--marquee-dx`) live in the consuming component's `<style>` (Task 3) keyed off `.marquee-on`.
    marquee.test.ts: isOverflowing(100, 80) true, isOverflowing(80, 100) false, isOverflowing(80, 80) false (equal = fits, no marquee).
  </behavior>
  <action>
    Create `dragScroll.ts` and `marquee.ts` as Svelte actions (`import type { Action } from 'svelte/action'`) per the behavior block, each also exporting its pure helper (`shouldSuppressClick`, `isOverflowing`) for the unit tests. Mirror dragClose.ts structure: typed Action, pointer listeners added on attach, update(opts) + destroy(). For dragScroll, the click-suppression listener MUST be attached in the capture phase (`addEventListener('click', handler, true)`) so it intercepts before the child tile button's onclick — exactly the "dragging the shelf does not accidentally play a song" requirement. Keep both actions dependency-free (no new packages). Add concise top comments explaining the tap-vs-drag guard (dragScroll) and the reduced-motion + ResizeObserver overflow detection (marquee), mirroring the doc-comment density of dragClose.ts / longpress.ts.

    Create the two matching `*.test.ts` files testing ONLY the pure helpers, in the same node/vitest style as match-key.test.ts and velocity.test.ts.
  </action>
  <verify>
    <automated>pnpm test -- dragScroll marquee --run 2>&1 | tail -20 && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'dragScroll|marquee' || echo "no type errors in new action files"</automated>
  </verify>
  <done>dragScroll.test.ts + marquee.test.ts pass; both actions compile under TS strict; shouldSuppressClick and isOverflowing behave per the threshold/overflow cases; dragScroll attaches a capture-phase click suppressor, marquee guards SSR + reduced-motion.</done>
</task>

<task type="auto">
  <name>Task 3: Wire cover-backfill + dragScroll + marquee into home; apply dragScroll/marquee to artist albumrow</name>
  <files>src/routes/(app)/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte</files>
  <action>
    In `src/routes/(app)/+page.svelte`:

    FIX-A wiring — extend `tileCover(item)` to the full order of preference: (1) Last.fm `item.image` if present, (2) `caaReleaseGroupCover(item.mbid)` (existing nza path, if mbid), (3) cached CN-source cover via `getCachedCover(item.artist, item.title)`, (4) gradient fallback (return null → existing `<img>`-absent → gradient shows). The lazy resolve (preference #4-as-action) is NOT inside tileCover (that's synchronous render); instead, after first paint, call `backfillCovers(...)` in the background which writes the cache, then re-render. Add a reactive cover-version counter: a `$state` number `coverVer` bumped in the `onResolved` callback so the `{#each}` tile covers recompute (read `coverVer` inside tileCover or in a small `$derived`/inline expression on the `<img src>` so Svelte 5 re-evaluates). Collect the cover-needing rows = all DiscoveryTrack rows across topHits + tagShelves + countryShelves that have NO `image` AND NO `mbid` (the ones still showing gradients) — exclude topArtists (they link to the artist page, not a track). Call `backfillCovers(rows, { onResolved: () => coverVer++, max: 24 })` from a background scheduler: after the cache `applyCache` path AND after a successful `refresh`, in onMount/refresh, guarded so it runs only in browser (it already does — onMount). Keep it OFF the critical path (do not await it before paint; fire-and-forget with `void`). Add a top comment marking it FIX-A. Import `backfillCovers` from `$lib/services/cover-backfill` and `getCachedCover` from `$lib/services/cover-cache`.

    FIX-B wiring — add `import { dragScroll } from '$lib/actions/dragScroll'` and apply `use:dragScroll` to EACH `.albumrow` element (topHits row, topArtists row, every tagShelf row, every countryShelf row). The capture-phase click suppression in the action handles preventing an accidental tile tap during a drag — no change to the tile `onclick`/`playStub` handlers needed.

    FIX-C wiring — add `import { marquee } from '$lib/actions/marquee'` and apply `use:marquee` to the tile label spans `.al-name` and `.al-count` (and the fallback grid `.t-title` / `.t-artist` if cheap). Add CSS keyframes in this file's `<style>`: a `.marquee-on` rule that animates `transform: translateX(...)` between 0 and `calc(-1 * var(--marquee-dx))` with `animation-direction: alternate` (bounce), only applied when the action adds `.marquee-on`; keep the default `.al-name`/`.al-count` ellipsis (white-space:nowrap; overflow:hidden; text-overflow:ellipsis) as the non-overflow state. Wrap the marquee in `@media (prefers-reduced-motion: no-preference)` as defense-in-depth (the action already gates on it). NOTE: marquee needs the text in an inner element it can translate without breaking the ellipsis box — if the existing `.al-name` is the clipping box, have the action translate the node's text via the node itself with `overflow:hidden` preserved; verify the ellipsis still shows when NOT overflowing.

    In `src/routes/(app)/artist/[name]/+page.svelte` (cheap reuse): apply `use:dragScroll` to the `.albumrow` element and `use:marquee` to `.al-name` (and `.al-count` if cheap). Add the same `.marquee-on` keyframe CSS to this file's `<style>` (or confirm the tokens are self-contained per-file). Do NOT change the album tile onclick/goto behavior.

    DO NOT touch `src/routes/+layout.svelte`. Svelte 5 runes only. No new dependencies.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -15 && pnpm test --run 2>&1 | tail -8</automated>
  </verify>
  <done>pnpm check is clean (0 errors); full pnpm test suite green (all prior tests + the 3 new test files). Home shelves are use:dragScroll, tile labels use:marquee; tileCover follows image → CAA → cached → gradient; backfillCovers fires post-paint and bumps coverVer so resolved covers appear. Artist albumrow has dragScroll + marquee. +layout.svelte untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → CN source proxies (searchAll) | cover-backfill issues the SAME searchAll requests the player already makes; no new endpoint, no new untrusted input crosses here |
| browser → coverartarchive.org (`<img src>`) | unchanged from nza; mbid is encodeURIComponent'd into an `<img>` src attribute, not CSS url() |
| browser ↔ localStorage (cover-cache) | app-origin only; values are URL strings read back into `<img src>` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-rvy-01 | Tampering/XSS | cover-cache value → `<img src>` | mitigate | Cover URLs come from the SAME dedupeBest pipeline as nowbar/queue art (already trusted) OR from CAA; rendered as `<img src>` ATTRIBUTE (not CSS url()), so no CSS-injection surface; an unreachable/garbage URL fails to `onerror`/gradient — never a script context. Cache stores plain strings only. |
| T-rvy-02 | DoS (self) | backfillCovers fan-out | mitigate | Concurrency-capped at 3 via the existing mapWithConcurrency; total capped via `max` (~24); cached items skipped so repeat visits issue zero searches (Pitfall 11 — no unbounded fan-out over all 72 tiles). |
| T-rvy-03 | Info disclosure | localStorage key | accept | Cover URLs + normalized song keys are public discovery metadata, no secret/PII; same posture as the existing `musicsquare:top-picks` cache. |
| T-rvy-SC | Tampering | npm/pip/cargo installs | accept | No new packages added — both actions and both services are dependency-free and reuse existing primitives (mapWithConcurrency, matchKey, searchAll, dedupeBest). |
</threat_model>

<verification>
- `pnpm check` → 0 errors (TS strict, svelte-check).
- `pnpm test --run` → all prior tests + cover-cache.test.ts + dragScroll.test.ts + marquee.test.ts green.
- Manual smoke (not blocking): home tiles that were color blocks fill with real covers shortly after load; dragging a shelf with the mouse scrolls it and does NOT play a song; long tile titles bounce, short ones stay static; reduced-motion → static.
</verification>

<success_criteria>
- FIX-A: chart/tag/geo tiles without an mbid get a real CN-source cover lazily, capped, cached (openmusic:cover-cache:v1); never blocks render; never a broken image.
- FIX-B: pointer/mouse drag scrolls shelves with click-suppression; touch still native-scrolls.
- FIX-C: overflowing labels marquee-bounce; non-overflowing ellipsis; reduced-motion respected.
- Pure logic unit-tested (cover-cache get/set+key, drag-vs-tap threshold, overflow detection).
- pnpm check + pnpm test green; src/routes/+layout.svelte untouched; no new deps; commits atomic on main.
</success_criteria>

<output>
Create `.planning/quick/260606-rvy-home-tiles-backfill-cache-real-covers-cn/260606-rvy-SUMMARY.md` when done.
</output>
