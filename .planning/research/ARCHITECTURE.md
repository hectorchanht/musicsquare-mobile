# Architecture Research — v1.1 Last.fm Integration

**Domain:** Last.fm integration (metadata enrichment, optional auth + scrobble/love sync, discovery tabs, new playback source) into an existing SvelteKit + Cloudflare music PWA
**Researched:** 2026-06-06
**Confidence:** HIGH (integration points verified against real files; Last.fm signed-call mechanics + scrobble rules verified against official Last.fm API docs)

> This is the v1.1 INTEGRATION research doc. The v1.0 base architecture lives in `ARCHITECTURE.md` (do not conflate). This doc maps NEW Last.fm features onto the EXISTING `src/lib/{proxy,sources,services,stores}` + `src/routes/(app)` + `src/routes/api` architecture. It does NOT redesign the base app.

---

## Standard Architecture

### What already exists (the seams we attach to)

The codebase has two parallel registries keyed by the same `SourceId`, a thin edge-proxy boundary, a service layer, and runes singleton stores:

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT  (src/routes/(app)/*, src/lib/stores, src/lib/sources, ...)    │
│                                                                        │
│  UI shell  ── (app)/+layout.svelte  bottom-nav tabs[] + mini-player    │
│      │        (app)/+page.svelte (Home) → picks.buildDiversePicks()    │
│      │                                                                 │
│  stores ──  player.svelte.ts  library.svelte.ts  settings  names       │
│      │        (Svelte 5 runes singletons, localStorage-persisted)      │
│      │                                                                 │
│  services ─ catalog (searchAll/ensureTrackDetails)  picks  similar     │
│      │       dedupe  translate  lrc  share                             │
│      │                                                                 │
│  sources ─ registry.ts  SOURCES{netease,qq,kuwo,joox}  (SourceAdapter) │
│             search()+resolve() → fetch('/api/<source>/...')            │
└──────────────────────────────────────────────────────────────────────┘
                                │  same-origin /api/*
┌──────────────────────────────────────────────────────────────────────┐
│  EDGE  (Cloudflare, src/routes/api, src/lib/proxy)                     │
│                                                                        │
│  /api/[source]/[...path]  → PROXIES[source].buildUrl(path,params,env)  │
│       thin passthrough, injects JOOX_TOKEN from platform.env           │
│  /api/similar  → DEDICATED route, injects LASTFM_KEY, returns clean    │
│       { artists: [] }; absent-key is a SUPPORTED fallback state        │
│  /api/translate → DEDICATED route                                      │
│                                                                        │
│  proxy-types.ts  Env { JOOX_TOKEN, LASTFM_KEY?, LASTFM_SECRET? }       │
│  http.ts  fetchWithRetry + corsHeaders (own-origin only, never *)      │
└──────────────────────────────────────────────────────────────────────┘
```

Two established edge patterns already coexist, and the v1.1 design picks between them per call:

1. **Generic passthrough** (`/api/[source]/[...path]`) — `buildUrl()` is a *thin URL builder*. Body forwarded UNCHANGED. Declares only `GET, OPTIONS`. Used by the 4 normalize-on-client music sources.
2. **Dedicated route** (`/api/similar`) — does its own fetch, shapes a clean response, and treats an absent secret as a *supported* state. This is the precedent the signed Last.fm calls follow.

### NEW components to build (and which existing file each one mirrors)

| New component | Type | Mirrors / extends | Edge or Client |
|---|---|---|---|
| `lastfm` SourceId | type widening | `sources/types.ts` `SourceId` union | both |
| `src/lib/sources/lastfm.ts` | client `SourceAdapter` | `sources/netease.ts` | client |
| `src/lib/proxy/lastfm.ts` | edge `ProxyAdapter` (read-only enrich/discovery passthrough) | `proxy/netease.ts` | edge |
| `src/lib/services/lastfm.ts` | enrichment + discovery service | `services/similar.ts` | client |
| `src/lib/services/scrobble.ts` | scrobble/now-playing trigger logic | (new) | client |
| `src/routes/api/lastfm/session/+server.ts` | signed auth.getSession (GET) | `api/similar/+server.ts` | edge |
| `src/routes/api/lastfm/scrobble/+server.ts` | signed track.scrobble (POST) | `api/similar/+server.ts` | edge |
| `src/routes/api/lastfm/love/+server.ts` | signed track.love/unlove (POST) | `api/similar/+server.ts` | edge |
| `src/lib/stores/lastfm.svelte.ts` | session/username store (no sk) | `library.svelte.ts` | client |
| `src/routes/auth/callback/+server.ts` | OAuth-style callback | (new) | edge |
| `src/routes/(app)/explore/+page.{ts,svelte}` | discovery tab + load | `(app)/+page.svelte` | client |
| new entry in `(app)/+layout.svelte` `tabs[]` | nav item | existing `tabs[]` | client |

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `proxy/lastfm.ts` (read-only) | Build upstream `ws.audioscrobbler.com` URL for unsigned read methods (track/artist/album.getInfo, chart.*, tag.*, geo.*, user.get*), inject `LASTFM_KEY` on the edge | Thin `buildUrl()` like `netease.ts`; routed via `/api/[source]/[...path]` with `source=lastfm` |
| `api/lastfm/session` | Exchange authorized token → session key; compute md5 `api_sig` with `LASTFM_SECRET`; set httpOnly sk cookie; also serve a "who am I" boot check | Dedicated `+server.ts`, GET, mirrors `api/similar` absent-secret posture |
| `api/lastfm/scrobble` + `/love` | Sign POST write calls (`track.scrobble`/`updateNowPlaying`, `track.love`/`unlove`); read `sk` from httpOnly cookie; never expose secret or sk | Dedicated `+server.ts`, POST, reads cookie |
| `services/lastfm.ts` | Client enrichment (merge getInfo onto Track) + discovery list builders | Like `similar.ts` — `fetch('/api/lastfm/...')`, graceful `[]` fallback |
| `services/scrobble.ts` | Playback-progress → fire updateNowPlaying / scrobble at the right threshold; no-op when signed out | Three functions the player calls; gates on `lastfm.authed` |
| `stores/lastfm.svelte.ts` | `username`, `authed`, `lovedKeys` mirror — NO sk on client | Runes singleton like `library` |
| `sources/lastfm.ts` | search via Last.fm → emit `{artist,track}` Track stubs; `resolve()` does the 2-step audio resolve | `SourceAdapter` like `netease.ts` |

---

## Recommended Project Structure

```
src/
├── routes/
│   ├── api/
│   │   ├── [source]/[...path]/+server.ts   # EXISTING — now also fronts source=lastfm
│   │   │                                   #   (read-only enrich + discovery passthrough)
│   │   ├── similar/+server.ts              # EXISTING (artist.getSimilar)
│   │   └── lastfm/                         # NEW — signed writes + session (dedicated)
│   │       ├── session/+server.ts          #   GET: auth.getSession (token→sk), set cookie
│   │       ├── scrobble/+server.ts         #   POST: track.scrobble + updateNowPlaying
│   │       └── love/+server.ts             #   POST: track.love / track.unlove
│   ├── auth/
│   │   └── callback/+server.ts             # NEW — Last.fm redirects here with ?token=...
│   └── (app)/
│       ├── +layout.svelte                  # MODIFIED — add Explore tab to tabs[]
│       ├── +page.svelte                    # EXISTING Home (optionally enrich picks)
│       └── explore/
│           ├── +page.ts                    # NEW — discovery load (charts/tags) SSR
│           └── +page.svelte                # NEW — discovery tab UI
├── lib/
│   ├── sources/
│   │   ├── types.ts                        # MODIFIED — add 'lastfm' to SourceId
│   │   ├── registry.ts                     # MODIFIED — register lastfm (1 import line)
│   │   └── lastfm.ts                       # NEW — client SourceAdapter (search + 2-step resolve)
│   ├── proxy/
│   │   ├── proxy-registry.ts               # MODIFIED — register lastfm (1 import line)
│   │   ├── proxy-types.ts                  # EXISTING — Env already has LASTFM_KEY/SECRET
│   │   ├── lastfm.ts                       # NEW — edge ProxyAdapter (read-only passthrough)
│   │   └── sign.ts                         # NEW — md5 api_sig helper (edge-only, shared by signed routes)
│   ├── services/
│   │   ├── lastfm.ts                       # NEW — enrichment + discovery list builders
│   │   └── scrobble.ts                     # NEW — scrobble/now-playing trigger logic
│   └── stores/
│       └── lastfm.svelte.ts                # NEW — account store (username/authed + love mirror)
```

### Structure Rationale

- **Signed writes get dedicated routes under `/api/lastfm/`, NOT the catch-all.** The catch-all's `buildUrl()` contract is a synchronous, side-effect-free URL builder that forwards the body unchanged and declares only `GET, OPTIONS`. Signed calls need: (a) md5 signing over the full param set, (b) reading the session key server-side (cookie), (c) POST with form-encoded body, (d) shaping a clean JSON result. None of that fits `buildUrl(path, params, env): string`. Forcing it in would break the "thin passthrough" invariant the catch-all documents.
- **Read-only Last.fm methods DO go through the catch-all** as `source=lastfm`, because they are exactly the thin-passthrough case (`getInfo`, `chart.*`, `tag.*`, `geo.*`, `user.get*` only need `api_key` injected — no signing, no session). This reuses `fetchWithRetry`, `corsHeaders`, retry/timeout, and the bundle-grep guard for free, and keeps "adding a source = one client file + one proxy file + one registry line" true.
- **`proxy/sign.ts` is a tiny edge-only helper** so all three signed routes share one verified md5-signature implementation (single place to get the alphabetical-sort + secret-append right). md5 is not in WebCrypto; on Workers use a small md5 implementation or `crypto`-free helper.
- **Account store separate from library store.** `library.svelte.ts` stays local-first and self-contained; the Last.fm account/sync layer is additive and may be absent. Mixing them would couple local favorites to a server dependency.

---

## Architectural Patterns

### Pattern 1: Signed-call endpoint topology (the core decision)

**What:** Split Last.fm calls by whether they need the shared secret / POST / session.

| Last.fm call | Needs secret? | Route | HTTP | Why |
|---|---|---|---|---|
| `track.getInfo`, `artist.getInfo`, `album.getInfo`, `*.getTopTags` | No (key only) | `/api/[source]/[...path]` (source=lastfm) | GET | Thin passthrough; key injected on edge |
| `chart.getTopTracks/Artists`, `geo.getTopTracks`, `tag.getTopTracks/Artists/getInfo` | No (key only) | `/api/[source]/[...path]` (source=lastfm) | GET | Discovery reads; thin passthrough |
| `artist.getSimilar` | No (key only) | `/api/similar` (EXISTING) | GET | Already built |
| `user.getRecentTracks`, `user.getLovedTracks` | No (key only, public) | `/api/[source]/[...path]` (source=lastfm) | GET | Public reads with `user=<username>` |
| `auth.getSession` | **Yes (secret)** | `/api/lastfm/session` | GET | md5 sign + sets sk cookie |
| `track.scrobble`, `track.updateNowPlaying` | **Yes (secret + sk)** | `/api/lastfm/scrobble` | **POST** | Write service, must be POST; signed; reads sk cookie |
| `track.love` / `track.unlove` | **Yes (secret + sk)** | `/api/lastfm/love` | **POST** | Write service, must be POST; signed; reads sk cookie |

**When to use a dedicated route:** iff the call (a) needs `LASTFM_SECRET` signing, OR (b) is an HTTP POST write, OR (c) needs to read the session cookie. Everything else uses the generic passthrough.

**Trade-offs:** Three small dedicated routes vs one generic one is slightly more files, but it confines the shared secret to exactly three handlers, keeps the catch-all's invariant clean, and matches the already-shipped `/api/similar` precedent. (Verified: `track.scrobble` and `track.love` are POST write services per Last.fm docs; the catch-all only declares `GET, OPTIONS`.)

**Example (api_sig construction — VERIFIED against Last.fm web-auth spec):**
```typescript
// src/lib/proxy/sign.ts — EDGE ONLY. md5(sortedParams as name+value, then +secret).
import { md5 } from './md5'; // small md5; CF Workers WebCrypto has no md5
export function apiSig(params: Record<string, string>, secret: string): string {
	const base = Object.keys(params)
		.filter((k) => k !== 'format' && k !== 'callback') // 'format' excluded from the signature
		.sort()
		.map((k) => k + params[k])
		.join('');
	return md5(base + secret);
}
```

### Pattern 2: Shared-secret + session-key confinement (security)

**What:** `LASTFM_SECRET` is read only inside the three `/api/lastfm/*` handlers via `platform.env` and is used only to compute `api_sig`. The session key (`sk`) returned by `auth.getSession` is stored in an **httpOnly, Secure, SameSite=Lax cookie** set by `/api/lastfm/session` — NEVER returned in the JSON body, NEVER touched by client JS.

**When to use:** Every signed write. The client calls `fetch('/api/lastfm/scrobble', { method:'POST', body })` with NO sk; the edge handler reads `cookies.get('lastfm_sk')`, signs `{ ...params, sk, api_key }` with the secret, and POSTs to `ws.audioscrobbler.com`.

**Trade-offs:** httpOnly cookie means the client can't read `sk` (good — XSS can't exfiltrate it), but the client also can't tell "am I signed in?" from it. Solve with a companion non-httpOnly `lastfm_user` cookie + a `{ username }` body from `/api/lastfm/session`, which the client stores in `lastfm.svelte.ts` (re-derived on boot via `GET /api/lastfm/session` with no token). The sk itself never leaves the edge.

**Example:**
```typescript
// api/lastfm/session/+server.ts (GET ?token=... → exchange; no token → "who am I")
export const GET: RequestHandler = async ({ url, platform, cookies }) => {
	const env = platform?.env as Env;
	const token = url.searchParams.get('token');
	if (!token) return json({ username: cookies.get('lastfm_user') ?? null });   // boot check
	if (!env.LASTFM_SECRET || !env.LASTFM_KEY) return json({ username: null });   // supported absent state
	const sig = apiSig({ api_key: env.LASTFM_KEY, method: 'auth.getSession', token }, env.LASTFM_SECRET);
	const r = await fetchWithRetry(
		`${LASTFM}?method=auth.getSession&api_key=${enc(env.LASTFM_KEY)}&token=${enc(token)}&api_sig=${sig}&format=json`);
	const { session } = (await r.json()) as { session?: { name: string; key: string } };
	if (!session) return json({ username: null });
	cookies.set('lastfm_sk', session.key, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 31536000 });
	cookies.set('lastfm_user', session.name, { httpOnly: false, secure: true, sameSite: 'lax', path: '/', maxAge: 31536000 });
	return json({ username: session.name });
};
```
(Session keys have infinite lifetime per Last.fm docs, so a long maxAge cookie is correct; sign-out clears both cookies.)

### Pattern 3: New "Last.fm" source — dual registry + 2-step audio resolve

**What:** Last.fm is metadata/social only — it does NOT serve audio. So the `lastfm` source's `search()` returns Track stubs with `audioUrl: null`, and `resolve()` performs a **2-step resolve**: (1) it already has `{artist, title}`; (2) it delegates to the existing aggregator to find a *playable* variant from the real audio sources.

**Where the resolver call lives:** Inside `sources/lastfm.ts` `resolve()`, which calls `searchAll(\`${artist} ${title}\`)` (catalog.ts) then `dedupeBest()` and picks the best title+artist match — i.e., the Last.fm source's audio resolution *reuses the entire existing source stack* rather than introducing a separate YouTube resolver. This keeps audio on the proven CN-source CDNs and avoids a brittle YouTube extractor on the edge.

> NOTE on the PROJECT.md "YouTube-style source": a true YouTube resolver (ytdl-style) is technically possible but is a separate fragile dependency with its own CORS/edge constraints. RECOMMENDED v1.1 approach: implement `resolve()` as "re-search the real sources for this artist+title and play the best match." This satisfies "resolves playable audio for Last.fm-discovered tracks" using infrastructure that already works; a dedicated YouTube `proxy/youtube.ts` source can be added later if desired. (Confidence MEDIUM that the YouTube path is worth it; HIGH that the re-search path works today.)

**Data flow:**
```
Last.fm search/discovery  →  Track stub { source:'lastfm', artist, title, audioUrl:null }
        │  user taps play
        ▼
player.play(track) → ensureTrackDetails(track) → SOURCES['lastfm'].resolve(track)
        │
        ▼
sources/lastfm.resolve():  searchAll(`${artist} ${title}`)  →  dedupeBest()
        │   pick best title+artist match (reuse dedupe key())
        ▼
returns a RESOLVED track from netease/qq/kuwo/joox (real audioUrl + lrc)
   (keep the lastfm uid for queue identity; swap in the playable source's audioUrl)
```

**Trade-offs:** The Last.fm source is a "virtual" source — its identity (`lastfm:<mbid-or-titleartist-hash>`) is stable for queue/dedupe, but it leans on the other sources for actual bytes. Edge case: re-search returns nothing → surface "no playable source found" (same posture as a dead CDN URL in `player.error`). The dual-registry mechanics are otherwise identical to the 4 existing sources: one `sources/lastfm.ts` + one `proxy/lastfm.ts` (for the read-only enrich/discovery passthrough) + one line in each registry.

### Pattern 4: Scrobble hook points in the player lifecycle

**What:** A `services/scrobble.ts` module the player calls at three lifecycle moments, ALWAYS guarded by "signed in?" so the player never couples to Last.fm when signed out.

**Where in `player.svelte.ts`:**
- **Play start** — inside `play()`, right after `this.audio.src = resolved.audioUrl; await this.audio.play()`: call `scrobble.onPlayStart(resolved)` → POST `track.updateNowPlaying`. (Verified: call as soon as the user starts listening; no timestamp needed.)
- **Threshold reached** — in the existing `timeupdate` listener registered in `attach()`: call `scrobble.onProgress(current, el.currentTime, el.duration)`. The service fires `track.scrobble` once when the track is >30s long AND played for `min(duration/2, 240s)`. (Verified threshold against Last.fm scrobbling rules.)
- **Track end / change** — in the `ended` listener and at the top of `play()` for the *outgoing* track: `scrobble.flush()` to commit any pending scrobble that crossed the threshold but wasn't committed.

**Decoupling rule:** `scrobble.*` functions check `lastfm.authed` first and return immediately if false. The player imports `scrobble` (a service), NOT the Last.fm store directly — same layering as it already imports `buildSimilarQueue`/`buildDiversePicks`. Signed out, every scrobble call is a cheap no-op; the player has zero Last.fm awareness.

**Example:**
```typescript
// services/scrobble.ts
import { lastfm } from '$lib/stores/lastfm.svelte';
let scrobbled = false, startTs = 0;
export function onPlayStart(t: Track) {
	scrobbled = false; startTs = Math.floor(Date.now() / 1000);
	if (!lastfm.authed) return;
	void post({ now: '1', artist: t.artist, track: t.title });           // updateNowPlaying
}
export function onProgress(t: Track, elapsed: number, duration: number) {
	if (scrobbled || !lastfm.authed || duration < 30) return;
	if (elapsed >= Math.min(duration / 2, 240)) {
		scrobbled = true;
		void post({ artist: t.artist, track: t.title, timestamp: String(startTs) }); // scrobble
	}
}
function post(body: Record<string,string>) {
	return fetch('/api/lastfm/scrobble', { method: 'POST', body: new URLSearchParams(body) });
}
```
(The edge `/api/lastfm/scrobble` reads the sk cookie, signs, and POSTs `track.scrobble` or `track.updateNowPlaying`.)

### Pattern 5: Loved-tracks ↔ local `library` reconciliation

**What:** Keep `library.svelte.ts` (localStorage, local-first) as the source of truth for "liked" UI state, and treat Last.fm loved-tracks as a two-way mirror that only activates when signed in.

**Reconciliation on sign-in:** Fetch `user.getLovedTracks` (read-only, via passthrough). Build a set keyed by the dedupe `key(t)` (normalized title|artist). Then:
- A locally-liked track NOT loved on Last.fm → POST `track.love` to push it up (local-first wins; the user already liked it).
- A Last.fm-loved track NOT in local `liked` → add a reconstructed Track stub (`source:'lastfm'`) to `library.liked` so cloud likes appear locally.
- Union/merge, never destructive — matches the local-first boundary in PROJECT.md.

**Keep in sync on love/unlove:** Wrap `library.toggleLike(t)`: after the local mutation + save, if `lastfm.authed`, POST `/api/lastfm/love` with `{ artist, track, love: added ? '1':'0' }`. Failure is non-fatal (local already updated). Signed out, it's just the existing local toggle.

**Identity bridge:** Last.fm matches by `{artist, track}` strings; local Tracks have `uid = source:songid`. Use the existing `dedupe.key()` normalization (already strips (Live)/[Remaster]/feat. suffixes) as the bridge so "邓紫棋 - 泡沫" matches across the boundary. Store `lovedKeys: Set<string>` in `lastfm.svelte.ts` for O(1) "is this loved on Last.fm" checks in the UI.

**Trade-offs:** String-key matching is fuzzy — acceptable for a social-like feature, and `key()` already normalizes hard. No server DB needed; Last.fm IS the cloud store (the whole point of delegating accounts to Last.fm).

### Pattern 6: Discovery tab — consistent with `picks`/`catalog`

**What:** A new `Explore` tab added to `(app)/+layout.svelte` `tabs[]`, backed by a `services/lastfm.ts` discovery builder that mirrors how `picks.buildDiversePicks()` feeds Home.

**Data-loading choice:** Use a **`+page.ts` `load` function** for the discovery lists (charts/tags are public, key-only reads through the passthrough, cacheable, SSR-friendly). This DIFFERS from Home's client-only `onMount` fetch — and that's the right call: Home depends on randomized client state + localStorage cache, while discovery is deterministic public data that SSRs cleanly. Returned tracks are `lastfm` stubs so tapping them flows through Pattern 3's 2-step resolve.

```typescript
// (app)/explore/+page.ts
export const load: PageLoad = async ({ fetch }) => {
	const [charts, tags] = await Promise.all([
		fetch('/api/lastfm/chart.gettoptracks?limit=20').then((r) => r.json()), // via passthrough
		fetch('/api/lastfm/tag.gettoptags').then((r) => r.json())
	]);
	return { charts: toTracks(charts), tags };
};
```

**Trade-offs:** A 4th bottom-nav tab (Home/Search/Library/Explore) is fine on mobile; if a 5th is later needed, fold discovery into Home as a section instead. `tabs[]` is the single edit point.

---

## Data Flow

### Auth flow (web-app authentication — VERIFIED)

```
[Sign in button]
   → redirect user to https://www.last.fm/api/auth/?api_key=KEY&cb=<APP>/auth/callback
   → user approves on last.fm
   → last.fm redirects to /auth/callback?token=TOKEN
   → /auth/callback → GET /api/lastfm/session?token=TOKEN
       → edge: api_sig = md5("api_key"+KEY+"method"+"auth.getSession"+"token"+TOKEN + SECRET)
       → edge: auth.getSession → { name, key }
       → edge: set httpOnly cookie lastfm_sk=key; set lastfm_user=name
       → redirect to /  (client GET /api/lastfm/session → { username }, sets lastfm.authed)
```
(`api_key` is public/embeddable; only `SECRET` and `sk` stay on the edge. The web flow does not strictly require auth.getToken — sending the user to /api/auth and receiving a token at the callback is sufficient.)

### Scrobble flow (signed write)

```
player.play() → scrobble.onPlayStart() → POST /api/lastfm/scrobble {now:1,...}
   → edge reads lastfm_sk cookie → sign → POST track.updateNowPlaying
timeupdate (elapsed ≥ min(dur/2, 240) & dur>30) → scrobble.onProgress()
   → POST /api/lastfm/scrobble {timestamp,...} → edge sign → POST track.scrobble
```

### Love flow (two-way)

```
library.toggleLike(t)  →  local mutation + save (always)
   → if lastfm.authed: POST /api/lastfm/love {artist,track,love:1|0}
        → edge reads sk cookie → sign → POST track.love / track.unlove
sign-in: user.getLovedTracks (passthrough) → merge into library.liked (union)
```

### State Management

```
lastfm.svelte.ts (runes singleton)
   username: string | null      ← from /api/lastfm/session body (NOT the sk)
   get authed() { return !!username }
   lovedKeys: Set<string>        ← dedupe.key() of Last.fm loved tracks
       ↓ read by
   library UI (heart state) · scrobble service (authed gate) · sign-in/out button
```

---

## Anti-Patterns

### Anti-Pattern 1: Forcing signed writes through the `/api/[source]` catch-all
**What people do:** Add `track.scrobble`/`track.love` to `proxy/lastfm.ts` `buildUrl()`.
**Why it's wrong:** `buildUrl()` is sync and returns a string for a forwarded GET; it can't do POST bodies, can't read the sk cookie, and would embed a signature in a URL the catch-all then GETs — but these are POST write services, and the catch-all only declares `GET, OPTIONS`. It also drags the shared secret into a code path designed to forward bodies unchanged.
**Do this instead:** Dedicated `/api/lastfm/{scrobble,love,session}` routes (Pattern 1).

### Anti-Pattern 2: Returning the session key to the client
**What people do:** `return json({ sk: session.key })` so client JS attaches it to scrobble calls.
**Why it's wrong:** `sk` is a long-lived credential (infinite lifetime); in JS it's exfiltratable by any XSS, and combined with the public api_key + edge signing that's account-takeover surface. Mirrors the JOOX_TOKEN threat class (T-01-04).
**Do this instead:** httpOnly cookie; the edge reads it per request. Client only ever knows `username` (Pattern 2).

### Anti-Pattern 3: Coupling the player to Last.fm
**What people do:** `import { lastfm }` in `player.svelte.ts` and branch on auth in the play loop.
**Why it's wrong:** Breaks local-first; signed-out users carry dead Last.fm paths in the hot playback path; tangles store dependencies.
**Do this instead:** Player calls `scrobble.*` services (like it already calls `buildSimilarQueue`); the service does the authed gate and no-ops when signed out (Pattern 4).

### Anti-Pattern 4: Destructive loved-tracks sync
**What people do:** On sign-in, replace `library.liked` with Last.fm loved tracks.
**Why it's wrong:** Nukes local-first likes accumulated while signed out; violates the additive boundary.
**Do this instead:** Union/merge with `dedupe.key()` matching; push local-only likes up, pull cloud-only likes down (Pattern 5).

### Anti-Pattern 5: A separate edge HTTP layer for Last.fm reads
**What people do:** Hand-roll fetch/retry/CORS in `proxy/lastfm.ts`.
**Why it's wrong:** Duplicates `http.ts` (`fetchWithRetry`, `corsHeaders`) and risks CORS-`*` regressions.
**Do this instead:** Read-only methods ride the catch-all, which already wires `fetchWithRetry` + own-origin CORS. Only the 3 signed routes do their own fetch (still importing `http.ts`).

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Last.fm read API (`ws.audioscrobbler.com`) | Key-only GET via `/api/[source]` passthrough (`source=lastfm`) | `getInfo`, `chart.*`, `tag.*`, `geo.*`, `user.get*`; absent-key → empty fallback like `/api/similar` |
| Last.fm auth (`auth.getSession`) | Signed GET via `/api/lastfm/session` | md5 sig with SECRET; sets httpOnly sk cookie; infinite-lifetime session |
| Last.fm write API (`track.scrobble`, `track.love`) | Signed POST via `/api/lastfm/{scrobble,love}` | POST form body; reads sk cookie; >30s & half/4-min scrobble rule |
| Real audio CDNs (netease/qq/kuwo/joox) | Reused by `lastfm` source `resolve()` | 2-step resolve: Last.fm gives {artist,title} → `searchAll` finds playable bytes |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `player.svelte.ts` ↔ `services/scrobble.ts` | Function calls (3 lifecycle hooks) | Service gates on auth; player stays Last.fm-agnostic |
| `library.svelte.ts` ↔ `stores/lastfm.svelte.ts` | `toggleLike` wrapper pushes to `/api/lastfm/love` | Local-first; Last.fm is additive mirror |
| `sources/lastfm.ts` ↔ `services/catalog.ts` | `resolve()` calls `searchAll` | 2-step audio resolve; reuses real sources |
| Client ↔ Edge (signed) | httpOnly cookie carries `sk`; client sends NO credential | Secret + sk never leave edge |
| `(app)/+layout.svelte` `tabs[]` ↔ `explore/+page.ts` | New nav entry + SSR `load` | Discovery uses load(); Home keeps client onMount |

---

## Suggested Build Order (Phases 8+)

Dependency analysis: **enrichment + discovery are read-only and key-only** (depend only on the existing passthrough + `LASTFM_KEY`, already in `Env`). **The new `lastfm` source** depends only on the existing source stack (no auth). **Auth is the prerequisite for scrobble + love-sync** (they need `sk`). So:

- **Phase 8 — Last.fm read foundation (enrichment + `lastfm` proxy passthrough).**
  Add `'lastfm'` to `SourceId`, `proxy/lastfm.ts` (read-only `buildUrl` for getInfo/chart/tag/geo/user), register in both registries, `services/lastfm.ts` enrichment (merge `track.getInfo`/`artist.getInfo` — bios, tags, hi-res art — onto existing Tracks). No auth, no UI tab. *Independent; de-risks proxy wiring.*

- **Phase 9 — Discovery tab (read-only).**
  `(app)/explore` route + `+page.ts` load (charts/tags/top-lists via passthrough), add Explore to `tabs[]`. Tracks are `lastfm` stubs. *Depends on Phase 8 proxy + source registration.*

- **Phase 10 — `lastfm` source playback (2-step resolve).**
  `sources/lastfm.ts` `search()` + `resolve()` (re-search real sources for playable audio). Wires discovery/enrichment stubs to actual playback. *Depends on Phase 8 (source id) + existing catalog; independent of auth.*

- **Phase 11 — Signed-call infrastructure + auth.**
  `proxy/sign.ts` (md5 api_sig), `/api/lastfm/session` (getSession + httpOnly cookie), `/auth/callback`, `stores/lastfm.svelte.ts` (username/authed), sign-in/out UI + boot "who am I" check. *Prerequisite for all writes.*

- **Phase 12 — Scrobble + now-playing.**
  `services/scrobble.ts` + `/api/lastfm/scrobble` (POST, signed), wire the 3 player hooks (play-start / threshold / end + flush). *Depends on Phase 11.*

- **Phase 13 — Loved-tracks two-way sync + history.**
  `/api/lastfm/love` (POST, signed), wrap `library.toggleLike`, sign-in reconciliation (`user.getLovedTracks` union-merge), `lovedKeys` mirror, optional recent-tracks history view (`user.getRecentTracks`). *Depends on Phase 11 (auth).*

This order ships value early (richer metadata + discovery + a new playable source) WITHOUT any auth surface, then layers the optional signed features on top — matching PROJECT.md's "sign-in is optional/additive, local-first keeps working signed-out."

---

## Sources

- Existing code (HIGH — read directly): `src/lib/proxy/{proxy-types,proxy-registry,http}.ts`, `src/routes/api/[source]/[...path]/+server.ts`, `src/routes/api/similar/+server.ts`, `src/lib/sources/{types,registry}.ts`, `src/lib/stores/{player,library,settings,names}.svelte.ts`, `src/lib/services/{catalog,picks,similar,dedupe}.ts`, `src/routes/(app)/{+layout,+page,search/+page}.svelte`
- `.planning/PROJECT.md` v1.1 milestone goals + Key Decisions (HIGH)
- Last.fm Web Authentication spec — /api/auth redirect → callback token → auth.getSession; api_sig = md5(alphabetical name+value params + shared secret); session keys infinite lifetime: https://www.last.fm/api/webauth (HIGH)
- Last.fm track.scrobble — POST write service, required params (artist/track/timestamp/api_key/api_sig/sk): https://www.last.fm/api/show/track.scrobble (HIGH)
- Last.fm scrobbling rules — >30s length, half-duration-or-240s threshold; updateNowPlaying on play start, no timestamp: https://www.last.fm/api/scrobbling (HIGH)

---
*Architecture research for: Last.fm integration into MusicSquare Mobile (v1.1)*
*Researched: 2026-06-06*
