# Phase 9: Discovery / Hot-Picks Tab - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 9 (2 endpoint candidates + 1 service + 1 home page + 1 artist page + 1 album page + 2 reused resolvers + 1 player store)
**Analogs found:** 9 / 9 (every new/modified file has a strong in-repo analog — no greenfield files)

> Phase 9 has **no net-new file roles**. Every deliverable either EXTENDS a Phase-8 file or MODIFIES an existing page. The one architectural decision is the **endpoint fork** (extend `/api/lastfm/info` allow-list vs new `/api/lastfm/discovery`) — both candidates mapped below. The whole phase is "copy the Phase-8 edge/enrichment posture and the existing page wiring, add list-shaped reshapers + a resolve-on-tap shim."

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/routes/api/lastfm/info/+server.ts` (EXTEND allow-list — Candidate A) | route / edge-proxy | request-response (read-through cache) | itself (Phase 8) | exact (self-extension) |
| `src/routes/api/lastfm/discovery/+server.ts` (NEW route — Candidate B) | route / edge-proxy | request-response (read-through cache) | `src/routes/api/lastfm/info/+server.ts` | exact |
| `…/discovery/*.test.ts` or extend `lastfm-info-endpoint.test.ts` | test | request-response | `…/lastfm/info/lastfm-info-endpoint.test.ts` | exact |
| `src/lib/services/lastfm.ts` (EXTEND: discovery list + getTopAlbums + album-tracklist builders) | service | CRUD (read) / batch fan-out | itself (`enrichArtist`/`enrichAlbum`) | exact (self-extension) |
| Resolve-on-tap shim (D-03) — likely in `lastfm.ts` or a small `discovery.ts` helper | service | transform (stub → playable Track) | `src/lib/services/similar.ts` + `picks.ts` (`searchAll`+`dedupeBest`) | exact |
| `src/routes/(app)/+page.svelte` (home Top-picks shelves) | component (page) | request-response → list render | itself (`.section`/`buildDiversePicks`) + artist `.albumrow` | exact (self-modification) |
| `src/routes/(app)/artist/[name]/+page.svelte` (real `artist.getTopAlbums`) | component (page) | request-response → list render | itself (derived `albums` + `.albumrow`) | exact (self-modification) |
| `src/routes/(app)/album/[name]/+page.svelte` (real `album.getInfo` tracklist + select-to-play) | component (page) | request-response → list render | itself (derived tracklist + `.list`/`.row`) | exact (self-modification) |
| `src/lib/services/catalog.ts` `searchAll` + `src/lib/services/dedupe.ts` `dedupeBest` | service (REUSE, do not modify) | transform | used as-is | reuse |
| `src/lib/stores/player.svelte.ts` `setQueue`/`play` | store (REUSE, do not modify) | event-driven | used as-is | reuse |

---

## THE ENDPOINT FORK (Claude's Discretion — decide in plan)

The Phase-8 endpoint's allow-list is **read-only getInfo** and its reshaper returns a **single entity** (`LastfmInfo`). Discovery needs **list-shaped** methods (`chart.gettoptracks`, `chart.gettopartists`, `tag.gettoptracks`, `geo.gettoptracks`, `artist.gettopalbums`) whose responses are arrays under a different envelope (`{ tracks: { track: [...] } }`, `{ artists: { artist: [...] } }`, `{ topalbums: { album: [...] } }`, `{ albuminfo... tracks: { track: [...] } }`).

### `src/routes/api/lastfm/info/+server.ts:25` — the allow-list to widen (Candidate A)
```ts
const ALLOWED_METHODS = new Set(['track.getinfo', 'artist.getinfo', 'album.getinfo']);
```
### `…/+server.ts:218` — the single-entity unwrap that does NOT generalize to lists
```ts
const entity = data.track ?? data.artist ?? data.album;
if (!entity) return jsonInfo(EMPTY, origin);
return jsonInfo(reshape(entity), origin);
```

**Candidate A — EXTEND `/api/lastfm/info`:** add the 5 methods to `ALLOWED_METHODS`, add list-shaped reshapers, and branch the response (single `LastfmInfo` vs a new `LastfmList` shape). Cheapest plumbing (reuse `corsHeaders`/`fetchWithRetry`/`pickImage`/the no-leak posture verbatim), but **mixes two response contracts in one route + one test file**, and `album.getinfo` is already there (overlap on the tracklist need).

**Candidate B — NEW `/api/lastfm/discovery/+server.ts`:** copy the entire file structure (lines 14–53 header/`jsonX`/CORS, 184–225 GET skeleton, 228–230 OPTIONS) but with a list reshaper + a `LastfmList` shape. Clean separation (charts/tags/geo/topalbums all return `{ items: [...] }`; `/info` stays single-entity), its own focused test, easier per-method TTLs. Slight duplication of the header/CORS/retry boilerplate.

**Recommendation to surface (not decide here):** Candidate B for the *list* methods (chart/tag/geo/artist.getTopAlbums), and **reuse the existing `/api/lastfm/info` `album.getinfo`** for the album-tracklist need (the `album.getInfo` response already carries `tracks` — `/info`'s reshaper currently drops them; either add tracks to `LastfmInfo` or fetch the tracklist via the new discovery route). Whichever fork, **mirror the Phase-8 posture exactly** (below).

---

## Shared Patterns (apply to BOTH endpoint candidates)

### Edge-secret + absent-key-graceful posture (MANDATORY — copy verbatim)
**Source:** `src/routes/api/lastfm/info/+server.ts:184-225`
**Apply to:** the discovery endpoint (whichever fork)
```ts
export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;
	// No key → 200 all-empty, NO upstream fetch (T-08-02). Mirror this for discovery:
	if (!key) return jsonInfo(EMPTY, origin);            // → return jsonList([], origin)
	const method = (url.searchParams.get('method') ?? '').toLowerCase();
	if (!ALLOWED_METHODS.has(method)) return jsonInfo(EMPTY, origin); // T-08-03 allow-list
	// …client params encodeURIComponent'd; key injected on the edge, never logged…
	const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
	const data = await res.json();
	if (data?.error) return jsonInfo(EMPTY, origin);     // error-6/29 → silent empty
	// …reshape…
};
```
- **Absent `LASTFM_KEY` → 200 empty, no fetch.** This is the D-06 fallback trigger: the client falls back to `buildDiversePicks` when discovery returns empty.
- **Allow-list every method** (T-08-03). For discovery the new set is exactly: `chart.gettoptracks`, `chart.gettopartists`, `tag.gettoptracks`, `geo.gettoptracks`, `artist.gettopalbums` (+ keep `album.getinfo` if extending `/info`).
- **Key injected on edge, never in body/headers/logs** (T-08-01). Reuse the no-leak test (see test analog).
- **`data.error` → empty.** Last.fm rate-limit is **code 29** (Pitfall 11) — it lands here as a graceful empty, never an exception.

### CORS scoped to own origin (never `*`)
**Source:** `src/lib/proxy/http.ts:26-36` (`corsHeaders`) + `…/info/+server.ts:48-53,228-230`
**Apply to:** the discovery endpoint's JSON responder + `OPTIONS` handler
```ts
function jsonInfo(info, origin) {
	return new Response(JSON.stringify(info), {
		status: 200,
		headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
	});
}
export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
```

### fetchWithRetry (already backs off 429/5xx) — reuse for ALL Last.fm calls
**Source:** `src/lib/proxy/http.ts:48-74`
**Apply to:** every upstream call in the discovery endpoint. `RETRYABLE_STATUS` already includes 429 (`http.ts:38`), so Pitfall-11 rate-limit retry is free.

### >>> PITFALL 11 — RATE-LIMIT / FAN-OUT (call out at the endpoint analog) <<<
**Concern owner:** the discovery endpoint + the `lastfm.ts` discovery builders.
- The Cache API is **NOT yet used anywhere in this repo** (`grep caches.*` → no hits) — this phase introduces it. Wrap each upstream read in Cloudflare `caches.default` keyed by the upstream URL: charts ~1h, tags ~6h, `artist.getTopAlbums`/`album.getInfo` ~24h (per CONTEXT discretion + research). Add `Cache-Control: public, max-age=<ttl>` to the response (safe — all discovery data is PUBLIC, no `sk`, contrast Pitfall 10's personalized-cache trap which does NOT apply here).
- **Prefer the batch top-list endpoints** — one `chart.getTopTracks` returns ~50 items; do NOT N+1 a per-item `track.getInfo` over them (Pitfall 11 / "Looks Done But Isn't").
- If the home page DOES fan out (4 shelves + N tag rows + M geo rows in parallel), **cap concurrency 3–5 in-flight** in the client builder (a small pool, not unbounded `Promise.all`/`allSettled` over every shelf at once). The existing `searchAll`/`buildDiversePicks` use unbounded `allSettled` — for discovery, add a pool. See `lastfm.ts` builder section.

---

## Pattern Assignments

### `src/lib/services/lastfm.ts` — EXTEND with discovery + getTopAlbums + tracklist builders (service, CRUD/batch)

**Analog:** itself — `enrichArtist`/`enrichAlbum` (`lastfm.ts:120-135`) and its `fetchInfo` helper (`:45-54`).

**Fetch + graceful-empty pattern to mirror** (`lastfm.ts:44-54`):
```ts
async function fetchInfo(params: Record<string, string>): Promise<LastfmInfo> {
	try {
		const qs = new URLSearchParams(params).toString();
		const res = await fetch(`/api/lastfm/info?${qs}`);          // → /api/lastfm/discovery for lists
		const data = (await res.json()) as LastfmInfo;
		return data ?? {};
	} catch {
		return {};                                                   // NEVER throws — empty on any failure
	}
}
```
**Builder shape to mirror** (`lastfm.ts:120-135`) — each new builder is `try { return reshape(await fetch…) } catch { return [] }`, capped, never throws:
```ts
export async function enrichArtist(name: string): Promise<EnrichResult> {
	try { return toResult(await fetchInfo({ method: 'artist.getinfo', artist: name })); }
	catch { return { ...EMPTY }; }
}
```
**What to ADD (new exports, same posture):**
- `getChartTopTracks()`, `getChartTopArtists()`, `getTagTopTracks(tag)`, `getGeoTopTracks(country)` → each returns a clean `{ artist, title, image }[]` (or `{ name, image }[]` for artists) list, `[]` on any failure.
- `getArtistTopAlbums(artist)` → clean `{ name, image }[]` for the artist page (D-04).
- `getAlbumTracklist(album, artist)` → ordered `{ artist, title }[]` for the album page (D-05). NOTE the country param for geo is the **ISO 3166-1 NAME, not code** (FEATURES.md, e.g. `United States` not `US`).
**What to CHANGE vs `enrich*`:** the reshape target is a **list** (`{ items: [...] }`), not the single `EnrichResult`. The image-array → URL logic already lives ON THE EDGE (`pickImage`, `+server.ts:91-102`) — keep it there; the client builder just consumes the already-cleaned `image: string | null` per item. Apply the **concurrency cap** here if the home page fans out many shelves at once (Pitfall 11).

---

### Resolve-on-tap shim (D-03) — stub `{artist, title}` → playable `Track` (service, transform)

> **THE LOAD-BEARING NEW PIECE.** Discovery items are Last.fm `{artist, title}` stubs — they are NOT `Track`s (no `uid`/`source`/`audioUrl`), so they **cannot** be handed to `player.play()` directly the way the existing pages hand real `Track`s. Tap-to-play must FIRST resolve via `searchAll`, exactly like `similar.ts`/`picks.ts` already do.

**Analog:** `src/lib/services/similar.ts:55-71` and `src/lib/services/picks.ts:28-38` — the established `{string} → searchAll → interleaved[0] → dedupeBest` resolver.

**`picks.ts:30-37` — the resolve-and-pick pattern to copy per-tapped-item:**
```ts
const results = await Promise.allSettled(artists.map((a) => searchAll(a, 1)));
const tops: Track[] = [];
for (const r of results) {
	if (r.status !== 'fulfilled') continue;
	const top = r.value.interleaved[0];          // best cross-source hit for the query
	if (top) tops.push(top);
}
return dedupeBest(tops, settings.preferredSource).filter((t) => !excludeUids.has(t.uid));
```
**`similar.ts:69-71` — the single-query fallback shape (closest to a per-tap resolve):**
```ts
const r = await searchAll(track.artist, 1);
return dedupeBest(r.interleaved, settings.preferredSource).filter(keep).slice(0, FALLBACK_LIMIT);
```
**What to BUILD:** a `resolveStub(artist, title): Promise<Track | null>` →
`const r = await searchAll(\`${artist} ${title}\`, 1); const best = dedupeBest(r.interleaved, settings.preferredSource)[0] ?? null; return best;`
- **Lazy / on-tap** (CONTEXT discretion lean): resolve ONLY the tapped item, not the whole shelf — avoids fan-out (Pitfall 11). Album tracklist: resolve a song only when its row is tapped (D-05).
- **Graceful degrade** (D-03): `null` → show "unplayable"/skip, never break the surface or the player.
- **DO NOT modify `catalog.ts` or `dedupe.ts`** — pure reuse (they already resolve `{string} → playable Track`).

---

### `src/routes/(app)/+page.svelte` — home Top-picks shelves (component, request-response)

**Analog:** itself — the `.section` block (`+page.svelte:103-130`), the `CACHE_KEY`/`loadCache`/`saveCache` pattern (`:19,31-47`), and the artist page's horizontal `.albumrow` (`artist/[name]/+page.svelte:117-126,162-166`) for the per-shelf horizontal row.

**Tile + tap-to-play markup to mirror** (`+page.svelte:117-126`) — BUT the onclick changes (stubs aren't Tracks):
```svelte
{#each songs as t (t.uid)}
	<button class="tile" use:longpress onlongpress={() => { menuTrack = t; menuOpen = true; }}
	        onclick={() => { player.setQueue(songs); player.play(t); }}>
		<div class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></div>
		…
{/each}
```
**`fallbackCover` (`+page.svelte:25-28`) — reuse verbatim** for chart/tag items with no Last.fm art (placeholder-star already filtered on the edge, so `cover` is real-or-null).

**What to CHANGE:**
- Primary source becomes the Last.fm shelves from `lastfm.ts` discovery builders (D-01/D-02); FOUR shelves: top hits / top artists / per-tag rows / per-country rows. Each shelf is a horizontal scroll row — copy the artist `.albumrow` flex styles (`artist/[name]/+page.svelte:162-166`), not the home 3-col `.grid`.
- **Tap handler:** discovery tiles hold STUBS → onclick must `const tr = await resolveStub(item.artist, item.title); if (tr) { player.setQueue([tr]); player.play(tr); }` (the resolve-on-tap shim above). The existing `player.setQueue(songs); player.play(t)` only works once items are real Tracks.
- **Top-artists shelf** taps → `goto('/artist/' + encodeURIComponent(name))` (D-02), reusing the existing artist-page route — NO resolve needed for artists.
- **D-06 FALLBACK:** keep `buildDiversePicks` (`picks.ts:28`) wired as the fallback when the discovery builders return empty (absent key / Last.fm error). The existing `refresh()`/`CACHE_KEY` cache+seed flow (`+page.svelte:50-67`) is the template — keep caching the resolved/displayed shelves to localStorage for instant render.

---

### `src/routes/(app)/artist/[name]/+page.svelte` — real `artist.getTopAlbums` (component, request-response)

**Analog:** itself — the derived `albums` block (`artist/[name]/+page.svelte:42-54`) + the `.albumrow` render (`:114-126`) + the SEPARATE-`$effect` enrichment pattern (`:76-85`).

**Derived-albums block being REPLACED** (`:42-54`) — currently groups `searchAll` results by `track.album`:
```ts
type Album = { name: string; cover: string | null; tracks: Track[] };
const albums = $derived.by<Album[]>(() => {
	const map = new Map<string, Album>();
	for (const t of songs) { const a = (t.album || '').trim(); … }   // ← the approximation D-04 replaces
	return [...map.values()].sort((x, y) => y.tracks.length - x.tracks.length);
});
```
**SEPARATE-effect enrichment pattern to mirror for the new top-albums fetch** (`:76-85`):
```ts
let enrich = $state<EnrichResult | null>(null);
let enrichedFor = '';
$effect(() => {
	const n = name;
	if (n && enrichedFor !== n) {
		enrichedFor = n;
		enrich = null;
		void enrichArtist(n).then((r) => { if (enrichedFor === n) enrich = r; }); // race-guard
	}
});
```
**Album-row click to ADAPT** (`:117-126`):
```svelte
<button class="album" onclick={() => { player.setQueue(al.tracks); player.play(al.tracks[0]); }}>
```
**What to CHANGE:**
- Replace the `track.album`-grouped `albums` derived with a real `getArtistTopAlbums(name)` fetch in its own race-guarded `$effect` (clone the `enrichedFor` guard, use a new `albumsFor` guard). Albums become `{ name, image }` from Last.fm.
- **Album click → navigate to the album page** (D-05: clicking an album opens `/album/[name]` with the REAL tracklist), i.e. `goto('/album/' + encodeURIComponent(al.name))` — NOT the current `player.setQueue(al.tracks)` (those derived tracks no longer exist for a Last.fm album). The current `player.setQueue(al.tracks); player.play(al.tracks[0])` is the OLD derived behavior being superseded.
- Keep the existing `searchAll`-derived **Hit songs** list (`:129-144`) and the Phase-8 bio/tags hero (`:96-108`) untouched — D-04 only swaps the albums section.

---

### `src/routes/(app)/album/[name]/+page.svelte` — real `album.getInfo` tracklist + select-to-play (component, request-response)

**Analog:** itself — the derived tracklist `$effect` (`album/[name]/+page.svelte:48-64`), the `.list`/`.row` render with `<Play>` icon (`:104-115`), and the album-artist-keyed enrichment effect (`:70-81`).

**Tracklist load being REPLACED** (`:48-64`) — currently `searchAll(albumName)` filtered by exact `track.album`:
```ts
searchAll(n, 1).then((r) => {
	const all = dedupeBest(r.interleaved, settings.preferredSource);
	const exact = all.filter((t) => (t.album || '').trim() === n);   // ← the approximation D-05 replaces
	tracks = exact.length ? exact : all;
});
```
**Row + select-to-play markup to mirror** (`:104-115`) — onclick changes (tracklist items are STUBS):
```svelte
{#each tracks as track, i (track.uid)}
	<button class="row" use:longpress onlongpress={…}
	        onclick={() => { player.setQueue(tracks); player.play(track); }}>
		<span class="rank">{i + 1}</span>
		<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
		<span class="meta">…</span>
		<Play size={16} />
{/each}
```
**What to CHANGE:**
- Replace the `searchAll`-grouped tracklist with `getAlbumTracklist(name, albumArtist)` → ordered Last.fm `{artist, title}` stubs (D-05). The artist comes from a route/query param or the navigating link (the page currently derives `albumArtist` from `tracks[0]` — `:41` — which won't exist before the real tracklist loads; pass the artist in the URL/state from the artist page link instead).
- **Select-to-play = resolve-on-tap** (D-05/D-03): row onclick must `const tr = await resolveStub(track.artist, track.title); if (tr) { player.setQueue([tr]); player.play(tr); }` — **lazy** (resolve only the tapped song, CONTEXT discretion lean), NOT eager-resolve all on album open (Pitfall 11). The current `player.setQueue(tracks); player.play(track)` only works on real Tracks.
- Keep the Phase-8 `enrichAlbum` listeners/playcount hero (`:70-99`) untouched; the new tracklist fetch can share or sit beside it.

---

## Player wiring (REUSE — do not modify)

**Source:** `src/lib/stores/player.svelte.ts:154-156, 207`
```ts
setQueue(tracks: Track[]) { this.queue = dedupeBest(tracks, settings.preferredSource); }
async play(track: Track, opts?: { fresh?: boolean }) { … await ensureTrackDetails(track) … }
```
- `play()` already calls `ensureTrackDetails` (`:218`) and handles `!resolved.audioUrl` gracefully (`:223-226` → sets `this.error`, clears media, returns — never throws). So once `resolveStub` returns a real `Track`, the existing player path handles resolution + the unplayable case for free.
- Both `setQueue` and `play` take **real `Track[]`/`Track`** — confirming the resolve-on-tap shim is REQUIRED before calling them with discovery stubs.

---

## Test analog

**Source:** `src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts` (the whole file)
**Apply to:** the discovery endpoint (extend this file for Candidate A, or a sibling `discovery.test.ts` for Candidate B).
Copy these cases for the new methods:
- **No-leak** (`:61-99`): fake key present in captured upstream URL with a `周杰伦` CJK fixture, ABSENT from body + `[...res.headers.entries()]`.
- **Absent-key** (`:101-125`): 200 empty list shape AND `fetch` NOT called (no `api_key=undefined`).
- **Method allow-list** (`:165-178`): a method outside the new discovery set → empty, no fetch.
- **error body** (`:144-163`): Last.fm `error` (incl. **code 29 rate-limit**) → empty list, no throw.
- **placeholder filter** (`:180-208`): grey-star hash in a chart/tag/album item → that item's image is null.
- **OPTIONS** (`:282-295`): 204 with scoped `Access-Control-Allow-Origin` (never `*`).
- **NEW for discovery:** add a list-reshape assertion (chart/tag/geo array → cleaned `{ items: [...] }`) and a **`Cache-Control: public`** assertion if the plan adds the Cache API TTLs.

---

## No Analog Found

None. Every Phase-9 deliverable maps to an exact in-repo analog (Phase-8 endpoint/service, the existing home/artist/album pages, and the `searchAll`/`dedupeBest`/`player` reuse). The only NEW code shape is the **list reshaper** on the edge and the **`resolveStub` transform** in the service — both are minor variations of patterns already present (`pickImage`/`pickTags` on the edge; `searchAll`+`dedupeBest` in `picks.ts`/`similar.ts`). The one NEW infra primitive is the **Cloudflare Cache API** (`caches.default`), which has no current usage in the repo — treat its TTL wrapper as net-new (research provides the TTLs).

## Metadata

**Analog search scope:** `src/routes/api/lastfm/`, `src/routes/(app)/`, `src/lib/services/`, `src/lib/proxy/`, `src/lib/stores/`, `src/lib/sources/`
**Files scanned:** 11 read in full + 1 grep sweep (Cache API / player signatures / Track type)
**Pattern extraction date:** 2026-06-06
