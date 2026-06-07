---
quick_id: 260607-hhd
slug: library-sourced-home-shelves-liked-playl
date: 2026-06-07
status: complete
commits:
  - 5449864  # Part B revert — drop swipe-up gesture + FLIP morph
  - ba7f437  # Part A — library-sourced home shelves
---

# Quick Task 260607-hhd — Library shelves + revert gte regressions

Decisions locked via CONTEXT.md + AskUserQuestion: **one shelf per playlist**;
**Part B = revert** swipe-up + FLIP entirely (user-offered fallback).

## Part A — Library-sourced home shelves
- `home-layout.ts` `HOME_SECTIONS` extends from 4 to **8** ids:
  `['liked','downloads','top-hits','top-artists','tags','countries','playlists','history']`.
  A brand-new user (empty `homeSectionOrder`) sees Liked + Downloads **pinned above Top hits**
  in `DEFAULT_SECTION_ORDER`. A returning user with a saved 4-section order keeps it; the new
  ids append at the end via the existing "missing-canonical-ids" path (`resolveSectionOrder`).
  `home-layout.test.ts` updated.
- **Home (+page.svelte)**:
  - New `$state` shelves: `likedShelf` / `downloadsShelf` / `historyShelf` /
    `playlistShelves` (one entry per non-empty playlist, name as the subhead).
  - `buildLibraryShelves(randomize)` over the live `library` + `playHistory` stores.
    Fisher-Yates when `randomize=true`; head-of-list slice otherwise. Capped to
    `settings.homeShelfSize`.
  - Persisted as uid arrays in `openmusic:home-library:v1` (separate from the Last.fm
    `openmusic:top-picks:v2` cache so a chart wipe doesn't burn library picks).
    `loadLibraryCache()` resolves uids back to live Track refs on cold mount; uids no
    longer in the live store are dropped silently.
  - Plugged into the existing `refresh(seedQueue, background, randomize)` → Randomize
    re-rolls library shelves alongside chart shelves.
  - 4 new `{#snippet …Block()}` blocks reuse the `.album/.al-cover` tile layout (so
    cover-scale, font-scaling, marquee all keep working), driven by a shared
    `librarySongRow(track: Track)` snippet. Tap = `player.play(track, { fresh: true })`.
  - Empty-source gating: each shelf renders nothing (no header, no row) when its source
    list is empty.
  - Import landmine fixed: `history` (the store) is imported as **`playHistory`** so it
    doesn't shadow the global `window.history` used at line `history.replaceState(...)` in
    the existing `/?play=` deep-link path.
- **Settings → Home Layout**: the `sectionLabel` record gains 4 entries → the existing
  reorder + show/hide UI surfaces the new sections automatically.
- **Settings → Data**: "Clear cached top picks" also drops the new
  `openmusic:home-library:v1` key so a user can reset both caches in one tap.
- **i18n**: 4 new keys (`settings.homeSectionLiked / Downloads / Playlists / History`)
  hand-translated for the 3 parity locales (en / zh-Hant / zh-Hans) and auto-filled for
  the other 12 (Dict-type completeness).

## Part B — Revert swipe-up + FLIP morph (gte / P5)
User-reported regressions: (1) the pointer state machine swallowed the synthetic click,
breaking tap-to-open; (2) the FLIP morph didn't visibly grow inner elements during
swipe-up (only the section's Y position changed). User explicitly offered the fallback
path.

Removed:
- `src/lib/stores/morph.svelte.ts` (file deleted).
- Layout: morph import, `nowbarEl`, `liftDy/Scale/Active/Id`, `liftStartY`,
  `LIFT_THRESHOLD`, `liftDown/Move/Up`, `captureNowbarRects`, `openNowPlaying`; the
  pointer handlers, transform style, `role="region"`, `class:lifting` on the nowbar;
  the `.nowbar.lifting` + `transition:transform` + `touch-action:pan-y` CSS additions.
  `np-open` button restored to `onclick={() => player.expand()}`.
- NowPlaying: `onMount`/`tick` imports + morph store imports; `titleEl2`/`artistEl2`
  refs and their `bind:this`; `morphActive`/`morphRunning`/`MORPH_DURATION`;
  `applyMorphFrom`; the `onMount` runner. Section restored to a single
  `transition:fly={{ y: 600, duration: 320 }}`. `.np.morph` chrome CSS block + the
  universal `.np .bar/.prog/.transport/.sheet` transition rule dropped.

KEPT from gte: the window-keydown `$effect` on NowPlaying (Space toggles, ArrowLeft
prev, ArrowRight next). Independent of the morph and works.

## Verification (live)
- Brand-new user defaults: subhead order = **Liked songs, Downloads, Top hits,
  Top artists, k-pop, jazz, Top in Japan, Top in US, Top in HK, My Playlist,
  Recently played**.
- Randomize: liked A,B,C → C,A,B; downloads A,B → B,A; cache mirrors.
- Page refresh restores the randomized order verbatim (cache survives reload).
- **Nowbar click opens NowPlaying** (regression confirmed fixed; `npOpenedByClick: true`).
- Swipe-up gesture gone — no pointer handlers on the nowbar.
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.

## Notes / follow-ups
- One shelf per playlist matches user choice; for users with many playlists the home may
  grow tall — they can hide individual sections via `/settings/home` (`playlists` toggles
  the whole block; an "expand to per-playlist toggles" UI is a future iteration).
- The cached uid set is the per-track identity; a user who EDITS a track (rare) keeps the
  cache valid. A track removed from the library disappears from the cached shelf on the
  next render — desired.
- No new `lastfm`-style network fan-out (these shelves are 100% local-store reads), so
  the home cold-mount stays at today's perf budget.
- `randomize` in `buildLibraryShelves` uses `Math.random()` — fine for queue/shelf UX.
