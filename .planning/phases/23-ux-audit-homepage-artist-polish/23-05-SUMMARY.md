---
phase: 23-ux-audit-homepage-artist-polish
plan: 05
subsystem: row-swipe-actions
tags: [swipe, queue, like, toast, haptics, a11y, deep-link, library, search, album]
requires:
  - src/lib/actions/swipeAction.ts (Plan 02)
  - src/lib/util/haptics.ts (Plan 01)
  - src/lib/stores/toast.svelte.ts (Plan 01)
provides:
  - "use:swipeAction (right=queue / left=like-toggle) on search, library track, and album tracklist rows"
  - "library aria-pressed/aria-current tab buttons (UX-06 §7.1)"
  - "library ?tab= and ?playlist= deep-link resolution with safe fallback (D-13, T-23-10)"
affects:
  - "home library-mirror + per-playlist shelves (Plan that wires section-nav) redirect into /library?tab= and /library?playlist="
tech-stack:
  added: []
  patterns:
    - "Reveal-behind-row swipe surface: .swipe-wrap (position:relative, overflow:hidden) + two absolutely-positioned .reveal layers; the .row carries an opaque var(--color-bg) base + z-index:1 so the row translateX (swipeAction) exposes the correct side and masks it at rest"
    - "Swipe commit = host fires player.addToQueue / library.toggleLike + global toast.show + haptics.tick (swipeAction stays a pure DOM gesture per Plan 02 contract)"
    - "Album stubs resolve via resolveStub before queue/like commit (mirrors tap-to-play), degrade to the unplayable toast on miss — never throw"
    - "Deep-link params read synchronously via $app/state page.url.searchParams, validated against VALID_TABS / existing playlist ids, unknown → safe fallback"
key-files:
  created: []
  modified:
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
decisions:
  - "Swipe coexists verbatim with the row's existing use:longpress + onclick — no changes to the tap/long-press contract (Phase 15/20 invariant); swipeAction's own sub-slop tap-preservation + WR-01 click suppression handle the arbitration."
  - "Reveal backgrounds use var(--color-primary) (queue) and var(--src-netease) (like/unlike field) per UI-SPEC §6; the reveal icon color is #fff, matching the existing #fff-on-accent convention used by .tabs button.active / .bar button / the toast (not a new color ramp)."
  - "Threshold left at the swipeAction 96px flat + flick default (§6) — no per-surface override."
  - "Album like-reveal heart renders fill=none (album rows are unresolved stubs; reading the real like state would need a network resolve). The toast confirms the actual committed direction."
  - "?playlist=<id> pins the Playlists tab to a single playlist detail view via a derived detailPlaylist; a manual setTab() clears the pin (one-shot entry, not a sticky filter)."
metrics:
  duration: ~14m
  tasks: 3
  files: 3
  completed: 2026-06-12
---

# Phase 23 Plan 05: Row Swipe-Actions on Main Vertical Lists Summary

Wired the Plan 02 `swipeAction` gesture (right = add-to-queue, left = like-toggle) onto the three existing vertical track-list surfaces — search results, library track tabs, and the album tracklist — each commit firing the Plan 01 global `toast.show()` + commit-tier `haptics.tick()`. Added library tab `aria-pressed`/`aria-current` (UX-06) and the D-13 deep-link handling (`?tab=` + `?playlist=`) with safe fallback. The album tracklist loading state was confirmed already a shape-matched skeleton.

## What Was Built

### Task 1 — search rows (commit `52aec20`)
- `src/routes/(app)/search/+page.svelte`: each result `.row` gains `use:swipeAction={{ onSwipeRight: () => swipeQueue(t), onSwipeLeft: () => swipeLike(t) }}` while keeping its `use:longpress` + `onclick` (tap-to-play).
- `swipeQueue(track)` calls `player.addToQueue(track)` (append-to-end, D-03, matching TrackMenu `addQueue`) + `toast.show(t('toast.addedToQueue'))` + `hapticTick()`.
- `swipeLike(track)` reads `library.isLiked(track.uid)` BEFORE `library.toggleLike(track)` so the toast is direction-correct (`toast.unliked` if it was liked, else `toast.liked`) + `hapticTick()` (D-04, matching TrackMenu `like()`).
- Reveal layers: `.reveal-queue` (left edge, `var(--color-primary)`, `ListEnd` icon) and `.reveal-like` (right edge, `var(--src-netease)`, `Heart` reflecting current state) sit BEHIND the row inside a `.swipe-wrap`; the row carries an opaque `var(--color-bg)` base + `z-index:1` so its translateX exposes the side and masks the reveal at rest.

