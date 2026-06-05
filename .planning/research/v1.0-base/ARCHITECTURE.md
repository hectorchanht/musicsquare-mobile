# Architecture Research

**Domain:** Mobile-first SvelteKit PWA music player with a Cloudflare Worker API-proxy in front of multiple unofficial music sources
**Researched:** 2026-06-05
**Confidence:** HIGH (verified against current SvelteKit, Cloudflare Workers, MediaSession docs; existing reusable data layer is already mapped in `.planning/codebase/`)

> Scope note: this document covers HOW to structure the rebuild — component boundaries, data flow, the pluggable source-adapter interface, and build order. It does NOT re-research the upstream proxy APIs themselves (already documented in `.planning/codebase/INTEGRATIONS.md`).

---

## Standard Architecture

### System Overview

Three tiers, with a hard network boundary between the browser and the Cloudflare Worker, and a hard module boundary inside the browser between the **service/data layer** (extracted from the monolith) and the **Svelte UI layer**.

```
┌───────────────────────────────────────────────────────────────────────┐
│                          BROWSER (SvelteKit PWA)                        │
│                                                                         │
│  UI LAYER  (Svelte 5 components + routes)            [REPLACE — new]    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ /search  │ │ /library │ │/playlist │ │ now-     │ │ bottom-nav   │  │
│  │  route   │ │  route   │ │  route   │ │ playing  │ │ shell+mini   │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │            │            │              │          │
│       └────────────┴─────┬──────┴────────────┴──────────────┘          │
│              read .svelte.ts rune stores / call actions                 │
│  ─────────────────────────┼─────────────────────────────────────────   │
│  STATE LAYER (rune stores, .svelte.ts)              [REUSE state model] │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐   │
│  │ playerStore│ │ queueStore │ │ searchStore│ │ libraryStore       │   │
│  │ (current,  │ │ (active    │ │ (results,  │ │ (favorites,        │   │
│  │  isPlaying)│ │  list+idx, │ │  loading)  │ │  playlists)        │   │
│  └─────┬──────┘ │  mode)     │ └─────┬──────┘ └─────────┬──────────┘   │
│        │        └─────┬──────┘       │                  │              │
│  ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ─┼ ─ ─ ─ ─ ─ ─ ─ ─ ─┼ ─ ─ ─ ─ ─    │
│  SERVICE/DATA LAYER (pure TS, no DOM)               [REUSE — extract]   │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │ audioEngine │ │ catalog svc  │ │ persist  │ │ source registry  │    │
│  │ (<audio> +  │ │ (search agg, │ │ (idb/ls) │ │ ┌──────────────┐ │    │
│  │ MediaSession│ │ ensureDetail)│ │          │ │ │SourceAdapter[]│ │    │
│  │ + WakeLock) │ └──────┬───────┘ └──────────┘ │ │ netease/qq/  │ │    │
│  └─────────────┘        │                      │ │ kuwo/joox/...│ │    │
│                         │                      │ └──────┬───────┘ │    │
│                         └──────────────────────┴────────┼─────────┘    │
│                                  fetch() to OWN proxy ───┼──────────    │
│  SERVICE WORKER  (app-shell precache; bypass /api + audio CDN)         │
└──────────────────────────────────────┼─────────────────────────────────┘
                                        │  HTTPS  (same-origin /api/*)
                                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                CLOUDFLARE WORKER  ( /api/* )         [NEW]              │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ router → CORS → cache(match) → per-source ProxyAdapter → fetch    │ │
│  │ upstream → normalize → cache.put(waitUntil) → rate-limit/retry    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│      hides JOOX token  |  caches.default  |  KV rate-limit (optional)  │
└──────────────────────────────────────┼─────────────────────────────────┘
                                        ▼
            Unofficial upstream proxies (qijieya / s01s / cenguigui /
            apicx / kugou / migu …)  — see codebase/INTEGRATIONS.md
```

