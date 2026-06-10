---
phase: 17-up-next-sourcing-settings-plumbing
reviewed: 2026-06-10T17:01:02Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/lib/actions/swipeRemove.test.ts
  - src/lib/actions/swipeRemove.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/config/defaults.ts
  - src/lib/services/color.test.ts
  - src/lib/services/color.ts
  - src/lib/services/deezer.test.ts
  - src/lib/services/deezer.ts
  - src/lib/services/enrich-merge.test.ts
  - src/lib/services/enrich-merge.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/settings.svelte.test.ts
  - src/lib/stores/settings.svelte.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/settings/appearance/+page.svelte
  - src/routes/(app)/settings/playback/+page.svelte
  - src/routes/api/deezer/album/+server.ts
  - src/routes/api/deezer/artist/+server.ts
findings:
  critical: 1
  warning: 10
  info: 5
  total: 16
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-06-10T17:01:02Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 17 (up-next sourcing + settings plumbing, swipe-to-remove, Deezer artist/album
enrichment) is well-instrumented: the pure helpers (`color.ts`, `enrich-merge.ts`) are clean
and fully tested, the per-context up-next resolver is correctly wired through
`setQueue`/`playStub` → `settings.effectiveUpnextMode`, and the edge proxies keep the
established no-secret / encodeURIComponent / never-throws posture.

However, the headline QUEUE-05 feature has a hole: `removeFromQueue` allows the
**currently playing** track to be swiped out of the queue, which silently kills the entire
never-stop chain (auto-advance, `next()`, `ensureAhead`, prefetch) — and the broken state is
persisted across reloads (CR-01). Around it sit several gesture-arbitration and caching
defects: the swipe action does not suppress the trailing click after a committed drag
(WR-01), the new Clear-queue button double-acts as a sheet-grip tap (WR-02), and both the
client Deezer cache and the edge proxies negative-cache transient failures for long TTLs in
direct contradiction of their own stated T-17-13 posture (WR-03, WR-04).

No structural findings block was provided for this review; all findings below are narrative
(direct adversarial code review).

## Critical Issues

### CR-01: Swiping away the currently playing track breaks the never-stop chain and persists the broken state

**File:** `src/lib/stores/player.svelte.ts:751-756` (with UI entry at `src/lib/components/NowPlaying.svelte:747`)
**Issue:** `removeFromQueue(uid)` filters the queue unconditionally, and NowPlaying attaches
`use:swipeRemove` to every queue row — including the row whose `track.uid === player.current?.uid`
(the row even gets the `playing` highlight, but `enabled` is never set). After swiping the
playing row away:

- `next()` → `indexOf(this.current)` returns `-1` → falls into the `ensureAhead()` branch
  (`player.svelte.ts:1133-1146`), but `ensureAhead()` itself early-returns on `i < 0`
  (`player.svelte.ts:776-777`), so the post-grow advance finds `j === -1` and **nothing plays**.
- The `ended` listener routes through the same dead `next()` → when the song finishes,
  playback silently stops with no notice — defeating the PLAY-07/08 never-stop design this
  same file goes to great lengths to enforce.
- `prefetchNext()` and `ensureAhead()` are both permanently dead (`indexOf(current) < 0`).
- `removeFromQueue` calls `persist()`, which writes `current` and the current-less `queue`
  to localStorage — so a reload `restore()`s the **same broken state**.

