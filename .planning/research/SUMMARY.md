# Project Research Summary

**Project:** MusicSquare Mobile v1.1 — Last.fm Integration
**Domain:** Last.fm metadata/auth/scrobble/discovery + YouTube-style playback source, layered onto an existing SvelteKit + Cloudflare Pages/Workers PWA music aggregator
**Researched:** 2026-06-06
**Confidence:** HIGH (Last.fm API mechanics verified against official docs; Cloudflare MD5 confirmed in official runtime docs; architecture verified against real codebase files)

---

## Executive Summary

MusicSquare Mobile v1.1 adds Last.fm as a cross-cutting integration across four distinct capability areas: passive metadata enrichment, optional user auth with two-way sync, editorial discovery tabs, and a new virtual playback source seeded by Last.fm catalog. The foundation is already in place — `LASTFM_KEY` and `LASTFM_SECRET` are declared in `Env`, the `/api/similar` route is a working precedent for a dedicated Last.fm edge proxy, and the source/proxy dual-registry pattern accepts new entries with two files and two lines. **No new npm runtime dependencies are needed for v1.1.** MD5 for `api_sig` is native on Cloudflare Workers via `crypto.subtle.digest({ name: 'MD5' })` (non-standard Cloudflare extension, verified in official docs), and the Cache API is built-in for edge-caching discovery responses.

The recommended build order is: read-only metadata enrichment + proxy wiring first (Phase 8), then the discovery tab (Phase 9), then the new Last.fm source's 2-step audio resolver (Phase 10), then signed-call infrastructure + auth (Phase 11), then scrobble (Phase 12), then loved-tracks sync (Phase 13). This diverges from the STACK/PITFALLS suggestion (enrichment → auth → discovery → source) in one key respect: architecture research argues that discovery tabs without a playable source are low-value, so the new source's resolver (Phase 10) is sequenced before auth (Phase 11). However, auth is the prerequisite for all write features — scrobble and loved sync cannot ship before Phase 11 regardless of ordering. The roadmapper should treat the enrichment → discovery → source → auth → scrobble → loved sequence (architecture recommendation) as the working default.

The highest-risk items at the v1.1 horizon are: (1) `api_sig` UTF-8 encoding on CJK track/artist names, which silently produces error 13 on Chinese tracks while passing English tests; (2) the GD Studio / YouTube-style source's instability — public instance churn and wrong-song resolution are both production-grade risks; (3) the session-key security surface — `sk` has infinite lifetime and, combined with the shared secret, represents account-takeover class exposure identical to JOOX_TOKEN (T-01-04). All three require explicit prevention strategies wired into the phases that own them.

---

## Key Findings

### Recommended Stack