**Two adapter registries, one shared contract.** There is a `SourceAdapter` on the *client* (knows how to call `/api/<source>/...` and normalize into the Track shape) and a `ProxyAdapter` on the *Worker* (knows the real upstream URL, params, and auth for one source). They share the same `source` identifier and the same normalized Track contract, but live on opposite sides of the network boundary. Adding a source = add one of each.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Worker router | Map `/api/<source>/search`, `/api/<source>/track/:id` to a ProxyAdapter; attach CORS | `itty-router` or hand-rolled `URLPattern` switch in `_worker.js` sibling, or SvelteKit `+server.ts` endpoints |
| ProxyAdapter (per source) | Own the real upstream URL/params/auth; do request shaping + response normalization to the Track contract | One TS module per source on the Worker, conforming to a `ProxyAdapter` interface |
| Worker cache layer | Edge-cache GET responses keyed by normalized URL; `ctx.waitUntil(cache.put)` | `caches.default` (Cache API) + `Cache-Control` headers |
| Worker resilience | Timeout, bounded retry on 429/5xx, optional KV/Rate-Limit binding | `AbortSignal.timeout`, retry helper, `env.RATE_LIMITER` |
| `catalog` service (client) | Aggregate parallel search across enabled adapters; interleave; lazy `ensureTrackDetails` | Port of `searchAllSources` + `ensureTrackDetails`; pure TS, no DOM |
| SourceAdapter (per source, client) | Build `/api/<source>` request, parse normalized JSON into a Track stub / enrich | One TS module per source conforming to `SourceAdapter` interface |
| `audioEngine` service | Single `<audio>` element wrapper; play/pause/seek; emit time/ended events; own MediaSession + Wake Lock wiring | Singleton class in a `.svelte.ts` module |
| `playerStore` | Reactive `currentTrack`, `isPlaying`, `position`, `duration`, `lyrics`, `currentLyricIndex` | Svelte 5 `$state` in `.svelte.ts` |
| `queueStore` | The active list + index + playMode; `next()`/`prev()` logic | `$state` + derived; ports `playNext`/`getActiveList` |
| `searchStore` | Search results, per-source pagination, loading flags | `$state` |
| `libraryStore` | Favorites + playlists; import/export; persistence orchestration | `$state` + `persist` service |
| `persist` service | Read/write library to storage; serialize/deserialize tracks | Ports `serializeTrack`/`save`/`load`; IndexedDB or localStorage |
| Route components | Render lists/now-playing; read stores, call store actions only | Svelte 5 `.svelte` files under `src/routes` |
| Bottom-nav shell | Persistent layout: tab bar + mini-player that expands to now-playing | `+layout.svelte` (survives route changes) |
| Service worker | Precache app shell; **bypass** `/api/*` and audio CDN requests | `src/service-worker.ts` using `$service-worker` module |

---

## Recommended Project Structure

