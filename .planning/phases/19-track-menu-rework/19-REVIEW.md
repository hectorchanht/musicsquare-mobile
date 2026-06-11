---
phase: 19-track-menu-rework
reviewed: 2026-06-11T06:07:18Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/track-menu-gate.ts
  - src/lib/components/track-menu-gate.test.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/config/defaults.ts
  - src/lib/stores/settings.svelte.ts
  - src/lib/stores/settings.svelte.test.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/i18n/i18n.test.ts
  - src/app.css
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-06-11T06:07:18Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Phase-19 "track-menu rework" diff (`5eec5dd^..HEAD`) against the diff_base: the
TrackMenu gated resolve-then-act rework (MENU-01/D-01..D-12), the Remix queue context
(QUEUE-04), the global tap-highlight reset (MENU-03), and the `onlongpress` blur edits across
the home/search/library/artist/album trigger sites.

The four invariants flagged in the brief all hold:

- **Overlay `$effect` / history invariant** — the menu effect is correctly `open`-only with
  every `overlays.open`/`dismiss` wrapped in `untrack()`. The deliberate exclusion of `track`
  from the dep set (so a stub→resolved reassignment does not churn history) is correct, and the
  three sheet effects (menu/picker/detail) each return a cleanup that is the sole dismiss site.
- **In-flight `Set` reactivity** — `inFlight` is reassigned (`new Set(inFlight).add(key)` /
  `new Set(inFlight); next.delete(key)`) on every mutation, so the Svelte 5 `$state` template
  reads (`inFlight.has(...)`) stay reactive. Correct.
- **`gated()` failure/finally path** — `finally` clears the key on both success and throw, and
  the `!resolved.audioUrl` early-`return` still passes through `finally` (no stuck spinner). The
  pure decisions are unit-tested and pass.
- **`onlongpress` `e.currentTarget` blur** — `(e.currentTarget as HTMLElement)?.blur()` is safe:
  the `longpress` action dispatches the `CustomEvent` synchronously on the node, so
  `currentTarget` is the element during dispatch, and the optional chain guards the null case.

Tooling: `track-menu-gate`, `settings.svelte`, `i18n`, and `player.svelte` test suites all
pass (37 + 76 tests green); `svelte-check` reports 0 errors / 0 warnings across 4100 files.
i18n parity is self-enforced for the new `menu.remix` / `toast.remixing` / `menu.preparing`
keys across all 15 locales. No security issues, no injection vectors, no secrets.

Findings below are quality/robustness items only — none block shipping.

## Warnings

### WR-01: Loading skeleton stacks BELOW the real header instead of replacing it

