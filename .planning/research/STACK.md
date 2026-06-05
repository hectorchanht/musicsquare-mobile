# Stack Research — v1.1 Last.fm Integration

> **Scope note:** This is a SUBSEQUENT-milestone (v1.1) addendum. The base-app stack
> (SvelteKit, Vite, Cloudflare adapter, PWA, audio) is in the existing `STACK.md`
> (v1.0, 2026-06-05) and is NOT re-researched here. This file covers ONLY the new
> capabilities: Last.fm metadata/auth/scrobble/discovery + the YouTube-style source.

**Domain:** Last.fm integration (metadata + signed auth/scrobble + discovery + YouTube-style playback source) layered onto an existing SvelteKit + Cloudflare Pages/Workers PWA music aggregator
**Researched:** 2026-06-06
**Confidence:** HIGH

## TL;DR (read this first)

1. **You need ZERO new runtime npm dependencies.** The single thing that looked like it required a library — the Last.fm md5 `api_sig` — is wrong: **Cloudflare Workers / Pages Functions support MD5 natively** via `crypto.subtle.digest({ name: 'MD5' }, bytes)`. No `js-md5`/`spark-md5`/`blueimp-md5`, no `nodejs_compat` crypto, no pure-JS fallback needed. (HIGH — official Cloudflare docs.)
2. **Auth flow:** use the **Last.fm Web Application flow** (token → `last.fm/api/auth?api_key=...&cb=<callback>` → `auth.getSession`). It is purpose-built for a hosted web app with a callback URL. (HIGH — official Last.fm docs.)
3. **Session-key storage:** **server-set `HttpOnly` `Secure` cookie**, NOT `localStorage`. The session key is a permanent (never-expires) credential that, combined with your edge-only secret, can love/scrobble on the user's behalf. It must never touch JS. (HIGH — security reasoning + Last.fm "store securely".)
4. **YouTube-style source:** the realistic, on-pattern option is the **GD Studio meting-style API** (`music-api.gdstudio.xyz`) with `source=ytmusic`, fronted by a new edge `ProxyAdapter` exactly like Netease. It returns a direct playable URL and is the *same* API family the upstream `CharlesPikachu/musicdl` already uses. Public Piped/Invidious instances and the YouTube Data API v3 are **not** viable (see What NOT to Use). (MEDIUM — third-party, no SLA, study-only ToS.)
5. **Caching:** add the **Cloudflare Cache API** (`caches.default`) in the new metadata/charts proxy routes. No KV binding needed for v1.1; Cache API is free, zero-config, and right-sized for Last.fm read endpoints. (HIGH — official docs.)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Web Crypto `crypto.subtle.digest({name:'MD5'})` | built-in (workerd runtime) | Compute Last.fm `api_sig` (md5 of alpha-sorted `<name><value>…<secret>`) on the edge | **Native on Cloudflare Workers AND Pages Functions** — same workerd runtime. No package, no `nodejs_compat`, no client exposure. Faster than any JS md5. The premise that "MD5 is not in Web Crypto on Workers" holds for the *standard* but Cloudflare adds MD5 explicitly for legacy interop. |
| Last.fm Web Application auth flow | Last.fm API 2.0 (`ws.audioscrobbler.com/2.0/`) | Optional user sign-in → infinite-lifetime session key | The only Last.fm flow designed around a server callback URL; fits a hosted SvelteKit app. Desktop flow is for native apps polling a token. |
| SvelteKit endpoints (`+server.ts`) | `@sveltejs/kit` 2.63.0 (already in repo) | New `/api/lastfm/*` routes: signed auth callback, scrobble/love, read proxies, discovery | Mirrors the existing `/api/similar` + `/api/[source]/[...path]` edge-proxy pattern. Secrets read from `platform.env`, never bundled. |
| Cloudflare Cache API (`caches.default`) | built-in (workerd runtime) | Edge-cache Last.fm charts/tags/getInfo responses | Free, no binding, no quota. Directly addresses Last.fm rate limits + the GD Studio "50 req / 5 min" cap. |
| GD Studio meting-style API | live service, no version (study-use) | The "YouTube-style" playback source — `source=ytmusic` resolves a playable audio URL from `{artist, track}` | Same unofficial-proxy posture as the existing 4 sources; returns a **direct** audio URL (no MSE/HLS); upstream `musicdl` already integrates it. Must be edge-proxied (see Pitfalls). |

