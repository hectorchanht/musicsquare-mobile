---
phase: 17-up-next-sourcing-settings-plumbing
fixed_at: 2026-06-10T17:45:18Z
review_path: .planning/phases/17-up-next-sourcing-settings-plumbing/17-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-06-10T17:45:18Z
**Source review:** .planning/phases/17-up-next-sourcing-settings-plumbing/17-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (fix_scope: critical_warning — CR-01 + WR-01..WR-10; IN-01..IN-05 out of scope)
- Fixed: 11
- Skipped: 0

Every fix was verified with `pnpm check` (svelte-check: 0 errors / 0 warnings, matching the
clean baseline) and the full `pnpm test` suite after each commit. Test count grew from the
534-test baseline to 543 (9 new regression tests added alongside the fixes). All fixes were
applied in an isolated git worktree and fast-forwarded onto `main`.

## Fixed Issues

### CR-01: Swiping away the currently playing track breaks the never-stop chain

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/components/NowPlaying.svelte`, `src/lib/stores/player.svelte.test.ts`
**Commit:** f5dcc12
**Applied fix:** Both layers of the review's suggested fix: `removeFromQueue()` now early-returns
when `uid === this.current?.uid` (mirroring `clearQueue`'s "never-stop: current survives"
invariant), and NowPlaying passes `enabled: track.uid !== player.current?.uid` to
`use:swipeRemove` so the gesture is inert on the playing row. One pre-existing test asserted
the old contract (it relied on the mocked `play()` making the swiped track current) and was
updated; a new regression test pins the no-op-on-current guard (queue unchanged, uid NOT
session-excluded).

### WR-01: swipeRemove does not suppress the trailing click after a committed drag

**Files modified:** `src/lib/actions/swipeRemove.ts`, `src/lib/actions/swipeRemove.test.ts`
**Commit:** fefbdba
**Applied fix:** Added a capture-phase, one-shot `suppressClick` handler armed in `up()` whenever
the gesture had captured (both the remove path and the spring-back path). It self-removes after
one click, is disarmed on the next `pointerdown` (so a touch release whose click was natively
suppressed can't swallow a later genuine tap), and is dropped in `destroy()`. Three new tests:
committed-drag click suppressed, spring-back click suppressed, tap arms no suppressor.

### WR-02: Tapping the Clear-queue button also toggles the sheet state

**Files modified:** `src/lib/components/NowPlaying.svelte`
**Commit:** 197d8b0
**Applied fix:** `gripDown` now resolves `.subnav button[data-tab]` (so Clear no longer produces
an `undefined` gripStartTab) and records a `gripStartPlainButton` flag for non-tab subnav
buttons. `gripUp`'s tap path returns early for plain buttons, letting their own `onclick` act
alone instead of falling through to the generic closed/half/full toggle.
**Status note:** fixed: requires human verification — gesture arbitration in a .svelte component
has no unit-test harness; please manually confirm: tapping Clear clears the queue WITHOUT the
sheet snapping, and tapping the tabs/grip still toggles as before.

### WR-03: Client Deezer cache negative-caches misses, timeouts, and aborts for up to 7 days

**Files modified:** `src/lib/services/deezer.ts`, `src/lib/services/deezer.test.ts`
**Commit:** 45987c0
**Applied fix:** (Security threat T-17-13.) Restructured every `cached()` factory in the file —
`deezerChart`, `deezerSongCover`, `deezerArtistCover`, `deezerSearchTopN`,
`deezerRelatedArtists`, `deezerArtist`, `deezerAlbum` — so a transient failure (non-ok,
timeout, caller abort, malformed JSON) REJECTS inside the factory (ttl-cache never stores
rejections) and the null/[] sentinel mapping moved OUTSIDE via `.catch()`. The private
`fetchDeezer` helper became `fetchDeezerOrThrow`. A genuine 200 answer (even `{cover:null}`)
is still cached. Note: the review cited six functions; `deezerChart` shares the identical
mechanism in the same file ("every Deezer client function") and was included. Three new tests
pin: failed deezerArtist retries, thrown deezerAlbum retries, successful-null IS memoized.

### WR-04: Edge proxies cache Deezer 200-with-error-body responses as an all-null reshape for 24h

**Files modified:** `src/routes/api/deezer/artist/+server.ts`, `src/routes/api/deezer/album/+server.ts`
**Commit:** 8ccf525
**Applied fix:** (Security threat T-17-13.) In both routes' by-id step (step 2): added
`if (!byIdRes.ok) return jsonResult(EMPTY, origin);` and, after parsing,
`if (dz?.id == null) return jsonResult(EMPTY, origin);` — a quota/rate-limit error body
(HTTP 200 + `{"error":{…}}`) carries no entity id, so it now returns the empty shape WITHOUT
`cache.put` and WITHOUT a Cache-Control TTL, exactly per the files' own T-17-13 comment.

### WR-05: reorderQueue does not persist — a reload silently loses the user's reorder

**Files modified:** `src/lib/stores/player.svelte.ts`
**Commit:** 7ddc0ee
**Applied fix:** Appended `this.persist();` after `this.manualUids.add(moved.uid);` in
`reorderQueue`, matching every other queue mutation.

### WR-06: playAlbum races player.regenerate — the album queue can be clobbered by generated picks

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** 5f362d0
**Applied fix:** Implemented the review's third suggested option (store-level, most robust): a
private monotonic `queueGen` bumped by every explicit `setQueue()`; `regenerate()` snapshots it
before `await buildSimilarQueue(...)` and discards its result if the generation moved — so
playAlbum's `setQueue(all, 'album')` always wins regardless of settle order, while the normal
fresh-play regeneration path is unchanged. New regression test holds `buildSimilarQueue` open,
lands an explicit `setQueue` mid-flight, and asserts the album queue survives.

### WR-07: downloadAlbum temporarily mutates the global defaultQuality setting

**Files modified:** `src/lib/sources/types.ts`, `src/lib/sources/qq.ts`, `src/lib/sources/kuwo.ts`, `src/lib/sources/joox.ts`, `src/lib/services/catalog.ts`, `src/lib/services/catalog.test.ts`, `src/routes/(app)/album/[name]/+page.svelte`, `src/lib/components/TrackMenu.svelte`
**Commit:** dbe9078
**Applied fix:** Threaded quality through the resolve chain per the review's fix: the
`SourceAdapter.resolve` contract gained an optional `quality?: DefaultQuality` param (type-only
import — no runtime cycle), `ensureTrackDetails(track, signal?, quality?)` forwards it, and
the three quality-aware adapters (qq `pickBestPlayUrl`, kuwo `level`, joox `pickJooxPlayUrl`)
use `quality ?? settings.defaultQuality`. `downloadAlbum` (the cited finding) AND
`TrackMenu.doDownload` (the identical temporary-swap pattern the album code was copied from)
now pass `settings.downloadQuality` explicitly — no shared-state mutation, no mid-window
`save()` persistence hazard, streaming resolves untouched when the param is absent. New
contract test asserts the quality reaches the adapter's third argument.

### WR-08: resolvedCache / albumLiked are not reset when the album route param changes

**Files modified:** `src/routes/(app)/album/[name]/+page.svelte`
**Commit:** 4973a8a
**Applied fix:** The tracklist `$effect`'s param-change branch now resets `resolvedCache = null`
and `busyAction = null` alongside `tracks = []`, so Like/Download/Add-to-playlist can never act
on the previous album's resolved tracks and `albumLiked` recomputes from scratch.
**Status note:** fixed: requires human verification — route-component state has no unit-test
harness; please manually confirm album→album history navigation shows the correct heart state
and Like/Download act on the visible album.

### WR-09: Stale lyric translations render against a new track when line counts match

**Files modified:** `src/lib/components/NowPlaying.svelte`
**Commit:** c9352e9
**Applied fix:** The translation `$effect` now sets `translated = []` immediately after
`trKey = key`, invalidating the previous track's output before the new `translateLines`
round-trip — the `translated.length === lines.length` render gate can no longer pass with the
old song's lines.
**Status note:** fixed: requires human verification — no component test harness; please
manually confirm switching tracks with translations on never shows the previous song's
translated lines (especially in `replace` mode).

### WR-10: defaults.ts claims to drive Settings class-field init, but most fields hardcode literals

**Files modified:** `src/lib/stores/settings.svelte.ts`
**Commit:** 978910a
**Applied fix:** Took the review's primary option (make the code match the documented contract):
every `$state` class-field initializer now reads from the `GENERAL_/APPEARANCE_/TRANSLATION_/
PLAYBACK_/HOME_DEFAULTS` consts; every `load()` fallback reads the same consts (booleans use a
`typeof === 'boolean'` guard so a tampered value still falls back to the const; the documented
`?? true` posture for the home-chrome booleans is preserved via the consts); the duplicate
local `DEFAULT_ACCENT` shadowing the exported one was deleted; the now-unused
`DEFAULT_SECTION_ORDER`/`SHELF_DEFAULT`/`DEFAULT_HOME_TAGS`/`DEFAULT_HOME_COUNTRIES` imports
were dropped (HOME_DEFAULTS derives from those pools, keeping the single source). All defaults
are value-identical to the previous literals — no behavior change for users; verified by the
existing settings.svelte.test.ts suite.

## Skipped Issues

None — all 11 in-scope findings were fixed.

---

_Fixed: 2026-06-10T17:45:18Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