```
musicsquare-mobile/
├── src/
│   ├── lib/
│   │   ├── sources/                 # CLIENT source-adapter registry [REUSE-extract]
│   │   │   ├── types.ts             #   SourceAdapter interface + Track type
│   │   │   ├── registry.ts          #   SOURCES: Record<source, SourceAdapter>; getEnabled()
│   │   │   ├── netease.ts           #   one module per source
│   │   │   ├── qq.ts
│   │   │   ├── kuwo.ts
│   │   │   ├── joox.ts
│   │   │   ├── kugou.ts             #   NEW source — add a file, register it
│   │   │   └── migu.ts              #   NEW source
│   │   ├── services/
│   │   │   ├── catalog.ts           #   searchAll() + ensureTrackDetails() [REUSE-extract]
│   │   │   ├── audioEngine.svelte.ts#   <audio> + MediaSession + WakeLock singleton
│   │   │   ├── lrc.ts               #   parseLRC() [REUSE verbatim]
│   │   │   └── persist.ts           #   serialize/deserialize + storage [REUSE-extract]
│   │   ├── stores/
│   │   │   ├── player.svelte.ts     #   playerStore  ($state)
│   │   │   ├── queue.svelte.ts      #   queueStore  (active list/index/mode)
│   │   │   ├── search.svelte.ts     #   searchStore
│   │   │   └── library.svelte.ts    #   libraryStore (favorites/playlists)
│   │   ├── i18n/                    #   translations{} + t() [REUSE]
│   │   └── components/
│   │       ├── MiniPlayer.svelte
│   │       ├── NowPlaying.svelte
│   │       ├── TrackList.svelte
│   │       ├── Lyrics.svelte
│   │       └── BottomNav.svelte
│   ├── routes/
│   │   ├── +layout.svelte           #   shell: <slot/> + BottomNav + MiniPlayer
│   │   ├── +page.svelte             #   home / search
│   │   ├── search/+page.svelte
│   │   ├── library/+page.svelte
│   │   ├── playlist/[id]/+page.svelte
│   │   └── api/                     #   OPTION A: proxy as SvelteKit endpoints
│   │       └── [source]/[...path]/+server.ts
│   ├── service-worker.ts            #   app-shell precache; bypass /api + CDN
│   └── app.d.ts                     #   App.Platform.env bindings (Cloudflare types)
├── worker/                          #   OPTION B: standalone Worker (if not co-located)
│   └── src/sources/                 #   PROXY adapters mirror src/lib/sources by name
├── static/ (manifest.webmanifest, icons)
├── svelte.config.js                 #   adapter-cloudflare
└── wrangler.toml                    #   bindings, compatibility flags
```

### Structure Rationale

- **`lib/sources/`:** The single most important folder for the "easy to add a source" requirement. Each source is one self-contained file implementing `SourceAdapter`; `registry.ts` is the only place that enumerates them. The `catalog` service iterates the registry — it never names a source. This is the direct generalization of the monolith's `searchNetease/QQ/Kuwo/Joox` + the `ensureTrackDetails` dispatcher (`index.html:2506`), turning a `switch (track.source)` into a registry lookup.
- **`.svelte.ts` for stores/audio:** Svelte 5 runes (`$state`) work in `.svelte.ts` modules, replacing the monolith's manual-render pattern (every mutation called `render*()`). Reactivity is automatic; UI just reads. (HIGH — current Svelte 5 docs.)
- **Service layer is DOM-free:** `catalog`, `lrc`, `persist` are pure TS so the proven logic is testable in isolation — this is exactly the BACKEND-REUSE seam the codebase map identified.
- **Worker co-located vs standalone:** Option A (SvelteKit `api/` endpoints compiled into the single `_worker.js`) is simplest and same-origin by construction (no CORS at all). Option B (standalone Worker) is only needed if you want the proxy deployed/scaled/cached independently of the app. **Recommend Option A** for v1 — fewer moving parts and the adapter pattern is identical.

---

## The Source-Adapter Abstraction (the load-bearing design)

Two interfaces, one normalized Track contract (the canonical Track shape already exists in `INTEGRATIONS.md`). Adding Kugou/Migu/any source means writing **one client adapter + one proxy adapter** and registering them — touching zero shared code.

### Client-side `SourceAdapter`

```typescript
// src/lib/sources/types.ts
export type SourceId = 'netease' | 'qq' | 'kuwo' | 'joox' | 'kugou' | 'migu';

export interface SourceAdapter {
  id: SourceId;
  label: string;                       // display name / pill
  enabledByDefault: boolean;

  // Search returns lightweight STUBS (detailsLoaded: false), like today.
  search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]>;

  // Lazily resolve audioUrl + lrc + quality for ONE track (called on play).
  // Mirrors the monolith's per-source fetchXxxDetails().
  resolve(track: Track, signal: AbortSignal): Promise<Track>;
}
```