**Net new dependencies in `package.json`: none.** Everything above is either runtime-built-in or already installed.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *(none required)* | — | — | The md5 question is answered by the platform, not a package. Do not add one. |
| `spark-md5` *(fallback only, NOT installed)* | 3.0.2 | Pure-JS md5 if — and only if — a future runtime drops native MD5 | Documented escape hatch. Tiny, zero deps, runs with no Node built-ins. Prefer over `js-md5` (0.8.3) / `blueimp-md5` (2.19.0) / `md5` (2.3.0, heavier deps). Do NOT install unless native MD5 is proven broken in your deploy. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `wrangler` 4.98.0 (already installed) | `wrangler pages secret put LASTFM_KEY` / `LASTFM_SECRET` for prod; `.dev.vars` for local | Already wired — keys exist in `.dev.vars` and `App.Platform.env`. No change. |
| `vitest` ^4.1.3 (already installed) | Unit-test the api_sig builder, cookie round-trip, GD Studio adapter normalization | Follow existing `*.test.ts` + `__fixtures__/` pattern (capture a `ytmusic` search/url fixture). |

## Installation

```bash
# Core: NOTHING. No new runtime deps for v1.1.
# (Native crypto.subtle MD5, native Cache API, existing SvelteKit/wrangler/vitest.)

# Secrets already present in .dev.vars (LASTFM_KEY, LASTFM_SECRET).
# For production (Pages):
wrangler pages secret put LASTFM_KEY
wrangler pages secret put LASTFM_SECRET

# OPTIONAL escape hatch — install ONLY if native MD5 is ever proven unavailable:
# pnpm add spark-md5 && pnpm add -D @types/spark-md5
```

### Reference: computing `api_sig` on the edge (no library)

