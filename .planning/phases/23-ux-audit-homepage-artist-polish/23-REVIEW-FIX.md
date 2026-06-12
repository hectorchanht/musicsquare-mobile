---
phase: 23-ux-audit-homepage-artist-polish
fixed_at: 2026-06-12T04:58:45Z
review_path: .planning/phases/23-ux-audit-homepage-artist-polish/23-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-06-12T04:58:45Z
**Source review:** .planning/phases/23-ux-audit-homepage-artist-polish/23-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (1 Critical + 8 Warning; fix_scope = critical_warning, 10 Info findings out of scope)
- Fixed: 9
- Skipped: 0

Every fix was verified with a full `svelte-check` run (0 errors, 0 warnings) before its commit.

## Fixed Issues

### CR-01: Unvalidated `homeLandingTab` reaches `LANDING_PATHS[...]` → 404 on every launch

**Files modified:** `src/lib/stores/settings.svelte.ts`, `src/routes/(app)/+layout.svelte`
**Commit:** d8eda97
**Applied fix:** `settings.load()` now validates `homeLandingTab` against the explicit `'home' | 'search' | 'library'` union (same pattern as `theme`/`upnextMode`) instead of a bare cast. Defense-in-depth in the layout: the redirect only fires when `LANDING_PATHS[...]` resolves to a real non-`'/'` path, so `goto(undefined)` can never occur.

### WR-01: CompactPager index-keyed rows + non-resetting `resolvedCover` show the wrong cover

**Files modified:** `src/lib/components/CompactPager.svelte`, `src/lib/components/CompactRow.svelte`, `src/routes/(app)/+page.svelte`
**Commit:** 8d7685b
**Applied fix:** CompactPager gains a required `key: (item: T) => string` prop and keys its inner row loop by item identity instead of index; all four home call sites pass keys (`track.uid`, `artist + ' ' + title`, artist `name`). Defense-in-depth: CompactRow resets `resolvedCover` in an `$effect` keyed on `seed` so a reused instance can never paint the previous track's art.

### WR-02: `inflightGuard.shouldRun` is dead code

**Files modified:** `src/routes/(app)/charts/top/+page.svelte`, `src/routes/(app)/charts/tags/[tag]/+page.svelte`, `src/routes/(app)/charts/countries/[country]/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`
**Commit:** b17517c (shared with WR-03 — one code change resolves both findings)
**Applied fix:** Took the review's first option: wired `shouldRun` into the async swipe/commit handlers it was written for (see WR-03). The module is no longer dead code — it now has four real consumers.

### WR-03: Async swipe commits have no in-flight guard

**Files modified:** `src/routes/(app)/charts/top/+page.svelte`, `src/routes/(app)/charts/tags/[tag]/+page.svelte`, `src/routes/(app)/charts/countries/[country]/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`
**Commit:** b17517c
**Applied fix:** Each page gains a `swipeInFlight = $state(new Set<string>())`. `swipeQueue`/`swipeLike` guard per row+action key (`q:`/`l:` prefix on `rowKey(it)` / `stubUid(stub)`) via `shouldRun`, add the key with reassign-for-reactivity, and clear it in `finally` (re-enabled on both resolve and throw, per the inflightGuard contract).

### WR-04: Chart-page liked reveal computed from constant `uid: ''` — always false

**Files modified:** `src/routes/(app)/charts/top/+page.svelte`, `src/routes/(app)/charts/tags/[tag]/+page.svelte`, `src/routes/(app)/charts/countries/[country]/+page.svelte`
**Commit:** a9be2a0
**Applied fix:** Took the review's first option: a `likedRows = $state<Record<string, boolean>>({})` per page, written after a `swipeLike` resolve lands (`likedRows[rowKey(it)] = !wasLiked`); the template reads `likedRows[rowKey(it)] ?? false` instead of allocating a stub per row to read a constant. Status: fixed — requires human verification (logic/state-handling change: the reveal Heart now reflects in-session swipe-likes only, which is the review's prescribed semantics for stub rows, but worth a manual glance).

### WR-05: artist-albums proxy negative-caches transient Deezer failures for 24 h

**Files modified:** `src/routes/api/deezer/artist-albums/+server.ts`
**Commit:** 5931b41
**Applied fix:** Both upstream calls now check `res.ok` and the Deezer 200-with-`{"error":{…}}` quota envelope before any reshape/cache: a non-ok or error-envelope response returns best-effort `EMPTY` with NO `cache.put`, matching the route's design comment and the T-17-13 no-negative-caching posture. Genuine "no artist match" / real empty album lists still cache for the full TTL.

### WR-06: Artist page local toast + album page mixing two toast systems (D-15 violation)

**Files modified:** `src/routes/(app)/artist/[name]/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`
**Commit:** 2a6476b
**Applied fix:** Removed both pages' local `toastMsg`/`toastTimer`/`toast()` plus the `.toast` markup and styles. Artist page now imports and calls `toast.show(...)` from `$lib/stores/toast.svelte` (and drops the now-unused `fly` import); album page routes ALL feedback (success and failure paths) through its existing `globalToast.show(...)`, so a single gesture never surfaces feedback through two pipelines.

### WR-07: Focus containment incomplete — sub-sheets lack `use:focusTrap`, nested traps leak Tab

**Files modified:** `src/lib/actions/focusTrap.ts`, `src/lib/components/TrackMenu.svelte`, `src/routes/(app)/album/[name]/+page.svelte`
**Commit:** b31934d
**Applied fix:** Added `use:focusTrap` to the TrackMenu playlist-picker sheet, the TrackMenu detail modal, and the album page's playlist picker. `focusTrap.onKeydown` now calls `e.stopPropagation()` after matching Tab so when traps nest (TrackMenu inside the trapped NowPlaying) only the innermost mounted trap arbitrates the cycle.

### WR-08: NowPlaying global Space shortcut hijacks Space-activation of focused buttons

**Files modified:** `src/lib/components/NowPlaying.svelte`
**Commit:** 09fad8c
**Applied fix:** The window keydown handler now lets focused interactive elements win Space: if `e.target` is a `<button>` or has `role="button"`/`role="slider"`, the handler returns without `preventDefault`, restoring platform-conventional Space activation; Space anywhere else still toggles play/pause.

---

_Fixed: 2026-06-12T04:58:45Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
