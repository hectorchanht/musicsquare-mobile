---
phase: 17-up-next-sourcing-settings-plumbing
plan: 04
subsystem: deezer-enrichment
tags: [deezer, enrichment, edge-proxy, artist-page, album-page, queue-context]
requires:
  - "Plan 17-01: QueueContext type + setQueue/playStub context arg signature"
  - "Plan 17-01: deezer.* i18n keys (all 15 locales)"
  - "src/routes/api/deezer/related/+server.ts (clone template)"
  - "src/lib/services/lastfm.ts EnrichResult"
provides:
  - "ENRICH-04: Deezer artist/album info enrichment beside Last.fm"
  - "/api/deezer/artist + /api/deezer/album own-origin edge routes"
  - "deezerArtist/deezerAlbum never-throws client fns + DeezerArtistInfo/DeezerAlbumInfo interfaces"
  - "Pure mergeEnrichArtist/mergeEnrichAlbum field-precedence helper (D-15)"
  - "'artist'/'album' QueueContext threaded into those pages' play calls (QUEUE-03 page coverage)"
affects:
  - "src/routes/(app)/artist/[name]/+page.svelte"
  - "src/routes/(app)/album/[name]/+page.svelte"
  - "src/lib/services/deezer.ts"
tech-stack:
  added: []
  patterns:
    - "Own-origin two-call edge proxy (search-by-name -> fetch-by-id), Cache-API TTL on success only"
    - "Never-throws service posture (null/empty on any miss/abort/throw)"
    - "Race-guarded $effect (dzFor guard) cloning the enrichedFor idiom"
    - "Pure field-precedence merge helper (no DOM/fetch/store) for unit-testable D-15"
key-files:
  created:
    - "src/routes/api/deezer/artist/+server.ts"
    - "src/routes/api/deezer/album/+server.ts"
    - "src/lib/services/enrich-merge.ts"
    - "src/lib/services/enrich-merge.test.ts"
  modified:
    - "src/lib/services/deezer.ts"
    - "src/lib/services/deezer.test.ts"
    - "src/routes/(app)/artist/[name]/+page.svelte"
    - "src/routes/(app)/album/[name]/+page.svelte"
decisions:
  - "Deezer routes do NOT long-cache a hard miss (empty shape returned without a long TTL) — a transient upstream failure pinned 24h is worse UX (T-17-13)."
  - "mergeEnrich exposes lastfmListeners/lastfmPlaycount/deezerFans SEPARATELY (not a single merged count) so the page renders counts side-by-side labeled by source (D-15)."
  - "Artist hi-res picture flows through the merge into the existing heroImg (best-quality > Last.fm > derived cover); related-artists shelf left as-is (already wired via getSimilarArtists)."
  - "Album page imports use:marquee (newly) so the long label row bounce-scrolls per MEMORY rule instead of static ellipsis."
  - "Album Deezer effect fires even on a deep link with no ?artist= — deezerAlbum searches on title alone; the enrich effect still requires the artist."
metrics:
  duration: "~10 min"
  tasks: 3
  files: 8
  completed: "2026-06-10"
  tests: "543 (505 full suite + 28 deezer + 15 enrich-merge; overlapping)"
---

# Phase 17 Plan 04: Deezer Artist/Album Enrichment Summary

Deezer artist/album info enrichment (ENRICH-04) via two own-origin edge proxies, two never-throws client fns, a pure field-precedence merge helper, and new Deezer sections beside the Last.fm enrichment on the artist/album pages — degrading silently on a miss; plus 'artist'/'album' queue-context threaded into those pages' play calls.

## What Was Built

### Task 1 — Two Deezer edge proxies + client fns + tests (commit 8c949af)
- **`/api/deezer/artist/+server.ts`** and **`/api/deezer/album/+server.ts`**: near-exact clones of `related/+server.ts`. Two-call own-origin proxy (`search/artist|album?q=…&limit=1` → `artist|album/{id}`), null-safe reshape, `encodeURIComponent` on every user-influenced param (V5/SSRF, T-17-11), fixed upstream host, edge Cache-API TTL (24h) **on success only**, empty shape on a miss with **no long TTL** (T-17-13), `corsHeaders` + `OPTIONS` (T-17-12), never throws (D-14/D-16).
  - Artist reshape: `{ picture: picture_xl, fans: nb_fan, albums: nb_album }`.
  - Album reshape: `{ cover: cover_xl, releaseDate: release_date, tracks: nb_tracks, fans, label, genres: genres.data[].name, duration }`. Title + artist combine into the search query.
