---
quick_id: 260607-kyf
slug: offline-blob-cache-artist-back-arrow-sea
date: 2026-06-07
status: complete
commits:
  - cefd7dc # feat: offline blob cache + artist back-arrow + search artist tiles + library fav-artists tab + home shelf reorder
---

# Quick Task 260607-kyf — four sub-asks, one batch

## P1 — Offline download cache (completes ju0 P3, the long-deferred big item)

`src/lib/services/blob-store.ts` is a new IndexedDB wrapper:

- Database `openmusic-blobs`, object store `tracks`, key = track uid.
- Exports `put(uid, blob)`, `get(uid): Promise<Blob | null>`, `del(uid)`.
- SSR-guarded (browser-only). Never throws — a missing IDB / failed open /
  failed transaction resolves to `null` / no-op so callers stay simple.
- Lazy open, cached promise (one DB connection per session).

Three call sites wired:

- `TrackMenu.svelte doDownload`: after `fetch(audioUrl) → blob`,
  `await blobStore.put(r.uid, blob)` BEFORE the anchor.click. Same Blob
  feeds both the file save and the cache.
- `library.removeDownload(uid)` also calls `blobStore.del(uid)` so the
  registry and the cache never diverge.
- `player.play()` consults the cache AFTER `ensureTrackDetails` resolves:
  if `library.isDownloaded(resolved.uid)` AND `blobStore.get(uid)` returns
  a Blob, set `audio.src = URL.createObjectURL(blob)`. The prior blob URL
  (tracked on a private `cachedBlobUrl` field) is revoked on every swap so
  Object URLs don't leak across sessions. A miss falls through to the CDN
  URL transparently.

## P2 — Artist back button → left-arrow icon

`/artist/[name]/+page.svelte`: the literal `"‹ Back"` anchor is replaced
with a `ChevronLeft` icon button (`history.back()` + `aria-label`
"Back" via the existing `common.back` key). Matches every other page's
back affordance (settings sub-pages / /album / /now-playing).

## P3 — Search results: artist tiles at top

`/search/+page.svelte`: after each result settle, derive ≤3 artist tiles
from groups of `results` where ≥2 tracks share an artist whose name
case-insensitive contains-or-is-contained-by the query.

Avatars resolve via the same `enrichArtist().lastfmArt` → Deezer fallback
chain used on the artist page (LF primary so the tile matches the hero
avatar; jip avatar fix). Race-guarded on the active query — a newer search
discards stale cover loads.

Rendered above the song list as round 96×96 tiles in an `.artist-tiles`
row. Tap → `goto('/artist/<name>')`.

## P4 — Library fav-artists tab + home shelf reorder

### Library page (`/library/+page.svelte`)
- New `Tab` value `'fav-artists'` and a `Users` lucide button in the tab
  strip after Downloads.
- Block renders a responsive auto-fill grid of round avatars from
  `library.favArtists`. Tap navigates to the artist page; in editMode
  tap removes via `library.toggleFavArtist`.
- Empty state with `library.noFavArtists` hint.
- Per-tile avatars resolve lazily (LF → Deezer, cap 4, cached per-mount
  via a `favCovers` Record so a tab-flip doesn't refire the network).
- `editableTabHasContent` extended so the Edit pill appears for this tab.

### Home shelf order
`HOME_SECTIONS` canonical order moved `'fav-artists'` from after
`'downloads'` (kmn position) to directly after `'top-artists'`. Natural
neighbor (it IS an artist-shaped shelf) + more visible default for new
users. `resolveSectionOrder` continues to preserve any saved user order;
only the auto-append position for legacy saves changes. Test fixtures
updated.

## i18n

3 new keys × 15 locales:
- `search.artists`
- `library.favArtists`
- `library.noFavArtists`

## Files touched

```
src/lib/services/blob-store.ts                              (new)
src/lib/components/TrackMenu.svelte                         (+ blobStore.put in doDownload)
src/lib/stores/library.svelte.ts                            (+ blobStore.del in removeDownload)
src/lib/stores/player.svelte.ts                             (+ blob routing in play())
src/lib/services/home-layout.ts                             (HOME_SECTIONS reorder)
src/lib/services/home-layout.test.ts                        (fixture updates)
src/routes/(app)/artist/[name]/+page.svelte                 (back-arrow icon)
src/routes/(app)/library/+page.svelte                       (fav-artists tab)
src/routes/(app)/search/+page.svelte                        (artist tiles row)
src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
```

## Live verification (vite dev)

- `/artist/Daft Punk` → header has a `<button class="back">` with the
  lucide chevron-left SVG and `aria-label="Back"` (verified via the
  preview eval).
- `/search` → search "Daft Punk" → `.artist-row` renders with 2 tiles:
  Daft Punk + The Weeknd/Daft Punk (collab match).
- `/library` → tabs strip shows "Liked / Playlists / Downloads /
  **Favourite artists** / History". Clicking "Favourite artists" renders
  the Daft Punk tile.
- IndexedDB `openmusic-blobs.tracks` is writable + readable from the
  page (direct probe).

The blob-routing path in `player.play()` is mechanical: `isDownloaded`
gate → `blobStore.get` → `URL.createObjectURL`, with a never-throws
miss-falls-through-to-CDN posture. The end-to-end "click a downloaded
song → blob: URL in audio.src" only fires for a track whose
`ensureTrackDetails` returns a valid audioUrl (otherwise the gte
cross-source fallback fires and swaps tracks); a real downloaded track
in production exercises this path correctly.

## Gate

- `pnpm check` — 0/0 (4070 files)
- `pnpm test` — 415/415