```typescript
// src/lib/sources/registry.ts  — the ONLY enumeration of sources
import { netease } from './netease';
import { qq } from './qq';
/* …import kugou, migu… */
export const SOURCES: Record<SourceId, SourceAdapter> = { netease, qq, kuwo, joox, kugou, migu };
export const getEnabledAdapters = (prefs: SourcePrefs) =>
  Object.values(SOURCES).filter(a => prefs[a.id] ?? a.enabledByDefault);
```

```typescript
// src/lib/services/catalog.ts  — generalizes searchAllSources + ensureTrackDetails
export async function searchAll(keyword: string, page: number) {
  const results = await Promise.allSettled(
    getEnabledAdapters(prefs).map(a => a.search(keyword, page, signal()))
  );
  // collect fulfilled, dedupe via trackMap by uid, interleave round-robin (port getInterleavedSearchList)
}
export function ensureTrackDetails(track: Track) {
  if (track.detailsLoaded) return track;
  return SOURCES[track.source].resolve(track, signal());   // was: switch(track.source)
}
```

### Worker-side `ProxyAdapter`

```typescript
// worker (or src/routes/api/[source]): one module per source
export interface ProxyAdapter {
  id: SourceId;
  // Build the REAL upstream request (URL, params, auth) and normalize the response.
  search(keyword: string, page: number, env: Env): Promise<NormalizedSearch>;
  resolve(id: string, ctx: ResolveCtx, env: Env): Promise<NormalizedTrack>;
}
// joox.ts reads env.JOOX_TOKEN here — the secret never reaches the browser.
```

**Why two layers instead of one passthrough?** The Worker can either (a) be a dumb passthrough that just forwards + adds CORS + caching, or (b) normalize upstream shapes server-side. **Recommendation: normalize on the Worker** for new sources (Kugou/Migu) so the client adapter stays trivial and upstream shape changes are absorbed at one edge location; keep the existing four sources as thin passthrough first (lowest-risk port), then migrate normalization serverward opportunistically. Either way the client `SourceAdapter` contract is unchanged.

---

## Architectural Patterns

### Pattern 1: Registry-driven source plugins

**What:** Sources are entries in a `Record<SourceId, Adapter>`; all aggregation iterates the registry. No business logic ever branches on a literal source name except inside that source's own module.
**When to use:** Whenever the count of sources is expected to grow (it is — Kugou, Migu, "best-effort others").
**Trade-offs:** Tiny indirection cost; huge reduction in change surface. Replaces the monolith's `switch (track.source)` in `ensureTrackDetails` and the hand-listed `Promise.all` in `searchAllSources`.

### Pattern 2: Audio engine as a single side-effectful singleton, stores as pure state

**What:** Exactly one `<audio>` element lives in `audioEngine.svelte.ts`. Stores hold *declarative* state (currentTrack, isPlaying, position). The engine subscribes to "play this track" intents and emits events that update stores. UI never touches `<audio>` directly.
**When to use:** Any music player. Multiple `<audio>` elements or per-component audio is the classic mobile bug source.
**Trade-offs:** One indirection layer, but it is the only safe way to keep MediaSession, Wake Lock, and the queue in sync, and to survive route changes (the engine lives in module scope, not in a component that unmounts).

```typescript
// audioEngine.svelte.ts (sketch)
class AudioEngine {
  #el = new Audio();
  async play(track: Track) {
    const t = await ensureTrackDetails(track);        // service layer (was playTrack's seam)
    this.#el.src = t.audioUrl!;
    await this.#el.play();
    this.#wireMediaSession(t);                          // metadata + action handlers
    this.#requestWakeLock();
  }
  // 'timeupdate' → playerStore.position + setPositionState + lyric index
  // 'ended'      → queueStore.next() → this.play(next)
}
export const audioEngine = new AudioEngine();           // module singleton
```

### Pattern 3: Persistent shell layout with an expanding mini-player