The v1.1 additions require zero new runtime packages. The single technology decision that usually trips Last.fm integrations — MD5 for `api_sig` — is resolved by the Cloudflare Workers runtime itself: `crypto.subtle.digest({ name: 'MD5' }, new TextEncoder().encode(str))` works natively on workerd (Cloudflare's documented non-standard extension for legacy interop). This means no `js-md5`, `spark-md5`, `blueimp-md5`, `crypto-js`, or Node `crypto` shim. The fallback if this ever breaks is `spark-md5` 3.0.2 (pure JS, zero Node deps), but it should not be pre-installed.

Auth uses the **Last.fm Web Application flow**: redirect to `last.fm/api/auth?api_key=...&cb=<callback>`, receive the token at the callback, exchange via `auth.getSession` (signed). The resulting session key (`sk`) has **infinite lifetime** per official Last.fm docs and must be stored server-side only, in an `httpOnly; Secure; SameSite=Lax` cookie. Edge-caching for discovery (charts/tags) uses the **Cloudflare Cache API** (`caches.default`) — free, zero-config, no KV binding needed for v1.1 TTLs.

**Core technologies:**
- `crypto.subtle.digest({ name: 'MD5' })` — native on workerd; computes Last.fm `api_sig` with no npm dependency
- Last.fm Web Application auth flow — purpose-built for hosted web app with callback URL; returns an infinite-lifetime `sk`
- `HttpOnly; Secure; SameSite=Lax` cookie — the only acceptable storage for `sk` (never localStorage, never JSON response body)
- SvelteKit `+server.ts` endpoints — new `/api/lastfm/{session,scrobble,love}` dedicated routes for signed writes, mirroring `/api/similar`
- Cloudflare Cache API (`caches.default`) — edge-cache Last.fm read endpoints (charts ~1h, getInfo ~24h, tags ~6h); no KV needed
- GD Studio `ytmusic` source (`music-api.gdstudio.xyz`) — realistic option for the new audio source; requires an edge proxy (Origin header spoofing); 50 req/5 min cap; study-only ToS; MEDIUM confidence

**What NOT to use:**
- Any MD5 npm package — unnecessary, adds bundle weight and supply-chain surface
- `localStorage` for `sk` — permanent write credential exposed to XSS
- YouTube Data API v3 — 100 units/search, no audio URLs, useless for playback
- Public Piped/Invidious instances called directly from the browser — CORS-blocked, high instance churn in 2025–2026
- `yt-dlp` / `ytmusicapi` on the edge — Python runtime, incompatible with workerd

### Expected Features

**Must have (table stakes — P1 for v1.1):**
- Worker-side Last.fm proxy + `api_sig` signing — enabler; nothing else works without it
- Metadata enrichment (track/artist/album.getInfo, tags, bio snippet, higher-res cover) — visible value with zero auth
- Placeholder art filter (grey-star hash `2a96cbd8b46e442fc41c2b86b821562f` + empty `#text`) — mandatory; without it the UI fills with broken images
- Charts + tags discovery tabs (chart.*, geo.*, tag.*) — the editorial discovery payoff; no auth required
- Last.fm-searchable source — makes discovery cards playable in one tap
- Optional sign-in (auth.getToken → browser grant → auth.getSession) — gateway to all sync features
- Scrobbling (updateNowPlaying at play-start + track.scrobble at 50%/4-min threshold) — headline reason Last.fm users connect
- Loved-tracks two-way sync (track.love/unlove + user.getLovedTracks merge-on-sign-in) — hearts feel connected

**Should have (differentiators):**
- Vibe/mood + genre tag browsing (chart.getTopTags → tag grid → tag.getTopTracks/Artists/Albums) — engages users who don't know what to search
- Listening history surface (user.getRecentTracks — handle nowplaying item with no date) — re-engagement
- Per-period top artists/tracks/albums (user.getTop* with period switcher) — stats recaps
- Similar-queue entries enriched with tags/art — tightens the "vibe" feel

**Defer to v1.x post-validation:**
- Offline scrobble queue with batched flush (≤50 per request, per-item timestamps, 14-day expiry)
- `library.getArtists` full-library import — heavy, niche
- Personal track tagging UI (track.getTags + write)

**Anti-features (never build):**
- Treat Last.fm as an audio source — metadata/social only; no streams
- Store LASTFM_KEY/SECRET or sk client-side — account-takeover risk at JOOX_TOKEN parity
- Auto-unlove on the server to mirror local removals — destroys loves from other clients; additive union only
- Scrobble on every seek or without threshold — violates official rules, inflates plays
- Require sign-in to use the app — breaks local-first boundary

### Architecture Approach

The v1.1 architecture extends the existing dual-registry + thin-edge-proxy pattern without redesigning it. The critical routing decision: **read-only Last.fm calls** (getInfo, chart.*, tag.*, geo.*, user.get*) go through the existing `/api/[source]/[...path]` catch-all with `source=lastfm`. **Signed writes** (auth.getSession, track.scrobble, track.love/unlove) get dedicated `/api/lastfm/{session,scrobble,love}` routes because they need: MD5 signing over full param set, server-side cookie read for `sk`, HTTP POST with form-encoded body, and clean JSON shaping. A shared `proxy/sign.ts` helper (~10 lines, edge-only) owns the single correct implementation of `api_sig`. The `lastfm` source's `resolve()` performs a 2-step audio resolve: delegates to `searchAll()` + `dedupeBest()` (existing catalog.ts), keeping audio on proven CN-source infrastructure.

**Major new components:**
1. `proxy/lastfm.ts` + `proxy/sign.ts` — edge ProxyAdapter (read-only buildUrl) + MD5 api_sig helper (edge-only)
2. `api/lastfm/session`, `api/lastfm/scrobble`, `api/lastfm/love` — three dedicated signed-write routes
3. `auth/callback/+server.ts` — OAuth-style redirect landing, sets cookies, redirects
4. `services/lastfm.ts` — enrichment + discovery list builders (mirrors similar.ts posture)
5. `services/scrobble.ts` — 3 player lifecycle hooks; gates on `lastfm.authed`; no-ops signed-out
6. `stores/lastfm.svelte.ts` — `username`, `authed`, `lovedKeys` runes singleton; NO sk on client
7. `sources/lastfm.ts` — SourceAdapter: search emits stubs, resolve() 2-step delegates to searchAll
8. `(app)/explore/+page.{ts,svelte}` — discovery tab with SSR load() for charts/tags

### Critical Pitfalls

1. **api_sig UTF-8 on CJK names (P8/P9)** — `TextEncoder().encode()` is mandatory; MD5 of raw JS string (UTF-16) produces error 13 specifically on Chinese artist/track names while English passes. Also: exclude `format` and `callback` from the signed string (but still send them on the request); use raw (not URL-encoded) values in the concat; sort keys with default `Array.sort()` (ASCII). Write a `周杰伦`/`稻香` fixture test as the single highest-value P9 unit test.

2. **LASTFM_SECRET / sk leakage (T-lfm-01, T-lfm-02, T-lfm-03 — P9)** — `sk` has **infinite lifetime**. Leaking via JSON body, localStorage, `$env/*/public`, or a universal `+page.ts` load is permanent write-access exposure. Mirror the existing no-leak test from `similar-endpoint.test.ts`: assert response body + all headers contain neither `LASTFM_SECRET` nor `sk` nor `api_sig`. CSRF defense: `SameSite=Lax` cookie + origin check on write endpoints (reuse `isAllowedOrigin`); POST-only.

3. **Double-scrobble / wrong timestamp / signed-out fires (P9)** — Per-play `scrobbleState = { trackUid, playStartedAt (UTC sec), scrobbled: boolean }`. Capture `playStartedAt = Math.floor(Date.now()/1000)` once at play start. Fire scrobble once per play instance; guard every call with `if (!lastfm.authed) return` — failure must never block playback.

4. **Enrichment overwrites good data / placeholder art (P8)** — Enrichment is additive and async, off the playback critical path. Filter the placeholder hash (`2a96cbd8b46e442fc41c2b86b821562f`) and empty `#text` before using any Last.fm image. Error 6 (no Last.fm match) must be silent.

5. **GD Studio / YouTube-style source instability + wrong-song resolution (T-lfm-04 — P10)** — Score the match (normalize + fuzzy-compare, penalize cover/karaoke/live keywords, duration sanity-check). Isolate behind `Promise.allSettled` + `AbortSignal.timeout`. Never take `results[0]` blindly. A dead source degrades like a down CN proxy.

---

## Implications for Roadmap

Phases continue from prior v1.0 milestone, starting at Phase 8.

### Phase 8: Last.fm Read Foundation (Metadata Enrichment + Proxy Wiring)

**Rationale:** Everything in v1.1 requires the edge proxy layer. Enrichment is read-only, key-only, auth-free — zero dependencies on signed infrastructure, delivers immediately visible value (richer now-playing, tags, bios, better art). Also establishes the match-key normalization primitive reused by Phase 13's loved-sync. De-risks proxy wiring before auth complexity.

**Delivers:** `proxy/lastfm.ts` (read-only buildUrl), registration in both registries, `services/lastfm.ts` enrichment (track/artist/album.getInfo → merge onto Track), placeholder art filter, `platform?.env` graceful absent-key fallback, match-key normalization primitive (`normalize(artist) + ' ' + normalize(track)`).

**Addresses FEATURES.md:** Metadata enrichment, higher-res/fallback cover art (both P1 table stakes).

**Avoids PITFALLS.md:** Pitfall 8 (enrichment on critical path + placeholder overwrite), Pitfall 10 (env plumbing), Pitfall 2 (UTF-8 foundation).

**Research flag:** Standard patterns (mirrors `/api/similar`). No deep research needed.

---

### Phase 9: Discovery Tab (Charts + Tags + Country Top-Lists)

**Rationale:** Auth-free; uses proxy from Phase 8. Shipping before the new source creates a brief "list-only, not yet playable" state — but it validates discovery UX and API response shapes before wiring audio resolution. The ARCHITECTURE ordering (enrichment → discovery → source → auth) is recommended over STACK/PITFALLS ordering (enrichment → auth → discovery → source) because auth introduces the highest-complexity signed-call surface and should land after simpler read-only surfaces are validated.

**Delivers:** `(app)/explore/+page.{ts,svelte}`, Explore entry in `tabs[]`, discovery builders in `services/lastfm.ts` (chart.*, geo.*, tag.*), edge-caching via Cache API (charts ~1h, tags ~6h), concurrency cap on fan-out (3–5 in-flight), `Cache-Control: public` on discovery, `private, no-store` on anything user-keyed.

**Addresses FEATURES.md:** Charts tab, vibe/mood tag browsing (P1 + differentiator).

**Avoids PITFALLS.md:** Pitfall 11 (rate-limit fan-out + caching), Pitfall 10 (personalized-cache separation).

**Research flag:** Standard SvelteKit `+page.ts` SSR + Cache API patterns. No research phase needed.

---

### Phase 10: Last.fm Source Playback (2-Step Audio Resolver)

**Rationale:** Discovery cards without audio are a dead end. `sources/lastfm.ts` `resolve()` delegates to `searchAll` + `dedupeBest` (re-search resolver, recommended default). GD Studio `ytmusic` is the optional parallel deliverable if re-search coverage is insufficient for Western catalog. `enabledByDefault: false` on ytmusic keeps the existing 4-source fan-out unaffected until explicitly enabled.

**Delivers:** `sources/lastfm.ts` (SourceId `'lastfm'`, search emits stubs, resolve() calls searchAll + dedupeBest), `'lastfm'` in registry.ts + proxy-registry.ts. Optional: `proxy/ytmusic.ts` + `sources/ytmusic.ts` (GD Studio, `enabledByDefault: false`).

**Addresses FEATURES.md:** Last.fm-searchable source (P1 table stakes), discovery cards playable in one tap.

**Avoids PITFALLS.md:** Pitfall 7 (YT instability + wrong-song — score match, isolate behind allSettled+timeout).

**Research flag:** Re-search resolver path — no additional research needed. **GD Studio ytmusic path — flag for `--research-phase`**: `s` checksum host/version drift, 50 req/5 min cap under load, instance failover, Western-catalog match rate vs CN sources all need validation.

**Key tension for planning:** Re-search resolver works today but may yield poor matches for Western-catalog Last.fm discoveries. GD Studio fills that gap but is third-party, unstable, study-only ToS. Recommend: ship re-search first, measure match rate, add GD Studio if coverage is insufficient.

---

### Phase 11: Signed-Call Infrastructure + Auth

**Rationale:** All write features gate on this phase. It introduces the highest-complexity security surface — `api_sig` signing, httpOnly cookie for `sk`, CSRF defense. Comes after read-only phases are validated to reduce blast radius of auth bugs. Auth UI has no value until there is something to unlock (scrobble/loved-sync).

**Delivers:** `proxy/sign.ts` (MD5 api_sig helper, edge-only, UTF-8 correct, format/callback excluded, CJK fixture test), `/api/lastfm/session/+server.ts` (auth.getSession + httpOnly cookie + boot "who am I"), `/auth/callback/+server.ts`, `stores/lastfm.svelte.ts` (`username`, `authed`, `lovedKeys` — NO sk), sign-in/out UI, no-leak test (body + headers + client bundle grep).

**Addresses FEATURES.md:** Optional sign-in (P1 table stakes), gateway to scrobble + loved-sync.

**Avoids PITFALLS.md:** Pitfall 1 (MD5 assumed unavailable), Pitfall 2 (api_sig correctness), Pitfall 3 (T-lfm-01 secret/sk leak), Pitfall 4 (T-lfm-02/03 sk storage + CSRF).

**Research flag:** api_sig algorithm fully specified at HIGH confidence. Cookie + CSRF patterns are standard. No additional research needed. CJK fixture test is a mandatory deliverable.

---

### Phase 12: Scrobble + Now-Playing

**Rationale:** Headline reason Last.fm users connect. Depends on Phase 11. Player lifecycle hooks are already identified; this phase wires `services/scrobble.ts` into them without coupling the player to Last.fm directly.

**Delivers:** `services/scrobble.ts` (onPlayStart, onProgress, flush), `/api/lastfm/scrobble/+server.ts` (signed POST for track.updateNowPlaying + track.scrobble), per-play scrobbleState guard, signed-out no-op path.

**Addresses FEATURES.md:** Scrobbling, updateNowPlaying profile badge (both P1 table stakes).

**Avoids PITFALLS.md:** Pitfall 5 (double-scrobble, wrong timestamp, signed-out fires), Pitfall 6 (offline queue — MVP online-only; batch queue deferred to v1.x).

**Research flag:** Scrobble rules fully documented at HIGH confidence. No research phase needed.

---

### Phase 13: Loved-Tracks Two-Way Sync + History

**Rationale:** Remaining auth-dependent features. Depends on Phase 11 auth store. The identity-mismatch challenge (local `uid` vs Last.fm `{artist, track}` strings) is the primary complexity; Phase 8's match-key normalization is the bridge.

**Delivers:** `/api/lastfm/love/+server.ts` (signed POST for track.love/unlove), `library.toggleLike` wrapper (posts to love endpoint when authed, non-blocking), sign-in reconciliation (`user.getLovedTracks` → union-merge into `library.liked` via match-key, additive/non-destructive), `lovedKeys` mirror in `lastfm.svelte.ts`, optional recent-tracks history view (`user.getRecentTracks`, handle nowplaying item with no date).

**Addresses FEATURES.md:** Loved-tracks two-way sync (P1), listening history surface (differentiator/P2).

**Avoids PITFALLS.md:** Pitfall 4 (CSRF on love endpoint), Pitfall 9 (uid ⇄ {artist,track} reconciliation, non-destructive merge).

**Research flag:** Reconciliation logic is fully specified in ARCHITECTURE.md. Consider `--research-phase` only if CJK normalization edge cases prove complex during implementation.

---

### Phase Ordering Rationale

**Two competing orderings surfaced in research:**

| | Source | Sequence |
|---|---|---|
| **Recommended** | ARCHITECTURE.md | Enrichment (P8) → Discovery (P9) → Source (P10) → Auth (P11) → Scrobble (P12) → Loved (P13) |
| Alternative | STACK.md + PITFALLS.md | Enrichment → Auth → Discovery → Source |

**Why the ARCHITECTURE ordering is recommended:** Auth (P11) is the most complex and highest-risk surface. Deferring it until the read-only surfaces are validated reduces the blast radius of auth bugs and keeps Phases 8–10 entirely security-surface-free. The only cost: discovery cards (Phase 9) are briefly unplayable until Phase 10 — acceptable for an internal milestone sequence.

**Why auth cannot move earlier than P11:** Scrobble (P12) and loved-sync (P13) have a hard dependency on the `sk` cookie and auth store. They cannot be moved earlier regardless of ordering preference.

**Key dependency chain:**
```
Phase 8 (proxy wiring + match-key) ──▶ Phase 9 (discovery reads)
                                    ──▶ Phase 10 (source resolver)
Phase 11 (auth + signed-call infra) ──▶ Phase 12 (scrobble)
                                    ──▶ Phase 13 (loved sync)
Phase 8 match-key primitive ────────▶ Phase 13 (identity reconciliation)
```

### Research Flags

**Phases likely needing `--research-phase` during planning:**
- **Phase 10** (if GD Studio ytmusic path is in scope): `s` checksum host/version drift, 50 req/5 min cap under real load, instance failover strategy, wrong-song match scoring for CJK vs Western catalog.
- **Phase 13** (if CJK normalization proves complex): Traditional/Simplified Chinese variant matching in `normalize()`, conflict resolution for tracks loved on Last.fm but not in any CN source, "ghost entry" lifecycle for loved stubs with no playable audio.

**Phases with standard patterns (skip research-phase):**
- **Phase 8** — mirrors `/api/similar` exactly; placeholder filter fully specified.
- **Phase 9** — standard SvelteKit SSR load + Cache API TTL caching.
- **Phase 11** — api_sig algorithm fully specified in official Last.fm docs; httpOnly cookie + SameSite CSRF is standard web security.
- **Phase 12** — scrobble rules verified against official docs; player hook points already identified.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | MD5 on Workers confirmed in official Cloudflare docs. Web auth flow verified against Last.fm official docs. No npm deps is a definitive finding. GD Studio is MEDIUM (third-party, no SLA, study-only ToS). |
| Features | HIGH | All Last.fm API methods verified against official API reference. Scrobble rules verified. Image placeholder behavior corroborated by multiple sources. Discovery UX patterns from product writeups (MEDIUM). |
| Architecture | HIGH | Integration points verified against real source files. Signed-route vs catch-all routing decision derived from reading the actual `buildUrl()` contract. |
| Pitfalls | HIGH | api_sig UTF-8 + format-exclusion + sort bugs verified against official docs + community error-13 threads. JOOX_TOKEN / sk security is first-principles. YouTube-source instability is MEDIUM (community reports, 2025 mass-block events). |

**Overall confidence:** HIGH for all Last.fm mechanics and architecture integration. MEDIUM for the GD Studio / YouTube-style source (third-party instability is a runtime risk, not a research gap).

### Gaps to Address

- **GD Studio `s` checksum version string drift:** The host|version|ts|id formula is sourced from upstream `musicdl` Python code. Verify the current formula against a live test call before Phase 10 implementation; capture a fixture response.
- **Re-search resolver match quality for Western catalog:** The re-search path (searchAll → dedupeBest) works well for CN-source catalog. Its hit rate for Western artists discovered via Last.fm charts is unknown. Validate with a representative sample during Phase 10 planning — this may decide whether GD Studio is in-scope for v1.1 or deferred.
- **CJK normalization completeness:** Whether `dedupe.key()` correctly handles Traditional/Simplified Chinese variants and CJK punctuation variants for the loved-sync match key is unverified. Flag for Phase 13 planning.
- **MD5 test strategy in workerd vs Node:** `crypto.subtle.digest({ name: 'MD5' })` works in workerd but NOT in plain `vite dev` / jsdom. Use `@cloudflare/vitest-pool-workers` or inject the hash function and stub it in unit tests. Decide in Phase 11 planning.
- **Offline scrobble queue:** Fully specified (≤50 batch, ASCII array-index sort, 14-day expiry, per-item timestamps) but deferred to v1.x post-validation. Mobile users on flaky connections will lose scrobbles until built.

---

## Sources

### Primary (HIGH confidence)
- https://www.last.fm/api/webauth — Web Application auth flow, api_sig construction, token lifetime, session key infinite lifetime
- https://www.last.fm/api/scrobbling — Scrobble rules (30s/50%/4-min), updateNowPlaying vs scrobble distinction
- https://www.last.fm/api/show/track.scrobble — POST write service, ≤50 batch, timestamp UTC seconds, error codes
- https://www.last.fm/api/show/track.love — POST write service, signed
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ — MD5 is supported in `crypto.subtle.digest` on Workers (non-standard CF extension)
- https://developers.cloudflare.com/workers/runtime-apis/cache/ — Cache API, programmatic put/match, no Set-Cookie caching
- https://lastfm-docs.github.io/api-docs/auth/signature/ — api_sig detail (exclude format/callback, ASCII sort, raw values, UTF-8)
- Existing source files (read directly): `src/lib/proxy/{proxy-types,proxy-registry,http}.ts`, `src/routes/api/similar/+server.ts`, `src/lib/sources/{types,registry}.ts`, `src/lib/stores/{player,library}.svelte.ts`, `src/lib/services/{catalog,picks,similar,dedupe}.ts`

### Secondary (MEDIUM confidence)
- https://music-api.gdstudio.xyz/api.php — GD Studio API endpoint (third-party, no SLA)
- https://github.com/CharlesPikachu/musicdl/blob/master/musicdl/modules/common/gdstudio.py — GD Studio `s` checksum construction
- https://sumguy.com/invidious-piped-redlib-nitter-2026/ — 2026 status of public Piped/Invidious instances
- https://support.last.fm/t/last-fm-api-artist-getinfo-only-returns-placeholder-images-for-artists/117821 — placeholder star image confirmation
- Community error-13 threads (ruby-lastfm #66, php-lastfm #2, navidrome #5178) — UTF-8/sort/format-exclusion bug taxonomy

### Tertiary (LOW confidence)
- Spotify/YouTube Music discovery UX patterns — tab structure and Home-personal vs Explore-editorial split (inferred from product writeups)

---
*Research completed: 2026-06-06*
*Milestone: v1.1 Last.fm Integration*
*Phases: 8–13 (continuing from v1.0 milestone)*
*Ready for roadmap: yes*
