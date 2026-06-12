---
phase: 23-ux-audit-homepage-artist-polish
reviewed: 2026-06-12T04:38:06Z
depth: standard
files_reviewed: 47
files_reviewed_list:
  - src/lib/actions/focusTrap.ts
  - src/lib/actions/inflightGuard.test.ts
  - src/lib/actions/inflightGuard.ts
  - src/lib/actions/swipeAction.test.ts
  - src/lib/actions/swipeAction.ts
  - src/lib/components/CompactPager.svelte
  - src/lib/components/CompactRow.svelte
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/SleepTimerSheet.svelte
  - src/lib/components/ToastHost.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/config/defaults.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/services/deezer.test.ts
  - src/lib/services/deezer.ts
  - src/lib/services/home-layout.test.ts
  - src/lib/services/home-layout.ts
  - src/lib/stores/settings.svelte.test.ts
  - src/lib/stores/settings.svelte.ts
  - src/lib/stores/toast.svelte.ts
  - src/lib/util/haptics.test.ts
  - src/lib/util/haptics.ts
  - src/routes/(app)/+layout.svelte
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/charts/countries/[country]/+page.svelte
  - src/routes/(app)/charts/tags/[tag]/+page.svelte
  - src/routes/(app)/charts/top/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/settings/home/+page.svelte
  - src/routes/api/deezer/artist-albums/+server.ts
findings:
  critical: 1
  warning: 8
  info: 10
  total: 19
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-06-12T04:38:06Z
**Depth:** standard
**Files Reviewed:** 47
**Status:** issues_found

## Summary

Reviewed all 47 Phase 23 files: the new gesture/a11y actions (swipeAction, focusTrap, inflightGuard), the compact home pager components, the three new chart pages, the artist-album gating client + edge proxy, the settings/toast/haptics stores, and the 15 i18n dictionaries.

The strongest work is in the pure layers: `home-layout.ts` resolvers, `deezer.ts` cache posture, `swipeAction`'s gesture arbitration (well tested), and the artist-albums proxy's SSRF/URL-injection guards are all solid. A scripted cross-check of all 15 locale files confirmed **identical 302-key sets with no duplicates** — the wave-2 i18n merge is clean.

Key concerns found:

1. **Corrupt persisted `homeLandingTab` breaks the landing redirect on every launch** — the one enum the layout dereferences into a path table is the one enum `settings.load()` never validates, violating the project's own T-w87-05 invariant (CR-01).
2. The compact pager keys rows by **index**, while `CompactRow` keeps a never-reset `resolvedCover` and `lazyCover` is one-shot — after a Randomize, library compact rows can show the **previous track's cover art** permanently (WR-01).
3. `inflightGuard.shouldRun` — the centerpiece of the D-16 double-fire protection — is **dead code**: nothing imports it, and the new async swipe commits it was built for are unguarded (WR-02/WR-03).
4. The new edge proxy **negative-caches transient Deezer failures for 24 h**, contradicting the WR-03 no-negative-caching posture the same phase pins in client tests (WR-05).
5. The artist page **reintroduces a local toast** the same phase's D-15 explicitly consolidated away (WR-06).

## Critical Issues

### CR-01: Unvalidated `homeLandingTab` reaches `LANDING_PATHS[...]` → `goto(undefined → "/undefined")` on every app launch

**File:** `src/lib/stores/settings.svelte.ts:290` and `src/routes/(app)/+layout.svelte:107-113`
**Issue:** `settings.load()` validates `theme` and `upnextMode` against their unions, but assigns `homeLandingTab` with a bare cast:

```ts
this.homeLandingTab = (v.homeLandingTab as HomeLandingTab) ?? HOME_DEFAULTS.homeLandingTab;
```

Any persisted garbage string (corrupt write, manual tamper, version skew — exactly the threat T-w87-05 declares in scope: "localStorage is an untrusted input … must NEVER break the home page's first paint") passes the layout's only guard (`settings.homeLandingTab !== 'home'`), so the layout executes `goto(LANDING_PATHS[garbage], { replaceState: true })` where `LANDING_PATHS[garbage] === undefined`. `goto(undefined)` resolves to the relative path `"undefined"` → the app **redirects to the 404 page on every cold start at `/`**, with `replaceState` so Back cannot recover, until the user clears storage. The fixed-lookup-table half of T-w87-05 (no open redirect) was implemented; the validate-before-lookup half was not.
**Fix:**