**What:** `+layout.svelte` renders the bottom-nav and a mini-player **outside** the routed `<slot/>`, so navigating between /search, /library, /playlist never tears down audio or the player UI. The mini-player expands into the full-screen NowPlaying view via a transition (not a route), so playback is uninterrupted.
**When to use:** The Spotify/YT-Music shell. Required for "keep playing across navigation."
**Trade-offs:** NowPlaying-as-overlay (recommended) vs NowPlaying-as-route. A route gives a back-button/URL but risks remounting; an overlay is safer for audio continuity. Recommend overlay driven by a `uiStore.nowPlayingOpen` flag, with history-state integration for the back gesture.

### Pattern 4: Worker proxy = cache-first read-through with bounded retry

**What:** `match(cache)` → on miss `fetch(upstream, {signal: timeout})` with retry on 429/5xx → `cache.put` via `ctx.waitUntil` → return with CORS + `Cache-Control`.
**When to use:** All GET search/detail calls. Detail (audioUrl/lrc) caching must be short-TTL because audio URLs from these CDNs expire; search can cache longer.
**Trade-offs:** Cache API is per-colo and not tiered (verified, Cloudflare docs) — fine for this workload. Cache *search* responses, not the audio stream bytes.

---

## Data Flow

### Search → Play (the primary path, ported from the monolith)

```
User types keyword (search route)
   ↓ searchStore.run(keyword)
catalog.searchAll() ── Promise.allSettled over getEnabledAdapters()
   ↓ each adapter.search() → fetch  /api/<source>/search   (same-origin)
                                   ↓
                       CF Worker: cache.match → ProxyAdapter.search → upstream
                                   ↓ normalize + CORS + cache.put(waitUntil)
   ← Track[] stubs (detailsLoaded:false)  → dedupe by uid → interleave
   ↓ searchStore.results = … (reactive; UI re-renders automatically)
User taps a track  → queueStore.setActiveList('results', idx) → audioEngine.play(track)
   ↓ ensureTrackDetails(track) → SOURCES[source].resolve() → /api/<source>/track/:id
   ↓ track.audioUrl/lrc/quality populated
   ↓ <audio>.src = audioUrl; play(); MediaSession.metadata set; WakeLock acquired
   ↓ 'timeupdate' → playerStore.position + setPositionState + lyric highlight
   ↓ 'ended' → queueStore.next() (list/single/shuffle) → audioEngine.play(next)
```

### State management (Svelte 5 runes replace imperative renders)

```
audio events ─┐
store actions ┼─→ $state in *.svelte.ts  ──(reactive read)──→ Svelte components
MediaSession ─┘        playerStore / queueStore / searchStore / libraryStore
```

The key change from the monolith: **no `render*()` calls.** Mutating `playerStore.currentTrack` re-renders every subscriber. This directly retires the "all renderers called imperatively" anti-pattern flagged in the codebase analysis.

### Persistence

```
libraryStore mutate (favorite/add to playlist)
   ↓ persist.save()  (debounced)
   → serializeTrack() strips audioUrl/lrc  → IndexedDB (recommended) or localStorage
Startup: persist.load() → deserializeTrack() → libraryStore hydrate → rebuild trackMap
```

Keep the existing `pikachu-music-library-v1` key/format if continuity with the old app matters (noted as a constraint). IndexedDB is recommended over localStorage for the library because (a) it survives larger playlists and (b) iOS has historically been flaky with large localStorage — but localStorage is acceptable for v1 to minimize port risk.

### Background / lock-screen flow (MediaSession + Wake Lock)

```
play() ⇒ navigator.mediaSession.metadata = MediaMetadata{title,artist,album,artwork[]}
       ⇒ setActionHandler('play'|'pause'|'nexttrack'|'previoustrack'|'seekto')
       ⇒ on play/pause: mediaSession.playbackState = 'playing'|'paused'
       ⇒ on timeupdate: setPositionState({duration,position,playbackRate})
       ⇒ navigator.wakeLock.request('screen')  (re-acquire on visibilitychange)
```

