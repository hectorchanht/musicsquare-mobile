# Phase 1: Data Layer + Proxy Foundation - Research

**Researched:** 2026-06-05
**Domain:** TypeScript data-layer extraction + SvelteKit `+server.ts` metadata proxy on Cloudflare + audio-egress spike
**Confidence:** HIGH (stack versions verified on npm; `platform.env` + `<audio>` CORS verified against SvelteKit/MDN docs; the four source contracts are read directly from `index.html`). The egress-spike *outcome* is the genuine unknown this phase exists to resolve — its design is HIGH, its result is by definition unknown until run.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New SvelteKit app lives at the **repo root** (`src/`, `package.json`, `svelte.config.js`, `vite.config.ts` at top level).
- **D-02:** Existing desktop `index.html` is **moved to `legacy/index.html`** — preserved as the porting reference, kept out of the build path. (Currently still at repo root; the move is a Phase-1 task.)
- **D-03:** Package manager is **pnpm**.
- **D-04:** Clean rebuild — no requirement to stay mergeable with `upstream` (CharlesPikachu/musicsquare). Diverge freely.
- **D-05:** Cloudflare account **F147259@gmail.com** — `account_id: f1868a071996e836eae6da2b65f37929`.
- **D-06:** Cloudflare Pages/Workers project name is **`openmusic`** → `openmusic.pages.dev`. Git repo stays `musicsquare-mobile`; only the CF project/subdomain is `openmusic`.
- **D-07:** **Provision + deploy now.** Create the `openmusic` project and deploy a minimal proxy during Phase 1 so the browser-direct-audio egress spike runs on a **real Cloudflare edge** (edge egress IP differs from home/dev IP — that difference is precisely the risk being tested).
- **D-08:** **RISK / blocker to verify first:** the connected Cloudflare MCP token lists only *Flow* and *Frank.chan* accounts — NOT `F147259`. Confirm access to account `f1868a071996e836eae6da2b65f37929` (token scope / `wrangler login`) before provisioning. If access can't be obtained, surface to the user.
- **D-09:** The `/api/*` `+server.ts` proxy is a **thin pass-through** for the four existing sources (forward upstream JSON; client adapter normalizes to canonical Track shape). Proxy still owns CORS, bounded retry, and JOOX-token injection from `platform.env`. New sources (Phase 7) may normalize server-side.
- **D-10:** Canonical track ID = **`{source}:{songid}`**. Detail/lyrics resolution keys off this stable ID — NOT a positional index — so JOOX returns the *selected* track after reorder/paginate.
- **D-11:** Ported data layer is **TypeScript (strict)** with a shared `Track` type.

### Claude's Discretion
- The proxy shape default (D-09 passthrough) and the ID scheme (D-10 `{source}:{songid}`) were Claude's-discretion calls already locked into CONTEXT — treat them as locked.
- Remaining discretion in this phase: route layout (`/api/[source]/[...]` vs explicit per-endpoint), retry/timeout numbers, fixture/test structure, how the spike harness page is built. This research recommends concrete defaults for each below.

### Deferred Ideas (OUT OF SCOPE)
- Audio engine / playback wiring, `<audio>` element lifecycle, MediaSession — **Phase 2**. (Phase 1 only *resolves* audio URLs and runs the egress spike; it does not build the player.)
- Library persistence (`pikachu-music-library-v1` continuity, idb migration) — **Phase 3**.
- Server-side response normalization for *new* sources (Kugou/Migu) — **Phase 7** (the existing 4 stay passthrough per D-09).
- Custom domain for `openmusic` beyond `.pages.dev` — not needed this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **DATA-01** | Reusable data logic (per-source search/detail fetchers, LRC parsing) extracted from `index.html` into typed modules | "The Data Layer Being Ported" maps every `index.html` function → its `src/lib/` target with exact line numbers; `parseLRC`/`inferQualityFromUrl` port verbatim |
| **DATA-02** | A SvelteKit `+server.ts` proxy fronts all metadata calls (search/detail/lyrics), owns CORS + bounded retry, hides JOOX token via `platform.env` | "The `+server.ts` Metadata Proxy" — verified `platform?.env.JOOX_TOKEN` path, route shape, `.dev.vars`, CORS, retry helper |
| **DATA-03** | Search fans out across enabled sources with per-source isolation (`Promise.allSettled`) so one failing source never breaks the result set | "Promise.allSettled Fan-Out" — typed `SettledSourceResult`, port of `searchAllSources` from `Promise.all` → `allSettled` |
| **DATA-04** | Pluggable source-adapter registry: add a source by adding files only (client adapter + proxy adapter + registry import), touching no shared code | "The Source-Adapter Registry" — `SourceAdapter`/`ProxyAdapter` interfaces, `registry.ts` as the single enumeration, the acceptance test |
| **SRC-01** | The 4 existing sources (Netease, QQ, Kuwo, JOOX) work end-to-end through the new data layer + proxy | "Per-Source Port Map" — endpoint, params, response shape, quirks, and normalization for each of the 4 |
</phase_requirements>

## Summary

Phase 1 is a **headless extraction + de-risking** phase. There is no UI. The work is three interlocking pieces:

1. **Scaffold** a root-level SvelteKit 2 / Svelte 5 / Vite 8 app with `adapter-cloudflare`, pnpm, TypeScript strict, and move the monolith to `legacy/index.html`.
2. **Extract** the four sources' search/detail/LRC logic out of `legacy/index.html` into typed `src/lib/` modules behind a `SourceAdapter` (client) / `ProxyAdapter` (server) registry, with a `+server.ts` metadata proxy at `/api/*` that hides the JOOX token in `platform.env`, isolates per-source failures with `Promise.allSettled`, and keys detail resolution off the stable `{source}:{songid}` ID (fixing the JOOX position-index trap).
3. **Spike** the audio data-flow decision: deploy the minimal proxy to a real Cloudflare edge (`openmusic.pages.dev`) and empirically determine, per source, whether the resolved audio CDN URL plays **browser-direct** from the deployed edge — locking success criterion #5.

The proxy decision is already 90% made by research: the Worker proxies **metadata only**; audio bytes go **browser-direct** because (verified, MDN) a plain `<audio src>` cross-origin load is **not CORS-gated**, and (verified, Cloudflare docs) routing audio through the Worker risks the free-tier 10ms CPU limit and an edge-egress geo/IP mismatch against China-centric CDNs. The spike's job is to *confirm* browser-direct works per source from the deployed edge and to design the Worker stream-passthrough fallback for any source where it doesn't.

