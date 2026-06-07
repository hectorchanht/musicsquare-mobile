---
quick_id: 260607-kmn
slug: artist-page-action-buttons-favourite-wir
description: artist page action buttons (favourite/play/share) + fav-artists home shelf
created: 2026-06-07
mode: quick
---

# Plan

Three artist-page action buttons + complete the deferred ju0 P5 (fav-artists shelf).

## Tasks

### T1 — library.favArtists bucket

`src/lib/stores/library.svelte.ts`:
- Extend `LibShape` with `favArtists?: string[]`.
- Add `favArtists = $state<string[]>([])`.
- Hydrate in `load()` (non-destructive: missing key → `[]`).
- Persist in `save()`.
- Add `isFavArtist(name: string): boolean`.
- Add `toggleFavArtist(name: string): void` (case-preserving, normalized for compare).
- Extend `clearAll()` to wipe `favArtists`.

### T2 — Home layout: fav-artists section id

`src/lib/services/home-layout.ts`:
- Extend `HOME_SECTIONS` to include `'fav-artists'` (appended — `resolveSectionOrder` auto-appends new ids for existing users).

`src/lib/services/home-layout.test.ts`:
- Add a test that the new id is auto-appended for legacy saves.

`src/routes/(app)/settings/home/+page.svelte`:
- Add `'fav-artists': 'settings.homeSectionFavArtists'` to the `sectionLabel` record.

`src/routes/(app)/+page.svelte`:
- Add a `favArtistsShelf` `$state<{ name: string; image: string | null }[]>([])`.
- New $effect that backfills artist covers for `library.favArtists` via deezerArtistCover/enrichArtist (concurrency 4, race-guarded on the list contents).
- New `{#snippet favArtistsBlock()}` — round-avatar shelf identical to `topArtistsBlock` shape but data-sourced from favArtists.
- Wire into the `{#each resolveSectionOrder ...}` switch.

### T3 — Artist page action buttons

`src/routes/(app)/artist/[name]/+page.svelte`:
- Import `Heart`, `Play`, `Share2` from `@lucide/svelte`.
- Import `library` from stores, `shareUrl` style (artist URL, not track-stub — `${origin}/artist/${encodeURIComponent(name)}`).
- Local `toast()` helper (same lightweight pattern as TrackMenu/home).
- 3-button action row inserted into `.hero`, between `<p class="note">` and `{#if enrich?.tags}`:
  - **Favourite (Heart)**: `class:on={favArtist}` derived from `library.isFavArtist(name)`; onclick toggles + toast (`toast.artistFavorited` / `toast.artistUnfavorited`).
  - **Play (Play icon)**: random pick from `songs`. Set queue to a shuffled order with picked-first; `player.play(picked, { fresh: true })`. Disabled while `loading || !songs.length`.
  - **Share (Share2 icon)**: `navigator.share({ title, text, url })` with copy-clipboard + `toast.shareCopied` fallback.

### T4 — i18n × 15 locales

New keys:
- `settings.homeSectionFavArtists` — "Favourite artists" / "我喜歡的歌手" / "我喜欢的歌手" + 12 others
- `artist.favorite` — "Favourite"
- `artist.unfavorite` — "Unfavourite"
- `artist.playArtist` — "Play"
- `artist.share` — "Share"
- `toast.artistFavorited` — "Added to favourite artists"
- `toast.artistUnfavorited` — "Removed from favourite artists"

(`toast.shareCopied` already exists.)

### T5 — Gate + commit

- `pnpm check` clean, `pnpm test` green.
- Single `feat(quick-260607-kmn): ...` commit. SUMMARY.md + STATE.md row via docs commit.

## must_haves

- artist hero shows 3 round-pill action buttons (Heart/Play/Share2)
- Heart toggle persists via library.favArtists localStorage key
- Play button picks random hit + plays + queue contains all artist songs
- Share uses Web Share API with clipboard fallback
- `'fav-artists'` appears as a home-layout section in settings/home with toggle + drag
- Favourite artists shelf renders on home (when non-empty) in user's saved order
- i18n parity across 15 locales — `pnpm test` passes