```ts
// settings.svelte.ts load()
this.homeLandingTab =
	v.homeLandingTab === 'home' || v.homeLandingTab === 'search' || v.homeLandingTab === 'library'
		? v.homeLandingTab
		: HOME_DEFAULTS.homeLandingTab;
```

and/or defense-in-depth in the layout:

```ts
const dest = LANDING_PATHS[settings.homeLandingTab];
if (dest && dest !== '/') goto(dest, { replaceState: true });
```

## Warnings

### WR-01: CompactPager index-keyed rows + non-resetting `resolvedCover` show the WRONG cover after items change

**File:** `src/lib/components/CompactPager.svelte:31-35`, `src/lib/components/CompactRow.svelte:60-61`, consumed at `src/routes/(app)/+page.svelte:829-849`
**Issue:** The pager keys both loops by index (`{#each columns as col, ci (ci)}` / `{#each col as item, ri (ri)}`), so when `items` change (e.g. Randomize rebuilds `likedShelf`/`downloadsShelf`/`historyShelf`), Svelte **reuses the same `CompactRow` instances** with new props. `CompactRow` holds `let resolvedCover = $state<string | null>(null)` that is never reset when `track` changes, and `effectiveCover = resolvedCover ?? cover` prefers the stale value — so the row shows the **previous track's resolved art over the new track's title**. The repair path is also dead: `lazyCover` is one-shot (`done = true` after first intersection; `update()` only swaps `current`, never re-resolves), so the wrong cover persists until full remount. Affects every `libraryShelf` compact row (the ones that pass `track`).
**Fix:** Key the pager rows by item identity, not index — let the host pass a key, or key on the item itself:

```svelte
{#each col as item, ri (ri)}  →  {#each col as item (keyOf(item))}
```

(e.g. a `key: (item: T) => string` prop; home passes `track.uid` / artist name). Alternatively (defense-in-depth) reset `resolvedCover` inside CompactRow when the identity changes:

```ts
$effect(() => { void seed; resolvedCover = null; });
```

### WR-02: `inflightGuard.shouldRun` is dead code — exported, tested, consumed by nothing

**File:** `src/lib/actions/inflightGuard.ts:13-15`
**Issue:** A repo-wide grep finds zero imports of `shouldRun`/`inflightGuard` outside its own test file. It is also a byte-for-byte semantic duplicate of `shouldStartResolve` in `src/lib/components/track-menu-gate.ts:30-32` (`return !inFlight.has(key)`). The D-16 "double-click-resistant async action" guard the module documents was never wired into any consumer (see WR-03), so the deliverable exists only as a test fixture.
**Fix:** Either wire it into the async swipe/commit handlers it was written for (WR-03), or delete the module + test and reuse `shouldStartResolve`. Two identical one-line helpers with different names will drift.

### WR-03: Async swipe commits (chart + album pages) have no in-flight guard — double-swipe duplicates queue entries and races like-toggles

**File:** `src/routes/(app)/charts/top/+page.svelte:123-144`, `src/routes/(app)/charts/tags/[tag]/+page.svelte:86-101`, `src/routes/(app)/charts/countries/[country]/+page.svelte:87-102`, `src/routes/(app)/album/[name]/+page.svelte:245-259`
**Issue:** `swipeQueue`/`swipeLike` on stub rows `await resolveStub(...)` (a multi-second cross-source search) and then mutate the queue/library. There is no per-row in-flight set: two quick right-swipes on the same row launch **two concurrent resolves and two `player.addToQueue(tr)` calls** (duplicate queue entries); two quick left-swipes launch two concurrent resolves whose `isLiked`/`toggleLike` interleave non-deterministically (toast can report "Liked" twice while the net state is unliked). This is precisely the D-16 scenario `inflightGuard` (WR-02) was created for.
**Fix:** Guard per row key with the existing helper:

