# Phase 8: Last.fm Read Foundation & Metadata Enrichment - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 9 (3 new, 6 modified) + 2 candidate route shapes
**Analogs found:** 9 / 9 (every file has a strong in-repo analog)

> Phase 8 is explicitly "standard patterns — mirrors `/api/similar`" (SUMMARY.md research flag). Almost every new file copies a shipped sibling from the `quick-260606-5ug` similar-artists work. Be literal: the planner should reuse these excerpts verbatim and change only the named deltas.

---

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/lib/proxy/lastfm.ts` (read-only `buildUrl`) — **candidate A (catch-all)** | NEW | proxy (edge ProxyAdapter) | request-response | `src/lib/proxy/netease.ts` | exact (role+flow) |
| `src/routes/api/lastfm/[...]/+server.ts` (dedicated read route) — **candidate B** | NEW | route (edge handler) | request-response | `src/routes/api/similar/+server.ts` | exact (role+flow) |
| `src/lib/services/lastfm.ts` (client enrichment service) | NEW | service | request-response (additive merge) | `src/lib/services/similar.ts` | exact (role+flow) |
| `src/lib/services/match-key.ts` (`{artist}+{title}` primitive) | NEW | utility | transform (pure normalize) | `src/lib/services/dedupe.ts` `key()` | exact (role+flow) |
| `src/lib/sources/types.ts` (`Track` enrich fields) | MOD | model | n/a (type contract) | `src/lib/sources/types.ts` existing optional extras (L38-49) | exact (in-file) |
| `src/lib/components/TagChips.svelte` (new chip component) | NEW | component | event-driven (display-only P8) | `NowPlaying.svelte` `.subnav`/`.row` chip styling + `app.css` tokens | role-match |
| `src/lib/components/NowPlaying.svelte` (tag chips + cover-swap) | MOD | component | request-response (async enrich) | self (L235 cover bg-image, L238-241 meta) | exact (in-file) |
| `src/routes/(app)/artist/[name]/+page.svelte` (bio + tags + image) | MOD | component (route page) | request-response (async enrich) | self (L46-57 `$effect` load, L62-67 hero) | exact (in-file) |
| `src/routes/(app)/album/[name]/+page.svelte` (art + album info) | MOD | component (route page) | request-response (async enrich) | self (L30-46 `$effect` load, L51-56 hero) | exact (in-file) |
| `src/lib/proxy/proxy-registry.ts` + `src/lib/sources/types.ts` `SourceId` | MOD | config/registry | n/a | `proxy-registry.ts` L11-16, `types.ts` L13 | exact (only if candidate A chosen) |
| **Reused as-is (no edit):** `src/lib/proxy/http.ts`, `src/lib/proxy/proxy-types.ts` | — | utility/config | — | — | — |

**Key routing fork (Claude's Discretion, CONTEXT D-36):** the read-proxy can be **(A)** a thin `proxy/lastfm.ts` `buildUrl` riding the existing `/api/[source]/[...path]` catch-all (`source=lastfm`) — ARCHITECTURE.md's recommendation — OR **(B)** a dedicated `/api/lastfm/...` route mirroring `/api/similar`. Both analogs are mapped below. Either way `LASTFM_KEY` stays edge-only.

---

## Pattern Assignments

### Candidate A — `src/lib/proxy/lastfm.ts` (proxy, request-response) — RECOMMENDED by ARCHITECTURE.md

**Analog:** `src/lib/proxy/netease.ts` (thin `buildUrl`, no auth, allow-list of upstream methods)

**buildUrl pattern** (`netease.ts:15-37`):
```typescript
export const neteaseProxy: ProxyAdapter = {
	id: 'netease',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) {
			throw new Error(`netease: unsupported path "${type}"`);
		}
		const upstream = new URL(METING_BASE);
		upstream.searchParams.set('server', 'netease');
		upstream.searchParams.set('type', type);
		const id = searchParams.get('id');
		if (id !== null) upstream.searchParams.set('id', id);
		...
		return upstream.toString();
	}
};
```

**Replicate:** the `ProxyAdapter` shape, the `ALLOWED_TYPES`/method allow-list guard (throw on unknown → catch-all returns 400), `new URL(base)` + `searchParams.set`, default-when-empty path normalization, `toString()` return.

**Change (vs netease):**
- `id: 'lastfm'`; base = `https://ws.audioscrobbler.com/2.0/`.
- **READ `env`** (netease ignores it): `upstream.searchParams.set('api_key', env?.LASTFM_KEY ?? '')` — but **netease/joox-style, the catch-all does NOT treat absent key as a clean `{}`** (it returns the upstream body). For Last.fm read methods, an absent key would produce a Last.fm error JSON, which the client service must tolerate (see `services/lastfm.ts` graceful-fallback). If you want the `/api/similar` absent-key-is-200-`{}` posture, choose **Candidate B** instead.
- Allow-list = `track.getinfo`, `artist.getinfo`, `album.getinfo` (+ later `*.gettoptags`); add `&format=json`.
- **NOTE on the catch-all's `buildUrl(env)` signature:** `proxy-types.ts:32` already passes `env` to every `buildUrl` — netease just names it `_env`. So `lastfm.ts` reading `env.LASTFM_KEY` needs no contract change. But JOOX is currently the *only* adapter that reads `env`; `lastfm` becomes the second.

