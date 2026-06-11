---
phase: 21-search-cover-pipeline-polish
plan: 05
subsystem: cover-pipeline
tags: [covers, lazy-load, intersection-observer, library, album, artist]
requires:
  - "lazyCover action (Action<HTMLElement, LazyCoverParam>) — Plan 02"
  - "resolveCoverForTrack + two-layer cover cache (uid then name) — Plan 02"
  - "Track / makeUid COLON form — sources/types.ts"
provides:
  - "use:lazyCover wired into ALL remaining track-list surfaces this phase: library liked/playlist/downloads/history, album tracklist, artist hit-song tracklist (COVER-02 D-14 complete with Plan 04 search)"
  - "album tracklist (Last.fm stubs) now paints a real resolved cover over the seeded gradient via a synthetic Track adapter"
affects:
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
tech-stack:
  added: []
  patterns:
    - "Reactive resolved-cover map: let resolvedCovers = $state<Record<string,string>>({}); onResolved bumps it immutably ({ ...resolvedCovers, [uid]: url }) — mirrors the library favCovers idiom"
    - "Render prefers resolvedCovers[uid] ?? track.cover, falling back to the page's seeded gradient (D-12); SOLID https only (Plan 02 gate), rendered via the EXISTING background-image path (no new sink, T-0bb-01)"
    - "Stub→Track adapter for the album page: Last.fm tracklist stubs ({artist,title}) wrapped into a synthetic Track so lazyCover (which needs a Track) resolves them; synthetic uid `album:<artist> <title>` for the uid-layer/de-dupe, while the (artist,title) name-layer cache key is SHARED with the real track resolved on tap → no refetch across stub and resolved track"
key-files:
  created: []
  modified:
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
decisions:
  - "Album rows are Last.fm STUBS with no uid/source/cover — the plan's assumption that track.uid exists did not hold. Built a per-stub synthetic Track (stubAsTrack) rather than touching the action: the name-layer cache key (artist,title) is identical to the one resolveCoverForTrack writes when the same song resolves to a real Track on tap, so the cover caches consistently across both."
  - "Kept each page's own seeded-gradient fallbackCover as the null placeholder (D-12); did NOT touch fav-artist avatars (library) or al-cover album/related-artist image rows (artist) — those are artist/album imagery, not track covers."
metrics:
  duration: ~10m
  tasks: 2 (of 3; Task 3 is a human-verify checkpoint)
  files: 3
  completed: 2026-06-11
---

# Phase 21 Plan 05: Lazy Covers Across Library / Album / Artist Summary

Wired the Plan-02 `lazyCover` action into every remaining track-list surface in the phase — the library liked/playlist/downloads/history lists, the album tracklist, and the artist hit-song tracklist — so empty or broken covers resolve on scroll-into-view, repaint via a reactive uid→url map, and never refetch (cache-first, uid then name). The album tracklist, which previously rendered only a gradient, now paints a real resolved cover over it.

## What Was Built

### Task 1 — library track-row lazy covers (commit aa6f51d)
- Imported `lazyCover`; added `let resolvedCovers = $state<Record<string, string>>({})` plus an `onCoverResolved(uid, url)` that bumps the map immutably (mirrors the existing `favCovers` reactive-map idiom on this page).
- Attached `use:lazyCover={{ track, onResolved: onCoverResolved }}` to all FOUR track-row `.art` spans: liked, playlist, downloads, and history. Each render now reads `style:background-image={(resolvedCovers[track.uid] ?? track.cover) ? url(...) : fallbackCover(track)}`.
- Left each row's `use:longpress` + onclick intact (lazyCover stacks on the `.art` span). Did NOT touch the fav-artist `.fav-avatar` rows (artist images, not track covers).

### Task 2 — album + artist tracklist lazy covers (commits 39c300e, c0651f5)
- **Album** (`album/[name]/+page.svelte`): the tracklist rows are Last.fm `AlbumStub = {artist,title}` — NO uid/source/cover. Added `resolvedCovers` + `onCoverResolved`, and a `stubAsTrack(stub)` adapter that wraps each stub into a minimal synthetic `Track` (synthetic uid `album:<artist> <title>`, `cover: null`). Wired `use:lazyCover={{ track: stubAsTrack(track), onResolved }}` on the tracklist `.art` and changed the render to `resolvedCovers[stubUid(track)] ? url(...) : fallbackCover(track.artist + track.title)` so a resolved cover paints OVER the gradient. The synthetic track's name-layer cache key (artist,title) is the SAME key the real track uses when resolved on tap, so the cover caches consistently across both (no refetch).
- **Artist** (`artist/[name]/+page.svelte`): hit-song rows are real `Track`s. Added `resolvedCovers` + `onCoverResolved` and wired `use:lazyCover={{ track, onResolved }}` on the tracklist `.art`, preferring `resolvedCovers[track.uid] ?? track.cover`. Left the `al-cover` album-image and related-artist rows untouched (album/artist imagery, out of scope).

## Verification

- `pnpm check` → **0 errors, 0 warnings** (after each task)
- `pnpm test` (full suite) → **707 passed (55 files)**
- Manual checkpoint (Task 3) still owed — see below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stray NUL byte in the album `stubUid` template literal**
- **Found during:** Task 2 post-commit deletion/integrity check (git reported the album file as binary; base commit had 0 NUL bytes, so it was introduced this session).
- **Issue:** A `\x00` landed between `${stub.artist}` and `${stub.title}` in the `stubUid` template literal instead of the intended space, making git treat the file as binary.
- **Fix:** Replaced the NUL with a space → `album:${stub.artist} ${stub.title}`.
- **Files modified:** src/routes/(app)/album/[name]/+page.svelte
- **Commit:** c0651f5

### Plan-assumption correction (not a behavior deviation)

- The plan's Task-2 note said to confirm the album track exposes `track.uid`. It does NOT — album tracklist entries are Last.fm `{artist,title}` stubs. Built a `stubAsTrack` synthetic-Track adapter (documented above) so `lazyCover` (which requires a `Track`) works and the cover caches under the shared (artist,title) name key. No change to the Plan-02 action.

## Notes for Downstream / Reviewer

- COVER-02 **D-14 is now structurally complete**: lazyCover is wired into search (Plan 04) and all three list surfaces here. Resolved covers are SOLID https only and rendered through the existing `style:background-image` path used for source covers — no new injection sink (T-0bb-01); the fan-out is viewport-bounded and de-duped per the Plan-02 action (T-21-05).
- The album page now resolves real covers for gradient-only rows; whether the resolved cover for a stub is the *correct* album art (vs. a generic single cover) depends on the Deezer→iTunes→CN chain and is a manual-verification item (Task 3).

## Checkpoint Status

Task 3 (`checkpoint:human-verify`) was NOT auto-run — `auto_advance` is false. All implementation work (Tasks 1-2) is committed. The orchestrator should present the checkpoint to the user for manual verification across the library, album, and artist surfaces.

## Self-Check: PASSED