**File:** `src/lib/components/TrackMenu.svelte:219-246`
**Issue:** The real `.sheet-head` (title/artist marquee + Like/Close cluster) ALWAYS renders
(it is no longer gated by `loading`). The header-only skeleton then renders in a *second*
`.sheet-head` block guarded by `{#if loading && !track.title}`. When a stub with no title is
still resolving, both render: an empty real header (blank title/artist rows plus the action
cluster) immediately followed by the skeleton bars — two stacked header rows. The skeleton was
clearly intended to stand in *for* the missing header, not to appear underneath an empty one.
The comment ("Home stubs usually carry title/artist so this only fills the rare pre-data
instant") concedes this is a narrow window, but the double-header is a visible glitch when it
does occur (e.g. a stub created with `title: ''`).
**Fix:** Make the real header conditional on having content and let the skeleton replace it,
e.g.:
```svelte
{#if loading && !track.title}
	<div class="sheet-head" aria-hidden="true">
		<div class="head-text">
			<div class="sk" style="height:15px;width:65%"></div>
			<div class="sk" style="height:12px;width:45%;margin-top:6px"></div>
		</div>
		<!-- keep the Like/Close cluster here too, or accept it appearing once data lands -->
	</div>
{:else}
	<div class="sheet-head"> … real header … </div>
{/if}
```

### WR-02: `gated()` fast path runs an async callback un-awaited with no error handling or spinner

**File:** `src/lib/components/TrackMenu.svelte:46`
**Issue:** `if (isGatedReady(track)) return void run(track);` short-circuits before the
try/catch/finally and before `inFlight` is touched. `run` may be async (`doDownload` is
`async`). On the fast path the returned promise is discarded via `void`, so: (a) no spinner is
shown, and (b) any rejection becomes an unhandled promise rejection rather than the graceful
`toast(t('toast.noAudio'))` the slow path guarantees. Today `doDownload` internally guards its
own `fetch`/blob in a try/catch and `ensureTrackDetails(...).catch(...)`, so it does not reject
in practice — this is a latent fragility, not a live bug. But the contract "`gated` actions
never leave a stuck/unhandled state" silently does not hold for the fast path, and a future
gated async `run` that can throw would regress here without any signal.
**Fix:** Route the fast path through the same protected await so failure handling is uniform:
```ts
if (isGatedReady(track)) {
	try { await run(track); } catch { toast(t('toast.noAudio')); }
	return;
}
```
(Optionally also flash the spinner on the fast path for visual consistency, though it resolves
instantly.)

### WR-03: `doShare` shares the resolved-or-stub `track`, but Remix/Download/Detail resolve first — Share can emit an unresolved share URL

**File:** `src/lib/components/TrackMenu.svelte:137-148`
**Issue:** `doShare` is NOT gated — it builds `shareUrl(track, player.queue)` directly from the
current `track` prop, which on a home long-press is a discovery STUB (`detailsLoaded:false`,
possibly `audioUrl:null`). Every *other* action that needs a real track (Download/Detail/Remix)
goes through `gated()` to resolve first, but Share does not. Depending on what `shareUrl`
encodes, sharing from a stub may produce a link that omits source/songid/audio data that a
resolved track would carry, yielding a share that the recipient cannot resolve back to the same
track. This is an inconsistency in the "stub is tappable, action resolves on demand" model
introduced this phase.
**Fix:** Confirm `shareUrl` only needs `{artist,title}` (stable on a stub) — if so, document
that Share is intentionally stub-safe. If it encodes uid/source/audio, gate it like the others:
`onclick={() => gated('share', doShare)}` and accept `(resolved: Track)` in `doShare`.

### WR-04: `aria-busy` rows drop their accessible name while NOT busy

**File:** `src/lib/components/TrackMenu.svelte:254, 262, 273`
**Issue:** The three gated rows set `aria-label={inFlight.has(key) ? t('menu.preparing') : undefined}`.
When not busy, `aria-label` is `undefined`, so the accessible name falls back to the button's
visible text (`{t('menu.remix')}` etc.) — that part is fine. But the icon is swapped for a
`<span class="row-spinner">` (no text) while busy, and the *only* thing announcing the busy
state is `aria-label="Preparing…"` replacing the action name. A screen-reader user who focuses
the row mid-resolve hears "Preparing…" but loses *which* action is preparing (Remix vs Download
vs Detail). Minor but it degrades the SR experience the `aria-busy`/`aria-label` wiring was
added to improve.
**Fix:** Keep the action name and append busy state, e.g.
`aria-label={inFlight.has('remix') ? \`${t('menu.remix')} – ${t('menu.preparing')}\` : undefined}`,
or rely on `aria-busy` alone and leave the visible text in place (do not override the name).

## Info

### IN-01: Dead code — `gotoAlbum` and the `Disc` import are unused

**File:** `src/lib/components/TrackMenu.svelte:92-96, 269`
**Issue:** The "Go to album" menu row is commented out (`<!-- <button … gotoAlbum …> -->`), but
the `gotoAlbum()` function (lines 92-96) and the `Disc` icon import (line 5) remain. `Disc` is
imported and never rendered; `gotoAlbum` is defined and never called. `svelte-check` does not
flag these because the function references `goto`/`overlays`/`track` (so it is not trivially
dead to the compiler) and the import is "used" by the commented markup historically.
**Fix:** Either restore the album row or remove `gotoAlbum`, the `Disc` import, and the
commented-out `<button>` (line 269).

### IN-02: `addToPlaylist` toast fires even when no playlist add occurred

**File:** `src/lib/components/TrackMenu.svelte:166`
**Issue:** `function addToPlaylist(id) { if (track) library.addToPlaylist(id, track); pickerOpen = false; toast(t('toast.addedToPlaylist')); }`
— the toast is unconditional, but the actual add is guarded by `if (track)`. If `track` is null
(should not happen given the `{#if pickerOpen && track}` render guard, but the function does not
know that), the user sees "Added to playlist" with nothing added. Pre-existing pattern, low
risk; noting for consistency with the rest of the file which guards toasts behind the mutation.
**Fix:** Move the toast inside the guard: `if (track) { library.addToPlaylist(id, track); toast(...); }`.

### IN-03: Magic skeleton dimensions inline in the template

**File:** `src/lib/components/TrackMenu.svelte:242-243`
**Issue:** Skeleton bar sizes are inline literals (`height:15px;width:65%`,
`height:12px;width:45%;margin-top:6px`). These are meant to mirror `.hd-title` (15px) and
`.hd-artist` (13px) sizes but are hand-copied — if the header font sizes change, the skeleton
silently drifts. Minor maintainability nit.
**Fix:** Optional — derive from the same CSS custom properties / a shared class, or add a comment
tying the literals back to `.hd-title`/`.hd-artist`.

---

_Reviewed: 2026-06-11T06:07:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