**Registry wiring (MOD):**
- `src/lib/sources/types.ts:13` — widen `SourceId`: `'netease' | 'qq' | 'kuwo' | 'joox' | 'lastfm'`.
- `src/lib/proxy/proxy-registry.ts:6-16` — add `import { lastfmProxy } from './lastfm';` + `lastfm: lastfmProxy` in `PROXIES`.
- **Trap:** `PROXIES` is typed `Record<SourceId, ProxyAdapter>` AND `SOURCES` is `Record<SourceId, SourceAdapter>` (`registry.ts:10`). Widening `SourceId` makes `SOURCES` a type error until a client `sources/lastfm.ts` exists — which is **Phase 10**, not Phase 8. **This is a real cross-phase coupling the planner must resolve.** Options: (1) make `lastfm` optional in the source registry typing, (2) ship a stub `sources/lastfm.ts` in Phase 8, or (3) choose Candidate B (dedicated route) which needs NO `SourceId` widening at all. The dedicated-route path sidesteps this entirely — weigh that against ARCHITECTURE.md's "one source = two files + two lines" preference.

---

### Candidate B — `src/routes/api/lastfm/.../+server.ts` (route, request-response) — sidesteps SourceId widening

**Analog:** `src/routes/api/similar/+server.ts` (the single most reusable asset for ENRICH-03; CONTEXT specifics line 45 says "mirror exactly")

**Env read + graceful absent-key** (`similar/+server.ts:34-47`):
```typescript
export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;       // verified CF-adapter path
	const key = env?.LASTFM_KEY;
	if (!key) return jsonArtists([], origin);            // absent key = SUPPORTED 200, no throw, no upstream fetch
	const artist = url.searchParams.get('artist') ?? '';
	if (!artist.trim()) return jsonArtists([], origin);
	...
```

**Clean-shape helper + scoped CORS** (`similar/+server.ts:20-25, 79-82`):
```typescript
function jsonArtists(artists: string[], origin: string | null): Response {
	return new Response(JSON.stringify({ artists }), {
		status: 200,
		headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
	});
}
export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
```

**No-leak fetch (key on edge only, retry+timeout)** (`similar/+server.ts:50-76`):
```typescript
const upstream =
	`${LASTFM_ENDPOINT}?method=artist.getsimilar` +
	`&artist=${encodeURIComponent(artist)}` +
	`&api_key=${encodeURIComponent(key)}` +    // injected on edge — NEVER logged, NEVER in response
	`&format=json&limit=${limit}`;
try {
	const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
	const data = (await res.json()) as { ... };
	// shape a clean, deduped result
	return jsonArtists(artists, origin);
} catch {
	return jsonArtists([], origin);            // upstream error / bad JSON → best-effort empty (Pitfall 8: error 6 silent)
}
```

**Replicate (locked by CONTEXT specifics L45):** `platform?.env` read; `env?.LASTFM_KEY` with **absent-key → 200 clean-empty (never throw, never fetch `api_key=undefined`)**; `corsHeaders(origin)` (never `*`); `fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2)`; try/catch → clean-empty fallback; `OPTIONS` 204 preflight; the upstream URL/key are **never** logged (V7 / T-5ug-01).

