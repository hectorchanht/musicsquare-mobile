# Phase 21: Search & Cover Pipeline Polish - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 13 (3 new, 10 modified)
**Analogs found:** 13 / 13 (every file extends or mirrors an existing in-repo module)

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/lib/actions/lazyCover.ts` | NEW | action | event-driven (IntersectionObserver) | `src/lib/actions/longpress.ts` + search-page IO sentinel | role-match (action idiom) + flow-match (IO) |
| `src/lib/services/score-context.ts` | NEW | service (pure) | transform | `src/lib/services/score-match.ts` | exact (pure node-tested service) |
| `src/lib/actions/lazyCover.test.ts` | NEW | test | — | `src/lib/actions/longpress.test.ts` | exact |
| `src/lib/services/score-context.test.ts` | NEW | test | — | `src/lib/services/score-match.test.ts` | exact |
| `src/lib/services/score-match.ts` | MOD | service (pure) | transform | itself (extend in place) | exact |
| `src/lib/services/cover-cache.ts` | MOD | service (pure + localStorage) | CRUD (key-value store) | itself — the `artist:` prefix precedent | exact |
| `src/lib/services/itunes-cover.ts` | MOD | service | request-response (fetch) | itself — `upgradeArtwork` token swap | exact |
| `src/lib/stores/player.svelte.ts` | MOD | store | event-driven (playback state) | itself — existing cover/MediaSession path | exact |
| `src/lib/services/media-session.ts` | MOD (read-only / no sig change) | service (pure) | transform | itself — `buildArtwork` | exact |
| `src/routes/(app)/search/+page.svelte` | MOD | component (route) | request-response + streaming | itself — `run`/`loadMore`/`onPartial` dedupe sites | exact |
| `src/routes/(app)/library/+page.svelte` | MOD | component (route) | CRUD list | search-page row + `library` rows | exact |
| `src/routes/(app)/album/[name]/+page.svelte` | MOD | component (route) | request-response list | search-page row | role-match |
| `src/routes/(app)/artist/[name]/+page.svelte` | MOD | component (route) | request-response list | search-page row | role-match |
| `src/lib/sources/types.ts` + adapters/proxies | MOD (conditional, Q1) | model + service | transform | `Track` interface + adapter `search()` | exact (additive field) |
| `src/lib/components/NowPlaying.svelte`, `Nowbar.svelte` | MOD | component | — | repoint `.cover` reads at `player.resolvedCover` | exact |

---

## Pattern Assignments

### `src/lib/actions/lazyCover.ts` (NEW — action, event-driven)

**Primary analog:** `src/lib/actions/longpress.ts` (action closure shape + cleanup discipline)
**Secondary analog:** `src/routes/(app)/search/+page.svelte` lines 335-347 (IntersectionObserver create/observe/disconnect) and `src/lib/stores/player.svelte.ts` lines 1151-1166 (`new Image()` probe).

**Action signature + closure-return-destroy shape** — copy from `longpress.ts:1,30-33,88-99`:
```typescript
import type { Action } from 'svelte/action';