- **`deezerArtist(name, signal?)` / `deezerAlbum(title, artist?, signal?)`** in `deezer.ts` — mirror `deezerRelatedArtists` exactly: aborted-guard → trim → empty→null → `cached()` (7d) → own-origin fetch with `combinedSignal` → non-ok/throw → null. Exported `DeezerArtistInfo` / `DeezerAlbumInfo` interfaces.
- **`deezer.test.ts`** extended with 14 new cases (own-origin path, encoded params, empty/already-aborted/non-ok/malformed/throw → null). All 28 deezer tests green.

### Task 2 — Pure mergeEnrich field-precedence helper (TDD: 3e585fb RED, fe71c03 GREEN)
- **`enrich-merge.ts`** exports pure `mergeEnrichArtist(lastfm, deezer)` and `mergeEnrichAlbum(lastfm, deezer)` returning `MergedArtistInfo` / `MergedAlbumInfo`. D-15: best-quality image wins (Deezer hi-res preferred when present, never downgrades a present value to null); counts kept side-by-side (`lastfmListeners`/`lastfmPlaycount`/`deezerFans` exposed separately); Last.fm tags/bio/bioUrl pass through untouched; album release/label/genres/tracks/duration come from Deezer when present.
- **PURE** — no DOM/fetch/store imports, inputs never mutated (purity grep gate returns 0). 15 unit tests green (best-quality, both-counts, additive Last.fm fields, null-Deezer intact, both-null empty shape, purity).

### Task 3 — Deezer sections + skeletons on pages + context threading (commit b7cf6e3)
- **Artist page**: parallel race-guarded `deezerArtist` `$effect` (`dzFor` guard); `merged = $derived(mergeEnrichArtist(enrich, dz))`; `heroImg` now uses `merged.image` (hi-res Deezer picture generalizing the old `enrich?.lastfmArt ?? hero` precedent); a fans/albums stats row with a shape-matched `dzLoading` skeleton that disappears cleanly on a miss (D-14/D-17). Related-artists shelf untouched (already wired).
- **Album page**: parallel race-guarded `deezerAlbum` `$effect`; `merged = $derived(mergeEnrichAlbum(enrich, dz))`; `heroImg` uses `merged.cover`; a Deezer info block (release date / label / genres / track count / duration / fans) with a shape-matched skeleton. Label row uses `use:marquee` (newly imported) per the MEMORY marquee rule. `fmtDuration` formats Deezer seconds → M:SS/H:MM:SS.
- **D-18 preserved**: the playable list stays the CN-source `songs`/`tracks`; Deezer is info-only (no dead non-playable rows added).
- **Context threading (QUEUE-03 page coverage)**: `'artist'` into `setQueue([picked,...rest], 'artist')` (playArtistRandom) and the hit-songs row `setQueue(songs, 'artist')`; `'album'` into both `playStub(...,'album')` calls and `setQueue(all…, 'album')`.

## Deviations from Plan

None — plan executed exactly as written. (Two minor judgment calls within plan scope: the album page newly imports `use:marquee` as the plan's marquee rule required but the file did not yet import it; and a small `fmtDuration` helper was added on the album page to render Deezer's seconds-based duration — both are page-local view formatting, not behavior changes.)

## Verification

- `vitest run src/lib/services/deezer.test.ts` — 28 passed (incl. 14 new never-throws/own-origin cases).
- `vitest run src/lib/services/enrich-merge.test.ts` — 15 passed (D-15 field precedence + purity).
- `svelte-check` — 0 errors, 0 warnings (confirms consumed `deezer.*` keys resolve, all wiring type-checks).
- `vitest run` full suite — 505 passed (45 files), no regression.
- Grep gates: both routes have `OPTIONS` + `encodeURIComponent`; both client fns + interfaces present; `mergeEnrich*` used on each page; `'artist'`/`'album'` threaded; `api.deezer.com` count = 0 in both page files.
- Manual (deferred to VALIDATION.md at wave merge): open artist/album pages with and without Deezer hits → skeletons match shape; sections vanish cleanly on a miss; no dead Deezer rows.

## Notes for Future Plans

- The `deezer.*` i18n keys consumed here were created by Plan 01 Task 4; this plan did not edit any locale file.
- The merge helper is pure and reusable — any future surface needing Last.fm + Deezer field precedence (e.g. a Now-Playing detail sheet) can import `mergeEnrichArtist`/`mergeEnrichAlbum` directly.
- Edge routes cache successful reshapes 24h at the edge + 7d client-side (`cached`), so a popular artist/album is fetched from Deezer at most once per TTL window (T-17-14 rate-limit amplification mitigated).