```ts
let inFlight = $state(new Set<string>());
async function swipeQueue(it: DiscoveryTrack) {
	const key = `q:${rowKey(it)}`;
	if (!shouldRun(inFlight, key)) return;
	inFlight = new Set(inFlight).add(key);
	try { /* resolve + addToQueue + toast */ }
	finally { const n = new Set(inFlight); n.delete(key); inFlight = n; }
}
```

### WR-04: Chart-page liked reveal is computed from a constant `uid: ''` — always false

**File:** `src/routes/(app)/charts/top/+page.svelte:214,218`, `src/routes/(app)/charts/tags/[tag]/+page.svelte:150,153`, `src/routes/(app)/charts/countries/[country]/+page.svelte:149,152`
**Issue:** `{@const liked = library.isLiked(stubTrack(it).uid)}` — `stubTrack()` always returns `uid: ''`, so `liked` is `library.isLiked('')` → permanently `false`. The `class:on={liked}` on the left swipe-reveal Heart never lights up, even for tracks the user just liked via the very swipe it decorates (the resolved track has a real source uid the stub can never match). The expression also allocates a full stub object per row per render just to read a constant.
**Fix:** Discovery rows cannot know the resolved uid up front. Either track liked state by the resolved uid after a `swipeLike` lands (a `Record<rowKey, boolean>` updated in `swipeLike`), or drop the `class:on` styling from these stub rows (the library/search pages, whose rows are real Tracks, keep it correctly).

### WR-05: artist-albums proxy negative-caches transient Deezer failures as `{ data: [] }` for 24 h

**File:** `src/routes/api/deezer/artist-albums/+server.ts:149-188`
**Issue:** Neither upstream fetch checks `res.ok` or Deezer's 200-with-`{"error":{…}}` quota envelope before reshaping and caching:
- `fetchWithRetry` **returns** (does not throw) a 429/5xx once the retry budget is exhausted (`src/lib/proxy/http.ts:59-66`). Deezer error bodies are valid JSON, so `searchData.data?.[0]?.id` is `undefined` → the code takes the **"no artist match → genuine empty result"** branch and `cache.put`s `EMPTY` with `max-age=86400` (lines 154-166).
- Same on the albums call: a rate-limited/erroring response parses to `{}` → `list = []` → cached `EMPTY` for 24 h (lines 171-187).

So a single rate-limit window pins "this artist has no albums" at the edge for a full day — every client then silently falls back to Last.fm verification. This directly contradicts the route's own design comment ("Upstream error … best-effort empty (NO cache write)") and the WR-03/T-17-13 no-negative-caching posture the same phase's client tests pin (`deezer.test.ts:452-461` only proves the client layer; the edge layer defeats it).
**Fix:** Treat non-ok and the Deezer error envelope as failure (return EMPTY without `cache.put`):

```ts
if (!searchRes.ok) return jsonResult(EMPTY, origin);
const searchData = (await searchRes.json()) as DzArtistSearchResponse & { error?: unknown };
if (searchData.error) return jsonResult(EMPTY, origin);
// …same for albumsRes before the cache.put
```

### WR-06: Artist page reintroduces a local toast (and the album page mixes two toast systems) — violates this phase's own D-15 consolidation

**File:** `src/routes/(app)/artist/[name]/+page.svelte:117-124,485,509`; `src/routes/(app)/album/[name]/+page.svelte:131-139,245-259,580,635`
**Issue:** Phase 23's D-15 deliverable consolidated "the three local `toast()` copies" into the global `toast` store rendered once by `ToastHost` ("so the feedback layer never drifts"). The artist page nonetheless ships a fresh local `toastMsg`/`toastTimer` + `.toast` markup — its comment even cites "same lightweight pattern as TrackMenu / home", both of which were migrated away in this very phase. The album page is worse: its swipe handlers fire `globalToast.show()` on success but the **local** `toast()` on failure (lines 246-259), so the same gesture surfaces feedback through two different pipelines, and both pills render `position: fixed; top: safe-area+14px; z-index: 90` — when a global toast and a local one fire close together they paint on top of each other.
**Fix:** Replace both pages' local `toastMsg`/`toastTimer`/markup/styles with `toast.show(...)` from `$lib/stores/toast.svelte` (mechanical; the artist page already imports nothing conflicting; the album page already imports it as `globalToast`).

