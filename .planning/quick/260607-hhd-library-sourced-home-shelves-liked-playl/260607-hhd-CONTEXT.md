# Quick Task 260607-hhd — Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Task Boundary

Two unrelated areas:
- **PART A**: Library-sourced home shelves (liked / playlists / downloads / history), behaving
  like existing chart shelves (settings/home reorderable, randomize, cache-persist).
- **PART B**: Revert the swipe-up gesture + FLIP morph from quick-260607-gte. They broke nowbar
  click-to-open and the FLIP didn't visibly match user intent. Keep tap-to-open + the existing
  cover-drag-down-to-collapse + the new keyboard shortcuts (which didn't regress).
</domain>

<decisions>
## Implementation Decisions

### Playlist shelf shape (locked via AskUserQuestion)
- **One shelf per user playlist**, labeled with the playlist name. Empty playlists are skipped at
  render time (no shelf shown). Order = the order playlists were created (preserve the existing
  `library.playlists` array order).

### Part B revert (Claude's call — user offered explicit fallback)
- Drop `src/lib/stores/morph.svelte.ts` entirely.
- Drop the pointer gesture state (`liftDown/Move/Up`, `liftDy`, `liftScale`, `liftActive`,
  `nowbarEl`, `captureNowbarRects`, `openNowPlaying`) from `src/routes/(app)/+layout.svelte`.
  Restore the simple `onclick={() => player.expand()}` on the np-open button. Drop the
  `role="region"` + pointer handlers + transform style + `class:lifting` from the nowbar div.
  Drop the `.nowbar.lifting` + `transition: transform` + `touch-action: pan-y` CSS.
- Drop the FLIP morph block in `src/lib/components/NowPlaying.svelte`: the morph imports
  (`tick`, `takeFrom`, `prefersReducedMotion`, `MorphFrom`), the `coverElMorph`/`titleEl2`/
  `artistEl2` refs (and their `bind:this`), `morphActive`/`morphRunning`/`MORPH_DURATION`,
  `applyMorphFrom`, and the `onMount` runner.
- Revert the section transition to a SINGLE `transition:fly={{ y: 600, duration: 320 }}` (was
  split into `in:fly` + `out:fly` after gte). Drop the `class:morph` on .np and the chrome
  morph CSS (`.np.morph .bar/.prog/.transport/.sheet` + the universal transition rule).
- KEEP the keyboard shortcuts $effect (Space / ←  / → — added by gte Part 4). It is independent
  of the morph and works correctly.

### Cache + persistence (Part A)
- New `openmusic:home-library:v1` localStorage key holds an object
  `{ liked: string[], downloads: string[], history: string[], playlists: Record<id,string[]> }`
  where each array is the chosen track `uid` set (≤ shelf size). Persisted via the existing
  randomize flow alongside `openmusic:top-picks:v1`.
- Randomize re-rolls all library shelves at the same time as chart shelves.
- A first-visit reset (or a Data-tab "Clear cached top picks") clears this key too.

### Section ids + defaults
- New section ids: `'liked' | 'downloads' | 'history' | 'playlists'` (the playlists section
  EXPANDS to multiple shelves at render time, one per non-empty playlist — its ordering position
  controls where the playlist block starts).
- `DEFAULT_SECTION_ORDER` becomes `['liked', 'downloads', 'top-hits', 'top-artists', 'tags',
  'countries', 'playlists', 'history']`.
- Empty-source gating: at render time, each library section is dropped (no header / no row)
  when its underlying source list is empty. Settings/home still surfaces the toggles so a user
  can hide a section even when it has data.

### Tile content (Claude's discretion)
- Each library shelf uses the SAME `.album` flex tile + `.al-cover` + `.al-name` + `.al-count`
  components as today's `recentArtists` / `topArtists` shelves (so cover-scale + marquee + font
  scaling all work for free).
- Cover: the track's `cover` URL when present, else the existing `fallbackCover()` gradient.
- Tap → `player.play(track, { fresh: true })` (full Track in hand — no resolveStub needed).

</decisions>

<specifics>
## Specific Ideas

- The Randomize handler in home `+page.svelte` already calls `refresh(true, false)` with a
  `randomize` flag — the same handler should re-roll the library picks.
- Library data lives in `library.liked` (Track[]), `library.downloads` (Track[]),
  `library.playlists` (Playlist[] with `.tracks: Track[]`), `history.entries` (HistoryEntry[]).
  History entries have a `.track` field with the full Track.

</specifics>

<canonical_refs>
## Canonical References

- `src/lib/services/home-layout.ts` — section id type + `DEFAULT_SECTION_ORDER` +
  `resolveSectionOrder`.
- `src/routes/(app)/+page.svelte` — shelf rendering + Randomize handler.
- `src/routes/(app)/settings/home/+page.svelte` — section reorder/hide UI driven by
  `sectionLabel: Record<HomeSectionId, TranslationKey>`.
- gte commit `95c61e6` — code to revert in Part B.

</canonical_refs>
