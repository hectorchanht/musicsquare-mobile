# Quick Task 260607-ii6 — Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
Seven UI polish items spanning album page, library page, NowPlaying transport, Settings
Playback, and TrackMenu toast wording.
</domain>

<decisions>
## Implementation Decisions

### Playback tab source surfacing (locked via AskUserQuestion)
**Hidden "Advanced · sources" accordion** at the bottom of /settings/playback. Tucks per-source
on/off chips behind a collapsed disclosure so the tab stays speed/quality-first; users who need
to opt into 5sing can. New `settings.enabledSources?: Partial<Record<SourceId, boolean>>`
mirrors the `getEnabledAdapters(prefs)` plumbing.

### Album download failure — fallback path
Diagnose first; if `fetch` blocks on CORS for the audio CDN, the per-track save FAILS silently
(catch block runs, count stays 0). Fall back to `window.open(audioUrl, '_blank')` per track —
the browser then triggers its own download/play behavior at the OS level (already what the
TrackMenu doDownload path uses on fetch failure at [TrackMenu.svelte:96](src/lib/components/TrackMenu.svelte:96)).

### Per-button disable
Replace boolean `albumBusy` with `busyAction: 'play' | 'download' | 'like' | 'addToPlaylist' |
'share' | null`. Each handler sets it on entry, clears on exit. Each button's `disabled` checks
its own action id. Same-button double-fire suppressed; other buttons stay interactive.

### Toast wording (TrackMenu like)
Post-toggle, `library.isLiked(uid)` returns the NEW state. The bug: when now-false the toast
reads `t('menu.like')` ("Like" — verb), not a past-tense unliked confirmation. Add a new
i18n key `toast.unliked` ("Removed from liked" / 已取消喜歡 / 已取消喜欢) and use it. Same
key reused by NowPlaying like-button + album like.

### Album-like heart fill state
`$derived` over `library.liked` + the resolved album track uids. When ALL liked → fill +
"unlike all" toast on tap. Else outline + "liked" toast. The state needs the resolved Track
list — today album shows STUBS until tap; reuse the `resolveAll()` cache from the like handler
so the visual reflects the post-tap state. For the un-resolved case (cold load, no actions
yet), show outline (most common state).

### Album-row longpress
Add `use:longpress` + `onlongpress` to the track-row button, opening the same `TrackMenu`
component with the resolved track. Album rows are STUBS (not Tracks) — long-press needs to
resolve first (mirroring `playStub`). Add a `menuLoading` flag for the brief resolve window.

### Library bulk-edit
Scope to v1: Liked tab only (per user). An `editMode = $state(false)` flag in `library/+page.svelte`;
top-right Edit/Done button toggles it; in edit mode, row click runs `library.toggleLike(track)`
(removes from liked) instead of `playList`. Visual cue: a small Trash icon replaces the row's
left affordance + a subtle red row tint via `class:editing`. Architect so extending to
Downloads / per-playlist views later is a one-line tab-conditional.

### NowPlaying transport swap
The leftmost transport button (today Shuffle) becomes Like. Heart icon: `fill="currentColor"`
when `library.isLiked(player.current.uid)`, else `none`. Tap calls `library.toggleLike` + the
unified toast. Move shuffle into the more-menu (`MoreVertical` button at the top right of NP).
Reuse the existing TrackMenu component, but add a "Shuffle queue" menu item that calls
`player.toggleShuffle()`. The Repeat button on the right stays.

</decisions>

<canonical_refs>
- TrackMenu like bug: [TrackMenu.svelte:42](src/lib/components/TrackMenu.svelte:42)
- Album action bar: [album/[name]/+page.svelte](src/routes/(app)/album/[name]/+page.svelte)
- Library page row click: [library/+page.svelte:54](src/routes/(app)/library/+page.svelte:54)
- Playback settings: [settings/playback/+page.svelte](src/routes/(app)/settings/playback/+page.svelte)
- NP transport: [NowPlaying.svelte:571](src/lib/components/NowPlaying.svelte:571)
- 5sing adapter ships `enabledByDefault: false` — accordion is the discovery path.
</canonical_refs>
