---
quick_id: 260606-wv8
type: execute
subsystem: home-discovery-covers
tags: [deezer, edge-proxy, cover-backfill, cors, cloudflare-cache, security]
requires:
  - /api/lastfm/discovery (posture mirrored)
  - $lib/proxy/http (corsHeaders, fetchWithRetry)
  - $lib/services/cover-cache (track + artist keys)
  - $lib/services/catalog + dedupe (CN fallback)
  - $lib/services/discovery (mapWithConcurrency)
provides:
  - /api/deezer/search (no-secret Deezer cover/search edge proxy → { cover, artistPicture })
  - $lib/services/deezer (deezerSongCover / deezerArtistCover / buildDeezerSearchUrl)
  - Deezer-PRIMARY cover backfill (Deezer → CN track / Deezer artist)
affects:
  - src/routes/(app)/+page.svelte (home discovery cover chain comments)
tech-stack:
  added: [] # NO new npm dependency, NO new env var/secret
  patterns:
    - own-origin edge proxy with caches.default + own-origin cache key (Last.fm-proxy posture)
    - safeImageUrl host allow-list (https *.dzcdn.net, CSS-breaker reject)
    - never-throws + AbortSignal-honoring client through own-origin proxy
key-files:
  created:
    - src/routes/api/deezer/search/+server.ts
    - src/routes/api/deezer/search/deezer-endpoint.test.ts
    - src/lib/services/deezer.ts
    - src/lib/services/deezer.test.ts
  modified:
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/services/cover-cache.ts
    - src/routes/(app)/+page.svelte
  deleted:
    - src/lib/services/itunes-cover.ts
    - src/lib/services/itunes-cover.test.ts
decisions:
  - Deezer is PRIMARY in the backfill (resolveOne calls deezerSongCover FIRST; CN searchAll only on a Deezer miss).
  - The Last.fm tier of the "Deezer → CN → Last.fm" chain is the CHEAP item.image pre-check in tileCover(), NOT a backfill network call — so no Last.fm track.getInfo backfill step was added.
  - iTunes fully removed (module + test deleted, zero `itunes` references in src/) rather than kept as a last-resort fallback — Deezer + CN cover the catalog; default is remove-cruft.
  - No secret/env: Deezer public search is keyless, so the proxy reads NO platform.env and proxy-types.ts Env is untouched.
metrics:
  tasks_completed: 2 of 3 (Task 3 is checkpoint:human-verify — DEFERRED-TO-HUMAN)
  files_created: 4
  files_modified: 4
  files_deleted: 2
  tests: 383 passed (39 files); +34 new Deezer tests, -16 removed iTunes tests
  completed_date: 2026-06-07
---

# Quick 260606-wv8: Deezer Edge Proxy + Deezer as Primary Covers Summary

Added a no-secret Deezer cover/search edge proxy (`/api/deezer/search`) mirroring the Last.fm proxy posture, a thin never-throws `deezer.ts` client, and reworked the home cover-backfill so Deezer is the PRIMARY cover source (Deezer → CN for track tiles, Deezer artist pictures for 熱門歌手 tiles); iTunes was fully removed.

## What Was Built

### Task 1 — Deezer edge proxy + client (commit `dce9915`)

- **`src/routes/api/deezer/search/+server.ts`** — `GET` reshapes Deezer `data[0]` through a single `reshapeSearch()` into `{ cover, artistPicture }` (cover = `cover_xl ?? cover_big ?? cover_medium`; artistPicture = `picture_xl ?? picture_big`). Posture copied from `/api/lastfm/discovery`:
  - Own-origin `corsHeaders` (never `*`); `OPTIONS` → 204 with the same scoped headers.
  - `caches.default` edge cache keyed by the **own-origin** `new Request(url.toString())` (never the upstream `api.deezer.com` URL); cache hit stores a CORS-free body and re-applies CORS for the requesting origin (WR-01).
  - `fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2)`.
  - `safeImageUrl` host allow-list (`cdn-images.dzcdn.net` / `.dzcdn.net`, https only, reject `/[)\s"'\\(]/`) applied to BOTH cover and artistPicture.
  - `Cache-Control: public, max-age=86400` on success + cache-hit.
  - Empty/missing `q` → `{ cover: null, artistPicture: null }` with NO fetch. No-match / malformed JSON / non-ok / throw → same graceful empty, no cache write, never throws.
  - **No secret/env read** — works with `platform: undefined`; `proxy-types.ts` Env untouched.
