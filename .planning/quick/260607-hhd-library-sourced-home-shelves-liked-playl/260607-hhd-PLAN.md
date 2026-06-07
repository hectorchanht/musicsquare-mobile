---
quick_id: 260607-hhd
slug: library-sourced-home-shelves-liked-playl
date: 2026-06-07
status: planned
---

# Quick Task 260607-hhd — Library shelves on home + revert gte regressions

Decisions locked via CONTEXT.md: **playlist = one shelf per playlist**; **Part B = revert**
swipe-up + FLIP entirely (user-offered fallback), keep gte's keyboard shortcuts intact.

## Task 1 — Revert swipe-up gesture + FLIP morph (Part B)
**Files:** `src/lib/stores/morph.svelte.ts` (delete), `src/routes/(app)/+layout.svelte`,
`src/lib/components/NowPlaying.svelte`.

- Delete `morph.svelte.ts`.
- Layout: remove the morph import, `nowbarEl`, `liftDy/Scale/Active/Id`, `liftDown/Move/Up`,
  `captureNowbarRects`, `openNowPlaying`. Restore the nowbar markup to today-without-gte
  (`onclick={() => player.expand()}`, no `role="region"`, no pointer handlers, no transform
  style, no `class:lifting`). Remove the `.nowbar.lifting` + `transition: transform` + `touch-action`
  CSS additions.
- NowPlaying: remove the morph imports (`tick`, `takeFrom`, `prefersReducedMotion`,
  `MorphFrom`), the `titleEl2/artistEl2` refs + their `bind:this`, `morphActive`/`morphRunning`/
  `MORPH_DURATION`, `applyMorphFrom`, the `onMount` runner. Revert the section to single
  `transition:fly={{ y: 600, duration: 320 }}` (drop the `in:`/`out:` split + `class:morph`).
  Remove the `.np.morph` CSS block + the universal `.np .bar/.prog/.transport/.sheet` rule.
- Keep the kbd shortcut `$effect` (gte Part 4) — unaffected by the revert.

## Task 2 — Home-layout section ids + defaults (Part A foundation)
**File:** `src/lib/services/home-layout.ts`
- Extend `HOME_SECTIONS` to:
  `['liked','downloads','top-hits','top-artists','tags','countries','playlists','history']`.
- Defaults reorder lands the four library ids in the correct positions; `resolveSectionOrder`'s
  "append missing canonical ids" path means an existing user with a saved order that doesn't
  include the new ids gets them appended cleanly (no blank, no clobber).
- The DEFAULT_SECTION_ORDER ordering puts `liked` + `downloads` AT THE TOP (above `top-hits`)
  as the user requested; first-visit reproducibility is automatic since first-load saved order
  is empty → resolveSectionOrder returns DEFAULT_SECTION_ORDER.

## Task 3 — Library shelf data + cache + Randomize integration (Part A)
**File:** `src/routes/(app)/+page.svelte` (+ small helper).
- Add 4 `$state` shelves: `likedShelf: Track[]`, `downloadsShelf: Track[]`,
  `historyShelf: Track[]`, `playlistShelves: { id: string; name: string; tracks: Track[] }[]`.
- New `buildLibraryShelves({ randomize })` pure-ish helper: for each source list, pick up to
  `settings.homeShelfSize` tracks. When `randomize=true`, Fisher-Yates the source; when false,
  return the first N preserving source order (for liked/downloads) or the latest N (for history).
  Playlists: iterate `library.playlists`, build one shelf per playlist whose `.tracks` is non-empty
  (each picked using the same N + randomize rules).
- Wire into the existing `refresh(seedQueue, background, randomize)` so the library shelves
  re-roll on Randomize alongside chart shelves. On cold load, build them from library data
  (which `library.load()` populated synchronously in onMount).
- Cache key `openmusic:home-library:v1` stores `{ likedUids, downloadsUids, historyUids,
  playlistsUids: Record<id, uid[]> }`. Saved at the end of `refresh()`; read in `loadCache()`
  to hydrate the four shelves alongside chart cache. Trivial: store uids; resolve back to
  Tracks from the live library/history stores at render time.
- Empty-source gating: each shelf renders nothing when its tracks array is empty.

## Task 4 — Home markup + settings/home labels + i18n (Part A render)
**Files:** `src/routes/(app)/+page.svelte`, `src/routes/(app)/settings/home/+page.svelte`,
i18n parity locales.
- Add 4 new `{#snippet …Block()}` blocks mirroring `topHitsBlock` shape: cover = `track.cover`
  or `fallbackCover(track.uid)`, name = `names.dnTitle(track.title)`, count =
  `names.dnArtist(track.artist)`, onclick = `player.play(track, { fresh: true })`. For
  per-playlist shelves: the playlist's name as the subhead.
- Plug into the `{#each resolveSectionOrder(...) as id}` dispatcher:
  - `liked` → likedBlock
  - `downloads` → downloadsBlock
  - `history` → historyBlock
  - `playlists` → playlistsBlock (renders one .albumrow per playlist).
- Settings/home labels map: add new entries to `sectionLabel: Record<HomeSectionId,
  TranslationKey>`. 4 new i18n keys in en/zh-Hant/zh-Hans:
  `settings.homeSectionLiked`, `settings.homeSectionDownloads`, `settings.homeSectionHistory`,
  `settings.homeSectionPlaylists`. (Dict type completeness handled by the 3-locale fallback —
  same rule as gte's `nowplaying.repeatModeOne/All`.)

Wait — Dict type requires all 15 locales to have every key. I'll fill all 15 like fnp did.

## Task 5 — Clear-data wiring (Part A polish)
**File:** `src/routes/(app)/settings/data/+page.svelte`
- "Clear cached top picks" should also drop the new `openmusic:home-library:v1` key so a user
  can reset both caches in one tap.

## Verification (must-have)
- All 4 new library shelves render on home when their sources are non-empty; hidden when empty.
- Randomize button shuffles each library shelf (visibly different picks on consecutive presses).
- After a Randomize press, page refresh restores the SAME picks (cache survives reload).
- Settings → Home Layout shows 4 new section rows with i18n labels; user can hide/reorder them.
- Defaults: a brand-new user with at least one liked + downloaded track sees Liked + Downloaded
  ABOVE Top hits.
- Part B: a plain click on the nowbar opens NowPlaying. Swiping up is a no-op (gesture removed).
  Swipe-down-on-cover still collapses (existing path). Kbd shortcuts still work.
- `pnpm check` 0/0, tests pass, build OK.

## Must-haves
- Section ids `liked`/`downloads`/`history`/`playlists` exist in HOME_SECTIONS in canonical order.
- `openmusic:home-library:v1` cache key persists and is read on home cold-mount.
- Settings/home reorder + show/hide works for all 4 ids.
- The Randomize button mutates the cached picks for all 4 library shelves + chart shelves.
- No swipe-up gesture, no FLIP morph code remains.