**Primary recommendation:** Scaffold root SvelteKit + `adapter-cloudflare`; build the `SourceAdapter`/`ProxyAdapter` registry with a thin-passthrough `/api/[source]/[...path]/+server.ts`; port the 4 sources verbatim from `legacy/index.html` (preserving the QQ dual-format guard and JOOX probe, but rekeying JOOX detail off `{source}:{songid}` + re-validation instead of blind position index); use `Promise.allSettled` for the fan-out; and run the egress spike as its own explicitly-scoped work item with a hard decision gate — gated *first* on resolving the D-08 account-access blocker (`wrangler login` to F147259 confirmed before any deploy).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Search request to upstream proxy | Frontend Server (`+server.ts` on CF Worker) | — | Hides JOOX token, owns CORS/retry; same-origin from browser |
| Search aggregation / interleave / dedup | Browser (client `catalog` service) | — | `Promise.allSettled` fan-out + `getInterleavedSearchList` + `trackMap` are pure client logic; per ARCHITECTURE.md the Worker is per-source only |
| Detail/audio-URL resolution request | Frontend Server (`+server.ts`) | — | Same proxy boundary; JOOX token + probe injection live server-side |
| Lazy detail dispatch (`ensureTrackDetails`) | Browser (registry lookup) | — | Decides *when/which* to resolve; ports the monolith's `switch(source)` to `SOURCES[track.source].resolve()` |
| LRC parsing | Browser (`lrc.ts` util) | — | Pure string→array transform; no network, no DOM |
| JOOX token storage | Frontend Server (`platform.env`) | — | Secret must never reach the client bundle (success criterion #2) |
| Audio byte streaming | **Browser ↔ CDN direct** (Phase 2 sets `<audio>.src`) | Frontend Server stream-passthrough (fallback only, if spike fails) | `<audio src>` is not CORS-gated (MDN); browser preserves the geo/IP context the CDN URL expects; Worker free-tier CPU forbids buffering |
| Track identity / dedup | Browser (`trackMap` keyed `{source}:{songid}`) | — | Stable ID survives reorder/paginate |

## Standard Stack

> Project-level `.planning/research/STACK.md` already selected and version-pinned the full stack on 2026-06-05. This section re-verifies the **Phase-1-relevant subset** against npm as of 2026-06-05 and flags one drift.

### Core (Phase 1 needs these)
| Library | Version (verified npm 2026-06-05) | Purpose | Why Standard |
|---------|-----------------------------------|---------|--------------|
| `svelte` | `5.56.2` | Reactivity (Phase 1 uses none directly — headless — but it's the framework floor) | Only supported major line `[VERIFIED: npm registry, slopcheck OK]` |
| `@sveltejs/kit` | `2.63.0` | Routing + `+server.ts` server endpoints = the proxy | First-class CF adapter; `+server.ts` gives the proxy for free `[VERIFIED: npm registry, slopcheck OK]` `[CITED: svelte.dev/docs/kit/adapter-cloudflare]` |
| `vite` | `8.0.16` | Build/dev server | Mandated by vite-plugin-svelte 7 (`^8`) `[VERIFIED: npm registry, slopcheck OK]` |
| `@sveltejs/vite-plugin-svelte` | `7.1.2` | Svelte↔Vite glue | Peer-requires Vite `^8`, Svelte `^5.46.4` `[VERIFIED: npm registry, slopcheck OK]` |
| `@sveltejs/adapter-cloudflare` | `7.2.8` | Build SvelteKit → Cloudflare Workers Static Assets (compatible w/ Pages) | THE adapter; exposes `platform.env`; peer-requires `wrangler ^4` `[VERIFIED: npm registry, slopcheck OK]` `[CITED: svelte.dev/docs/kit/adapter-cloudflare]` |
| `wrangler` | `4.98.0` (npm) / `4.95.0` (installed locally) | CF local dev (`.dev.vars` → `platform.env`) + deploy | Emulates bindings locally, deploys app+Worker `[VERIFIED: npm registry, slopcheck OK]` |
| `@cloudflare/workers-types` | `4.20260605.1` | Types for `platform.env` bindings in `app.d.ts` | Required to type the proxy's env access `[VERIFIED: npm registry, slopcheck OK]` |
| `typescript` | see drift note → pin **`~5.9`** | Strict-typed data layer (D-11) | The ~25-field Track + 4 source shapes need types to port safely `[VERIFIED: npm registry, slopcheck OK]` |

> **⚠️ Version drift flag (TypeScript):** STACK.md said TypeScript "5.x (≥5.3.3)". As of 2026-06-05 `npm view typescript version` returns **`6.0.3`** — TypeScript released a 6.0 major. SvelteKit/svelte-check compatibility with TS 6.0 is **not yet verified for this stack** in this session. **Recommendation: pin TypeScript to the latest 5.x line (`~5.9`) for Phase 1** to avoid a toolchain-compatibility rabbit hole on the foundational phase; revisit TS 6 as an isolated upgrade later. `[ASSUMED]` that `~5.9` is the safe floor — confirm the exact latest 5.x at scaffold time with `pnpm view typescript@5 version`.

### Supporting (Phase 1)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `idb` | `8.0.3` | IndexedDB wrapper | **NOT Phase 1** — persistence is Phase 3. Do not install yet. `[VERIFIED: npm registry, slopcheck OK]` |
| `@vite-pwa/sveltekit` | `1.1.0` | PWA | **NOT Phase 1** — Phase 5. The Phase-1 SW concern is only "don't break audio later"; no SW is built here. |

**Phase 1 install (root, pnpm):**
```bash
# Scaffold first (interactive — choose SvelteKit minimal + TypeScript):
pnpm dlx sv create .            # scaffold into repo root (D-01); see "Scaffolding Gotchas" below
# Then add the deploy toolchain:
pnpm add -D @sveltejs/adapter-cloudflare wrangler @cloudflare/workers-types
# Pin TS to 5.x to dodge the TS6 drift:
pnpm add -D typescript@~5.9
```
> Do NOT install `idb`, PWA, gesture, or audio libs in Phase 1 — they belong to later phases.

**Version verification done:** all eight core packages confirmed present and current on the npm registry as of 2026-06-05 (see table); `slopcheck scan` of a manifest pinning these exact versions returned **9/9 `[OK]`** (see Package Legitimacy Audit).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Proxy as `+server.ts` route | Separate standalone Worker | More deploys/domains/CORS for zero benefit here — STACK.md explicitly rejects this for v1 |
| `adapter-cloudflare` | `adapter-cloudflare-workers` | Deprecated (old Workers Sites); doesn't support all SvelteKit features — never use |
| `Promise.allSettled` | `Promise.all` (current monolith) | `all` rejects-all-or-resolves-all → one dead source blanks search. `allSettled` is mandatory per DATA-03 |

## Package Legitimacy Audit

> All Phase-1 packages verified. slopcheck 0.6.1 installed and `scan` run against a manifest pinning the exact versions above.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `svelte` | npm | mature (5.x line) | github.com/sveltejs/svelte | [OK] | Approved |
| `@sveltejs/kit` | npm | mature | github.com/sveltejs/kit | [OK] | Approved |
| `vite` | npm | mature | github.com/vitejs/vite | [OK] | Approved |
| `@sveltejs/vite-plugin-svelte` | npm | mature | github.com/sveltejs/vite-plugin-svelte | [OK] | Approved |
| `@sveltejs/adapter-cloudflare` | npm | mature | github.com/sveltejs/kit | [OK] | Approved |
| `wrangler` | npm | mature | github.com/cloudflare/workers-sdk | [OK] | Approved |
| `@cloudflare/workers-types` | npm | mature (daily releases) | github.com/cloudflare/workerd | [OK] | Approved |
| `typescript` | npm | mature | github.com/microsoft/TypeScript | [OK] | Approved (pin `~5.9`, see drift flag) |
| `idb` | npm | mature | github.com/jakearchibald/idb | [OK] | Approved (Phase 3, not now) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                         BROWSER (SvelteKit client — headless in Phase 1)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  catalog.searchAll(keyword)                                                    │
  │      │                                                                          │
  │      ▼  Promise.allSettled over getEnabledAdapters()                            │
  │  ┌──────────────┐  each adapter.search() / .resolve()  builds a same-origin     │
  │  │ SourceAdapter│  fetch to /api/<source>/...                                   │
  │  │  registry    │      │                                                        │
  │  │ netease/qq/  │      │  ← normalizes upstream JSON → Track (D-09 passthrough) │
  │  │  kuwo/joox   │      │                                                        │
  │  └──────────────┘      │   dedupe by uid={source}:{songid} (trackMap)           │
  │      │                 │   interleave round-robin (getInterleavedSearchList)    │
  │      ▼                 │                                                        │
  │  ensureTrackDetails(track) → SOURCES[track.source].resolve()                    │
  └──────────────────────────────────┼─────────────────────────────────────────────┘
                                      │  HTTPS  same-origin  /api/*
                                      ▼
                    CLOUDFLARE EDGE (adapter-cloudflare Worker — openmusic.pages.dev)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  src/routes/api/[source]/[...path]/+server.ts                                  │
  │      router → CORS(own origin) → ProxyAdapter[source]                          │
  │      → inject JOOX token from platform.env.JOOX_TOKEN  (never sent to client)  │
  │      → fetch(upstream, {signal: AbortSignal.timeout}) + bounded retry on 429/5xx│
  │      → forward upstream JSON unchanged (passthrough, D-09)                      │
  └──────────────────────────────────┼─────────────────────────────────────────────┘
                                      ▼
       Unofficial upstream proxies:  api.qijieya.cn · tang.api.s01s.cn ·
                                     kw-api.cenguigui.cn · apicx.asia/api/joox_music
                                      │ returns audioUrl pointing at →
                                      ▼
       ════════════ AUDIO CDN (Netease/QQ/Kuwo/JOOX origin servers) ════════════
                                      ▲
   THE SPIKE QUESTION ───────────────┘
   Does <audio src=CDN_URL> load browser-DIRECT from a deployed edge user?
   (NOT through the Worker — audio bytes never transit /api in the chosen design)
```

File-to-implementation mapping is in "The Data Layer Being Ported" table below — the diagram shows conceptual data flow only.

### Recommended Project Structure (Phase 1 subset)
```
musicsquare-mobile/                    # repo root (D-01)
├── legacy/
│   └── index.html                     # the monolith, moved here (D-02), out of build
├── src/
│   ├── lib/
│   │   ├── sources/
│   │   │   ├── types.ts               # SourceAdapter interface + Track + SourceId + SettledSourceResult
│   │   │   ├── registry.ts            # SOURCES record + getEnabledAdapters() — ONLY enumeration of sources
│   │   │   ├── netease.ts             # client SourceAdapter (port of searchNetease + fetchNeteaseDetails)
│   │   │   ├── qq.ts
│   │   │   ├── kuwo.ts
│   │   │   └── joox.ts
│   │   ├── services/
│   │   │   ├── catalog.ts             # searchAll() allSettled + interleave + dedupe; ensureTrackDetails()
│   │   │   └── lrc.ts                 # parseLRC() [port verbatim] + inferQualityFromUrl()
│   │   └── proxy/
│   │       ├── proxy-types.ts         # ProxyAdapter interface + Env type
│   │       ├── proxy-registry.ts      # PROXIES record — mirrors sources by id
│   │       ├── netease.ts             # ProxyAdapter: real upstream URL/params (no auth)
│   │       ├── qq.ts
│   │       ├── kuwo.ts
│   │       ├── joox.ts                # reads env.JOOX_TOKEN HERE
│   │       └── http.ts                # fetchWithRetry(timeout, bounded retry) + CORS helper
│   ├── routes/
│   │   ├── api/
│   │   │   └── [source]/[...path]/+server.ts   # the metadata proxy (DATA-02)
│   │   └── spike/+page.svelte          # the egress-spike harness page (deployed for success criterion #5)
│   └── app.d.ts                        # App.Platform.env: { JOOX_TOKEN: string }
├── static/
├── svelte.config.js                    # adapter-cloudflare
├── wrangler.jsonc                       # name="openmusic", compatibility_date, nodejs_compat
├── .dev.vars                            # JOOX_TOKEN=... (gitignored — local dev only)
├── .gitignore                           # MUST include .dev.vars
├── tsconfig.json                        # strict: true
└── package.json
```

### Pattern 1: Two-sided adapter registry (the load-bearing design — DATA-04)
**What:** A `SourceAdapter` on the client (calls `/api/<source>/...`, normalizes to Track) and a `ProxyAdapter` on the Worker (knows real upstream URL/params/auth). Both keyed by the same `SourceId`. Adding a source = one client file + one proxy file + one line in each registry. Aggregation/dispatch code **never names a source**.
**When to use:** Always here — Phase 7 adds Kugou/Migu, and the acceptance test (success criterion #3) is "adding a hypothetical source touches only new files + registry imports."
**Example:**
```typescript
// src/lib/sources/types.ts  [CITED: .planning/research/ARCHITECTURE.md client-SourceAdapter sketch]
export type SourceId = 'netease' | 'qq' | 'kuwo' | 'joox';

export interface Track {
  uid: string;            // canonical id = `${source}:${songid}`  (D-10)
  source: SourceId;
  songid: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  audioUrl: string | null;     // null until resolve()
  lrc: string | null;          // null until resolved (JOOX has it at search time)
  lrcUrl: string | null;       // Netease only
  detailsLoaded: boolean;
  quality: string | null;
  qualityLabel: string | null;
  keyword: string;             // search keyword (QQ/JOOX detail need it)
  displayIndex: number;        // 1-based, for interleave ordering ONLY (never for identity)
  // source-specific extras kept optional so the shared shape stays clean:
  songMid?: string;            // QQ/JOOX
  jooxIndex?: number;          // JOOX positional fallback ONLY — see Pitfall 4
  qqQualityText?: string | null;
  jooxQualityText?: string | null;
  pay?: string | null;         // QQ paywall signal
  pageUrl?: string;            // QQ
}

export interface SourceAdapter {
  id: SourceId;
  label: string;
  enabledByDefault: boolean;
  search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]>;
  resolve(track: Track, signal: AbortSignal): Promise<Track>;   // lazy audioUrl + lrc + quality
}
```
```typescript
// src/lib/sources/registry.ts — the ONLY place sources are enumerated
import { netease } from './netease';
import { qq } from './qq';
import { kuwo } from './kuwo';
import { joox } from './joox';
export const SOURCES: Record<SourceId, SourceAdapter> = { netease, qq, kuwo, joox };
export const getEnabledAdapters = (prefs: Partial<Record<SourceId, boolean>> = {}) =>
  Object.values(SOURCES).filter(a => prefs[a.id] ?? a.enabledByDefault);
```

### Pattern 2: Thin-passthrough `+server.ts` proxy with token injection (DATA-02, D-09)
**What:** One catch-all route handles all four sources. The `ProxyAdapter` builds the real upstream URL (injecting `platform.env.JOOX_TOKEN` for JOOX), fetches with timeout + bounded retry, and returns the upstream body **unchanged** (passthrough). CORS scoped to own origin.
**When to use:** All search/detail/lyrics metadata calls in Phase 1.
**Example:**
```typescript
// src/routes/api/[source]/[...path]/+server.ts  [CITED: svelte.dev/docs/kit/adapter-cloudflare — platform?.env access]
import type { RequestHandler } from './$types';
import { PROXIES } from '$lib/proxy/proxy-registry';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

export const GET: RequestHandler = async ({ params, url, platform, request }) => {
  const proxy = PROXIES[params.source as keyof typeof PROXIES];
  if (!proxy) return new Response('unknown source', { status: 404 });

  // platform?.env is the verified path for CF bindings/secrets in adapter-cloudflare.
  const env = platform?.env;                       // { JOOX_TOKEN: string }
  const upstream = proxy.buildUrl(params.path, url.searchParams, env);  // joox injects token here

  const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
  // D-09 passthrough: forward body unchanged; only add CORS + content-type.
  return new Response(res.body, {
    status: res.status,
    headers: { ...corsHeaders(request.headers.get('origin')), 'content-type': res.headers.get('content-type') ?? 'application/json' }
  });
};
```
> The JOOX token lives only in `platform.env` (from `.dev.vars` locally, `wrangler secret` / dashboard in prod). It is injected into the *upstream* URL on the edge and **never appears in any `/api/*` request the browser makes** — satisfying success criterion #2. `[CITED: svelte.dev/docs/kit/adapter-cloudflare]` confirms `platform?.env.YOUR_SECRET` is the exact runtime path and `App.Platform.env` is the `app.d.ts` typing location.

### Pattern 3: `Promise.allSettled` fan-out with typed per-source results (DATA-03)
**What:** `catalog.searchAll` maps enabled adapters to promises, awaits `allSettled`, and partitions into fulfilled tracks + typed per-source failures. One thrown source leaves the rest intact.
**When to use:** The search aggregator. This is the direct fix for the monolith's `Promise.all` (which the monolith *partially* mitigated by swallowing errors inside each fetcher — but `allSettled` makes isolation explicit and surfaces per-source status).
**Example:**
```typescript
// src/lib/services/catalog.ts  [CITED: .planning/research/PITFALLS.md Pitfall 6]
export interface SettledSourceResult {
  source: SourceId;
  status: 'ok' | 'error';
  tracks: Track[];
  error?: string;       // typed message for per-source status UI (Phase 4 consumes)
}

export async function searchAll(keyword: string, page: number, prefs: Partial<Record<SourceId, boolean>>) {
  const adapters = getEnabledAdapters(prefs);
  const ac = new AbortController();
  const settled = await Promise.allSettled(
    adapters.map(a => a.search(keyword, page, ac.signal))
  );
  const perSource: SettledSourceResult[] = settled.map((r, i) => ({
    source: adapters[i].id,
    status: r.status === 'fulfilled' ? 'ok' : 'error',
    tracks: r.status === 'fulfilled' ? r.value : [],
    error: r.status === 'rejected' ? String(r.reason) : undefined,
  }));
  // dedupe by uid via a Map, then interleave round-robin (port getInterleavedSearchList).
  return { perSource, interleaved: interleave(dedupe(perSource.flatMap(s => s.tracks))) };
}
```

### Pattern 4: Stable-ID detail resolution, not positional (DATA / D-10, fixes JOOX trap)
**What:** `ensureTrackDetails` looks up the adapter by `track.source` and resolves by the track's stable identity, not its list position. For JOOX specifically (whose upstream detail API is keyed by position `n`), the adapter still passes `n=jooxIndex` to the upstream **but re-validates** the returned `songmid`/`歌曲ID`/title against the expected track and fails loudly on mismatch.
**Example:**
```typescript
// src/lib/services/catalog.ts
export function ensureTrackDetails(track: Track, signal: AbortSignal): Promise<Track> {
  if (track.detailsLoaded && track.audioUrl) return Promise.resolve(track);
  return SOURCES[track.source].resolve(track, signal);   // was: switch(track.source) in monolith
}
```

### Anti-Patterns to Avoid
- **Hard-coding the source list in aggregation** (`Promise.allSettled([netease.search(), qq.search(), ...])`): re-introduces the friction DATA-04 removes. Iterate `getEnabledAdapters()`.
- **Buffering audio in the Worker** (`await res.arrayBuffer()` on audio): blows free-tier 10ms CPU + 128MB. Phase 1 never proxies audio bytes anyway; the *fallback* (if spike fails) must stream-passthrough, never buffer.
- **Returning `Access-Control-Allow-Origin: *`** on the proxy: combined with the JOOX token, makes you an open music/CORS relay. Scope CORS to own origin(s).
- **Committing `.dev.vars`**: leaks the JOOX token. It must be gitignored; production secret set via `wrangler secret put JOOX_TOKEN` or dashboard.
- **Re-deriving `jooxIndex` from a fresh search before resolving**: the position drifts → wrong song. Keep `jooxIndex` bound to the exact result set the user acted on, and re-validate after fetch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Same-origin metadata proxy | Standalone Worker + CORS plumbing | SvelteKit `+server.ts` route | Same-origin by construction = zero CORS; one deploy artifact |
| Reading secrets at the edge | `.env` + `import.meta.env` (ships to client) | `platform.env.JOOX_TOKEN` | `platform.env` is server-only; `import.meta.env` PUBLIC_* would leak the token |
| Request timeout | manual `setTimeout` + `AbortController` everywhere | `AbortSignal.timeout(ms)` | Native, one-liner; monolith's JOOX probe hand-rolled this — modern runtime has it built in |
| Cross-origin audio playback | Worker audio stream proxy | `<audio src>` direct (Phase 2) | `<audio src>` is **not** CORS-gated (MDN) — direct works without any proxy and preserves geo/IP |
| LRC parsing | new parser | port `parseLRC` verbatim from `index.html:2517` | Proven, 16 lines, handles `[mm:ss.xxx]`; no reason to rewrite |
| Quality from URL | new logic | port `inferQualityFromUrl` from `index.html:1747` | Proven extension-sniff (flac/wav/ape→lossless else 320k) |

**Key insight:** Phase 1's data logic is **already written and proven** in `legacy/index.html`. The job is *extraction + typing + re-keying identity*, not invention. The only genuinely new code is the registry interfaces, the `+server.ts` proxy shell, the retry helper, and the spike harness. Resist rewriting the fetchers — port them.

## Runtime State Inventory

> This phase moves `index.html` → `legacy/index.html` and changes the JOOX token's home from a client constant to a server secret. That makes it a refactor/rename-adjacent phase, so this inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `localStorage['pikachu-music-library-v1']` and `['pikachu-music-lang']` are written by the *old* app. **Phase 1 does not touch persistence** (Phase 3). The new app at the same origin (`openmusic.pages.dev`) is a *different origin* from the old GitHub Pages host, so there is no shared localStorage to migrate in Phase 1 — and Phase 1 writes none. | None in Phase 1. Flag for Phase 3: key/format continuity only matters if same-origin continuity is desired (it isn't here — new host). |
| Live service config | The four upstream proxies (`api.qijieya.cn`, `tang.api.s01s.cn`, `kw-api.cenguigui.cn`, `apicx.asia`) are third-party; no config of theirs lives in this repo or in any dashboard we own. The **JOOX token** is the only credential — currently hardcoded at `index.html:2165`. | Move JOOX token to `platform.env.JOOX_TOKEN`: set in `.dev.vars` (local) and via `wrangler secret put` / CF dashboard (prod). The Cloudflare `openmusic` Pages/Workers project itself is net-new live config to create (D-07). |
| OS-registered state | None. No Task Scheduler / launchd / pm2 / cron involvement. The old app is a static file on GitHub Pages with no process. | None — verified by reading PROJECT.md (static GitHub Pages, "no backend server, no process"). |
| Secrets / env vars | `JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw'` (`index.html:2165`); `JOOX_BR = 4` (`index.html:2166`). The token is a *code rename + relocation* (client const → server secret), not a key rotation — the token value is unchanged. `JOOX_BR=4` is a non-secret tuning constant; keep it server-side too (in the JOOX ProxyAdapter or as a non-secret env var). | Create `.dev.vars` with `JOOX_TOKEN=f84ao9lMF_q7husBWRfgUw`; gitignore it; set the prod secret. Optionally rotate the token later (out of Phase 1 scope). |
| Build artifacts / installed packages | None yet — repo currently has **no `package.json`, no `node_modules`, no `.svelte-kit/`** (verified: greenfield). The old app has zero build artifacts (static HTML). | None to clean. Scaffolding *creates* the first build artifacts; ensure `.gitignore` covers `node_modules/`, `.svelte-kit/`, `.wrangler/`, `.dev.vars`. |

**The canonical question — after every repo file is updated, what still has the old string?** The JOOX token string appears in exactly one place (`index.html:2165`, soon `legacy/index.html:2165`). Once moved to `platform.env`, the only "cached" copy is in the preserved legacy file (intentional, as the porting reference) and in git history. No runtime system other than the new Cloudflare project holds it. No data migration is required in Phase 1.

## Common Pitfalls

### Pitfall 1: D-08 — Cloudflare account access is NOT yet available (BLOCKS THE SPIKE)
**What goes wrong:** The spike (success criterion #5) requires deploying to CF account `f1868a071996e836eae6da2b65f37929` (F147259@gmail.com). The currently-connected credentials do **not** include that account.
**Why it happens:** **Verified this session:** `wrangler whoami` errors with *"Failed to automatically retrieve account IDs for the logged in user… incorrect permissions on your API token."* The connected **Cloudflare MCP** lists only `Flow (280bedba354e1a13c921727f30686447)` and `Frank.chan (0b9e5c70a8072908a4f186d65acd1db8)` — **NOT F147259**. So neither the local wrangler token nor the MCP token can reach the target account today.
**How to avoid:** Make account access a **hard gate before any deploy task**:
1. Run `wrangler login` (interactive OAuth) against the F147259 Google account, OR generate a scoped API token in that account's dashboard and set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID=f1868a071996e836eae6da2b65f37929`.
2. Confirm with `wrangler whoami` that the account list now includes `f1868a071996e836eae6da2b65f37929`.
3. If access cannot be obtained, **surface to the user** (per D-08) — do not silently deploy to the wrong account (Flow/Frank.chan are not the intended target).
**Warning signs:** `wrangler deploy` succeeds but the project lands under Flow/Frank.chan; `whoami` shows no F147259 account; "Authentication error [code: 10000]".
**Phase to address:** Phase 1, as the **first task of the spike work item**, gating all deploy tasks.

### Pitfall 2: Worker egress geo/IP mismatch breaks audio (THE reason the spike exists)
**What goes wrong:** If audio bytes are routed *through* the Worker, the request originates from a Cloudflare edge IP in an arbitrary region. The China-centric audio CDNs (esp. JOOX/QQ) may geo-block, IP-block, or token-bind to a region, so URLs that played browser-direct now 403 through the Worker.
**Why it happens:** CF Workers offer no region-pinned egress on standard plans. The old app relied on the *browser's* IP/region + `no-referrer`.
**How to avoid:** **Don't proxy audio bytes.** Proxy metadata only; let `<audio src>` load the CDN URL directly from the browser (not CORS-gated — MDN verified). The spike confirms this works per source from a *deployed edge user*. Carry over the `<meta name="referrer" content="no-referrer">` behavior via `referrerpolicy="no-referrer"` on the audio element (Phase 2) so referer-gated CDNs don't 403.
**Warning signs:** Plays in `wrangler dev` (your home IP) but 403s deployed; failures correlate with source (JOOX worst), not track; error bodies contain geo/region language.
**Phase to address:** Phase 1 spike — this is the locking decision.

### Pitfall 3: Worker free-tier 10ms CPU limit if audio is ever buffered (fallback design constraint)
**What goes wrong:** If the spike forces a Worker fallback for some source, a naive `await res.arrayBuffer()` on a multi-MB FLAC blows the free-tier 10ms CPU budget → "Worker exceeded CPU time limit."
**Why it happens:** Buffering converts cheap I/O wait into expensive CPU+memory. `fetch()` wait does NOT count toward CPU; buffering does.
**How to avoid (fallback only):** `return new Response(upstream.body, { headers })` — stream, never buffer. **Forward the client's `Range` header upstream and propagate the upstream `206` + `Content-Range`/`Accept-Ranges` back unchanged** so browser seeking works. Only rewrite headers. **Subrequest note:** CF free tier allows 50 subrequests/request and the Cache API shares that quota — a stream-passthrough is 1 subrequest, fine.
**Warning signs:** Large tracks fail, short ones work; high TTFB; seeking returns `200` not `206`.
**Phase to address:** Phase 1 spike fallback design; real implementation only if the spike says a source needs it.

### Pitfall 4: JOOX detail-by-position-index returns the wrong song (DATA-04 / D-10)
**What goes wrong:** JOOX upstream detail is fetched by `n` = 1-based position in the original search results (`index.html:2425`, `n=track.jooxIndex`). If results reorder/paginate between search and resolve, the wrong track's audio/lyrics load — user taps Song A, Song B plays.
**Why it happens:** The upstream proxy keyed detail by position, not by `songmid`. The monolith preserved `jooxIndex` and trusted it blindly.
**How to avoid:** (1) Canonical uid is `joox:${songMid || 歌曲ID}` (D-10) — stable across reorder. (2) The JOOX adapter still sends `n=jooxIndex` to upstream (the API requires it) **but** captures the expected `songMid`/title at search time and **re-validates** the returned `d.songmid`/`d['歌曲名称']` against the expected track after the detail fetch; on mismatch, fail loudly (or re-probe) rather than play the wrong song. (3) Never re-derive `jooxIndex` from a fresh search. **Verification test** (Wave 0): search → reorder/paginate the result array → resolve a known JOOX track → assert returned `songMid` matches expected.
**Warning signs:** Wrong song plays specifically for JOOX; lyrics don't match audio; worse the more the user paginates before playing.
**Phase to address:** Phase 1, JOOX adapter — explicit success criterion #4.

### Pitfall 5: Silent unofficial-API failures / contract drift masked as "0 results"
**What goes wrong:** The QQ `tang` API already changed shape once — the monolith carries `Array.isArray(json) ? json : json?.data` dual-format handling (`index.html:2055`). Proxies return `200` with HTML error pages or unexpected shapes rather than clean error codes; failures collapse to empty lists.
**How to avoid:** Validate response shape at each adapter boundary (a small guard per source). Treat shape-mismatch as a *typed* `contract-drift` error distinct from network error / paywall / empty. **Preserve the QQ dual-format guard verbatim.** Honor QQ's `pay` field as a distinct "paywalled" signal (Phase 4 UI consumes it). Pin contracts with **fixtures** (recorded real responses) + tests so a drift fails CI, not users (Wave 0 below).
**Warning signs:** A source intermittently returns 0; one source's tracks all fail while others work; no telemetry.
**Phase to address:** Phase 1 (typed adapters + fixtures), reinforced in Worker retry + Phase 4 error UX.

### Pitfall 6: Scaffolding into a non-empty repo root (D-01)
**What goes wrong:** `sv create .` into a root that already contains `index.html`, `.git`, `.planning/`, `scripts/`, `.github/` may refuse or clobber.
**How to avoid:** Move `index.html` → `legacy/index.html` **before** scaffolding (D-02 ordering). Use `pnpm dlx sv create .` and choose the option to proceed in a non-empty directory; verify it doesn't overwrite `.planning/`, `legacy/`, `scripts/`, `.github/`, or the `.git` remotes (`origin`=github-b:hectorchanht, `upstream`=CharlesPikachu). Confirm `.gitignore` includes `node_modules/`, `.svelte-kit/`, `.wrangler/`, `.dev.vars`.
**Warning signs:** Scaffolder reports "directory not empty"; `.planning/` files modified; lost git remotes.
**Phase to address:** Phase 1, scaffold task (first, before extraction).

## Code Examples

### The Data Layer Being Ported (exact source map — read these in `legacy/index.html`)
| New module | Ports from `index.html` | Lines | Port notes |
|------------|-------------------------|-------|-----------|
| `lib/sources/netease.ts` `.search` | `searchNetease` | 1986–2038 | Keep `pickQueryParam` to extract songid from `it.url ?id=`; search returns audioUrl directly |
| `lib/sources/netease.ts` `.resolve` | `fetchNeteaseDetails` | 2268–2308 | Builds `type=url` + `type=lrc` URLs; content-type sniff for LRC (json vs text) |
| `lib/sources/qq.ts` `.search` | `searchQQ` | 2041–2120 | **Preserve dual-format guard** `Array.isArray(json)?json:json?.data` (2055); key by `song_mid`; capture `pay` |
| `lib/sources/qq.ts` `.resolve` | `fetchQQDetails` (incl. `pickBestPlayUrl`) | 2311–2396 | Needs `msg`(keyword)+`mid`; quality tier priority sq>pq>accom>hq>std>fq; do NOT set detailsLoaded on failure (allow retry) |
| `lib/sources/kuwo.ts` `.search` | `searchKuwo` | 2123–2163 | `{code:200,data:[{rid,...}]}`; uid=`kuwo:${rid}` |
| `lib/sources/kuwo.ts` `.resolve` | `fetchKuwoDetails` | 2398–2422 | `level=zp` lossless; inline `lyric`; throws on `code!==200` |
| `lib/sources/joox.ts` `.search` | `searchJoox` | 2169–2212 | Chinese field names (`歌曲名称`/`歌手`); lrc inline at search; uid=`joox:${songmid||歌曲ID}` |
| `lib/sources/joox.ts` `.resolve` | `fetchJooxDetails` (incl. `probeJooxAudioUrl`, `pickJooxPlayUrl`) | 2424–2504 | `n=jooxIndex` upstream **+ re-validate songmid** (Pitfall 4); probe HEAD→GET range; quality order Atmos>FLAC>... |
| `lib/services/catalog.ts` `searchAll` | `searchAllSources` | 2216–2263 | `Promise.all` → **`Promise.allSettled`** (DATA-03); drop DOM/render calls |
| `lib/services/catalog.ts` `ensureTrackDetails` | `ensureTrackDetails` | 2506–2513 | `switch(source)` → `SOURCES[track.source].resolve()` |
| `lib/services/catalog.ts` `interleave` | `getInterleavedSearchList` | 1691–1707 | Round-robin netease→qq→kuwo→joox by `displayIndex`; generalize to iterate registry order |
| `lib/services/lrc.ts` `parseLRC` | `parseLRC` | 2517–2533 | **Port verbatim** — `[mm:ss.xxx]` regex → `{time,text}[]` sorted |
| `lib/services/lrc.ts` `inferQualityFromUrl` | `inferQualityFromUrl` | 1747–1758 | **Port verbatim** — extension sniff |

### JOOX URL probe (port + edge-runtime note)
```typescript
// Ports index.html:2434-2464. Runs CLIENT-SIDE in the resolved adapter OR server-side in ProxyAdapter.
// CRITICAL for the spike: the probe's RESULT depends on WHO runs it (browser IP vs edge IP) —
// this is exactly Pitfall 2. If the proxy probes server-side, it probes from the edge IP.
// Recommendation: probe BROWSER-SIDE (or skip probing and let <audio> error→retry in Phase 2)
// so the probe sees the same IP/region that will actually play the audio.
async function probeAudioUrl(u: string, signal: AbortSignal): Promise<boolean> {
  const req = (method: string, extra?: RequestInit) =>
    fetch(u, { method, cache: 'no-store', redirect: 'follow', signal, ...extra })
      .then(r => r.ok || r.status === 206 || (r.status >= 200 && r.status < 400));
  try { if (await req('HEAD')) return true; } catch {}
  try { return await req('GET', { headers: { Range: 'bytes=0-0' } }); } catch { return false; }
}
```

### `app.d.ts` typing for the JOOX secret
```typescript
// src/app.d.ts  [CITED: svelte.dev/docs/kit/adapter-cloudflare]
declare global {
  namespace App {
    interface Platform {
      env: { JOOX_TOKEN: string };
      // ctx?: ExecutionContext;  // add if waitUntil() needed for caching later
    }
  }
}
export {};
```

## THE EGRESS SPIKE (success criterion #5 — the locking decision)

> This is the highest-priority Phase-1 unknown. Scope it as its **own work item with a hard decision gate**. It is NOT an end-of-phase checkbox.

### What the spike decides
Per source (Netease, QQ, Kuwo, JOOX): **does the resolved audio CDN URL play browser-direct from a deployed Cloudflare edge user, or does that source require the Worker to stream-passthrough the audio bytes?** The answer locks the metadata-proxy-vs-browser-direct-audio data-flow architecture for Phase 2.

### Pre-conditions (gates — must pass before deploy)
1. **D-08 account access** (Pitfall 1): `wrangler whoami` confirms account `f1868a071996e836eae6da2b65f37929` is reachable. If not → surface to user, STOP.
2. The four ProxyAdapters resolve a real `audioUrl` per source through `/api/*` (the metadata proxy works end-to-end first).

### What to deploy (minimal)
- The scaffolded SvelteKit app + `/api/[source]/[...path]/+server.ts` metadata proxy.
- A single `src/routes/spike/+page.svelte` harness page (it's fine for this page to use Svelte even though the data layer is headless — it's a test rig, deleted or kept as a debug route afterward).
- Deploy to the `openmusic` project (`openmusic.pages.dev`) on account `f1868a071996e836eae6da2b65f37929` via `wrangler deploy` (or Pages-via-Git). `JOOX_TOKEN` set as a deployed secret.

### What the harness page does (per source, run from a normal browser hitting the deployed URL)
For each source, the page: (a) searches a known-popular keyword via `/api/<source>/search`, (b) resolves the top result's `audioUrl` via `/api/<source>/...`, then runs three measurements on that CDN URL:

| Measurement | How | Pass criterion |
|-------------|-----|----------------|
| **Browser-direct playback** | Create `new Audio(audioUrl)`, set `referrerpolicy=no-referrer`, call `.play()`, listen for `canplay`/`playing` vs `error`/`stalled` (8s timeout) | `playing` fires → PASS (browser-direct works) |
| **CORS / fetch gating** | `fetch(audioUrl, {method:'GET', headers:{Range:'bytes=0-1'}})` and inspect status + whether it throws on CORS | Note whether a ranged `fetch` is allowed (informational — `<audio>` doesn't need it; tells us if a Worker proxy could even read bytes) |
| **Range / 206 support** | From the ranged `fetch` (or the audio element's network behavior in devtools), check for `206` + `Content-Range`/`Accept-Ranges` | `206` returned → seeking will work; `200`-only → seeking limited (note per source) |

Run the harness from a **real deployed visit** (not `wrangler dev`), because the edge-vs-home IP is the variable. The audio element load is what matters (it's not CORS-gated — MDN); the `fetch` probe is diagnostic for the fallback decision.

### Pass / fail criteria and the decision gate
| Outcome per source | Decision |
|--------------------|----------|
| `<audio>` plays browser-direct (the expected case) | **LOCK: browser-direct audio for that source.** Worker proxies metadata only. |
| `<audio>` fails browser-direct but CDN URL works through a Worker stream-passthrough | **Fallback: Worker stream-passthrough for that source** (stream, forward Range→206, never buffer — Pitfall 3). Document the per-source exception. |
| Both fail (URL geo/token-dead from edge AND browser) | **Source-specific limitation** — document; may need an alternate upstream proxy (out of Phase 1 scope) or mark source degraded. |

**Decision gate output:** a short matrix (source × browser-direct PASS/FAIL × needs-Worker-fallback) committed into the phase notes, which Phase 2 consumes as locked architecture. The *expected* result (per all project research) is browser-direct PASS for all four — but the spike exists precisely because JOOX/QQ CDN geo-binding could surprise us from a CF edge.

### Fallback design (only built if a source fails browser-direct)
A dedicated audio route distinct from `/api/*` (e.g. `/audio?src=...` or `/api/<source>/stream`) that:
- `return new Response(upstream.body, { headers })` — **stream, never `arrayBuffer()`** (Pitfall 3).
- Forwards the client `Range` header upstream; propagates `206` + `Content-Range` + `Accept-Ranges` unchanged.
- Adds `referrerpolicy`/omits `Referer` to satisfy referer-gated CDNs.
- CPU implication: ~1 subrequest, header-rewrite only → fits free-tier 10ms. (If JOOX needs this AND geo-blocks the edge IP too, streaming won't save it — that's the "both fail" row above.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded JOOX token in client (`index.html:2165`) | `platform.env.JOOX_TOKEN` server-side | This phase | Token absent from client bundle (success criterion #2) |
| `Promise.all` fan-out (rejects-all) | `Promise.allSettled` typed per-source | This phase | One dead source no longer blanks search (DATA-03) |
| `switch(track.source)` dispatch | Registry `SOURCES[source].resolve()` | This phase | Adding a source = new files only (DATA-04) |
| Positional JOOX detail (`n=jooxIndex`, blind) | Stable `joox:${songmid}` uid + re-validation | This phase | Right song after reorder (success criterion #4) |
| Vanilla IIFE, no build, no types | SvelteKit + Vite + TS strict | This phase | Typed, testable, modular |
| `@sveltejs/adapter-cloudflare-workers` | `@sveltejs/adapter-cloudflare` | (already current) | Use the non-deprecated adapter |

**Deprecated/outdated:**
- `adapter-cloudflare-workers` — deprecated; never use.
- TypeScript 5.x → **6.0.3 now exists** (released ~2026-04-16). Stack-compat with TS6 unverified this session → pin 5.x for Phase 1 (see drift flag).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pin TypeScript to `~5.9` (avoid TS 6.0 until stack-compat verified) | Standard Stack | LOW — if TS6 is fine, we miss nothing; if it breaks svelte-check, pinning 5.x avoids a foundational-phase derail. Confirm latest 5.x at scaffold. |
| A2 | All four audio CDNs will play browser-direct from a deployed edge (the *expected* spike outcome) | The Egress Spike | HIGH if wrong for JOOX/QQ — but the spike is designed to *test* this, not assume it. This is the one thing the phase exists to resolve empirically. |
| A3 | The JOOX upstream still requires `n=` (position) for detail and offers no detail-by-songmid | Pitfall 4 | MEDIUM — if upstream supports detail-by-mid, prefer it (more robust). Verify against live API during port; re-validation mitigates either way. |
| A4 | `referrerpolicy="no-referrer"` on the audio element reproduces the old `<meta no-referrer>` behavior sufficiently for referer-gated CDNs | Pitfall 2 | MEDIUM — if a CDN needs a *present* referer, this would 403; spike's audio-load test surfaces it. |
| A5 | `.dev.vars` populates `platform.env` in `wrangler dev` for `adapter-cloudflare` (vs needing `[vars]` in wrangler config) | The proxy pattern | LOW — both mechanisms exist; STACK.md + adapter docs confirm `platform.env` is the runtime path. Confirm `.dev.vars` loads at first `wrangler dev`. |
| A6 | The new app on `openmusic.pages.dev` is a different origin from old GitHub Pages, so no Phase-1 localStorage migration is needed | Runtime State Inventory | LOW — Phase 1 writes no persistence regardless; relevant only to Phase 3 framing. |

**These assumptions need user/empirical confirmation before becoming locked decisions** — especially A2 (the entire spike) and A3 (JOOX detail mechanism).

## Open Questions

1. **Can we obtain access to CF account `f1868a071996e836eae6da2b65f37929`?**
   - What we know: current local wrangler token AND the connected CF MCP both lack it (verified: `whoami` errors; MCP lists only Flow + Frank.chan).
   - What's unclear: whether the user can `wrangler login` to F147259@gmail.com or mint a scoped token for it.
   - Recommendation: First task of the spike work item; if blocked, surface to user per D-08. Do NOT deploy to Flow/Frank.chan as a substitute.

2. **Does the JOOX upstream support detail-by-songmid, or only `n=` position?**
   - What we know: monolith uses `n=jooxIndex` exclusively (`index.html:2426`).
   - What's unclear: whether `apicx.asia/api/joox_music` accepts a `mid`/`songmid` param for detail.
   - Recommendation: probe during the JOOX adapter port; prefer mid if available; otherwise keep `n=` + re-validation.

3. **Will the audio CDN URLs already be expired by the time the spike resolves+plays them?**
   - What we know: these URLs are short-lived (CONCERNS: ~30 min).
   - What's unclear: TTL per source.
   - Recommendation: in the harness, resolve and immediately play (no caching); a fresh-resolve failure is a real signal, not staleness.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | SvelteKit build/dev | ✓ | v22.22.0 | — |
| pnpm (D-03) | package management | ✓ | 11.13.0 | — |
| wrangler CLI | local dev + deploy + spike | ✓ | 4.95.0 local (npm latest 4.98.0) | `pnpm dlx wrangler` |
| CF account `f1868a071996e836eae6da2b65f37929` | the deploy + spike (D-05/D-07) | **✗** | — | **NO fallback** — must obtain access (D-08); blocking |
| CF MCP server | could provision/deploy | ◑ partial | connects to Flow + Frank.chan only | NOT the target account — cannot substitute |
| Internet → 4 upstream proxies | port verification + spike | assumed ✓ | — | proxies are third-party, no SLA |

**Missing dependencies with no fallback:**
- **Access to CF account `f1868a071996e836eae6da2b65f37929`.** This is the single blocking gap. The spike (success criterion #5) cannot run on a real edge without it. Resolve via `wrangler login`/scoped token before the deploy task; surface to user if unobtainable.

**Missing dependencies with fallback:**
- None — node/pnpm/wrangler are all present.

## Validation Architecture

> `workflow.nyquist_validation` is `true` (config.json) → this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **Vitest** (SvelteKit's default test runner via `sv create`) — confirm offered version at scaffold; otherwise `pnpm add -D vitest` |
| Config file | none yet — created by scaffold (`vite.config.ts` `test` block) — see Wave 0 |
| Quick run command | `pnpm vitest run src/lib/sources` (per-adapter unit tests, < 5s) |
| Full suite command | `pnpm vitest run` then `pnpm check` (svelte-check / tsc strict) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | `parseLRC` parses `[mm:ss.xxx]` → sorted `{time,text}[]` | unit | `pnpm vitest run src/lib/services/lrc.test.ts` | ❌ Wave 0 |
| DATA-01 | each adapter normalizes a recorded fixture → valid Track | unit (fixture) | `pnpm vitest run src/lib/sources` | ❌ Wave 0 |
| DATA-02 | `/api/<source>/search` proxies + injects token; token NOT in response | integration | `pnpm vitest run src/routes/api/proxy.test.ts` | ❌ Wave 0 |
| DATA-02 | JOOX token absent from client bundle | build-grep | `pnpm build && ! grep -r "f84ao9lMF" .svelte-kit/output/client` | ❌ Wave 0 |
| DATA-03 | one source throwing leaves others' results intact | unit | `pnpm vitest run src/lib/services/catalog.test.ts -t allSettled` | ❌ Wave 0 |
| DATA-04 | registry: `SOURCES` enumerates 4; `getEnabledAdapters` filters; aggregation names no source | unit | `pnpm vitest run src/lib/sources/registry.test.ts` | ❌ Wave 0 |
| SRC-01 | each of 4 adapters resolves audioUrl+lrc from a fixture | unit (fixture) | `pnpm vitest run src/lib/sources` | ❌ Wave 0 |
| #4 (JOOX identity) | reorder result set → resolve JOOX track → returned songMid matches expected | unit | `pnpm vitest run src/lib/sources/joox.test.ts -t identity` | ❌ Wave 0 |
| #5 (spike) | browser-direct playback per source from deployed edge | **manual / deployed harness** | open `openmusic.pages.dev/spike` (manual — cannot automate cross-origin CDN playback headlessly) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/lib/<module>` (the module just changed)
- **Per wave merge:** `pnpm vitest run && pnpm check`
- **Phase gate:** full suite green + the spike decision matrix committed, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vite.config.ts` test block (or `vitest.config.ts`) — created by scaffold; verify Vitest is wired
- [ ] `src/lib/services/lrc.test.ts` — covers DATA-01 (parseLRC, inferQualityFromUrl)
- [ ] `src/lib/sources/*.test.ts` + `__fixtures__/*.json` (recorded real responses per source) — covers SRC-01, DATA-01, contract-drift (Pitfall 5)
- [ ] `src/lib/sources/joox.test.ts` identity case — covers success criterion #4 (Pitfall 4)
- [ ] `src/lib/services/catalog.test.ts` — covers DATA-03 (allSettled isolation) + interleave/dedupe
- [ ] `src/lib/sources/registry.test.ts` — covers DATA-04
- [ ] `src/routes/api/proxy.test.ts` — covers DATA-02 (token injection + passthrough)
- [ ] `src/routes/spike/+page.svelte` — the manual egress-spike harness (success criterion #5)
- [ ] Fixtures captured by hitting each live upstream once and saving the JSON (also the contract-drift baseline)

## Security Domain

> `security_enforcement` not set to false → included. Phase 1 introduces a server boundary + a secret, so this matters.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth (local-first, no accounts) |
| V3 Session Management | no | No sessions |
| V4 Access Control | yes | Scope `/api/*` CORS to own origin; optional lightweight per-IP rate-limit / `Origin` allowlist so the proxy isn't an open music/CORS relay |
| V5 Input Validation | yes | Validate `params.source` against the registry (404 unknown); validate upstream response shape per adapter (contract-drift guard); never `{@html}` source-supplied titles/lyrics |
| V6 Cryptography | no | No crypto needed (token is a bearer string, not minted by us) |
| V7 Error Handling/Logging | yes | **Redact `JOOX_TOKEN` and signed audio params from any Worker logs / `wrangler tail`** |
| V14 Config | yes | JOOX token in `platform.env` secret, never client bundle, `.dev.vars` gitignored |

### Known Threat Patterns for SvelteKit-on-Cloudflare + unofficial proxies
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JOOX token harvested from client (current state) | Information Disclosure | Move to `platform.env`; verify absent from bundle (DATA-02 test) |
| Open proxy abuse (anyone uses your Worker as free CORS/music relay) | Elevation / DoS | CORS scoped to own origin; optional `Origin` allowlist + per-IP rate-limit; never `ACAO: *` |
| XSS via third-party track titles/lyrics | Tampering | Svelte auto-escapes text interpolation; never `{@html}` untrusted source data |
| Token/URL leakage in logs | Information Disclosure | Redact tokens + signed params in any logging/`wrangler tail` |
| Contract-drift / poisoned upstream body | Tampering | Per-adapter shape validation; treat unexpected shapes as typed errors, not trusted data |

## Sources

### Primary (HIGH confidence)
- [svelte.dev/docs/kit/adapter-cloudflare](https://svelte.dev/docs/kit/adapter-cloudflare) — verified `platform?.env.SECRET` runtime path, `App.Platform.env` typing in `app.d.ts`, `.dev.vars` local bindings, wrangler-config deploy bindings
- [MDN — `<audio>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) — verified cross-origin `<audio src>` playback is NOT CORS-gated; `crossorigin` only affects taint/Canvas reuse
- npm registry (`npm view`, 2026-06-05) — verified versions: svelte 5.56.2, @sveltejs/kit 2.63.0, vite 8.0.16, @sveltejs/vite-plugin-svelte 7.1.2, @sveltejs/adapter-cloudflare 7.2.8, wrangler 4.98.0, @cloudflare/workers-types 4.20260605.1, typescript 6.0.3 (drift), idb 8.0.3
- slopcheck 0.6.1 `scan` (2026-06-05) — 9/9 stack packages `[OK]`
- `wrangler whoami` (2026-06-05) — verified D-08 blocker: token lacks account-ID retrieval; CF MCP lists only Flow + Frank.chan, not F147259
- `legacy/index.html` (currently `index.html`) — authoritative source for the four source contracts + functions being ported (read lines 1691–2533)
- `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/ARCHITECTURE.md` — per-source endpoints/params/shapes, REUSE/REPLACE inventory (HIGH, project-specific)

### Secondary (MEDIUM confidence — project-level research, verified against official docs there)
- `.planning/research/ARCHITECTURE.md` — SourceAdapter/ProxyAdapter design, Worker-metadata/audio-direct split, build order
- `.planning/research/STACK.md` — stack selection + version pins, `+server.ts`-as-proxy, `platform.env`
- `.planning/research/PITFALLS.md` — egress geo-mismatch, Range/206, allSettled, JOOX index trap, free-tier CPU

### Tertiary (LOW confidence — needs the spike to resolve)
- The actual egress-spike outcome per source — by definition unknown until run on the deployed edge

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified on npm + slopcheck; one TS-6 drift flagged with safe pin
- Architecture / registry design: HIGH — directly ports a mapped, proven monolith into a researched two-sided-adapter pattern
- `+server.ts` proxy + `platform.env`: HIGH — exact API path verified against current SvelteKit docs
- Browser-direct-audio viability (CORS): HIGH that it's not CORS-gated (MDN); the geo/IP outcome is the spike's job (LOW until run)
- Pitfalls: HIGH — drawn from project PITFALLS.md cross-checked with Cloudflare/MDN/WebKit official sources
- D-08 account blocker: HIGH — empirically confirmed this session

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 for stack versions (fast-moving — re-check before scaffold); the spike outcome is point-in-time (audio CDN behavior can change any day).