**Change (vs `/api/similar`):**
- Method = `track.getinfo` / `artist.getinfo` / `album.getinfo` (parameterized by a `method` query param or path segment).
- Params: `track`+`artist` (track.getInfo), `artist` (artist.getInfo), `album`+`artist` (album.getInfo) — all `encodeURIComponent`'d.
- Clean shape returns enriched fields, NOT `{ artists: [] }`. Suggested: `{ tags: string[], bio: string|null, bioUrl: string|null, image: string|null, listeners?: number, playcount?: number }`. Absent-key / error-6 → return the same shape all-empty (`{ tags: [], bio: null, ... }`).
- **Placeholder-art filter MUST live here or in the service (Pitfall 8 / D-04):** drop the grey-star hash `2a96cbd8b46e442fc41c2b86b821562f` and empty `#text`; walk the `image[]` array for the largest non-empty `#text`. Sourcing art from `album.getInfo` (D-04 guardrail 1) is most reliable.

---

### `src/lib/services/lastfm.ts` (service, request-response — additive async merge)

**Analog:** `src/lib/services/similar.ts` (client → `/api/...` fetch + graceful `[]` fallback + clean shape; CONTEXT canonical-refs line 74)

**Client fetch + graceful fallback** (`similar.ts:24-34`):
```typescript
export async function getSimilarArtists(artist: string): Promise<string[]> {
	try {
		const res = await fetch(
			`/api/similar?artist=${encodeURIComponent(artist)}&limit=${SIMILAR_ARTIST_COUNT}`
		);
		const data = (await res.json()) as { artists?: string[] };
		return data?.artists ?? [];
	} catch {
		return [];                                  // any failure / no key → empty, caller falls back
	}
}
```

**Replicate:** the module-doc header explaining graceful-fallback + no-key-is-fine + "client only ever sees the clean shape, key stays server-side (T-5ug-01)"; the `try { fetch('/api/...') } catch { return <empty> }` posture; `encodeURIComponent` on every user value; never touch `platform.env` (this is the client).

