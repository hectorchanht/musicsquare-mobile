---
quick_id: 260607-kyf
slug: offline-blob-cache-artist-back-arrow-sea
description: offline blob cache + artist back-arrow + search artist tiles + library fav-artists tab + home shelf reorder
created: 2026-06-07
mode: quick
---

# Plan

Four scoped sub-asks shipped in one feat commit.

## T1 — Offline blob cache

- New `src/lib/services/blob-store.ts`:
  - SSR-guarded singleton over IndexedDB db `openmusic-blobs`, store `tracks`, key `uid`.
  - API: `put(uid, blob)`, `get(uid): Promise<Blob | null>`, `del(uid)`. Never throw.
  - Open is lazy + cached. On SSR or unavailable IDB → all methods resolve to nulls/no-ops.

- `TrackMenu.svelte doDownload`: after `fetch→blob`, call `blobStore.put(r.uid, blob)` BEFORE the anchor.click (await before clearing the object URL).

- `library.removeDownload(uid)`: also call `blobStore.del(uid)`.

- `player.play()`:
  - On a successfully resolved track that `library.isDownloaded(uid)`: try `blobStore.get(uid)`. If blob present, set `this.audio.src = URL.createObjectURL(blob)` and remember the URL on a private field `cachedBlobUrl`. Revoke the previous `cachedBlobUrl` whenever it is replaced or when a new play starts on a different uid.
  - Miss → use the CDN URL as today.

## T2 — Artist back button → left-arrow icon

`src/routes/(app)/artist/[name]/+page.svelte`:
- Replace `<a class="back" href="/">{t('artist.back')}</a>` with `<button class="back-btn" onclick={() => history.back()} aria-label={t('common.back')}><ChevronLeft size={22} /></button>` (matches settings sub-pages posture).
- Drop the `artist.back` reference; `common.back` already exists or add it.
- Update CSS to size like other back buttons (36×36 icon button).

## T3 — Search: artist tiles at top

`src/routes/(app)/search/+page.svelte`:
- Derive an `artistTiles` $state list from the current `results` after each settle:
  - Group results by `track.artist` (case-insensitive).
  - A group qualifies as "real artist match" if its artist name matches the query (case-insensitive contains) AND the group has ≥2 tracks. Cap to ≤3 tiles, sorted by group size desc.
- Each tile gets an avatar via the same `enrichArtist().lastfmArt` → `deezerArtistCover` fallback used on the artist page (race-guarded on the active query).
- Render above the song list (`.artist-tiles` row), tap → `goto('/artist/' + encodeURIComponent(name))`.
- Hide while skeleton showing or no qualifying matches.

## T4 — Library fav-artists tab + home shelf reorder

### 4a. Library page (`src/routes/(app)/library/+page.svelte`)
- Extend `Tab` union with `'fav-artists'`.
- New tab button in the nav strip with `Users` lucide icon.
- New `{:else if tab === 'fav-artists'}` block:
  - Round-avatar grid of `library.favArtists`. Tap → `goto('/artist/...')`.
  - In editMode: tap removes via `library.toggleFavArtist(name)` + Trash2 icon.
  - Empty state: `t('library.noFavArtists')`.
- Extend `editableTabHasContent` derivation.
- Avatar source: same `enrichArtist → deezerArtistCover` chain, lazy per-tile (cap 4, race-guarded).

### 4b. Home: HOME_SECTIONS reorder
- `src/lib/services/home-layout.ts`: move `'fav-artists'` from `[liked, downloads, fav-artists, top-hits, ...]` to `[liked, downloads, fav-artists, top-hits, top-artists, fav-artists?]`... wait, more visible default: put it directly after `top-artists` (it IS an artist-shaped shelf — natural neighbor):
  - New canonical: `['liked', 'downloads', 'top-hits', 'top-artists', 'fav-artists', 'tags', 'countries', 'playlists', 'history']`.
  - Update test fixtures.
- For existing users (legacy saved order = the kmn position): a soft migration in `resolveSectionOrder` is NOT needed — kmn already auto-appends. But to surface the fav-artists shelf for legacy saved-order users (whose persisted array doesn't contain `'fav-artists'`), the auto-append already lands it; that's the current bottom position. Users can reorder in settings. No code change beyond canonical order.
- Drop the unused k-old import / nothing else.

## T5 — i18n

New keys × 15 locales:
- `common.back` — "Back" (only if not already present)
- `library.favArtists` — "Favourite artists"
- `library.noFavArtists` — "No favourite artists yet"
- `search.artists` — "Artists"

## T6 — Gate + verify + commit

- `pnpm check`, `pnpm test`.
- Live: `vite dev` → download a track → play it → assert `player.audio.src` starts with `blob:`. Artist page back-arrow renders. Search "Daft Punk" → artist tile at top. Library new tab → Daft Punk tile.
- Single feat commit + SUMMARY.md + STATE.md row.

## must_haves

- `blob-store.ts` exports `put/get/del`, never throws, SSR-safe
- TrackMenu doDownload writes to blob store before clicking anchor
- library.removeDownload also deletes blob
- player.play sets `audio.src` to a blob URL when downloaded+present, revokes prior
- artist /[name] back button renders ChevronLeft icon
- search shows up to 3 artist tiles when query matches an artist
- library has a Favourite-artists tab with delete-on-edit
- home `HOME_SECTIONS` canonical = liked, downloads, top-hits, top-artists, fav-artists, tags, countries, playlists, history
- i18n parity passes
