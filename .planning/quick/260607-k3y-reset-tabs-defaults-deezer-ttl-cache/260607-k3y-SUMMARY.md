---
quick_id: 260607-k3y
slug: reset-tabs-defaults-deezer-ttl-cache
date: 2026-06-07
status: complete
commits:
  - b67f026 # k3y feat: centralized defaults + per-tab reset + client/edge cache layer
---

# Quick Task 260607-k3y — defaults config, per-tab reset, cache audit

Three sub-asks landed together:

1. **Reset-to-default** button on every customizable settings tab, with all
   defaults centralized in one editable config file.
2. **Memo Deezer hits** in a client TTL cache so repeat-search runs skip the
   ≤5 extra Deezer calls per search.
3. **Cache more queries broadly** + answer whether Cloudflare auto-caches.

## P1 — Central defaults config + per-tab reset

`src/lib/config/defaults.ts` is the new single source of truth. Five `as const`
groups (`GENERAL_DEFAULTS`, `APPEARANCE_DEFAULTS`, `TRANSLATION_DEFAULTS`,
`PLAYBACK_DEFAULTS`, `HOME_DEFAULTS`) feed into one aggregate `DEFAULTS`. Edit
this file to change what's "default" — nothing else moves.

`settings.svelte.ts` reads from `DEFAULTS.*` in five reset methods:
`resetGeneral`, `resetAppearance`, `resetTranslation`, `resetPlayback`,
`resetHome`. Each applies + persists.

Each settings page (general, appearance, translation, playback, home) gets a
`Reset to default` pill in the header that confirms then calls the matching
method. Three new i18n keys × 15 locales: `settings.resetGroup`,
`settings.resetConfirm`, `settings.resetDone`.

## P2/P3 — Caching: what already cached, what was missing, what k3y added

### What Cloudflare auto-caches (and what it doesn't)

- **Pages static assets** (CSS/JS/images bundled with the app): auto-cached
  at the CF edge. No action needed.
- **Worker routes** (`/api/*`): **NOT auto-cached.** Every request hits the
  Worker unless the route explicitly uses `caches.default.put/match` (the
  Cloudflare Workers Cache API).

### Inventory of edge cache use before k3y

| Route | Edge cache? |
|---|---|
| `/api/deezer/search` | yes (24h) |
| `/api/deezer/related` | yes |
| `/api/deezer/chart` | yes |
| `/api/lastfm/discovery` | yes |
| `/api/jamendo/search` | **no** |
| `/api/fivesing/search` | **no** |
| `/api/fivesing/url` | intentionally not (audio URLs expire ~1–2h) |
| `/api/lastfm/info` | no — relies on client cache below |

### k3y additions

**Client-side TTL cache (`src/lib/services/ttl-cache.ts`) wrapped around:**

- `deezerSongCover` — 24h
- `deezerArtistCover` — 24h
- `deezerSearchTopN` — 1h (the dedupe-Deezer hot path)
- `deezerRelatedArtists` — 1h
- `deezerChart` — 1h
- `fetchInfo` (all Last.fm helpers: `enrichTrack`/`Artist`/`Album`,
  `getChartTopTracks/Artists`, `getTagTopTracks`, `getGeoTopTracks`,
  `getArtistTopAlbums`, `getAlbumTracklist`) — 1h, keyed by sorted
  param signature
- `getSimilarArtists` — 1h

The store is shared module-scope, so a same-session repeat call returns
instantly with zero network. Rejected promises are never cached (the next
call retries).

**Edge cache (`caches.default`) added to:**

- `/api/jamendo/search` — 1h
- `/api/fivesing/search` — 1h

Both mirror the wv8 deezer/search posture: own-origin Request as cache key
(never the upstream URL with the secret in it), CORS-free cached body,
origin re-applied per request on a hit, no cache write on upstream error.

### Test isolation fix

The module-scoped store leaked across vitest runs. Added
`__clearSearchCache()` calls in `beforeEach`/`afterEach` of `lastfm.test.ts`
and `similar.test.ts` (the existing exporter from `ttl-cache.ts`).

## Files touched

```
src/lib/config/defaults.ts                    (new)
src/lib/stores/settings.svelte.ts             (+ 5 reset methods)
src/lib/services/deezer.ts                    (+ cached wrappers + TTL consts)
src/lib/services/lastfm.ts                    (+ cached wrap fetchInfo)
src/lib/services/similar.ts                   (+ cached wrap getSimilarArtists)
src/routes/(app)/settings/{general,appearance,translation,playback,home}/+page.svelte
src/routes/api/jamendo/search/+server.ts      (+ caches.default 1h)
src/routes/api/fivesing/search/+server.ts     (+ caches.default 1h)
src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
src/lib/services/{lastfm,similar}.test.ts     (cache reset)
```

## Gate

- `pnpm check` — 0 errors, 0 warnings (4069 files)
- `pnpm test` — 414/414 passing (41 files)
