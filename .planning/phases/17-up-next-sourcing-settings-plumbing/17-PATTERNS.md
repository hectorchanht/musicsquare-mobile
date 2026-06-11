# Phase 17: Up-Next Sourcing + Settings Plumbing - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 16 (3 NEW, 13 MODIFY)
**Analogs found:** 16 / 16 (every "new" capability is an adapter onto an existing tested seam)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/stores/player.svelte.ts` | store | event-driven | (self — extend existing methods `setQueue`/`regenerate`/`ensureAhead`) | self / exact |
| `src/lib/config/defaults.ts` | config | transform | (self — `PLAYBACK_DEFAULTS` / `enabledSources` map group) | self / exact |
| `src/lib/stores/settings.svelte.ts` | store | transform | (self — `enabledSources` map field + `applyTheme` + `FONT_SCALE` const + reset) | self / exact |
| `src/lib/actions/swipeRemove.ts` (NEW) | action | event-driven | `src/lib/actions/dragClose.ts` | role-match (axis mirror) |
| `src/lib/services/color.ts` (NEW) | utility | transform | `src/lib/i18n/detect.ts` (pure SSR-safe helper) | role-match |
| `src/routes/api/deezer/artist/+server.ts` (NEW) | route | request-response | `src/routes/api/deezer/related/+server.ts` | exact |
| `src/routes/api/deezer/album/+server.ts` (NEW) | route | request-response | `src/routes/api/deezer/related/+server.ts` | exact |
| `src/lib/services/deezer.ts` | service | request-response | (self — `deezerRelatedArtists` client fn) | self / exact |
| `src/lib/components/NowPlaying.svelte` | component | event-driven | (self — Up-Next list `:736`; `dragClose` action for header gesture idiom) | self / exact |
| `src/routes/(app)/settings/playback/+page.svelte` | component | request-response | (self — `.seg`/`.chips` selector rows + `setSource`) | self / exact |
| `src/routes/(app)/settings/appearance/+page.svelte` | component | request-response | (self — `.ctl` slider + `.prev` demo span) | self / exact |
| `src/routes/(app)/artist/[name]/+page.svelte` | component | event-driven | (self — `enrichArtist` race-guarded `$effect`) | self / exact |
| `src/routes/(app)/album/[name]/+page.svelte` | component | event-driven | (self — `enrichAlbum` race-guarded `$effect`) | self / exact |
| play-entry call sites (search/library/home) | component | event-driven | `setQueue(...)` call sites (artist `:109`, album `:212`) | exact |
| `src/lib/i18n/*.ts` (×15) | config | transform | `en.ts` reference dict + 14 parity dicts | exact |
| `src/lib/services/color.test.ts` + others (NEW tests) | test | — | `dragReorder.test.ts`, `velocity.test.ts`, `settings.svelte.test.ts` | exact |

## Pattern Assignments

### `src/routes/api/deezer/artist/+server.ts` + `album/+server.ts` (route, request-response) — NEW

**Analog:** `src/routes/api/deezer/related/+server.ts` (read in full, 112 lines). This is a near-exact clone: two-call own-origin proxy (search-by-name → fetch-by-id), edge Cache API, `corsHeaders`, `OPTIONS` handler, never-throws (empty shape on miss).

**Imports + constants pattern** (related/+server.ts lines 12-19):
```typescript
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

const DEEZER_ARTIST_SEARCH = 'https://api.deezer.com/search/artist';
const DEEZER_ARTIST_RELATED = 'https://api.deezer.com/artist';
const TTL = 86400; // 24h — artist/album data is stable (D-16: long TTL)
```

**Edge-cache narrow + accessor** (related/+server.ts lines 21-32) — copy verbatim:
```typescript
interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}
interface EdgeCacheStorage { default?: EdgeCache; }
function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}
```

**Untrusted-upstream interfaces (all fields optional)** (related/+server.ts lines 47-57) — extend for the new fields. Live-verified shapes (RESEARCH.md Code Examples):
```typescript
// artist/{id} → reshape to { picture: picture_xl, fans: nb_fan, albums: nb_album, radio }
interface DzArtist { id?: number; name?: string; picture_xl?: string; nb_fan?: number; nb_album?: number; radio?: boolean; }
// album/{id} → reshape to { cover, releaseDate, tracks, fans, label, genres: string[], duration }
interface DzAlbum { id?: number; title?: string; cover_xl?: string; release_date?: string;
  nb_tracks?: number; fans?: number; label?: string; duration?: number;
  genres?: { data?: { name?: string }[] }; }
```

**GET handler core pattern** (related/+server.ts lines 59-107) — the proven 2-call + cache-key-on-own-origin flow. Reuse exactly, swapping only the upstream paths and reshape:
```typescript
export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const name = (url.searchParams.get('name') ?? url.searchParams.get('artist') ?? '').trim();
	if (!name) return jsonResult(EMPTY, origin);                      // empty shape, no long cache
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());                     // key = OWN-ORIGIN request (T-wv8-06)
	if (cache) { const hit = await cache.match(cacheReq); if (hit) return jsonResult(await hit.json(), origin, TTL); }
	try {
		const searchUrl = `${SEARCH}?q=${encodeURIComponent(name)}&limit=1`;   // V5: encodeURIComponent guards SSRF
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const id = ((await searchRes.json()) as DzSearchResp)?.data?.[0]?.id;
		if (id == null) return jsonResult(EMPTY, origin);              // miss → do NOT long-cache (Security: negative TTL)
		const byIdRes = await fetchWithRetry(`${BYID}/${encodeURIComponent(String(id))}`, { signal: AbortSignal.timeout(8000) }, 2);
		const out = reshape((await byIdRes.json()) as DzArtist);       // null-safe reshape (every field optional)
		if (cache) await cache.put(cacheReq, new Response(JSON.stringify(out), { headers: { 'content-type':'application/json', 'Cache-Control':`public, max-age=${TTL}` } }));
		return jsonResult(out, origin, TTL);
	} catch { return jsonResult(EMPTY, origin); }                     // never throws
};
export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
```

**Album route note:** name→id via `/search/album?q=<title artist>&limit=1` (combine title + artist in the query for a better hit). Otherwise identical structure.

**Security (V5 / RESEARCH Security Domain):** `encodeURIComponent` the name/title; fixed upstream host (never user-supplied); treat all JSON optional; prefer NOT long-caching a hard miss (cache the empty shape with a short/no TTL — the related route caches `{artists:[]}` but for artist/album a transient upstream failure pinned 24h is worse UX).

---

### `src/lib/services/deezer.ts` (service, request-response) — MODIFY

**Analog:** `deezerRelatedArtists()` in the same file (lines 205-224). Add `deezerArtist(name)` / `deezerAlbum(title, artist)` mirroring it exactly: never-throws, `cached()` wrapper, own-origin proxy path, `combinedSignal`.

**Client-fn pattern** (deezer.ts lines 205-224):
```typescript
const ARTIST_PATH = '/api/deezer/artist';
const TTL_ARTIST = 7 * 24 * 60 * 60 * 1000; // 7d — artist/album stable (mirror TTL_COVER)

export interface DeezerArtistInfo { picture: string | null; fans: number | null; albums: number | null; }

export async function deezerArtist(name: string, signal?: AbortSignal): Promise<DeezerArtistInfo | null> {
	if (signal?.aborted) return null;
	const clean = (name ?? '').trim();
	if (!clean) return null;
	return cached(`dz:artist:${clean}`, TTL_ARTIST, async () => {
		const url = `${ARTIST_PATH}?${new URLSearchParams({ name: clean }).toString()}`;
		try {
			const res = await fetch(url, { signal: combinedSignal(signal) });
			if (!res.ok) return null;
			return (await res.json()) as DeezerArtistInfo;
		} catch { return null; }   // never throws → caller leaves section absent (D-14)
	});
}
```
Reuse the existing `combinedSignal()` (deezer.ts lines 108-113) and `cached` import (line 22). Export the reshape interfaces so the page-level merge (D-15) can type them.

---

### `src/lib/actions/swipeRemove.ts` (action, event-driven) — NEW

**Analog:** `src/lib/actions/dragClose.ts` (read in full, 118 lines) + `src/lib/gestures/velocity.ts`. Structural mirror on the **X axis** (`clientX`/`translateX`) with an added axis-arbitration step so it shares the Up-Next row with the vertical GripVertical reorder (Pitfall 2 / D-06).

**Action signature + state (mirror dragClose lines 23-39):**
```typescript
import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';
export interface SwipeRemoveOpts { onremove: () => void; threshold?: number; enabled?: boolean; }
export const swipeRemove: Action<HTMLElement, SwipeRemoveOpts> = (node, opts) => {
	let dragging = false, captured = false, startX = 0, startY = 0, dx = 0;
	const SLOP = 8;            // dragClose's DRAG_START
	const FLICK_V = 0.5;       // dragClose's FLICK_V (px/ms)
	const vel = createVelocityTracker();
	node.style.touchAction = 'pan-y';   // KEY DIFFERENCE: pan-y keeps vertical scroll, yields horizontal
```

**CRITICAL tap-preservation comment (dragClose lines 60-63) — copy the rationale:**
```typescript
// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click
// to THIS node, so a tap on the row never reaches its onclick (tap-to-play "did nothing").
// Capture only once an actual horizontal drag begins (in move()).
```

**Down handler (mirror dragClose lines 52-64) — records start only:**
```typescript
function down(e: PointerEvent) {
	if (!enabled) return;
	dragging = true; captured = false; startX = e.clientX; startY = e.clientY; dx = 0;
	vel.reset(); vel.sample(e.clientX, e.timeStamp);   // velocity tracker now seeded on X
	node.style.transition = 'none';
}
```
**NOTE on velocity.ts (lines 30-49):** its `sample(clientY, ...)` is just "first arg = position coordinate" — pass `e.clientX`. No change to velocity.ts needed; it is axis-agnostic despite the `y` field name.

**Move handler — the NEW axis-arbitration (RESEARCH Pattern 3 / Pitfall 2):**
```typescript
function move(e: PointerEvent) {
	if (!dragging) return;
	const ddx = e.clientX - startX, ddy = e.clientY - startY;
	if (!captured) {
		if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;        // below slop = still a tap → onclick fires
		if (Math.abs(ddy) > Math.abs(ddx)) { dragging = false; return; } // vertical wins → let grip/scroll run
		node.setPointerCapture(e.pointerId); captured = true;            // horizontal commit (capture HERE, not on down)
	}
	dx = e.clientX - startX;
	vel.sample(e.clientX, e.timeStamp);
	node.style.transform = `translateX(${dx}px)`;                        // slide following finger (D-07)
	node.style.opacity = String(1 - Math.min(1, Math.abs(dx) / FADE_DISTANCE)); // fade
}
```

**Up handler (mirror dragClose lines 77-95) — flick OR distance threshold removes, else spring back:**
```typescript
function up() {
	if (!dragging) return;
	dragging = false; captured = false;
	const v = vel.velocity();
	if (Math.abs(dx) > threshold || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
		onremove();                                                       // animate out + remove
	} else {
		node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1), opacity 0.28s';
		node.style.transform = 'translateX(0)'; node.style.opacity = '1'; // spring back
	}
	dx = 0;
}
```

**Listeners + update/destroy (dragClose lines 97-117):** copy verbatim (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`; `update()` swaps `onremove`/`enabled`; `destroy()` removes listeners + resets inline styles + clears `touchAction`).

**Test:** mirror `src/lib/actions/dragReorder.test.ts` structure (synthesize PointerEvents, assert slop axis-lock + flick + tap-preserve). Wave 0 gap.

---

### `src/lib/services/color.ts` (utility, transform) — NEW

**Analog:** any small pure SSR-safe helper — closest is `src/lib/i18n/detect.ts` (pure, no side effects, unit-tested) and the `clampInt` helper in `settings.svelte.ts:60-64`. Keep it pure (no `browser` reads, no DOM) so it is trivially testable.

**Pattern (RESEARCH Pattern 5 — 6-line clamp-and-darken, zero deps):**
```typescript
/** Darken a #rrggbb hex by `amount` (0..1). Pure: parse → scale each channel → reclamp.
 *  Used by settings.applyTheme() to derive --color-primary-hover from the chosen accent. */