### WR-07: Focus containment incomplete — sub-sheets lack `use:focusTrap`, and nested traps leave the background tabbable

**File:** `src/lib/components/TrackMenu.svelte:278,289` (picker + detail sheets), `src/routes/(app)/album/[name]/+page.svelte:589` (album playlist picker), `src/lib/components/NowPlaying.svelte:743` + `TrackMenu.svelte:210` (nesting)
**Issue:** UX-06 §7.3 added `focusTrap` to the main TrackMenu sheet, SleepTimerSheet and NowPlaying — but the TrackMenu **playlist-picker** and **detail** sub-sheets and the album page's playlist picker have `use:dragClose` only, no `use:focusTrap`: Tab walks straight out of those modals into the page behind the scrim. Additionally, when TrackMenu opens inside NowPlaying, two traps nest (TrackMenu is a child of the trapped `.np`); `focusTrap.onKeydown` never calls `stopPropagation`, and a Tab from focus that sits OUTSIDE the menu (e.g. left on a transport button) is handled only by the **outer** trap, cycling through the supposedly-scrimmed background controls. Focus is never permanently lost (T-23-04 holds), but modality is not enforced.
**Fix:** Add `use:focusTrap` to the three sub-sheets (one-line each). For nesting, have `onKeydown` `e.stopPropagation()` after handling Tab so only the innermost mounted trap arbitrates.

### WR-08: NowPlaying global Space shortcut hijacks Space-activation of focused buttons

**File:** `src/lib/components/NowPlaying.svelte:404-426` (interacting with the new `use:focusTrap` at line 743)
**Issue:** The window-level keydown handler intercepts `' '`/`Space` with `e.preventDefault()` whenever focus is not in a text field — including when focus is **on a button**. The new focusTrap guarantees focus always rests on a NowPlaying control (it auto-focuses the first button on mount), so a keyboard/switch user pressing Space to activate the focused Like/Repeat/Collapse button instead gets play-pause toggled and the button never activates (Enter still works, but Space-activates-button is the platform convention `aria-pressed` buttons rely on). This is a regression introduced by combining the pre-existing shortcut with this phase's trap.
**Fix:** Let focused interactive elements win:

```ts
if (e.key === ' ' || e.code === 'Space') {
	const el = e.target as HTMLElement | null;
	if (el instanceof HTMLButtonElement || el?.getAttribute('role') === 'button' || el?.getAttribute('role') === 'slider') return;
	e.preventDefault();
	player.toggle();
}
```

## Info

### IN-01: `resolveSubset` docstring contradicts its implementation (and its tests)

**File:** `src/lib/services/home-layout.ts:158-163`
**Issue:** The JSDoc says "filter `pool` … so the RESULT ORDER follows the pool's canonical order, NOT the selection order", but the implementation (and the inline comment at line 168, and the tests at `home-layout.test.ts:152-155`) deliberately preserve the SAVED selection order — which drives the home shelf order.
**Fix:** Update the docstring; a future "fix" toward the doc would silently break drag-reorder.

### IN-02: Artist page Path-B comment references `deezerAlbum` that the code never calls

**File:** `src/routes/(app)/artist/[name]/+page.svelte:250-252`
**Issue:** The comment claims "deezerAlbum returns nb_tracks when Deezer has the album; otherwise verify via the Last.fm album.getInfo tracklist length", but the verification only calls `getAlbumTracklist`. Comment drift from a dropped design.
**Fix:** Trim the comment to describe the actual single-path verification.

### IN-03: Stale "all three locale files" comment in en.ts

**File:** `src/lib/i18n/en.ts:2-3`
**Issue:** Header says "All three locale files (en / zh-Hant / zh-Hans) MUST expose an IDENTICAL key set" — there are 15 locales now (all verified identical at 302 keys).
**Fix:** "All 15 locale files…".

### IN-04: `favCoversLoaded` never resets — a newly favourited artist keeps the gradient until reload