Action handlers route back into `audioEngine`/`queueStore` — the lock-screen Next button calls the same `queueStore.next()` as the in-app button. (HIGH — MediaSession steps verified against web.dev/MDN.)

---

## Worker-proxy vs Client responsibilities (explicit split)

| Concern | Cloudflare Worker (`/api/*`) | Client (browser) |
|---------|------------------------------|------------------|
| CORS | Owns it (adds headers; same-origin if co-located) | None — calls own origin |
| Upstream URLs/params | Owns (ProxyAdapter) | Never sees real upstream |
| Secrets (JOOX token) | Owns via `env.JOOX_TOKEN` | Never holds secrets |
| Rate-limit / retry / timeout | Owns (bounded retry, AbortSignal, optional KV) | Optional UI-level debounce only |
| Response caching | Owns (`caches.default`, TTL by endpoint) | In-memory `trackMap` dedupe only |
| Normalization to Track shape | Owns for new sources; passthrough for legacy four initially | Maps normalized JSON → Track object |
| Search aggregation / interleave | No (per-source only) | Owns (`catalog.searchAll`) |
| Lazy detail resolution decision | No | Owns (`ensureTrackDetails`) |
| Audio streaming | **Never proxied** (bytes flow browser ↔ CDN directly) | `<audio>.src` = CDN URL directly |
| Queue / play modes / state | No | Owns (`queueStore`, stores) |
| MediaSession / Wake Lock | No | Owns (`audioEngine`) |
| Persistence | No (local-first, no accounts) | Owns (`persist`) |

**Critical boundary:** the Worker proxies *metadata* (search JSON, detail JSON, LRC), **not the audio stream**. Audio URLs resolved by the proxy point at the source CDNs and are played directly by `<audio>` (same as today). This keeps the Worker within free-tier subrequest/CPU limits and avoids streaming costs.

---

## Service-worker boundary

| Request class | SW strategy | Why |
|---------------|-------------|-----|
| App shell (build + static, from `$service-worker`) | Precache (cache-first) | Installable, instant load, offline shell |
| Prerendered pages | Precache | Same |
| `/api/*` (proxy) | **Network-only, bypass** | Data must be fresh; audio URLs expire; never serve stale search |
| Audio CDN requests | **Bypass (do not intercept)** | Range requests + expiring URLs; caching audio is out of scope and legally avoided |
| Cover art images | Optional runtime cache (stale-while-revalidate) | Nice-to-have, low risk |

The monolith has no SW; this is net-new. Use SvelteKit's first-class `src/service-worker.ts` + `$service-worker` module (build/files/version arrays). The "streamed audio stays online-only" requirement maps directly to **bypassing audio + /api** in fetch handling. (HIGH — SvelteKit service-worker docs.)

---

## Scaling Considerations

This is a personal/demo, local-first app — scaling concern is **reliability and Cloudflare free-tier limits**, not user count.

| Scale | Architecture adjustments |
|-------|--------------------------|
| Personal / demo (now) | Worker passthrough + edge cache is plenty; localStorage library fine |
| Shared link / modest traffic | Lean on `caches.default` (cuts upstream calls); add bounded retry; consider KV rate-limit binding to protect fragile upstreams |
| If an upstream dies | Registry makes a source removable/swappable in one file; `Promise.allSettled` already degrades gracefully (partial results) |

### Scaling priorities

1. **First "bottleneck" is upstream fragility, not load.** Mitigate with Worker-side caching + retry + per-source isolation so one dead proxy never breaks search. (This is the top technical risk per PROJECT.md/CONCERNS.md.)
2. **Free-tier subrequest/CPU limits** on the Worker — caching search/detail responses keeps subrequest counts down; never proxy audio bytes.
3. **iOS Safari background-audio quirks** — the limiting factor for UX, not server scale. Budget verification time on a real device.

---

## Anti-Patterns

### Anti-Pattern 1: Hard-coding the source list in aggregation logic