```ts
// All params EXCEPT format & callback, sorted alphabetically by key,
// concatenated as <name><value>…, then + secret, then md5 → 32 hex chars.
async function lastfmSig(params: Record<string, string>, secret: string): Promise<string> {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join('') + secret;
  const digest = await crypto.subtle.digest({ name: 'MD5' }, new TextEncoder().encode(base));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Native `crypto.subtle.digest('MD5')` | `spark-md5` 3.0.2 (pure JS) | Only if a future runtime/policy removes Cloudflare's non-standard MD5. Keep the one-line swap documented; don't pre-install. |
| Last.fm **Web** auth flow (callback URL) | Last.fm **Desktop** flow (token + poll, no callback) | Never for this app. Desktop flow exists for installed apps with no public callback; a hosted PWA has a clean callback URL, so Web flow is strictly simpler. |
| **HttpOnly cookie** for session key | `localStorage` | Only acceptable if you accept that any XSS = permanent account takeover — and you can't sign writes client-side anyway (secret is edge-only). So: never. |
| **Cloudflare Cache API** for reads | **Workers KV** | Use KV only if you later need cross-PoP shared cache or want to store the *parsed/normalized* discovery payload with a long TTL and explicit invalidation. For v1.1 charts/tags, Cache API is simpler and free. |
| **GD Studio `ytmusic`** source | Self-hosted Piped/Invidious instance | Only if you stand up and maintain your own instance (VPN-fronted IP). Out of scope for a free-edge personal project; high ops burden. |
| GD Studio `ytmusic` | `ytmusicapi` (Python) / `yt-dlp` | Never on Cloudflare — both are Python and need a long-running runtime + ffmpeg/signature solving. Not runnable on workerd. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any md5 npm package (`js-md5`, `blueimp-md5`, `md5`, `crypto-js`) | Unnecessary — workerd has native MD5. `crypto-js`/`md5` also drag CJS/Node-ish deps and bloat the bundle. | `crypto.subtle.digest({ name: 'MD5' }, ...)` |
| Node `crypto` (`createHash('md5')`) | Even with `nodejs_compat`, heavier and unnecessary when Web Crypto MD5 is native. Avoid coupling auth to the Node compat shim. | Web Crypto `subtle.digest` |
| `localStorage` for the Last.fm session key | Session key never expires; paired with the edge secret it can love/scrobble forever. JS-readable storage = XSS → permanent takeover. Mirrors the JOOX_TOKEN "never on client" rule (T-01-04 / T-5ug-01). | Server-set `HttpOnly; Secure; SameSite=Lax` cookie; sign all write calls on the edge |
| **YouTube Data API v3** for resolution | `search.list` costs **100 units**; free quota is **10,000 units/day** = ~100 searches/day total across ALL users. Also returns metadata only — **no audio stream URL**. Useless for playback resolution. | GD Studio `ytmusic` source (returns a playable URL) |
| **Public Piped / Invidious instances** | 2026 status: Google IP-blocks, CAPTCHAs, throttling; public instances are "a rate-limit roulette wheel." No SLA, frequent 403s, instances vanish. | GD Studio `ytmusic` (still third-party, but on-pattern + returns ready URLs) |
| **`yt-dlp` / `ytmusicapi`** on the edge | Python + ffmpeg + JS-signature-cipher solving; needs a persistent process. Cannot run on workerd (CPU/time limits, no Python). | GD Studio `ytmusic` |
| Calling GD Studio **directly from the browser** | It requires an `Origin: https://music.gdstudio.xyz` request header and won't return permissive CORS — a browser can't spoof `Origin`, so direct calls fail. | New edge `ProxyAdapter` (server-side fetch sets the required header) |
| Paid streaming APIs (Spotify/Apple) | Out of scope per PROJECT.md (licensing/auth). | n/a |

## Stack Patterns by Variant

**For the Last.fm signed-auth + scrobble feature:**
- New route `src/routes/api/lastfm/auth/+server.ts` (the callback): reads `?token=`, computes `api_sig` with the edge `LASTFM_SECRET`, calls `auth.getSession`, then sets `HttpOnly` cookie `{ sk, username }` and redirects back into the app.
- New route(s) for writes (`track.love`, `track.scrobble`): read `sk` from the cookie, build the signed POST on the edge, never expose `sk` or secret to the client.
- Read-only Last.fm features keep working with `LASTFM_KEY` only and **no** secret/session — exactly like `/api/similar` already does (absent-key = supported fallback, never throw).

**For Last.fm metadata enrichment + discovery (read-only):**
- New route `src/routes/api/lastfm/[method]/+server.ts` (or per-method routes mirroring `/api/similar`): inject `LASTFM_KEY` on the edge, call `track/artist/album.getInfo`, `chart.*`, `geo.getTopTracks`, `tag.getTop*`, return cleaned JSON.
- Wrap each in the Cache API: `cache.match(req)` → on miss `fetchWithRetry` (existing helper) → `cache.put(req, res.clone())` with `Cache-Control: public, max-age=<ttl>` (charts ~1h, getInfo ~24h, tags ~6h). Use `caches.default`.
- Reuse the `/api/similar` absent-key/error discipline (return safe empty payload, never throw) as the template.

