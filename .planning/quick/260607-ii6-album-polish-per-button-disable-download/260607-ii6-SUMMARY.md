---
quick_id: 260607-ii6
slug: album-polish-per-button-disable-download
date: 2026-06-07
status: complete
commits:
  - c623a5f  # all 7 items: album polish + library bulk-edit + Playback accordion + NP like swap
---

# Quick Task 260607-ii6 — UI polish across album / library / playback / NowPlaying

Locked decisions: Playback approach = **Hidden Advanced · sources accordion** (AskUserQuestion).
Other defaults set in CONTEXT.md.

## Album page (3 fixes + 1 new affordance)
**File:** `src/routes/(app)/album/[name]/+page.svelte`
- **Per-button disable**: `albumBusy` boolean → `busyAction: AlbumAction | null`. Each handler
  sets/clears its own id; each button's `disabled` checks `busyAction === '<self>'`. In-flight
  Download no longer locks out Like. Double-fire on the SAME button still suppressed.
- **Long-press track rows** open TrackMenu against the resolved track. Rows are stubs, so the
  menu opens with `menuLoading=true` while `resolveStub` runs (TrackMenu's skeleton). Mirrors
  the home-shelf idiom.
- **Album-like heart fill state**: new `$derived albumLiked` over `resolvedCache +
  library.liked`. Filled when ALL liked → tap unlikes all → `toast.unliked` → heart returns
  to outline. Outline otherwise → tap likes the missing ones → `toast.liked` → heart fills.
- **Download CORS fallback**: the fetch→blob→anchor.click path silently failed against
  CN-source CDNs that don't send `Access-Control-Allow-Origin` (root cause of the user-reported
  "no downloads"). On fetch throw, falls back to `window.open(audioUrl, '_blank')` per track;
  the browser handles the download. Counts both paths toward the saved tally.

## TrackMenu
**File:** `src/lib/components/TrackMenu.svelte`
- Like toast was `t('menu.like')` (action verb) when unliking. Now reads
  `toast.liked` / `toast.unliked` against the post-toggle state.
- New **"Shuffle queue"** menu item (visible when `player.queue.length > 1`), drives
  `player.toggleShuffle()`. `.on` reflects `player.shuffle`. Discoverable from the NP kebab.

## Library bulk-edit (Liked tab v1)
**File:** `src/routes/(app)/library/+page.svelte`
- `editMode` flag + Edit/Done pill top-right (visible only on Liked tab when
  `liked.length > 0`).
- In edit mode: row click runs `library.toggleLike(track)` (removes) instead of `playList`.
  Trash2 icon replaces the play icon; row gets `.edit-row` (red tint + hover).
- Tab switch auto-exits edit mode (`$effect` on `tab`). v1 scopes to Liked tab; `rowAction()`
  structured so extending to Downloads/Playlists is one conditional later.

## Playback Advanced — Sources accordion
**Files:** `src/lib/stores/settings.svelte.ts`, `src/lib/sources/registry.ts`,
`src/routes/(app)/settings/playback/+page.svelte`
- New `settings.enabledSources: Partial<Record<SourceId, boolean>>` (non-destructive
  load/save).
- `getEnabledAdapters` precedence chain: **explicit prefs[id]** (e.g. fallback's per-source
  retry) > **`settings.enabledSources[id]`** > **`adapter.enabledByDefault`**. Single change
  reaches every `searchAll` caller — no plumbing churn.
- `<details>` accordion at bottom of /settings/playback. One chip per registered source
  (label = adapter's `.label`). Lets a user opt INTO 5sing without changing the adapter
  contract.

## NowPlaying transport: Like replaces Shuffle
**File:** `src/lib/components/NowPlaying.svelte`
- Leftmost transport button now Like: `Heart` with `fill={currentLiked ? 'currentColor' :
  'none'}`. Tap toggles + flashes a local 1.5s toast (`toast.liked` / `toast.unliked`).
  `currentLiked` is `$derived` from `library.isLiked(player.current.uid)`.
- Shuffle removed from transport row — moved into the kebab menu (TrackMenu's new
  "Shuffle queue" item).

## i18n
7 new keys across **15 locales** (Dict completeness):
`common.done`, `library.edit`, `toast.liked`, `toast.unliked`, `settings.sourcesAdvanced`,
`settings.sourcesAdvancedNote`, `menu.shuffleQueue`. 3 parity hand-translated; 12 auto-filled.

## Verification (live preview)
- **NP transport**: order = Like / Prev / Play-Pause / Next / Repeat (no Shuffle ✓).
  Click Like → aria flips to "Liked", `.on=true`, toast "Liked", heart fills. Click again →
  aria "Like", `.on=false`, toast "Removed from liked", heart outlines.
- **Library Edit**: 3 liked tracks → click Edit → button becomes "Done", 3 rows get
  `.edit-row` (trash icon + red tint). Tap a row → 3→2 liked (removal). Click Done →
  `.edit-row` cleared, button back to "Edit".
- **Playback Advanced**: accordion labeled "Advanced — Sources". 5 chips visible after
  expand (5sing outline by default since `enabledByDefault: false`). Click 5sing →
  `.on=true`, persisted as `enabledSources: { fivesing: true }` in
  `openmusic:settings:v1`. The next `searchAll` automatically fans out to 5sing through the
  updated `getEnabledAdapters` precedence chain.
- `pnpm check` **0/0**, tests **414/414**, build OK.

## Notes / follow-ups
- Bulk-edit is Liked-tab only in v1. Extension to Downloads / per-playlist is one
  conditional + per-tab remove handler.
- The NP Like toast lives inside the NP overlay (`.np-toast`); other in-app toasts use
  the per-page `<div class="toast">` pattern. Could be unified into a shared toast store
  later (cosmetic).
- The album page's `albumLiked` derived is `false` until the first action runs `resolveAll`
  (the cache is null at cold load). A user who arrives at the album with ALL tracks already
  liked will see an outline heart until they tap it once (which resolves + then renders
  filled). Acceptable for v1; eager-resolving every album visit would burn the network for
  the "they're not all liked" common case.