**File:** `src/routes/(app)/library/+page.svelte:103-120`
**Issue:** `loadFavCovers` short-circuits on the one-shot `favCoversLoaded` flag; the `$effect` re-runs when `library.favArtists` grows, but the early return means the new artist's avatar is never fetched in-session.
**Fix:** Track which names are already fetched (`Set<string>`) instead of a boolean, and fetch only the missing ones.

### IN-05: Global ToastHost and the layout's notice-toast occupy the identical fixed slot

**File:** `src/lib/components/ToastHost.svelte:15` and `src/routes/(app)/+layout.svelte:233-249`
**Issue:** Both render `position: fixed; left:50%; top: safe-area+14px; z-index: 90`. A skip/stopped notice and a `toast.show()` pill visible simultaneously paint on top of each other (the sticky "Playback stopped + Retry" pill can be obscured by a transient toast).
**Fix:** Offset one (e.g. notice-toast `top: +56px` when `toast.msg` is set) or route notices through a stacked host.

### IN-06: Chart rows keyed by `artist + title` — duplicate upstream rows would throw `each_key_duplicate`

**File:** `src/routes/(app)/charts/top/+page.svelte:213`, `…/tags/[tag]/+page.svelte:149`, `…/countries/[country]/+page.svelte:148`
**Issue:** `{#each tracks as it (rowKey(it))}` over a 100-row uncontrolled Last.fm payload: two chart entries with the same `(artist, title)` (re-releases / chart glitches) produce duplicate keys, which Svelte 5 treats as an error and breaks the list render.
**Fix:** Suffix the index into the key (`${rowKey(it)}#${i}`) or de-dupe rows after fetch.

### IN-07: Library `?tab=` / `?playlist=` deep-link params are read once at component init

**File:** `src/routes/(app)/library/+page.svelte:48-78`
**Issue:** `loadInitialTab()`/`loadInitialPlaylist()` run only in the `$state` initializers. SvelteKit reuses the component instance for same-route param navigation (e.g. history back/forward between `/library?tab=liked` and `/library?playlist=x`), so the tab does not follow the URL in that case.
**Fix:** React to `page.url` in an `$effect` (apply the same VALID_TABS validation), or accept and document the one-shot semantics.

### IN-08: Three chart pages are ~200-line near-verbatim copies

**File:** `src/routes/(app)/charts/top/+page.svelte`, `…/tags/[tag]/+page.svelte`, `…/countries/[country]/+page.svelte`
**Issue:** `stubTrack`, `rowKey`, `fallbackCover`, `play`, `openMenu`, `swipeQueue`, `swipeLike`, `minDwell`, the skeleton snippet, and ~90 lines of identical CSS are triplicated. Every fix in this report (WR-03, WR-04, IN-06) must be applied three times — a drift engine.
**Fix:** Extract a shared `ChartTrackList.svelte` (props: `fetch(page): Promise<DiscoveryTrack[]>`, heading) or at minimum a shared `chart-rows.ts` helper module.

### IN-09: Remaining `settings.load()` enum fields use bare casts without union validation

**File:** `src/lib/stores/settings.svelte.ts:214-262,290-291`
**Issue:** `lyricsLang`/`artistLang`/`titleLang`/`lastfmLang`/`bioLang`/`translateMode`/`defaultQuality`/`defaultSource`/`homeDensity` are assigned via `as` casts while `theme` and `upnextMode` get explicit union checks. Unlike CR-01 these all degrade gracefully today (comparisons just miss), but any future `Record[value]` lookup on them recreates CR-01.
**Fix:** Add a small `oneOf(v, [...allowed], def)` helper and use it for every enum field in `load()`.

### IN-10: NowPlaying seek `role="slider"` missing required ARIA value attributes

**File:** `src/lib/components/NowPlaying.svelte:848`
**Issue:** The slider exposes `aria-valuenow` but not `aria-valuemin`/`aria-valuemax` (required for `role="slider"`); screen readers cannot contextualize the 0-100 value.
**Fix:** Add `aria-valuemin={0} aria-valuemax={100}` (and ideally `aria-valuetext={fmtTime(player.currentTime)}`).

---

_Reviewed: 2026-06-12T04:38:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