**What people do:** Copy the monolith's `Promise.all([searchNetease(), searchQQ(), …])` and `switch (track.source)` into the new code.
**Why it's wrong:** Every new source (Kugou, Migu, …) edits shared aggregation + dispatch code — the exact friction the milestone wants to remove.
**Do this instead:** Iterate `getEnabledAdapters()` / `SOURCES[track.source]`. Adding a source touches only its own file + the registry import.

### Anti-Pattern 2: Putting the `<audio>` element in a component

**What people do:** Render `<audio>` inside NowPlaying or a route page.
**Why it's wrong:** Navigating away unmounts it and kills playback — fatal for a music player and for the "persistent player" requirement.
**Do this instead:** One `<audio>` owned by the `audioEngine` module singleton (created in JS, not markup), independent of the component tree.

### Anti-Pattern 3: Mixing fetch/state with rendering (the original sin)

**What people do:** Recreate `playTrack()` that sets state, fetches details, AND updates UI in one function.
**Why it's wrong:** Untestable, and re-couples the layers the rebuild is trying to separate.
**Do this instead:** `audioEngine.play()` (side effects) → mutate stores (declarative) → components react. The `ensureTrackDetails` seam stays in the pure service layer.

### Anti-Pattern 4: Proxying or caching the audio stream through the Worker

**What people do:** Route `<audio>.src` through `/api/stream?url=…`.
**Why it's wrong:** Blows Worker CPU/subrequest/egress limits, adds latency, breaks range requests, and creates legal/storage exposure (downloads are out of scope).
**Do this instead:** Proxy only metadata; play the CDN URL directly in `<audio>`; SW bypasses audio.

### Anti-Pattern 5: Exporting a bare reactive primitive from a `.svelte.ts` module

**What people do:** `export let isPlaying = $state(false)`.
**Why it's wrong:** Reassigning an exported primitive does not propagate reactivity across module boundaries (verified, Svelte 5 docs).
**Do this instead:** Export a `$state` **object** (or a class with getters), e.g. `export const playerStore = $state({ isPlaying:false, … })`, and mutate its properties.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Upstream music proxies (qijieya/s01s/cenguigui/apicx/kugou/migu) | Worker `fetch()` from a ProxyAdapter only | No SLA; isolate per source; cache + retry; never expose real URLs to client |
| Audio CDNs | Direct `<audio>.src` from browser | URLs expire → short detail-cache TTL; `referrerpolicy=no-referrer` to avoid referer blocking (carry over `<meta referrer no-referrer>`) |
| Cloudflare KV / Rate-Limit binding | Optional Worker binding | Only if upstream abuse-protection needed; declare in `wrangler.toml` + `app.d.ts` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Client SourceAdapter ↔ Worker ProxyAdapter | HTTPS to `/api/<source>/*` | Same `SourceId` + Track contract on both sides; the network boundary |
| UI components ↔ stores | Read `$state`, call store actions | One-way: components never mutate raw state ad hoc |
| Stores ↔ audioEngine | Engine emits → stores; stores/actions call `engine.play/pause` | Engine is the only `<audio>`/MediaSession/WakeLock owner |
| Service layer ↔ stores | Stores call `catalog`/`persist`; services stay DOM-free & store-free where possible | Keeps proven logic testable in isolation |
| Service worker ↔ everything | Intercepts navigations/static only; bypasses `/api` + audio | App-shell only |

---

## Suggested Build Order (dependencies)

Built bottom-up so each layer has its dependency ready; the data layer is portable from day one and testable before any UI exists.

1. **Source contract + registry + one adapter (Netease) + Worker proxy skeleton.**
   Depends on: nothing. Establishes the `SourceAdapter`/`ProxyAdapter` interfaces, `/api/*` routing, CORS, and the cache/retry helper. Validates the whole boundary end-to-end with one source. *Highest-leverage first step.*
2. **Port remaining existing adapters (QQ, Kuwo, JOOX) + `catalog.searchAll` + interleave + `trackMap` dedupe.**
   Depends on: #1. JOOX brings the token-in-Worker and URL-probing case.