### Task 2 — library rows + a11y tabs + deep-links (commit `79799ca`)
- `src/routes/(app)/library/+page.svelte`: `use:swipeAction` (same wiring as Task 1) on the four TRACK-row surfaces — liked, downloads, history, and playlist-detail rows. NOT on fav-artist tiles or playlist-folder rows (those are not tracks), per the plan.
- All 5 tab buttons carry `aria-pressed={tab === '<id>'}` + `aria-current={tab === '<id>' ? 'page' : undefined}` reflecting the active tab (UX-06 §7.1, replicating the edit-btn `aria-pressed` precedent).
- `loadInitialTab()` now reads `page.url.searchParams.get('tab')` (home library-mirror redirects WIN over the stored tab), validated against `VALID_TABS`; an unknown/garbage tab falls back to the stored/default tab without throwing (T-23-10).
- `?playlist=<id>` is read by `loadInitialPlaylist()`, validated against existing `library.playlists` ids; a valid id forces the Playlists tab and pins it to that playlist's detail view (a derived `detailPlaylist`); an unknown id falls back to showing all playlists without crashing. A manual `setTab()` clears the pin.

### Task 3 — album tracklist rows + skeleton confirm (commit `6c328af`)
- `src/routes/(app)/album/[name]/+page.svelte`: `use:swipeAction` on the real tracklist rows, keeping `use:longpress` + `onclick`.
- Album rows are `{artist,title}` STUBS, so — exactly like tap-to-play and the long-press menu — `swipeQueue`/`swipeLike` first `await resolveStub(...)` to a real Track before the queue/like commit; a miss degrades to the existing `album.unplayable` local toast (never throws). The commit fires the GLOBAL `toast.show()` (reused `toast.addedToQueue` / `toast.liked` / `toast.unliked` keys) + `hapticTick()`.
- Skeleton confirm: the existing `{#if loading}` block already renders shape-matched `.sk` rows (rank bar + 44px `.art.sk` matching the loaded `.art` + `.sk-rtitle` 80% / `.sk-rsub` 45% bars), 10 rows, with NO visible loading text — only an SR-only `aria-label={t('album.loading')}`. This satisfies UX-01; left unchanged (the size/shape already mirrors the album's own loaded rows).

## Verification
- `pnpm check` exits 0 (0 errors, 0 warnings, 4260 files) after each task and at the end.
- Queue/like semantics matched to TrackMenu: `player.addToQueue` (append-to-end) and `library.toggleLike` with the pre-toggle `library.isLiked` read for the direction-correct toast.
- Reveal backgrounds use `var(--color-primary)` + `var(--src-netease)` — no hex literals added beyond the `#fff` reveal-icon color (matches the existing #fff-on-accent convention; not a new ramp).
- Swipe coexists with the load-bearing tap + long-press on all three surfaces (swipeAction's sub-slop tap-preservation + WR-01 suppression, unchanged from Plan 02).

## Deviations from Plan

### Setup (not a code deviation)
**Restored dependencies** — `node_modules` was absent in this fresh worktree. Ran `pnpm install --frozen-lockfile` (no lockfile change, no new packages) so `svelte-check` could run.

### Auto-fixed Issues
**1. [Rule 3 - Blocking] Restructured the library `?playlist` → tab init to avoid a `state_referenced_locally` warning**
- **Found during:** Task 2 verification (`pnpm check` reported 1 warning: a top-level `if (detailPlaylistId) tab = 'playlists'` read `$state` outside a closure).
- **Issue:** Reading the `detailPlaylistId` `$state` at the top level to seed `tab` triggered svelte-check's `state_referenced_locally` warning; the acceptance criterion is `pnpm check` exits 0 (clean).
- **Fix:** Folded the playlist→tab decision INTO `loadInitialTab()` (it calls `loadInitialPlaylist()` and returns `'playlists'` when a valid id is present), so `tab`'s initializer derives the correct tab with no top-level `$state` read.
- **Files modified:** src/routes/(app)/library/+page.svelte
- **Commit:** 79799ca (fixed before the Task 2 commit)

## Threat Model Compliance
- **T-23-10 (param injection):** `?tab` validated against `VALID_TABS`, `?playlist` validated against existing `library.playlists` ids; unknown values fall back to the stored/default tab / full playlist list without throwing. Mitigated as planned.
- **T-23-11 / T-23-12:** accepted per plan (swipe mutates only the user's own queue/library via the same paths TrackMenu uses; reveal text is static reused i18n keys).

## Threat Flags
None — no new network endpoint, auth path, or schema surface introduced. The deep-link params are read-only navigation inputs, validated at the trust boundary (the only new surface, already covered by T-23-10).

## Known Stubs
None. All three surfaces are fully wired to the live `player`/`library`/`toast`/`haptics` paths.

## Self-Check: PASSED
- FOUND: src/routes/(app)/search/+page.svelte
- FOUND: src/routes/(app)/library/+page.svelte
- FOUND: src/routes/(app)/album/[name]/+page.svelte
- FOUND: .planning/phases/23-ux-audit-homepage-artist-polish/23-05-SUMMARY.md
- FOUND commit: 52aec20 (Task 1 — search)
- FOUND commit: 79799ca (Task 2 — library)
- FOUND commit: 6c328af (Task 3 — album)
- `use:swipeAction` wired on all three surfaces (search result row, 4 library track-row surfaces, album tracklist row); `pnpm check` exits 0.