`clearQueue()` directly above it explicitly guards this invariant ("never-stop: current
survives"), confirming the intent that `removeFromQueue` violates.
**Fix:** Guard the current track in the store (mirror `clearQueue`'s posture), e.g.:
```ts
removeFromQueue(uid: string) {
	if (uid === this.current?.uid) return; // never-stop: current survives (or advance first)
	this.removedUids.add(uid);
	this.manualUids.delete(uid);
	this.queue = this.queue.filter((t) => t.uid !== uid);
	this.persist();
}
```
and/or disable the gesture on the playing row in NowPlaying:
```svelte
use:swipeRemove={{ onremove: () => player.removeFromQueue(track.uid), enabled: track.uid !== player.current?.uid }}
```
(If "remove current = skip to next" is the desired UX instead, call `this.next()` before
filtering — but the silent dead-end must not ship.)

## Warnings

### WR-01: swipeRemove does not suppress the trailing click after a committed horizontal drag

**File:** `src/lib/actions/swipeRemove.ts:84-109` (used at `src/lib/components/NowPlaying.svelte:747`)
**Issue:** Unlike `dragClose` (whose host node carries no `onclick`), `swipeRemove` is
attached directly to the queue-row `<button>` that owns the tap-to-play `onclick`. Once a
horizontal drag commits, `setPointerCapture` retargets the trailing `click` to this same
node — and the action never calls `preventDefault()`/click-suppression on release. On mouse
input (desktop, the app is "responsive up to desktop"), a `click` fires after **every**
mousedown→mouseup regardless of travel distance, so:

- a drag past the threshold removes the track **and then immediately plays it**
  (`player.play(track, { fresh: true })` — which also regenerates the queue), and
- a spring-back partial drag still fires tap-to-play even though the user clearly dragged.

Touch input is usually safe only because mobile browsers suppress click after movement —
the action's own "tap contract" relies on that incidental behavior instead of enforcing it.
**Fix:** Track "this gesture was a committed drag" and swallow the next click in capture
phase:
```ts
function suppressClick(e: MouseEvent) {
	e.stopPropagation();
	e.preventDefault();
	node.removeEventListener('click', suppressClick, true);
}
// in up(), when `captured` was true at release:
node.addEventListener('click', suppressClick, true);
```
(Also add a test: "committed drag does not fire the row onclick".)

### WR-02: Tapping the new Clear-queue button also toggles the sheet state

**File:** `src/lib/components/NowPlaying.svelte:453-497, 727-735`
**Issue:** The Clear button (QUEUE-05) lives inside `nav.subnav`, whose
`onpointerdown={gripDown}` handles every press. `gripDown` resolves
`(e.target).closest('.subnav button')` — which **matches the Clear button** — and reads
`btn.dataset.tab as Tab`. Clear has no `data-tab`, so `gripStartTab` becomes `undefined`
(not `null`). In `gripUp`'s tap path, `if (gripStartTab)` is falsy, so the tap falls through
to the **generic grip toggle**: `sheetState = closed→half / half→closed / full→half`. Net
effect: tapping Clear clears the queue *and* snaps the sheet to a different state (e.g.
half-open queue collapses to closed the moment the user clears it).
**Fix:** Exclude non-tab subnav buttons from the generic toggle, e.g. in `gripUp`'s tap
branch:
```ts
const onSubnavButton = gripStartTab !== null; // set gripStartTab only for buttons WITH data-tab…
```
…and in `gripDown`:
```ts
const btn = (e.target as HTMLElement).closest('.subnav button[data-tab]') as HTMLElement | null;
gripStartTab = btn ? (btn.dataset.tab as Tab) : null;
const isPlainButton = !!(e.target as HTMLElement).closest('.subnav button:not([data-tab])');
// when isPlainButton: skip the generic toggle in gripUp (let the button's own onclick act alone)
```

### WR-03: Client Deezer cache negative-caches misses, timeouts, and aborts for up to 7 days

**File:** `src/lib/services/deezer.ts:152-155, 170-173, 191-201, 218-228, 267-276, 294-305`
**Issue:** `cached()` (ttl-cache.ts) deliberately caches only *resolved* values so "a
rejection is NOT cached (the next call retries)". But every Deezer client function is
never-throws **inside** the `cached()` factory: a network failure, a 6 s timeout, *or a
caller-initiated abort* resolves to `null`/`[]`, which is then cached under the 7-day
(`TTL_COVER`/`TTL_ARTIST`) or 6-hour keys. Consequences:

- An aborted backfill (routine — the home cover pool aborts on navigation) pins that
  cover/artist/album as "no result" for the rest of the session; it can never resolve again
  without a reload. The deezer.test.ts `afterEach` comment ("a prior (possibly null) result
  … does not leak") acknowledges the mechanism but the production path keeps it.
- A single timeout on `deezerArtist`/`deezerAlbum` (new in this phase) silently hides the
  artist/album Deezer section for the whole session — contradicting the same feature's
  server-side T-17-13 rule ("a transient upstream failure pinned … is worse UX").

**Fix:** Don't cache sentinel failures — either throw inside the factory and catch outside:
```ts
return cached(key, TTL_ARTIST, async () => {
	const res = await fetch(url, { signal: combinedSignal(signal) }); // let abort/timeout REJECT
	if (!res.ok) throw new Error(String(res.status));
	return (await res.json()) as DeezerArtistInfo;
}).catch(() => null);
```
or at minimum perform the abort check / pass the caller signal *outside* `cached()` so an
abort never reaches the factory.

### WR-04: Edge proxies cache Deezer 200-with-error-body responses as an all-null reshape for 24 h

**File:** `src/routes/api/deezer/artist/+server.ts:106-123`, `src/routes/api/deezer/album/+server.ts:128-151`
**Issue:** Step 2 (`artist/{id}` / `album/{id}`) never checks `res.ok` and never validates
that the parsed body is a real entity. Deezer signals rate-limiting as **HTTP 200 with**
`{"error":{"type":"Exception","message":"Quota limit exceeded"}}` — that body parses fine,
every optional field nullish-coalesces to `null`, and the resulting
`{picture:null,fans:null,albums:null}` is treated as "a successful reshape" and written to
the edge cache with `max-age=86400`. A quota blip during a traffic spike pins an empty
artist/album section for 24 hours per name — exactly the failure mode the file's own
T-17-13 comment says must not be cached ("a hard miss returns the empty shape WITHOUT a
long TTL").
**Fix:** Cache only when the by-id response is ok *and* identifies a real entity:
```ts
const byIdRes = await fetchWithRetry(byIdUrl, { signal: AbortSignal.timeout(8000) }, 2);
if (!byIdRes.ok) return jsonResult(EMPTY, origin);
const dz = (await byIdRes.json()) as DzArtist;
if (dz?.id == null) return jsonResult(EMPTY, origin); // error-body / quota → no cache, no TTL
```

### WR-05: reorderQueue does not persist — a reload silently loses the user's reorder

**File:** `src/lib/stores/player.svelte.ts:1411-1421`
**Issue:** Every other queue mutation (`setQueue`, `playNext`, `addToQueue`,
`removeFromQueue`, `clearQueue`, `toggleShuffle`, `cycleRepeat`) ends with `this.persist()`.
`reorderQueue` — the drop handler of the Up-Next grip drag — does not, so the reordered
queue only reaches localStorage if some *other* persisting event happens before the user
reloads/closes the tab. A user who reorders and then refreshes gets the old order back.
**Fix:** Append `this.persist();` after `this.manualUids.add(moved.uid);`.

### WR-06: playAlbum races player.regenerate — the album queue can be clobbered by generated picks

**File:** `src/routes/(app)/album/[name]/+page.svelte:245-259` (interacting with `src/lib/stores/player.svelte.ts:1079-1125`)
**Issue:** `playAlbum()` calls `player.playStub(..., 'album')` — which internally
`setQueue([first], 'album')` + `play(first, { fresh: true })`. With the roadmap-locked
global default (`'generated'`, and no per-context override for `album`), that fresh play
fires `void this.regenerate(first)` (network-bound, seconds). Meanwhile `playAlbum` awaits
`resolveAllCached()` (also seconds) and then `player.setQueue(all, 'album')`. Whichever
settles last wins the queue:

- regenerate last → the user's explicit "play this album" queue is **replaced by
  genre-similar generated tracks** (album tracks are not in `manualUids`, so regenerate
  drops them all);
- setQueue last → the regenerate result is discarded (harmless but wasted work).

**Fix:** Make the intent explicit instead of racing: pass the album list as the queue before
playing (resolve first track, `setQueue` synchronously, then `play(first, {fresh:true})`
only after the queue is final), or suppress regeneration for this flow (e.g.
`play(first, { fresh: false })` after an explicit `setQueue(all, 'album')`), or have
`setQueue` bump a queue-generation that `regenerate` re-checks before assigning
`this.queue`.

### WR-07: downloadAlbum temporarily mutates the global defaultQuality setting

**File:** `src/routes/(app)/album/[name]/+page.svelte:266-316`
**Issue:** `downloadAlbum()` swaps `settings.defaultQuality = settings.downloadQuality` for
the duration of a potentially minutes-long loop (N tracks × resolve + fetch + 250 ms
stagger). During that window:

- Any concurrent playback resolve (auto-advance, prefetchNext, a tap on another page —
  playback continues while downloading) resolves at the *download* tier (e.g. lossless)
  instead of the user's streaming tier, defeating the D-03 fast-resolve default.
- Any code path that calls `settings.save()` during the window (the user toggling any
  setting, another component's slider) **persists** the download tier as the streaming
  default; the `finally` restore then writes back in-memory but nothing re-saves unless
  another save happens — and if the tab is killed mid-loop, the wrong value is what's on
  disk.

**Fix:** Thread the quality through the resolve call instead of mutating shared state — give
`ensureTrackDetails` an options/quality parameter (or a scoped resolver) so the download
path requests `settings.downloadQuality` explicitly without touching
`settings.defaultQuality`.

### WR-08: resolvedCache / albumLiked are not reset when the album route param changes

**File:** `src/routes/(app)/album/[name]/+page.svelte:193, 228-241`
**Issue:** `tracks`, `enrich`, and `dz` are all race-guarded on the `name|artist` key and
reset when the param changes, but `resolvedCache` (and `busyAction`) are not. SvelteKit
reuses the same component instance for same-route param navigation (e.g. history
back/forward between two visited albums, or any future album→album link), so after a param
change `resolvedCache` still holds the *previous* album's resolved tracks.
`resolveAllCached()` then short-circuits on the stale non-empty cache: Like/Download/
Add-to-playlist would **like, download, or playlist the wrong album's tracks**, and
`albumLiked` renders the previous album's heart state.
**Fix:** Reset it in the tracklist effect alongside `tracks = []`:
```ts
loadedFor = key;
tracks = [];
resolvedCache = null;
```

### WR-09: Stale lyric translations render against a new track when line counts match

**File:** `src/lib/components/NowPlaying.svelte:188-229`
**Issue:** The translation effect computes a new `trKey` on track change and kicks off
`translateLines`, but never clears the previous `translated` array while the new request is
in flight. The render gate is `showTr = translated.length === lines.length` — a pure length
comparison. When the new track's (split) line count happens to equal the previous track's,
`showTr` stays true and the **previous song's translations** render under the new song's
lyric lines for the multi-second duration of the translate round-trip (in `replace` mode the
old translations fully replace the new lyrics text).
**Fix:** Reset the buffer when the key changes:
```ts
trKey = key;
translated = [];   // invalidate the previous track's output immediately
translating = true;
```

### WR-10: defaults.ts claims to drive Settings class-field init, but most fields hardcode their own literals

**File:** `src/lib/config/defaults.ts:1-8` vs `src/lib/stores/settings.svelte.ts:52, 93-183, 201-268`
**Issue:** The file header states "Edit this file to change what new users see + what
reset-to-default reverts to. The Settings class … reads from these consts on class-field
init AND on the reset-group methods." That is true only for the up-next fields
(`UPNEXT_DEFAULTS.mode`). Everything else is duplicated as literals:
`defaultQuality = $state('128')`, `accent = $state(DEFAULT_ACCENT)` (a *second*, local
`DEFAULT_ACCENT` at settings.svelte.ts:52 shadowing the exported one in defaults.ts:25),
`fontScale* = $state(100)`, `theme = 'dark'`, plus all the `?? '…'` fallbacks in `load()`.
Editing `defaults.ts` therefore changes only the reset behavior, not first-visit defaults or
load-fallbacks — the documented single source of truth silently diverges into three places
(class init, load() fallbacks, reset methods).
**Fix:** Initialize fields from the consts (e.g.
`defaultQuality = $state<DefaultQuality>(PLAYBACK_DEFAULTS.defaultQuality)`,
`accent = $state(GENERAL_DEFAULTS.accent)`), delete the duplicate local `DEFAULT_ACCENT`,
and use the same consts as `load()` fallbacks — or correct the defaults.ts header so it
stops promising behavior the code does not have.

## Info

### IN-01: upnextPerContext values are not validated on load (keys/modes pass through unchecked)

**File:** `src/lib/stores/settings.svelte.ts:217-227`
**Issue:** `upnextMode` is validated against the 2-value union, but `upnextPerContext` gets
only the object/not-array shape guard — tampered values (`{liked:'bogus'}`) or unknown keys
survive into state and `save()`. `effectiveUpnextMode` then returns the bogus string, which
the play() branch treats as not-'generated' (silent same-list degradation).
**Fix:** Filter entries on load: keep only known context keys whose value is
`'same-list' | 'generated'`.

### IN-02: `{#each results as t}` shadows the imported i18n `t()` in the search results block

**File:** `src/routes/(app)/search/+page.svelte:382`
**Issue:** Inside the each block, `t` is the Track, not the translation function. No current
call site breaks, but any future `t('…')` added inside the block (a very natural edit in
this file, which calls `t()` 15+ times elsewhere) becomes a runtime error.
**Fix:** Rename the iterator (`{#each results as track (track.uid)}`) to match every other
list in the codebase.

### IN-03: Local variables shadow the imported `names` store in artist and library pages

**File:** `src/routes/(app)/artist/[name]/+page.svelte:206`, `src/routes/(app)/library/+page.svelte:57`
**Issue:** `const names = await getSimilarArtists(n)` / `const names = library.favArtists`
shadow the `names` display-name store imported at the top of both files. Within those
scopes, `names.dnArtist(...)` would silently misresolve if added later.
**Fix:** Rename to `similarNames` / `favNames`.

### IN-04: swipeRemove leaves inline style residue on yielded/no-op gestures

**File:** `src/lib/actions/swipeRemove.ts:67, 100-107`
**Issue:** `down()` sets `node.style.transition = 'none'`; the vertical-yield path
(`dragging = false` in `move()`) and the remove path both exit without restoring it (the
remove path also leaves the last `transform`/`opacity` applied — visible as a stuck
half-faded row if `onremove` ever no-ops, e.g. post-CR-01 guard). Tap releases also write
`transform: translateX(0)` + `opacity: 1` inline on every tap.
**Fix:** Call `resetTransform()` on the remove path (mirroring `dragClose.up()`'s
`resetTransform(); onclose();` order) and clear `transition` when going passive on vertical
yield.

### IN-05: Phase-17 i18n keys are untranslated English in all non-English dictionaries

**File:** `src/lib/i18n/ar.ts:276-291` (same block in de/es/fr/it/hi/…)
**Issue:** The new keys (`settings.upnextSourcing`, `settings.upnextSameList`,
`settings.upnextGenerated`, `settings.ctx*`, `nowplaying.clearQueue`, `deezer.*`) carry
English placeholder values in every non-English dictionary (e.g. ar.ts mixes RTL Arabic with
'Up-next sourcing'), while neighboring keys in the same files are translated.
**Fix:** Translate the Phase-17 block per locale, or track it as known debt.

---

_Reviewed: 2026-06-10T17:01:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