**Change (vs `similar.ts`):**
- Export `enrich(track: Track): Promise<EnrichResult>` returning `{ tags, bio, bioUrl, image, listeners?, playcount? }`; empty result on any failure.
- **Additive merge, never overwrite (Pitfall 8 / ENRICH-02 non-negotiable):** fill only missing fields; for cover, only adopt `image` when strictly higher-res than the existing `track.cover` AND not the placeholder (D-04 guardrails 2+3). Compute via the new `match-key.ts` to align Last.fm `{artist,title}` with the local track.
- **OFF the critical path (Pitfall 8 / ENRICH-01):** the service is called *after* play/view resolves, never awaited before audio starts. No `searchAll`/`dedupeBest` dependency like `similar.ts` has (that's for queue building) — this only fetches getInfo and reshapes.
- Bio: strip HTML, take first ~2-3 sentences, keep English as-is (D-07); always carry `bioUrl` for the required attribution link (D-08).

---

### `src/lib/services/match-key.ts` (utility, transform — the reusable `{artist}+{title}` primitive)

**Analog:** `src/lib/services/dedupe.ts` `key()` (CONTEXT line 46/74 — "sibling to dedupe.ts's key()"; Phase 13 loved-sync consumes it)

**Normalization core** (`dedupe.ts:19-29`):
```typescript
/** Normalized identity key: title+artist, case/space/punct-insensitive, suffixes dropped. */
function key(t: Track): string {
	const norm = (s: string) =>
		(s || '')
			.toLowerCase()
			.replace(/[（(【\[].*?[)）\]】]/g, ' ')                              // drop (Live) / [Remaster] / 【...】
			.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
			.replace(/[^\p{L}\p{N}]+/gu, '')                                     // strip punctuation/space (keeps CJK + latin + digits)
			.trim();
	return `${norm(t.title)}|${norm(t.artist)}`;
}
```

**Replicate:** the exact `norm()` regex chain (lowercase → drop bracketed suffixes → drop `- remaster/live/feat.` tails → strip non-`\p{L}\p{N}` with the `u` flag → trim). This is the load-bearing normalization Phase 13 reconciliation reuses.

**Change (vs `dedupe.key()`):**
- Make it a **standalone exported helper** taking raw strings, not a `Track`: `export function matchKey(artist: string, title: string): string` (so Last.fm `{artist, name}` strings — which are NOT `Track`s — can be keyed). CONTEXT specifics L46: "standalone exported helper since Phase 13 loved-sync reconciliation consumes it."
- Output ordering: ARCHITECTURE.md/Pitfall 9 specify `normalize(artist) + ' ' + normalize(track)`; `dedupe.key()` uses `title|artist`. **Pick one canonical order and document it** — the planner should make `match-key.ts` the single source of truth and consider whether `dedupe.key()` should delegate to it (refactor risk: `dedupe.ts` has tests — verify they still pass).
- **CJK Traditional/Simplified folding is explicitly OUT (deferred to Phase 13, CONTEXT D-39).** Ship lowercasing/trim/punctuation/whitespace folding only.
- Pure module — no runes, no `$state`, no `$app/*` imports (mirrors `dedupe.ts` and `history-logic.ts` so it is node-Vitest-testable). Add a CJK fixture test (`周杰伦`/`稻香`) like the similar-endpoint test fixtures use.

---

### `src/lib/sources/types.ts` — `Track` enrich fields (model)

**Analog:** the existing optional-extras block in the same file (`types.ts:38-49`)

**Existing optional-extras pattern** (`types.ts:38-49`):
```typescript
	// --- source-specific extras (from the serializeTrack whitelist) — optional ---
	songMid?: string; // QQ/JOOX
	qqId?: string; // QQ
	...
	pay?: string | null; // QQ paywall signal
	pageUrl?: string; // QQ
```

**Replicate:** append optional fields in the same style with inline comments, e.g.:
```typescript
	// --- Last.fm enrichment (Phase 8, additive/optional) — never overwrites source data ---
	tags?: string[];        // top-5 display tags
	bio?: string;           // English bio snippet, HTML-stripped (D-07)
	bioUrl?: string;        // Last.fm attribution link, REQUIRED when bio shown (D-08)
	lastfmArt?: string;     // hi-res cover candidate, placeholder-filtered (D-04)
```

**CRITICAL persistence trap (CONTEXT D-38 + Established Patterns):**
- **There is NO `serializeTrack` whitelist on the library path.** `library.svelte.ts:49` persists FULL `Track` objects: `JSON.stringify({ liked: this.liked, playlists: this.playlists, downloads: this.downloads })`. Adding fields to `Track` ⇒ they WILL be persisted into `localStorage` library for liked/playlist tracks. That is acceptable (they're small, JSON-safe) but means the enrich fields become part of the persisted shape — `Library.load()` (`library.svelte.ts:35`) reads them back untyped via `v.liked ?? []`, so no migration is needed, but volatile/stale tags could persist.
- The ONE real whitelist is `history-logic.ts:36-50` `toEntry()` — it lists fields explicitly and **drops anything not named**. Enrich fields will simply NOT survive into history entries (fine — they re-enrich on replay). Do NOT add them to `HistoryEntry`/`toEntry` (keeps history minimal, ENRICH stays lazy).
- **Planner decision (CONTEXT D-38):** extend `Track` with optional fields (simplest, shown above) **vs** a side enrichment cache keyed by `uid`/match-key (keeps `Track` pure, avoids persisting volatile enrich data into the library). The side-cache option better honors "enrichment is volatile, off the critical path" but adds a new store. Recommend the optional-fields approach for P8 simplicity unless persisted-staleness is a concern; either way `library.load()` and `history-logic.toEntry()` must stay green.

---

### `src/lib/components/TagChips.svelte` (NEW component) + `NowPlaying.svelte` (MOD)

**Analogs:** `NowPlaying.svelte` (where chips + cover-swap land) + `app.css` design tokens.

**Where tags chips land — under the title** (`NowPlaying.svelte:238-241`):
```svelte
<div class="meta">
	<div class="title">{player.current ? names.dn(player.current.title) : ''}</div>
	<button class="artist" onclick={openArtist}>{player.current ? names.dn(player.current.artist) : ''}</button>
</div>
```
Insert a `<TagChips tags={...} />` row right after `.meta` (D-01a: chips under the title).

**Cover bg-image (the swap target)** (`NowPlaying.svelte:235`):
```svelte
style:background-image={player.current?.cover ? `url(${player.current.cover})` : fallbackCover(player.current)}
```
**Cover-swap rule (D-03/D-04):** only swap to the Last.fm image when strictly higher-res AND not placeholder AND **preloaded** (D-04 guardrail 4 — `new Image(); img.onload = () => swap`) so the bg doesn't flash. Best-effort/async (guardrail 5) — never blocks first paint. ENRICH-02 overrides D-03: a real cover NEVER regresses to placeholder/broken.

**Chip styling source** (reuse `app.css` tokens + `NowPlaying.svelte` `.subnav` button look):
- Tokens from `app.css:2-24`: `--color-surface`, `--color-surface-2`, `--color-text-muted`, `--color-primary`, `--radius-full` (9999px — ideal for chips), `--color-border`.
- The `.subnav button` (`NowPlaying.svelte:369`) and `.row` (`L373`) show the established pill/row button look (background:none, muted text, `--color-primary` active).

**Build for Phase 9 (D-06):** chips are **display-only in P8** but structure the component so a future `onclick`/`href` makes them tappable→discovery without a rewrite (e.g. accept an optional `onTagClick` prop, default no-op; render as `<button>`-or-`<span>` styled identically).

**i18n / display-name layer (CONTEXT specifics L47):** chips/bio coexist with `names.dn()` — bio text is English-as-is (not run through `dn()`); tag/artist labels that ARE titles/artists still use `names.dn()`. Use `t(...)` from `$lib/i18n` for any static labels ("Read more on Last.fm", section headings).

---

### `src/routes/(app)/artist/[name]/+page.svelte` (MOD — bio + tags + better image)

**Analog:** self — the existing derived-search page with its async `$effect` load.

**Existing async-load pattern to mirror for enrichment** (`artist/[name]/+page.svelte:46-57`):
```typescript
$effect(() => {
	const n = name;
	if (n && loadedFor !== n) {
		loadedFor = n; loading = true; songs = [];
		searchAll(n, 1)
			.then((r) => (songs = dedupeBest(r.interleaved, settings.preferredSource)))
			.catch(() => (songs = []))
			.finally(() => (loading = false));
	}
});
```

**Hero/image swap target** (`artist/[name]/+page.svelte:62-67`):
```svelte
<div class="herocover" style:background-image={hero ? `url(${hero})` : 'linear-gradient(...)'}></div>
<h1>{names.dn(name)}</h1>
<p class="note">{t('artist.derived', { count: songs.length })}</p>
```

**Replicate / Change:** add a SECOND `$effect` (or extend) that, keyed on `name` with its own `enrichedFor` guard, calls `services/lastfm.enrichArtist(name)` → sets `bio`/`bioUrl`/`tags`/`image`. It must NOT block the existing `searchAll` track-list load (D-02: enrichment augments, does not replace). Render the bio paragraph + `<TagChips>` + the **always-present** "Read more on Last.fm" attribution link (D-08) below the hero. Prefer the Last.fm artist image for the hero only when present + non-placeholder (else keep the derived `hero`). Reuse the `.note`/`section`/`.muted` styles already in the file.

---

### `src/routes/(app)/album/[name]/+page.svelte` (MOD — album art + info)

**Analog:** self — same derived-search `$effect` structure as the artist page.

**Existing load + hero** (`album/[name]/+page.svelte:30-46, 51-56`):
```typescript
$effect(() => {
	const n = name;
	if (n && loadedFor !== n) {
		loadedFor = n; loading = true; tracks = [];
		searchAll(n, 1).then((r) => { ... tracks = exact.length ? exact : all; })
			.catch(() => (tracks = [])).finally(() => (loading = false));
	}
});
```
```svelte
<div class="cover" style:background-image={hero ? `url(${hero})` : 'linear-gradient(...)'}></div>
```

**Replicate / Change:** add an enrichment `$effect` calling `services/lastfm.enrichAlbum(name, artist)` → set hi-res album art (placeholder-filtered, swap-when-better per D-04) + album info (listeners/playcount per D-01c). Render the info line near `.note` (`L55`). Same non-blocking, augment-not-replace posture; reuse `.note`/`.muted` styles.

---

## Shared Patterns

### Edge secret confinement + no-leak (applies to whichever read route is chosen)
**Source:** `src/routes/api/similar/+server.ts:34-43` + `similar-endpoint.test.ts`
**Apply to:** the Last.fm read endpoint (Candidate A `lastfm.ts` buildUrl or Candidate B route) and `services/lastfm.ts`.
- `LASTFM_KEY` read ONLY via `platform?.env` on the edge; injected into the upstream URL; **never** in the response body/headers; **never** logged (T-5ug-01 / V7).
- Absent key is a **first-class supported state** (Candidate B returns 200 clean-empty; Candidate A surfaces Last.fm's own error which the service treats as empty).
- **Mandatory no-leak test** (mirror `similar-endpoint.test.ts:33-65`): stub `fetch`, assert the captured upstream URL contains `api_key=<FAKE>` AND a non-ASCII fixture (`周杰伦`) encoded, AND the response body + `JSON.stringify([...res.headers.entries()])` do NOT contain the fake key. Plus the absent-key test (`:67-84`: no fetch, `api_key=undefined` never requested) and the malformed-JSON test (`:86-98`).

### Network helpers (reuse as-is — no new edge HTTP layer; Anti-Pattern 5)
**Source:** `src/lib/proxy/http.ts` (`fetchWithRetry` L48-74, `corsHeaders` L26-36)
**Apply to:** any edge fetch + every response.
- `fetchWithRetry(url, { signal: AbortSignal.timeout(8000) }, 2)` — native timeout, bounded retry on 429/5xx (Pitfall 11 rate-limit safety comes free).
- `corsHeaders(origin)` — own-origin allow-list, **never `*`** (T-01-02). Candidate A gets this automatically from the catch-all route; Candidate B must spread it like `/api/similar` does.

### Env contract (no edit needed)
**Source:** `src/lib/proxy/proxy-types.ts:11-23`
`Env` ALREADY declares `LASTFM_KEY?` (L17) and `LASTFM_SECRET?` (L22) as server-only optional. Phase 8 only needs `LASTFM_KEY` (no signing). **No change to `proxy-types.ts`.**

### Pure, node-testable logic modules
**Source:** `src/lib/services/dedupe.ts` + `src/lib/history/history-logic.ts` (header doc L1-8)
**Apply to:** `services/match-key.ts` — no runes, no `$app/*`, types-only `Track` import. Mirrors how `dedupe.ts`/`history-logic.ts` stay plain-Vitest-testable. Add the CJK fixture test here.

### Async enrichment is OFF the critical path (Pitfall 8 / ENRICH-01 — cross-cutting)
**Source:** `player.svelte.ts:120-155` `play()` — note enrichment hooks must come AFTER `await this.audio.play()` and be `void`-fired (like `void this.regenerate(resolved)` on L148), never awaited before audio starts. `player.current` (L23) is the enrich trigger source.
**Apply to:** every call into `services/lastfm.enrich*`. Trigger timing (on-play vs on-view vs both) is Claude's Discretion (CONTEXT D-37) provided it stays async + non-blocking.

---

## No Analog Found

None. Every Phase 8 file maps to a strong in-repo analog. The two areas with the *weakest* (still adequate) analogs:

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `TagChips.svelte` | component | event-driven | No existing dedicated "chip" component; compose from `app.css` tokens + `NowPlaying.svelte` `.subnav`/`.row` button styling. RESEARCH FEATURES.md image-array handling guides the placeholder filter. |
| cover-swap preload guard | UI logic | async | No existing image-preload-before-swap in the repo (`NowPlaying.svelte:235` sets bg-image directly). Implement the `new Image().onload` preload per D-04 guardrail 4 — net-new but trivial. |

---

## Metadata

**Analog search scope:** `src/lib/proxy/`, `src/lib/sources/`, `src/lib/services/`, `src/lib/stores/`, `src/lib/components/`, `src/lib/history/`, `src/routes/api/`, `src/routes/(app)/`, `src/app.css`
**Files scanned/read:** 17 (similar route + test, similar/dedupe/match services, http/proxy-types/types/registries, netease proxy, catch-all route, NowPlaying, artist page, album page, player store, app.css, history-logic, library store)
**Pattern extraction date:** 2026-06-06
**Key cross-phase coupling flagged for planner:** widening `SourceId` to include `'lastfm'` (Candidate A) breaks the `SOURCES` `Record<SourceId, SourceAdapter>` type until a Phase-10 client source exists — Candidate B (dedicated route) avoids this. The persistence "whitelist" the CONTEXT warns about does NOT exist on the library path (`library.svelte.ts:49` persists full Tracks); it only exists in `history-logic.toEntry()`.