export const longpress: Action<HTMLElement, number | undefined, { onlongpress: (e: CustomEvent) => void }> = (
	node,
	duration = 450
) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	// ...
	return {
		destroy() {
			clear();
			node.removeEventListener('pointerdown', down);
			// ... remove every listener registered above
		}
	};
};
```
For `lazyCover` the destroy must call `io.disconnect()`.

**IntersectionObserver create/observe/teardown** — copy from `search/+page.svelte:335-347`:
```typescript
io = new IntersectionObserver(
	(entries) => {
		if (entries[0]?.isIntersecting) loadMore();
	},
	{ root: null, rootMargin: '400px 0px' }   // root:null = viewport (WINDOW scrolls)
);
io.observe(el);
return () => io?.disconnect();
```
Note the `root: null` + `rootMargin` prefetch-early idiom (search uses `400px`; lazyCover discretion suggests `~200px`). Unobserve after first intersection (`io.unobserve(node)`) + a `done` one-shot flag (mirror longpress's `suppressNextClick` one-shot pattern).

**`new Image()` broken-URL probe (D-15)** — copy from `player.svelte.ts:1151-1166`:
```typescript
private preloadNextCover(track: Track) {
	const url = track.cover;
	if (!url || typeof Image === 'undefined') return;       // SSR / no-cover guard
	try {
		const img = new Image();
		img.decoding = 'async';
		img.referrerPolicy = 'no-referrer';
		img.src = url;
		// ...
	} catch { /* best-effort */ }
}
```
For lazyCover: set `img.onload` (cover is good → keep) / `img.onerror` (treat as empty → run chain). The `typeof Image === 'undefined'` SSR guard is mandatory.

**Concurrency cap (do NOT Promise.all)** — route any per-batch fan-out through `mapWithConcurrency` (`discovery.ts:110`):
```typescript
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]>
```
A per-row action firing one resolve each is naturally viewport-bounded; add an in-flight `Set<uid>` de-dupe so two observers don't race the same song.

**Resolve chain reuse:** the action's resolve helper must reuse `cover-backfill.ts` tier mechanics (see Shared Patterns: Cover tier chain) — never a new resolver. Read uid cache → name cache first; only fire the chain on a miss/broken.

---

### `src/lib/services/score-context.ts` (NEW — pure service, transform)

**Analog:** `src/lib/services/score-match.ts` (pure, import-light, node-Vitest-testable; no `$state`, no `$app/*`, no I/O).

**Pure-function + import discipline** — mirror `score-match.ts:16-17` (only `matchKey` + the `Track`/`SourceId` types):
```typescript
import { matchKey } from '$lib/services/match-key';
import type { SourceId, Track } from '$lib/sources/types';
```

**Distinct-source artist map (D-05 — count sources, NOT rows):**
```typescript
export interface SetContext {
	artistSources: Map<string, Set<SourceId>>;   // artist matchKey → distinct source ids
	queryLen: number;                              // for short-title proximity (D-06)
}

export function computeSetContext(rows: Track[], query: string): SetContext {
	const artistSources = new Map<string, Set<SourceId>>();
	for (const r of rows) {
		const k = matchKey(r.artist, '');          // artist-only key (mirrors artistCoverCacheKey)
		let set = artistSources.get(k);
		if (!set) { set = new Set(); artistSources.set(k, set); }
		set.add(r.source);
	}
	return { artistSources, queryLen: query.trim().length };
}
// boost ONLY when set.size >= 2 (cross-source presence, NOT raw count — D-05)
```
The artist-only key `matchKey(r.artist, '')` matches the `artistCoverCacheKey` precedent in `cover-cache.ts:38-40`.

---

### `src/lib/services/score-match.ts` (MOD — pure service, transform)

**Analog:** itself. Extend in place with an additive optional 3rd arg (D-07).

**Existing pure score (DO NOT break — CR-01/CR-02/WR-02 invariants)** — current `scoreMatch` at lines 150-157:
```typescript
export function scoreMatch(query: { artist: string; title: string }, candidate: Track): number {
	return similarity(query, candidate) - variantPenalty(query, candidate);
}
```
The 2-arg callers (`resolveStub`, `tryFallback`) MUST keep working unchanged.

**Existing named tuning consts (lines 63-67)** — follow this exact style for the new consts:
```typescript
const SIM_EXACT = 10;     // candidate matchKey === query matchKey
const SIM_ARTIST = 3;
const SIM_TITLE = 3;
const SIM_TOKEN = 2;      // graded latin-token overlap (max)
const VARIANT_WEIGHT = 4; // subtracted per un-asked-for variant keyword
```
Add `SHORT_CLIP_SEC` (~60), `PREVIEW_PENALTY` (D-04: must be strictly `> SIM_EXACT + maxShortTitleBoost + maxArtistBoost`), and the boost consts in the same block.

**Additive optional 3rd arg (D-07) — recommended shape:**
```typescript
export function scoreMatch(
	query: { artist: string; title: string },
	candidate: Track,
	ctx?: SetContext            // additive; existing 2-arg callers unaffected
): number {
	let s = similarity(query, candidate) - variantPenalty(query, candidate);
	// D-03: ONLY penalize a KNOWN finite duration < SHORT_CLIP_SEC. undefined/null/0 = unknown = NO penalty.
	if (typeof candidate.duration === 'number' && candidate.duration > 0 && candidate.duration < SHORT_CLIP_SEC) {
		s -= PREVIEW_PENALTY;   // D-04: dominates any boost combination
	}
	if (ctx) {
		s += shortTitleBoost(query, candidate, ctx.queryLen);     // D-06
		s += artistFrequencyBoost(candidate, ctx.artistSources);  // D-05 (set.size >= 2)
	}
	return s;
}
```

**Variant-keyword + word-boundary matcher (DO NOT regress)** — `variantPenalty` lines 131-148 and the `KW_TESTERS`/`ASCII_ONLY` word-boundary logic (lines 116-123) must stay intact (CR-01 latin word boundaries, CR-02 substring de-dupe, WR-02 title-only).

---

### `src/lib/services/cover-cache.ts` (MOD — pure service + localStorage, CRUD)

**Analog:** itself — the `artist:` prefix family is the exact precedent for the new `uid:` family (D-13).

**Disjoint-prefix key precedent (lines 38-40):**
```typescript
export function artistCoverCacheKey(artist: string): string {
	return 'artist:' + matchKey(artist, '');   // disjoint from track keys
}
```

**Shared read/write helpers to REUSE (lines 73-92)** — the new uid get/set must call the existing private `readKey`/`writeKey` (never re-implement the try/catch / empty-url no-op):
```typescript
function readKey(key: string): string | null {
	const url = readRecord()[key];
	return typeof url === 'string' && url.length > 0 ? url : null;
}
function writeKey(key: string, url: string): void {
	const clean = (url ?? '').trim();
	if (!clean) return;                 // never cache an empty cover (keeps gradient)
	try {
		const rec = readRecord();
		rec[key] = clean;
		localStorage.setItem(CACHE_KEY, JSON.stringify(rec));
	} catch { /* quota / unavailable — non-fatal */ }
}
```

**New uid layer (D-13) — mirror `artistCoverCacheKey` discipline exactly. PITFALL 7: use the raw `track.uid` (COLON form from `makeUid`, e.g. `netease:123`), build the key once via one helper for both get + set:**
```typescript
export function uidCoverCacheKey(uid: string): string {
	return 'uid:' + uid;            // e.g. 'uid:netease:12345678' — disjoint family
}
export function getCachedCoverByUid(uid: string): string | null {
	return readKey(uidCoverCacheKey(uid));
}
export function setCachedCoverByUid(uid: string, url: string): void {
	writeKey(uidCoverCacheKey(uid), url);
}
// Read order (caller): getCachedCoverByUid(uid) ?? getCachedCover(artist, title)
// Write on resolve: BOTH setCachedCoverByUid(uid, url) AND setCachedCover(artist, title, url)
```
Same flat `openmusic:cover-cache:v1` store, no migration (additive disjoint family).

---

### `src/lib/services/itunes-cover.ts` (MOD — service, request-response)

**Analog:** itself — one-token swap in `upgradeArtwork` (D-11), lines 63-67:
```typescript
export function upgradeArtwork(url: string | null | undefined): string | null {
	const clean = (url ?? '').trim();
	if (!clean) return null;
	return clean.includes('100x100bb') ? clean.replace('100x100bb', '600x600bb') : clean;
}
```
Change `'600x600bb'` → `'1200x1200bb'`. **Also update `itunes-cover.test.ts`** which asserts `600x600bb`.

---

### `src/lib/stores/player.svelte.ts` (MOD — store, event-driven)

**Analog:** itself — the existing cover + MediaSession path.

**Existing MediaSession metadata write (offline path lines 1291-1299, network path lines 1350-1358)** — repoint `buildArtwork(track.cover)` / `buildArtwork(resolved.cover)` at the new `resolvedCover` field:
```typescript
const ms = this.ms;
if (ms) {
	ms.metadata = new MediaMetadata({
		title: names.dnTitle(resolved.title),
		artist: names.dnArtist(resolved.artist),
		album: resolved.album,
		artwork: buildArtwork(resolved.cover)   // ← becomes buildArtwork(this.resolvedCover)
	});
	ms.playbackState = 'playing';
}
```

**Generation guard for the async re-fire (PITFALL 4)** — copy the `myGen`/`playGen` snapshot+recheck idiom used after every await in `play()` (lines 1264, 1282, 1322):
```typescript
const myGen = this.playGen;
// ... await ...
if (myGen !== this.playGen) return; // superseded — discard
```
On async cover land: re-check `myGen === this.playGen`, then assign a FRESH `new MediaMetadata({...})` (the OS only repaints on a new object, never in-place mutation).

**Cover propagation already wired (line 1333)** — keep feeding `library.adoptCover`:
```typescript
if (resolved.cover) library.adoptCover(resolved);
```

**Field declaration** — add near the existing `pendingTrack`/`playGen` state (lines 149-181):
```typescript
resolvedCover = $state<string | null>(null);
```
Set sync at play entry: `this.resolvedCover = track.cover ?? getCachedCoverByUid(track.uid) ?? getCachedCover(track.artist, track.title) ?? null`, then fire the chain on null and re-fire MediaSession on landing (generation-guarded).

---

### `src/lib/services/media-session.ts` (READ-ONLY this phase — no signature change)

`buildArtwork(cover)` (lines 35-42) is already null-safe with the `/favicon.svg` final fallback (D-12). The player simply feeds it `resolvedCover` instead of `track.cover` — no edit here.
```typescript
export function buildArtwork(cover: string | null): MediaImage[] {
	if (cover) { /* size ladder of {src: cover, ...} */ }
	return [{ src: FALLBACK_ART, sizes: 'any', type: 'image/svg+xml' }];   // FALLBACK_ART = '/favicon.svg'
}
```

---

### `src/routes/(app)/search/+page.svelte` (MOD — route component, streaming + request-response)

**Analog:** itself. Two changes: (a) score+sort step after each dedupe; (b) `use:lazyCover` on rows.

**Dedupe call sites the sort slots AFTER (D-01/D-02)** — keep them INSIDE the existing race guards (PITFALL 3):
- `onPartial` line 221-222: `if (myAc.signal.aborted || kw !== q.trim()) return;` then `results = dedupeBest(...)`
- final line 225: `results = dedupeBest(interleaved, settings.preferredSource);`
- Deezer-boost re-rank lines 237-241 (already a post-paint swap with the same guard — the sort mirrors this)
- `loadMore` line 275: `const merged = dedupeBest(...)`

**Race-guard idiom (preserve on every async commit):**
```typescript
const myAc = ac; // captured before await
// ...
if (myAc.signal.aborted || kw !== q.trim()) return;
results = dedupeBest(partial.interleaved, settings.preferredSource);
```
Wrap the new `rankList(dedupeBest(...))` inside this same guard.

**Sort-before-persist (PITFALL 6)** — `persistSession()` (lines 233, 240, 285) must store the ALREADY-SORTED list; the restore path (lines 305-315) assigns `results = searchSession.results` directly and must NOT re-sort (keep order-preserving).

**Current cover render (line 481 — D-15 plumbing note: `background-image`, fires NO error event):**
```svelte
<span class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></span>
```
Attach `use:lazyCover={{ track: t, onResolved }}` to this `.art` span (or the row). The resolved cover repaints via a reactive map the page bumps in `onResolved` (mirror the `dedupeBestWithDeezer` post-paint swap pattern).

**Autofocus (SRCH-03 — ALREADY SHIPPED, verify-only, lines 316-320):**
```typescript
// Evaluated AFTER the hasPrior restore — a restored prior query makes q non-empty so
// focus is not stolen. In onMount (NOT a $effect keyed on q) so clearing mid-session
// does NOT re-grab focus.
if (!q.trim()) queryInputEl?.focus();
```
Do NOT rebuild. The `searchSession.hasPrior` gate (line 305) is the restore-vs-fresh guard (D-17).

---

### `src/routes/(app)/library`, `album/[name]`, `artist/[name]` `+page.svelte` (MOD — route components, list)

**Analog:** the search-page row + each page's own `fallbackCover` helper. Every surface renders covers identically as `style:background-image` (the D-15 mechanism note):
- `library/+page.svelte` lines 161, 186, 203, 234: `<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}>` (also `use:longpress` already on the row at 160/185/202/233 — `use:lazyCover` stacks on the `.art` span)
- `album/[name]/+page.svelte` line 503: `<span class="art" style:background-image={fallbackCover(track.artist + track.title)}>` (NOTE: album rows currently render ONLY the gradient — no `track.cover`; lazyCover must resolve+paint here)
- `artist/[name]/+page.svelte` line 378: `<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}>`

Each page keeps its own `fallbackCover` gradient (D-12 placeholder) and adds the `use:lazyCover` action + a reactive resolved-cover map.

---

### `src/lib/sources/types.ts` + adapters + proxies (MOD — CONDITIONAL, Open Question Q1)

**Analog:** the `Track` interface (`types.ts:19-64`) and adapter `search()` (`SourceAdapter.search`, line 70). The Last.fm enrichment fields (lines 59-63) are the precedent for an additive optional field:
```typescript
// --- Last.fm enrichment (Phase 8, additive/optional) — never overwrites source data ---
tags?: string[];
bio?: string;
```
Add `duration?: number;` (seconds) the same way. Then plumb it per source: proxy reshape (`src/lib/proxy/*.ts`) → adapter `search()`/`resolve()` map. **BLOCKER:** no source sets duration today, so the 試聽 penalty (D-03) is dormant until at least one source (research suggests QQ `interval` / Netease-Kuwo song detail) is plumbed. Planner decides scope.

---

## Shared Patterns

### Cover tier chain (Deezer → iTunes → CN) — REUSE, never re-implement
**Source:** `src/lib/services/cover-backfill.ts` (the `tier()` never-throw wrapper lines 125-132, `isSolidCover` https guard lines 90-92, `resolveOne` chain lines 137-166).
**Apply to:** `lazyCover.ts` resolve helper AND the `player.svelte.ts` `resolvedCover` async chain.
```typescript
function isSolidCover(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');   // T-0bb-01 https-only guard
}
async function tier(fn: () => Promise<string | null>): Promise<string | null> {
	try { const url = await fn(); return isSolidCover(url) ? url : null; }
	catch { return null; }                 // per-tier never-throw → fall through to next tier
}
// Deezer (deezerSongCover) → iTunes (itunesSongCover) → CN (searchAll + dedupeBest[0].cover)
```
Phase 21 adds NEW CALLERS; consider exporting a single-item `resolveOne`-style helper from `cover-backfill.ts` so both new callers share it.

### Concurrency cap — REUSE `mapWithConcurrency`, never `Promise.all`
**Source:** `src/lib/services/discovery.ts:110` (`mapWithConcurrency<T,R>(items, limit, fn)`); `cover-backfill.ts:83` uses `CAP = 6`.
**Apply to:** any lazyCover batch fan-out.

### Identity normalization — REUSE `matchKey`
**Source:** `src/lib/services/match-key.ts` (artist-first). Used by `score-match.ts:16`, `cover-cache.ts:23`, and the new `score-context.ts`. Single source of truth for scoring + cache keys.

### localStorage try/catch no-op posture
**Source:** `cover-cache.ts` `readRecord`/`readKey`/`writeKey` (lines 52-92) — every access wrapped, returns null / no-op on failure. The uid layer inherits this via the shared helpers.

### Generation-guard for superseded async
**Source:** `player.svelte.ts` `playGen` snapshot+recheck after every await (lines 1264, 1282, 1322); search page `myAc.signal.aborted || kw !== q.trim()` (lines 221, 238, 277). Apply to the MediaSession async re-fire and per-partial re-sort.

### `https`-only `<img src>` security guard (T-0bb-01 / V5)
**Source:** `cover-backfill.ts:90` `isSolidCover` + the module-header injection note. Resolved/cached covers are rendered as `<img src>` ATTRIBUTE only, never CSS `url()`. The current rows use `style:background-image` for the *source* `track.cover` — Phase 21 must NOT route *resolved* covers through a less-safe path; only SOLID https URLs are written to cache.

### Svelte action closure idiom (classic, node-testable)
**Source:** every action in `src/lib/actions/` (longpress, coverSwipe, dragScroll, dragReorder, swipeRemove, marquee, chipReorder) uses the `Action<Node, Param, Events>` closure-return-`{ destroy }` shape with matching `*.test.ts`. `lazyCover.ts` + `lazyCover.test.ts` follow `longpress.ts` + `longpress.test.ts` (manual-mount, IO mock).

### Test structure
**Source:** existing `score-match.test.ts`, `cover-cache.test.ts`, `longpress.test.ts` (node Vitest project). New `score-context.test.ts` mirrors `score-match.test.ts`; new `lazyCover.test.ts` mirrors `longpress.test.ts` (IO-mock manual mount). Run: `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm test -- <module>`.

---

## No Analog Found

None. Every file extends or mirrors an existing in-repo module — Phase 21 is a pure-extension phase.

The one genuinely NEW-shaped concern is the `Track.duration` end-to-end plumbing (conditional, Q1): the *field* has the Last.fm-enrichment additive-optional precedent, but no source currently maps a duration, so the per-source proxy→adapter mapping has no exact analog beyond the generic `search()` reshape pattern. Planner should treat this as the phase's only non-copy work.

---

## Metadata

**Analog search scope:** `src/lib/services/`, `src/lib/actions/`, `src/lib/stores/`, `src/lib/components/`, `src/routes/(app)/{search,library,album,artist}/`, `src/lib/sources/types.ts`
**Files scanned (read in full or targeted):** `score-match.ts`, `cover-cache.ts`, `itunes-cover.ts`, `cover-backfill.ts`, `longpress.ts`, `types.ts`, `media-session.ts` (buildArtwork), `player.svelte.ts` (cover/MediaSession path 1145-1364), `search/+page.svelte` (200-348), `NowPlaying.svelte` (288-339), plus grep-located render sites on library/album/artist/Nowbar and `discovery.ts mapWithConcurrency`.
**Pattern extraction date:** 2026-06-11