- **`src/lib/services/deezer.ts`** — `buildDeezerSearchUrl(term)` → `/api/deezer/search?q=...` (encoded, own-origin, never api.deezer.com); `deezerSongCover(artist,title,signal?)` / `deezerArtistCover(artist,signal?)` go through the proxy, honor an already-aborted signal with no fetch, and return null on every miss (never throw). `combinedSignal` = `AbortSignal.any([caller, AbortSignal.timeout(6000)])` with a no-`any` fallback.
- **Tests:** `deezer-endpoint.test.ts` (reshape, fallbacks, encoding, empty/no-match/malformed/throw, platform-undefined, host allow-list, Cache-Control + cache-hit + own-origin cache key + no-write-on-miss, CORS) and `deezer.test.ts` (URL build/encoding, resolve, empty-term + already-aborted no-fetch, non-ok/null-field/malformed/throw). 34 tests, written failing first (TDD red → green).

### Task 2 — Deezer-first backfill, iTunes removed (commit `457ddd2`)

- **`cover-backfill.ts`** — `resolveOne` now resolves `deezerSongCover` FIRST (with a `signal?.aborted` recheck); only on a `null` does it fall through to the existing CN path (`searchAll → dedupeBest[0].cover`). `resolveOneArtist` swaps to `deezerArtistCover`. The cache + `onResolved` + never-throws + CAP=3 + `max` + skip-cached wrapper is unchanged. Header rewritten to the Deezer-first chain; documents that the Last.fm tier is the cheap `tileCover` `item.image` pre-check, not a backfill call.
- **`cover-backfill.test.ts`** — re-pointed spies to `./deezer`; flipped ordering assertions (asserts `searchAll` is NOT called on a Deezer hit; a Deezer miss falls through to a CN hit); kept never-throws / skip-cached / de-dupe / cap / artist tests. 14 tests.
- **`+page.svelte`** — `tileCover()` synchronous pre-check order UNCHANGED (Last.fm image → CAA(mbid) → cached → gradient); only the comment blocks at `tileCover` and `scheduleBackfill` updated to the final chain.
- **`cover-cache.ts`** — one comment reworded (artist key now caches a Deezer-backfilled image).
- **Removed** `itunes-cover.ts` + `itunes-cover.test.ts`; `grep -rniE itunes src/` is clean (zero references, comments included).

## Verification (all automated checks PASS)

- `pnpm vitest --run` deezer-endpoint.test.ts + deezer.test.ts → 34 passed.
- `pnpm vitest --run cover-backfill.test.ts` → 14 passed.
- `test ! -f itunes-cover.ts && test ! -f itunes-cover.test.ts && ! grep -rniE itunes src/` → all true (files gone, zero refs).
- `pnpm check` (svelte-check) → 0 errors / 0 warnings (4038 files).
- `pnpm test` (full suite) → **383 passed (39 files)**, no regressions.
- `pnpm build` → succeeds; adapter-cloudflare emits `entries/endpoints/api/deezer/search/_server.ts.js` and registers `api/deezer/search` in the route manifest; `_routes.json` includes `/*` so the worker serves the proxy.

## Threat Model Compliance