3. **`audioEngine` (single `<audio>`, play/pause/seek) + `playerStore` + `queueStore` + `ensureTrackDetails` wiring + `lrc` parse.**
   Depends on: #2 (needs resolvable tracks). This is the core "tap → plays" loop, headless.
4. **Persistence (`persist` + `libraryStore`) + import/export.**
   Depends on: track shape (#1) and stores (#3). Can proceed in parallel with #5.
5. **SvelteKit shell: `+layout.svelte` bottom-nav + MiniPlayer + routes (search/library/playlist) + NowPlaying overlay + Lyrics + i18n.**
   Depends on: stores (#3/#4). First point a human can use it.
6. **PWA: manifest + `service-worker.ts` app-shell precache + `/api`/audio bypass.**
   Depends on: a deployable app (#5).
7. **Background audio polish: MediaSession action handlers wired to queue, `setPositionState`, Wake Lock, visibilitychange re-acquire; iOS device verification.**
   Depends on: #3 + #6. Highest uncertainty (iOS Safari) — schedule explicit device testing.
8. **New sources (Kugou, Migu) — proves the abstraction.**
   Depends on: #1–#2 only. If adding a source here requires touching anything other than a new `lib/sources/*.ts` + a Worker adapter + the registry import, the abstraction failed — treat that as the acceptance test for the design.

**Roadmap implication:** Phases 1–3 are the de-risking core (extract proven data layer + prove the proxy boundary headless). Phase 7 (iOS background audio) and any fragile new source in Phase 8 are the natural "needs deeper research" flags. Phases 4–6 are standard SvelteKit/PWA work unlikely to need extra research.

---

## Sources

- [Cloudflare • SvelteKit adapter docs](https://svelte.dev/docs/kit/adapter-cloudflare) — adapter config, `platform.env` bindings, server endpoints (HIGH)
- [SvelteKit · Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/) — Workers deploy, `nodejs_als` flag (HIGH)
- [Cloudflare Pages vs Workers 2026 migration](https://cogley.jp/articles/cloudflare-pages-to-workers-migration) — "new projects: deploy to Workers from day one" (MEDIUM, single source, dated 2026)
- [Service workers • SvelteKit Docs](https://svelte.dev/docs/kit/service-workers) — `$service-worker` build/files/version, auto-register (HIGH)
- [$state • Svelte Docs](https://svelte.dev/docs/svelte/$state) — runes, `.svelte.ts` shared state, primitive-export caveat (HIGH)
- [Different Ways To Share State In Svelte 5 — Joy of Code](https://joyofcode.xyz/how-to-share-state-in-svelte-5) — class/object store patterns (MEDIUM)
- [Runes and Global state: do's and don'ts — Mainmatter](https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/) — SSR global-state caveats (MEDIUM)
- [Customize media notifications with the Media Session API — web.dev](https://web.dev/articles/media-session) — metadata, action handlers, `setPositionState` (HIGH)
- [MediaSession — MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession) — API reference (HIGH)
- [iOS Web Apps and Media Session API — dbushell](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/) and [Nailing the MediaSession API on iOS — overdevs](https://overdevs.com/ios-mediasession.html) — iOS Safari background-audio quirks, 16.4 fixes (MEDIUM)
- [Cache — Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/cache/) and [Using the Cache API](https://developers.cloudflare.com/workers/examples/cache-api/) — `caches.default`, `ctx.waitUntil(cache.put)`, not tiered (HIGH)
- [Rate Limiting — Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) and [Limits](https://developers.cloudflare.com/workers/platform/limits/) — rate-limit binding, subrequest quota shared with Cache API (HIGH)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/PROJECT.md` — existing reusable data layer, Track contract, source list (HIGH, authoritative for this codebase)

---
*Architecture research for: SvelteKit + Cloudflare PWA music player (rebuild — extract data layer, new mobile UI)*
*Researched: 2026-06-05*
