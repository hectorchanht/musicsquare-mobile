---
quick_id: 260607-lry
slug: library-tab-persist-cache-audit
date: 2026-06-07
status: complete
commits:
  - 576478b
---

# Library tab persistence + cache audit

## T1 — Library tab persistence

Library page now restores the previously-active tab on mount. Persisted
to `openmusic:library:tab` on every tab switch (via a `setTab(v)` helper
that updates state + persists in one step); restored from the initial
`$state` value so the correct tab renders from frame 1 with no flash.

Verified live: switched to Downloads → localStorage = "downloads" → hard
nav `/` then back to `/library` → page restored on Downloads, sub-label
reads "Library · Downloads".

## T2 — Cache audit (user asked "is everything cached?")

| Layer | Cached? | Where |
|---|---|---|
| Home tile covers | yes (localStorage) | [cover-cache.ts](src/lib/services/cover-cache.ts) `openmusic:cover-cache:v1` |
| Repeat image loads | yes (browser HTTP cache) | URLs are persistent (Deezer/iTunes/CN/CAA hosts) |
| Deezer queries (search, cover, related, chart) | yes (TTL 1h/24h) | [deezer.ts](src/lib/services/deezer.ts) wrapped in `cached()` — k3y |
| Last.fm queries (enrich, chart, tag, geo, album tracklist, similar) | yes (TTL 1h) | [lastfm.ts](src/lib/services/lastfm.ts) `fetchInfo` + [similar.ts](src/lib/services/similar.ts) — k3y |
| **`searchAll` aggregate** | **yes (TTL 5min)** | [catalog.ts](src/lib/services/catalog.ts) — already cached by the seam wrapper; covers the search page + discovery stub-resolve + diverse-picks + similar-queue paths |
| Track details (audio URL resolution) | per-session in `trackMap` | NOT TTL-cached on purpose — audio URLs expire ~1–2h, must re-resolve. Once resolved, the same `detailsLoaded:true` track skips re-resolve via the ensureTrackDetails short-circuit. |
| Downloaded songs → local-play | yes (IndexedDB) | [blob-store.ts](src/lib/services/blob-store.ts) `openmusic-blobs/tracks` keyed by uid. `player.play()` checks `library.isDownloaded(uid) && blobStore.get(uid)` and sets `audio.src` to a `blob:` Object URL — CDN re-stream only on miss/SSR. Wired in kyf. |
| Search-page result restoration on tab return | yes (in-memory) | [searchSession](src/lib/stores/searchSession.svelte.ts) holds the live result set + scroll position, so a nav-away/back is paint-instant for the LAST query. |

Nothing was missing. The user's intuition is correct: every fetched
thing of substance is cached in at least one layer (browser-HTTP /
client-TTL / localStorage / IndexedDB). Audio URLs are deliberately not
TTL-cached because the upstream CDNs return signed/expiring URLs.

No code change for T2 — the search-page TTL the request mentioned is
already in catalog.ts (5min, key=`${query}|${enabledSources}|${page}`).

## Gate

- `pnpm check` 0/0 (4070 files)
- `pnpm test` 415/415