| Threat ID | Mitigation as shipped |
|-----------|----------------------|
| T-wv8-01 (q passthrough) | `q` is `encodeURIComponent`'d into the fixed `api.deezer.com/search?q=...&limit=1` string; empty q short-circuits with no fetch. |
| T-wv8-02 (CORS) | `corsHeaders(origin)` own-origin only; OPTIONS 204 via the same helper; tests assert ACAO never `*`. |
| T-wv8-03 (secret) | No env/secret read; works with `platform: undefined`; proxy-types.ts Env untouched. |
| T-wv8-04 (self-DoS / rate cap) | `caches.default` TTL 86400 + client CAP=3 + `AbortSignal.timeout` (8s edge / 6s client) + fetchWithRetry bounded backoff. |
| T-wv8-05 (untrusted image URL) | `safeImageUrl` host allow-list on BOTH fields → off-host/non-https/CSS-breaker → null; rendered as `<img src>` only, onerror → gradient. |
| T-wv8-06 (cache bleed) | Cache key = own-origin Request (never the upstream URL); cached body CORS-free, CORS re-applied per request on hit; tests assert the key omits `api.deezer.com`. |
| T-wv8-07 (npm install) | No new dependency added. |

## Deviations from Plan

None for the auto tasks — Tasks 1 and 2 executed exactly as written.

One naming nuance: the plan's verify gate `! grep -rniE itunes src/` requires ZERO `itunes` substrings anywhere in `src/`, including comments. The plan's action prose ("note this is quick-260606-wv8 superseding v7k", "iTunes removed" in `+page.svelte` comments) would have left the literal word in comments and failed that gate. To satisfy the gate exactly, the comments were reworded to convey the same meaning without the literal "iTunes"/"itunes" token (e.g. "the prior fallback", "Deezer is PRIMARY (wv8 supersedes v7k)"). This is a faithful reconciliation of the two requirements, not a behavior change.

## Task 3 — Human-Verify Checkpoint: DEFERRED-TO-HUMAN

Task 3 is `checkpoint:human-verify` (gate: blocking). It is a runtime/visual confirmation that real Deezer covers appear on the running app — it CANNOT be satisfied by an automated agent (the v7k lesson: tests-green is NOT sufficient for a network-and-render-bound task). All automated verification above is green; the visual eyeball below is the only remaining step.

**Exact steps for the human verifier:**

1. **Run the app against the edge runtime** (the Cache API + the `/api/deezer/search` route need the worker runtime):
   `pnpm build && pnpm preview` (wrangler pages dev on `http://localhost:4173`). A bare `pnpm dev` also serves the proxy fetch but has no Cache API — `preview` is preferred. A local `LASTFM_KEY` makes the Last.fm home shelves populate; without it the home falls back to the diverse-picks grid (Deezer covers still backfill there).
2. Open `http://localhost:4173` on a phone-width viewport (DevTools device mode). Clear `openmusic:cover-cache:v1` in Application > Local Storage first, then hard-reload, so you watch covers land fresh (a warm visit reads them from cache).
3. **TRACK TILES:** confirm 精選推薦 / 熱門金曲 (top-hits) and the tag/country shelves — especially Western chart tiles that previously showed only a color gradient — now fill with REAL album covers shortly after first paint (progressively, as the capped backfill lands).
4. **ARTIST TILES:** confirm the 熱門歌手 (top-artists) round tiles show REAL artist photos (not gradients) — the field iTunes/Last.fm could never fill.
5. **NETWORK:** in DevTools Network, confirm requests go to `/api/deezer/search?q=...` (same-origin, 200) and the cover/picture `<img>` srcs are `https://cdn-images.dzcdn.net/...`. Confirm NO direct `api.deezer.com` request from the browser (must be proxied) and NO request carries a secret.
6. **GRACEFUL MISS:** a tile with no Deezer/CN match keeps its gradient — there is NO broken-image icon anywhere.

**Resume signal:** type "approved" once real Deezer covers visibly appear on BOTH home track tiles AND artist tiles, OR describe what still shows a gradient / broken image / wrong host so it can be fixed.

## Commits

- `dce9915` — feat(260606-wv8): Deezer edge search proxy + thin deezer.ts client
- `457ddd2` — feat(260606-wv8): Deezer-first cover backfill, remove iTunes

## Self-Check: PASSED

- Created files exist: `+server.ts`, `deezer-endpoint.test.ts`, `deezer.ts`, `deezer.test.ts` — all FOUND.
- Deleted files gone: `itunes-cover.ts`, `itunes-cover.test.ts` — both GONE.
- Commits exist in git log: `dce9915`, `457ddd2` — both FOUND.
- SUMMARY.md exists.
