---
quick_id: 260607-kmn
slug: artist-page-action-buttons-favourite-wir
date: 2026-06-07
status: complete
commits:
  - 93dbf71 # feat: artist-page action buttons + fav-artists home shelf
---

# Quick Task 260607-kmn — artist-page action buttons + fav-artists shelf

Two scopes in one feat commit: the three new artist-hero action buttons the
user asked for + completion of the deferred ju0 P5 (fav-artists shelf), since
the Favourite button needed somewhere to land.

## What shipped

### Library bucket
`stores/library.svelte.ts` gains a `favArtists: string[]` bucket with
`isFavArtist(name)` / `toggleFavArtist(name)` (case-insensitive compare,
case-preserving storage). Persisted into the existing
`openmusic:library:v1` shape under a new optional `favArtists?` key — missing
key → `[]`, so existing users upgrade non-destructively.

### Home: fav-artists section
- `HOME_SECTIONS` in `services/home-layout.ts` extended with `'fav-artists'`.
  `resolveSectionOrder` auto-appends new known ids for legacy saves (new test
  added).
- Settings/home reorder list now exposes "Favourite artists" with the same
  drag + toggle affordance.
- Home page renders a round-avatar shelf in the user's saved order, identical
  in shape to top-artists. Covers backfill via `backfillArtistCovers`
  (Deezer → iTunes, capped, cached) — same posture as top-artists.
- Picks persist in `LibraryShelfCache` so arrangement survives reloads.
  Legacy cache without `favArtists` falls back to seeding from the live
  bucket (non-destructive migration on first reload).

### Artist-page action bar
3 pill buttons centered in the hero, between the derived-tracks note and the
tag chips:

1. **Favourite (Heart)** — class:on derived from `library.isFavArtist(name)`;
   Heart icon fills when on; aria-label flips. Toast on toggle.
2. **Play (Play, primary tint)** — picks a random song from the loaded
   `songs`, Fisher-Yates shuffles the rest, sets queue `[picked, ...rest]`,
   `player.play(picked, { fresh: true })`. ensureAhead handles tail growth.
   Disabled while loading or empty.
3. **Share (Share2)** — `navigator.share({ title, text, url })` with
   clipboard fallback + the existing `toast.shareCopied`. No toast on user
   cancel.

### i18n
7 new keys × 15 locales:
- `settings.homeSectionFavArtists`
- `artist.favorite` / `artist.unfavorite` / `artist.playArtist` / `artist.share`
- `toast.artistFavorited` / `toast.artistUnfavorited`

## Files touched

```
src/lib/stores/library.svelte.ts                            (+ favArtists bucket)
src/lib/services/home-layout.ts                             (+ 'fav-artists' id)
src/lib/services/home-layout.test.ts                        (+ legacy upgrade test)
src/routes/(app)/+page.svelte                               (+ shelf snippet/state/cache)
src/routes/(app)/artist/[name]/+page.svelte                 (+ 3 action buttons)
src/routes/(app)/settings/home/+page.svelte                 (+ sectionLabel entry)
src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
```

## Live verification (vite dev, /artist/Daft Punk)

- 3 buttons render (Favourite/Play/Share) with correct labels + primary
  styling on Play.
- Tap Favourite → class becomes `act on`, label flips to "Favourited",
  localStorage `openmusic:library:v1.favArtists = ["Daft Punk"]`.
- `/` then shows a "Favourite artists" subhead with one round-avatar tile
  for Daft Punk.
- `/settings/home` lists "Favourite artists" in the reorder rows alongside
  the existing 8 sections.

## Gate

- `pnpm check` — 0/0 (4069 files)
- `pnpm test` — 415/415 (+1 vs k3y baseline)