export function darken(hex: string, amount: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;                                   // malformed → return input unchanged (never throws)
	const n = parseInt(m[1], 16);
	const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
	const r = f(n >> 16), g = f((n >> 8) & 0xff), b = f(n & 0xff);
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
```
**Note (A3):** the original pair `#7c5cff`→`#6a48f0` is ~12% darker, so `darken(accent, 0.12)` matches today's relationship. Add `src/lib/services/color.test.ts` (Wave 0 gap) — pure correctness + malformed-input passthrough.

---

### `src/lib/stores/player.svelte.ts` (store, event-driven) — MODIFY

**Analog:** self. Extend the existing queue-mutation methods. ALL new queue writes MUST route through one method that re-reads `this.queue` + re-merges `manualUids` + current track (Pitfall 1).

**`setQueue` — add context arg** (current at lines 701-705):
```typescript
// BEFORE:
setQueue(tracks: Track[]) { this.queue = dedupeBest(tracks, settings.preferredSource); this.persist(); }
// AFTER (QUEUE-03 — default null is the safe global-generated fallback):
setQueue(tracks: Track[], context: QueueContext = null) {
	this.queue = dedupeBest(tracks, settings.preferredSource);
	this.queueContext = context;     // new $state field, NOT persisted (reload → null → generated)
	this.persist();
}
```

**`queueContext` field — mirror the `manualUids` side-state discipline** (manualUids declared at lines 454-459, a plain non-`$state` Set keeping Track objects clean). `queueContext` is user-visible so it IS `$state`, but the union type lives near it:
```typescript
export type QueueContext = 'liked' | 'search' | 'downloads' | 'playlist' | 'album' | 'artist' | 'home-discovery' | 'history' | null;
queueContext = $state<QueueContext>(null);
```

**`removedUids` — plain Set like `manualUids`** (NOT `$state` — internal exclusion budget, Anti-Pattern). Declare beside `manualUids` (line 459).

**Auto-expand guard (D-05)** — the one-line fix at line 902:
```typescript
// BEFORE (fires on EVERY play() incl. next()/failover):
if (settings.autoExpandOnPlay) this.expanded = true;
// AFTER (only explicit fresh user plays — opts.fresh already exists in the signature at line 877):
if (opts?.fresh && settings.autoExpandOnPlay) this.expanded = true;
```

**`regenerate` exclude pattern (lines 1041-1052)** — thread `removedUids` into the existing exclude set:
```typescript
const exclude = new Set<string>([seed.uid, ...manualEntries.map((t) => t.uid), ...this.removedUids]);
const auto = await buildSimilarQueue(seed, exclude);   // signature already accepts excludeUids
this.queue = dedupeBest([seed, ...manualEntries, ...auto], settings.preferredSource);
```
Same for `ensureAhead` (lines 730-744): union `removedUids` into the `have` Set before `buildDiversePicks(8, have)`. Both fns already accept an exclude set (`buildSimilarQueue(track, excludeUids)` similar.ts:57; `buildDiversePicks(count, excludeUids)` picks.ts:28).

**NEW `removeFromQueue(uid)` — mirror `playNext`/`addToQueue` filter idiom (lines 708-724):**
```typescript
removeFromQueue(uid: string) {
	this.removedUids.add(uid);                          // D-10: session-excluded from regen
	this.manualUids.delete(uid);
	this.queue = this.queue.filter((t) => t.uid !== uid);  // re-read this.queue at write-time (Pitfall 1)
	this.persist();
}
```

**NEW `clearQueue()` (D-08 — keep only current, reset manualUids):**
```typescript
clearQueue() {
	this.queue = this.current ? [this.current] : [];    // never-stop: current survives
	this.manualUids.clear();                            // D-08: pins go too
	this.persist();                                     // D-09: NO immediate regenerate — ensureAhead refills near end-of-track
}
```

**Reset `removedUids` on a fresh play** (D-10) — inside the `opts?.fresh` branch near line 1022 (`if (opts?.fresh) void this.regenerate(resolved)`), clear `this.removedUids` first so a new listening session starts clean.

**Per-context branch:** in the `opts?.fresh` path, read `settings.effectiveUpnextMode(this.queueContext)`. `'generated'` → today's `regenerate(resolved)`. `'same-list'` → keep the snapshot the call site already passed via `setQueue` (do NOT regenerate). Anti-Pattern: never add a second queue-write path — route through `setQueue`/`regenerate`.

**Tests:** extend `src/lib/stores/player.svelte.test.ts` (already covers play/playStub/generation-guard) for queueContext / removeFromQueue / clearQueue / removedUids exclusion / auto-expand guard.

---

### `src/lib/config/defaults.ts` (config, transform) — MODIFY

**Analog:** self — the `PLAYBACK_DEFAULTS` group (lines 76-83) with its `enabledSources: {}` map field, and the `DEFAULTS` aggregation (lines 100-107). Follow the k3y "add a group, register it" pattern exactly (the header comment lines 1-8 spells out the 3-step recipe).

**New group pattern (mirror PLAYBACK_DEFAULTS structure):**
```typescript
// ---- Up-Next sourcing (Phase 17, QUEUE-03 / D-01) -------------------------------------
export type UpnextMode = 'same-list' | 'generated';
export const UPNEXT_DEFAULTS = {
	/** Global default for any context with no explicit override. Roadmap-locked = 'generated'. */
	mode: 'generated' as UpnextMode,
	/** Per-context overrides; absent key → falls back to `mode`. ALL default 'generated' (D-01). */
	perContext: {} as Partial<Record<Exclude<QueueContext, null>, UpnextMode>>
} as const;
```
**Register in `DEFAULTS`** (lines 100-107) — add `upnext: UPNEXT_DEFAULTS,` so the reset-group helper picks it up automatically. Mirror `DEFAULT_ACCENT` (line 25): keep the union type importable without circular dep (define `QueueContext` here or import the type from player — verify direction; defaults.ts already imports types from settings/home-layout).

---

### `src/lib/stores/settings.svelte.ts` (store, transform) — MODIFY

**Analog:** self. Three independent edits, each with an exact in-file precedent.

**(1) FONT_SCALE widen (UX-03 / D-11)** — change the two consts (lines 52-53). `clampInt` (lines 60-64) already widens safely; persisted 70-160 values stay valid:
```typescript
export const FONT_SCALE_MIN = 50;   // was 70
export const FONT_SCALE_MAX = 200;  // was 160
```

**(2) `upnextPerContext` map field — mirror `enabledSources` end-to-end** (the canonical object-map setting):
- Field init (line 105): `upnextPerContext = $state<Partial<Record<...>>>({});` + `upnextMode = $state<UpnextMode>(UPNEXT_DEFAULTS.mode)`.
- `load()` defensive parse (lines 202-205) — copy the `enabledSources` guard verbatim:
```typescript
this.upnextPerContext =
	v.upnextPerContext && typeof v.upnextPerContext === 'object' && !Array.isArray(v.upnextPerContext)
		? (v.upnextPerContext as Partial<Record<...>>)
		: {};
```
- `save()` serialize (line 274 region): add `upnextPerContext: this.upnextPerContext, upnextMode: this.upnextMode,`.
- `resetPlayback()` (lines 375-383): add `this.upnextPerContext = { ...DEFAULTS.upnext.perContext }; this.upnextMode = DEFAULTS.upnext.mode;` (mirrors `this.enabledSources = { ...d.enabledSources }` at line 381).
- NEW method (RESEARCH Pattern 1):
```typescript
effectiveUpnextMode(ctx: QueueContext): UpnextMode {
	if (!ctx) return this.upntextMode;                   // global default = 'generated'
	return this.upnextPerContext[ctx] ?? this.upnextMode;
}
```

**(3) Accent hover derivation (UX-07 / Pattern 5)** — in `applyTheme()` (lines 311-330), after the `--color-primary` set (line 315):
```typescript
import { darken } from '$lib/services/color';   // settings stays leaf — color.ts is pure, no store imports
r.style.setProperty('--color-primary', this.accent);
r.style.setProperty('--color-primary-hover', darken(this.accent, 0.12)); // ROOT-CAUSE FIX: hover was never set
```
**Leaf-store discipline (Pitfall 6):** settings must NOT import player. The demo-text current-track read happens in the appearance PAGE, not here. `color.ts` is a pure util — safe to import.

**Test:** `src/lib/stores/settings.svelte.test.ts` EXISTS — extend for `effectiveUpnextMode` resolution + FONT_SCALE clamp-widen.

---

### `src/lib/components/NowPlaying.svelte` (component, event-driven) — MODIFY

**Analog:** self — the Up-Next list (lines 733-759) with its existing per-row GripVertical reorder (`grip-handle` button, lines 747-755) and `onclick={() => player.play(track, { fresh: true })}` tap-to-play (line 743). The subnav header is at lines 726-731.

**Swipe-remove on each row** — add `use:swipeRemove` to the existing `.q-row` button. The grip stays a separate child with its own pointer handlers + `onclick={(e) => e.stopPropagation()}` (line 754) — the swipe action's slop/axis-lock yields vertical to the grip:
```svelte
<button class="row q-row" use:swipeRemove={{ onremove: () => player.removeFromQueue(track.uid) }}
	use:longpress onlongpress={() => openMenu(track)}
	onclick={() => player.play(track, { fresh: true })}>
```
Set `touch-action: pan-y` on `.q-row` (the action sets it, but mirror the `.np-top { touch-action: pan-x }` precedent at line 804 if a CSS declaration is preferred).

**Clear button in the Up-Next subnav header** (lines 726-731) — add beside the tab buttons, gated on a non-trivial queue:
```svelte
{#if tab === 'queue' && player.queue.length > 1}
	<button class="clear" onclick={() => player.clearQueue()} aria-label={t('nowplaying.clearQueue')}><Trash2 size={16} /></button>
{/if}
```
Import `Trash2` from `@lucide/svelte` (RESEARCH Standard Stack). New i18n key `nowplaying.clearQueue` (×15).

---

### `src/routes/(app)/artist/[name]/+page.svelte` + `album/[name]/+page.svelte` (component, event-driven) — MODIFY

**Analog:** self — the race-guarded enrichment `$effect` (artist lines 144-160, album lines 104-119). Add a PARALLEL Deezer effect cloning the `enrichedFor`-guard idiom exactly.

**Race-guarded Deezer effect (clone artist lines 146-160):**
```typescript
let dz = $state<DeezerArtistInfo | null>(null);
let dzFor = '';
let dzLoading = $state(true);
$effect(() => {
	const n = name;
	if (n && dzFor !== n) {
		dzFor = n; dz = null; dzLoading = true;
		void deezerArtist(n)
			.then((r) => { if (dzFor === n) dz = r; })       // race guard — discard if name changed
			.finally(() => { if (dzFor === n) dzLoading = false; });
	}
});
```

**Field-precedence merge (D-15)** — extract a PURE `mergeEnrich(lastfm, deezer)` helper (Wave 0 gap — testable): highest-res image wins regardless of source; counts side-by-side only if both exist and differ; additive, never replaces good per-source data (Phase 8 rule, mirrored at `heroImg = enrich?.lastfmArt ?? hero`, artist line 129).

**Skeleton (D-17)** — mirror the existing `enrichLoading`/`albumsLoading` explicit-settle flags (artist lines 48, 59; the `{:else if loading || enrichLoading}` skeleton at line 219 and the album `{#if enrichLoading}` at line 371). New Deezer sections get a `dzLoading` flag with the SAME shape-matched skeleton idiom; on a miss `dz` settles to `null` → section silently absent (D-14). Follow MEMORY skeleton rule: match loaded count/size/length.

**Marquee (MEMORY rule)** — any long Deezer text row (label, long names) uses `use:marquee` (already imported, artist line 19), never static ellipsis.

**D-18:** Deezer top-tracks are an ordering HINT only — never render dead non-playable rows; the playable list stays the CN-source `songs`.

---

### play-entry call sites (component, event-driven) — MODIFY

**Analog:** the existing `setQueue(...)` calls. Each must now pass its context (RESEARCH Code Examples lists all 11 sites):

| Call site | Line | Context to pass |
|-----------|------|-----------------|
| `artist/[name]/+page.svelte` `playArtistRandom` | 109 | `'artist'` |
| `artist/[name]/+page.svelte` hit-songs row | 317 | `'artist'` |
| `album/[name]/+page.svelte` | 212 | `'album'` |
| `search/+page.svelte` | 384 | `'search'` (← QUEUE-01 target — keep `setQueue` but `'search'` resolves to `generated`, so search results are NOT the up-next) |
| `library/+page.svelte` liked/playlist/downloads | 115 | `'liked'` / `'playlist'` / `'downloads'` |
| `library/+page.svelte` history | 120 | `'history'` |
| `(app)/+page.svelte` home tiles | 489/572/584/630/734 | `'home-discovery'` |

`playStub` (player.svelte.ts:858-859, internal `setQueue([tr])` + `play(tr,{fresh})`) should take an optional `context` arg threaded into its single internal `setQueue` (Open Question 2 recommendation — keeps one-write-path discipline). Example existing call (artist `:109-110`):
```typescript
player.setQueue([picked, ...rest]);              // → player.setQueue([picked, ...rest], 'artist')
void player.play(picked, { fresh: true });
```

---

### `src/lib/i18n/*.ts` (×15) (config, transform) — MODIFY

**Analog:** `en.ts` reference dict (defines `TranslationKey = keyof typeof en`) + 14 parity dicts; `Dict = Record<TranslationKey, string>` enforces every key in all 15 (i18n/index.ts:45-48). Add Phase-17 keys to ALL 15 at once (Pitfall 4 — a key only in `en.ts` is a build error).

**New keys (MINIMIZE — reuse existing surface keys per Open Question 3):**
- `nowplaying.clearQueue` (Clear button)
- Per-context labels: reuse existing nav/section keys where they exist (liked/search/downloads/playlist/album/artist/history likely have tab/section keys already — audit `en.ts` FIRST).
- Sourcing option labels: `settings.upnextSameList` / `settings.upnextGenerated` (2 keys).
- Deezer section headers: `lastfm`-namespace-style single unit keys (e.g. `deezer.fans`, `deezer.albums`, `deezer.released`, `deezer.label`) — numeric counts use a number + ONE unit key, not 8 strings (Pitfall 4).
- Demo-text prefix for UX-03: a single `settings.demoPrefix` ("example {name}") with `{name}` interpolation (i18n `t(key, params)` supports interpolation, index.ts:106).

15 locales: en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th. English placeholder acceptable for non-English until translated.

---

### `src/routes/(app)/settings/playback/+page.svelte` (component, request-response) — MODIFY

**Analog:** self — the `.seg`/`.chips` selector rows + `setSource`/`save()` handlers (lines 20-30, 73-81). Add one `'same-list' | 'generated'` segmented selector per context, following the existing `<section><h2>...</h2><div class="seg">...</div></section>` grouped pattern (D-02 — Settings → Playback ONLY).

**Selector row pattern (mirror the source `.chips` block, lines 73-81):**
```svelte
<section>
	<h2><ListMusic size={15} /> {t('settings.upnextSourcing')}</h2>
	{#each contexts as ctx (ctx)}
		<div class="seg-row">
			<span>{t(ctxLabelKey(ctx))}</span>
			<div class="seg">
				<button class:on={mode(ctx) === 'same-list'} onclick={() => setMode(ctx, 'same-list')}>{t('settings.upnextSameList')}</button>
				<button class:on={mode(ctx) === 'generated'} onclick={() => setMode(ctx, 'generated')}>{t('settings.upnextGenerated')}</button>
			</div>
		</div>
	{/each}
</section>
```
Handler mirrors `setSource` (line 30): write `settings.upnextPerContext = {...settings.upnextPerContext, [ctx]: v}; settings.save();`. Reset already wired via `resetPlayback()`.

---

### `src/routes/(app)/settings/appearance/+page.svelte` (component, request-response) — MODIFY

**Analog:** self — the `.ctl` slider blocks + `.prev` demo spans (lines 41-69). Two edits:

**(1) Widened range** — the `min={FONT_SCALE_MIN} max={FONT_SCALE_MAX}` bindings (lines 43,49,55,61,67) automatically pick up the new 50/200 consts. No per-slider change needed.

**(2) Dynamic demo text (D-12)** — replace the static `Stargazing`/`Myles Smith` literals (lines 44,50,56,62,68) with current-track-sourced text. Read `player.current` IN THE PAGE (Pitfall 6 — never import player into settings store):
```typescript
import { player } from '$lib/stores/player.svelte';   // page may import both
const demoTitle = $derived(player.current?.title ?? 'Stargazing');   // static fallback when nothing played
const demoArtist = $derived(player.current?.artist ?? 'Myles Smith');
```
Title sliders preview `demoTitle`, artist sliders `demoArtist`. The `.prev` span styling (lines 101-102) is unchanged.

---

## Shared Patterns

### Never-throws service posture (Phase 8 rule)
**Source:** `src/lib/services/deezer.ts` (every fn returns `null`/`[]`/empty on any miss/abort/throw, lines 120-132, 205-224)
**Apply to:** `deezerArtist`/`deezerAlbum` client fns; both new edge routes (empty shape on miss); the Deezer page sections (null → section absent, D-14)
```typescript
try { const res = await fetch(...); if (!res.ok) return null; return await res.json(); }
catch { return null; }   // miss → caller degrades gracefully, never a broken UI
```

### Own-origin proxy posture (no-key, never api.deezer.com from client)
**Source:** `src/routes/api/deezer/related/+server.ts` (lines 59-107) + `deezer.ts` header comment (lines 5-9)
**Apply to:** both new edge routes + client fns. Client ALWAYS hits `/api/deezer/*`; `encodeURIComponent` user input; fixed upstream host; `corsHeaders(origin)` + `OPTIONS`.

### Capture-after-slop, tap-preserving pointer gesture
**Source:** `src/lib/actions/dragClose.ts` (lines 52-95, esp. the "Do NOT setPointerCapture on pointerdown" comment lines 60-63) + `src/lib/gestures/velocity.ts` (flick, `FLICK_V = 0.5`)
**Apply to:** `swipeRemove.ts`. Down records start only; capture in move after slop; tap (< 8px) reaches `onclick`; flick OR distance threshold commits the action.

### k3y central-defaults pattern
**Source:** `src/lib/config/defaults.ts` (header recipe lines 1-8; `PLAYBACK_DEFAULTS` + `DEFAULTS` aggregation) + `settings.svelte.ts` field-init / `load()` / `save()` / `resetX()` quartet
**Apply to:** `UPNEXT_DEFAULTS`. Add group → register in `DEFAULTS` → reference in settings field init → it appears in reset automatically. Object-map fields mirror `enabledSources` (defensive `load()` parse + `{...d.x}` reset).

### Race-guarded enrichment $effect (page composes stores; stores never import player)
**Source:** `artist/[name]/+page.svelte` lines 146-160 (`enrichedFor` guard + `enrichLoading` explicit settle)
**Apply to:** the new Deezer artist/album effects; the appearance-page `player.current` demo read (Pitfall 6 — read in page, keep settings leaf).

### i18n 15-locale parity
**Source:** `src/lib/i18n/index.ts:45-48` (`Dict = Record<TranslationKey, string>` enforces parity at type-check)
**Apply to:** every new key — add to all 15 dicts in one batch; minimize keys (reuse surface names; numeric counts = number + one unit key).

### Manual-pin / side-Set discipline (keep Track objects clean)
**Source:** `player.svelte.ts:454-459` (`manualUids` plain Set, NOT `$state`, no origin field on Track)
**Apply to:** `removedUids` (plain Set, internal exclusion budget). `queueContext` is the ONE allowed `$state` origin field — a single player field, never per-Track (Anti-Pattern).

## No Analog Found

All files have a strong in-repo analog. No file falls back to RESEARCH.md-only patterns.

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| (none) | — | — | Every capability is an adapter onto an existing tested seam (RESEARCH "Key insight"). |

## Metadata

**Analog search scope:** `src/lib/{stores,services,actions,gestures,config,i18n}`, `src/routes/api/deezer`, `src/routes/(app)/{settings,artist,album,search,library}`, `src/lib/components/NowPlaying.svelte`
**Files scanned:** ~20 read (targeted), ~6 grepped
**Pattern extraction date:** 2026-06-10