**For the YouTube-style playback source (`ytmusic`):**
- Add it as a **first-class source** in the registry: `SourceId` gains `'ytmusic'`; one client adapter `src/lib/sources/ytmusic.ts` (search → normalize → `Track`, resolve → playable `audioUrl`) + one proxy adapter `src/lib/proxy/ytmusic.ts` (builds the GD Studio upstream URL, sets the required `Origin` header server-side). One line each in `registry.ts` / `proxy-registry.ts`. This is the exact "adding a source = one client file + one proxy file + one line in each registry" contract from `sources/types.ts`.
- The GD Studio request needs an `s` checksum param (md5-derived: `md5("music.gdstudio.xyz|<padded-version>|<9-digit-ts>|<urlencoded-id>")`, last 8 chars, uppercase). Compute it **on the edge** in the proxy adapter using the same native `crypto.subtle` MD5 — another reason no md5 package is needed. The host/version string is upstream-drift risk (flag for PITFALLS).
- `enabledByDefault` should be `false` initially (it's the discovery/Last.fm-seeded source, and the upstream is study-only / least proven) so the existing 4-source fan-out is unaffected until explicitly enabled.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `crypto.subtle.digest('MD5')` | workerd / `@sveltejs/adapter-cloudflare` 7.2.8 (Pages Functions) | Pages Functions run the **same workerd runtime** as Workers; native MD5 applies. No compat flag needed; `compatibility_date 2026-06-05` (current `wrangler.jsonc`) is fine. |
| Cache API `caches.default` | Pages Functions / workerd | Available; for `waitUntil()`-style async cache writes, uncomment `ctx?: ExecutionContext` in `app.d.ts` `Platform` (already stubbed there). |
| New `'ytmusic'` `SourceId` | `sources/types.ts`, `registry.ts`, `proxy-registry.ts`, `catalog.ts` interleave | `catalog.ts` interleave is already source-agnostic (`Object.keys(SOURCES)`); adding the id requires no aggregation edits. |
| `spark-md5` 3.0.2 (if ever used) | workerd, browser | Pure JS, no Node built-ins; ESM/CJS both fine. Only as a fallback. |

## Sources

- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ — **MD5 IS supported** in `crypto.subtle.digest` on Workers/workerd; "MD5 is not part of the WebCrypto standard but is supported in Cloudflare Workers for interacting with legacy systems." (HIGH)
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/index.md — confirms MD5 in the digest algorithm table, no compat flag required. (HIGH)
- https://www.last.fm/api/webauth — Web Application auth flow: `last.fm/api/auth?api_key=&cb=`, token at callback (valid 60 min, single-use), `auth.getSession` returns infinite-lifetime session key; api_sig = md5(alpha-sorted `<name><value>` + secret). (HIGH)
- https://lastfm-docs.github.io/api-docs/auth/signature/ — api_sig construction detail (HIGH, community mirror of official).
- https://developers.google.com/youtube/v3/determine_quota_cost — `search.list` = 100 units, 10,000/day default → ~100 searches/day; metadata only, no stream URL. (HIGH)
- https://sumguy.com/invidious-piped-redlib-nitter-2026/ — 2026: public Invidious/Piped instances IP-blocked/throttled, "rate-limit roulette wheel," self-host-only recommendation. (MEDIUM)
- https://music-api.gdstudio.xyz/api.php — GD Studio API: `types=search|url|pic|lyric`, `source=…|ytmusic`, returns direct audio URL, no key, ~50 req/5 min, study-only ToS. (MEDIUM — third-party, no SLA)
- https://github.com/CharlesPikachu/musicdl/blob/master/musicdl/modules/common/gdstudio.py — exact GD Studio request shape: `s` = md5(`host|version|ts9|urlencoded-id`)[-8:].upper(); sends `Origin: https://music.gdstudio.xyz` + browser UA. Upstream project already uses it. (MEDIUM)
- https://developers.cloudflare.com/workers/runtime-apis/cache/ — Cache API (`caches.default`), no Set-Cookie caching, programmatic put/match. (HIGH)
- `npm view` (npmjs registry, 2026-06-06) — current versions: spark-md5 3.0.2, js-md5 0.8.3, blueimp-md5 2.19.0, md5 2.3.0, ts-md5 2.0.1. (HIGH)

---
*Stack research (v1.1 Last.fm addendum) for: Last.fm integration on SvelteKit + Cloudflare Pages/Workers PWA*
*Researched: 2026-06-06*
