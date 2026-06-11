# Phase 19: Track Menu Rework - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 24 (1 new helper + 1 new test + 1 major component edit + 4 small store/config edits + 6 trigger-site edits + 1 global CSS + 15 i18n dicts + 1 i18n test extend)
**Analogs found:** 24 / 24 (every file has an in-repo analog — this is a rework, not greenfield)

This is a REWORK on a mature, hand-rolled design system. Every "analog" below is a REAL line in the current tree, verified by reading source this session. The executor should pattern-match, not invent.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/components/track-menu-gate.ts` **(NEW)** | utility (pure) | transform | `src/lib/actions/marquee.ts` (`isOverflowing`) + `src/lib/actions/longpress.ts` (`shouldSuppressClickAfterLongpress`) | exact (exported-pure-helper idiom) |
| `src/lib/components/track-menu-gate.test.ts` **(NEW)** | test | transform | `src/lib/actions/marquee.test.ts` | exact |
| `src/lib/components/TrackMenu.svelte` | component | event-driven (UI) + request-response (resolve) | itself (rework) + `NowPlaying.svelte` (header) | exact (self) |
| `src/lib/config/defaults.ts` | config (type) | n/a | existing `QueueContext` union (lines 94–103) | exact |
| `src/lib/stores/settings.svelte.ts` | store | request-response (resolver) | `effectiveUpnextMode` (lines 442–445) | exact (self) |
| `src/lib/stores/player.svelte.ts` | store | event-driven (queue) | `setQueue` (912) + `play(_,{fresh})`→`regenerate` (1276–1327) | exact (reuse, likely zero edit) |
| `src/routes/(app)/+page.svelte` | route (trigger site) | event-driven | itself + `tileMenu` (543–558) | exact (self) |
| `src/routes/(app)/library/+page.svelte` | route (trigger site) | event-driven | `.row:hover` (259) + `openMenu` | exact |
| `src/routes/(app)/search/+page.svelte` | route (trigger site) | event-driven | `.row:hover` (461) | exact |
| `src/routes/(app)/artist/[name]/+page.svelte` | route (trigger site) | event-driven | `.row:hover` (470) | exact |
| `src/routes/(app)/album/[name]/+page.svelte` | route (trigger site) | event-driven | `.row:hover` (536) + `openMenu` (213–225) | exact |
| `src/lib/components/NowPlaying.svelte` | component (trigger site + header analog) | event-driven | `.row:hover` (904) + queue/related rows (774, 814) | exact |
| `src/app.css` (optional global) | config (CSS) | n/a | global `.marquee-on` block (66–84) | role-match (add tap-highlight + hover guard) |
| `src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts` (×15) | config (i18n) | n/a | existing `menu.*` / `toast.*` keys (en.ts 225–281) | exact |
| `src/lib/i18n/i18n.test.ts` | test | n/a | existing parity test (43–50) | exact (extend) |

---

## Pattern Assignments

### `src/lib/components/track-menu-gate.ts` (NEW — pure utility, transform)

**Analog:** `src/lib/actions/marquee.ts` (`isOverflowing`, lines 16–22) + `src/lib/actions/longpress.ts` (`shouldSuppressClickAfterLongpress`, lines 20–28).

**Why this analog:** the project's established idiom is "extract the decision to a pure exported function, unit-test it under the node-only Vitest project, keep the DOM/`$state` wiring thin in the component/action." Both analogs are a single pure function + a doc-comment explaining the rule + a sibling `.test.ts`. The new helper is exactly this: the gating predicate + the in-flight-Set transition logic, lifted out of TrackMenu so MENU-01 is node-testable without a DOM (Wave 0 gap, RESEARCH line 449).

**Pure-helper idiom to copy** (verbatim shape from `marquee.ts:16–22`):
```typescript
/**
 * Pure helper: is the content (`scrollWidth`) wider than the visible box (`clientWidth`)?
 * Strict `>` so an exact fit does NOT marquee. Exported for unit testing in isolation.
 */
export function isOverflowing(scrollWidth: number, clientWidth: number): boolean {
	return scrollWidth > clientWidth;
}
```
And `longpress.ts:20–28`:
```typescript
/**
 * Pure helper: should the trailing native click be suppressed because a longpress just fired?
 * ... Exported so the decision is unit-testable under the node-only vitest project ...
 */
export function shouldSuppressClickAfterLongpress(fired: boolean): boolean {
	return fired;
}
```

**Functions to export (apply RESEARCH Pattern 2 / D-02 + D-03):**
- `isGatedReady(track)` — the literal `detailsLoaded && uid && audioUrl` test (mirrors `ensureTrackDetails`'s own readiness guard at `catalog.ts:186`: `track.detailsLoaded && track.audioUrl`). Returns true → the action can run on the stub immediately (ungated fast-path).
- `shouldStartResolve(inFlight: Set<string>, key: string): boolean` — `!inFlight.has(key)` (D-03 dedupe: a second tap while spinning is a no-op).
- The Set transition reducers (add-on-start, delete-in-`finally`) — keep them pure so the failure-clear ("never a stuck spinner") is testable. Use the reassign-for-reactivity discipline (`new Set(inFlight)`) only in the COMPONENT, not the pure helper.

Note the readiness guard precedent (the exact short-circuit the gate mirrors), `src/lib/services/catalog.ts:186`:
```typescript
if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
	return track;
}
```

---

### `src/lib/components/track-menu-gate.test.ts` (NEW — test, transform)

**Analog:** `src/lib/actions/marquee.test.ts` (entire file, 22 lines).

**Test-file idiom to copy** (verbatim `marquee.test.ts:1–21`):
```typescript
import { describe, it, expect } from 'vitest';
import { isOverflowing } from './marquee';

describe('isOverflowing — label overflow detection (FIX-C)', () => {
	it('content wider than the box overflows → marquee', () => {
		expect(isOverflowing(100, 80)).toBe(true);
	});
	it('content exactly equal to the box fits (no marquee for an exact fit)', () => {
		expect(isOverflowing(80, 80)).toBe(false);
	});
});
```
**Cases to write (RESEARCH Test Map / Wave 0):** gating predicate selects the gated set (`detailsLoaded && uid && audioUrl`); in-flight dedupe (`shouldStartResolve` false when key present); failure-clear (the Set transition removes the key on the reject path so no stuck spinner).

---

### `src/lib/components/TrackMenu.svelte` (component — MAJOR edit)

**Analog:** itself (the rework) + `NowPlaying.svelte:691–701` (two-row marquee header) + its own detail-modal X precedent (`TrackMenu.svelte:218`).

#### Imports pattern (current, lines 1–17) — extend, don't restructure
```typescript
import { tick, untrack } from 'svelte';
import { fly } from 'svelte/transition';
import { goto } from '$app/navigation';
import { ListStart, ListEnd, Download, Heart, ListPlus, Disc, User, Share2, Info, X, Plus, Shuffle, Trash2, Moon } from '@lucide/svelte';
// ... player / sleepTimer / library / settings / names / overlays / dragClose / t / ensureTrackDetails / blobStore / shareUrl / Track
```
- ADD `Sparkles` to the `@lucide/svelte` import (Remix icon — confirmed present at `node_modules/@lucide/svelte/dist/icons/sparkles.svelte`). `ListStart`, `ListEnd` map to Play-next / Add-to-queue.
- ADD an import of the new pure helpers from `./track-menu-gate`.
- Already imports `names`, `library`, `ensureTrackDetails` — all reused. `Heart` stays (relocates to header, NOT removed — Pitfall 7).

#### Overlay `$effect` — DO NOT TOUCH (the headline invariant, lines 142–158)
This is Pattern 1 / Pitfall 1. Keep this EXACT shape; the Close-X must converge on it, never call `overlays.dismiss` directly:
```typescript
$effect(() => {
	// DEP IS `open` ONLY — deliberately NOT `track`. ... untrack() wraps overlays.open/dismiss ...
	if (open) {
		untrack(() => overlays.open("trackmenu-menu", () => onclose()));
		return () => untrack(() => overlays.dismiss("trackmenu-menu"));
	}
});
```
The `close()` function (lines 35–38) already does the right thing — `pickerOpen = false; onclose();`. The new header X button is `onclick={close}`, identical to the scrim (`174`) and the detail-modal X (`218`, which flips local state only).

#### Two-row marquee header (replaces `.menu-head`, line 176) — copy NowPlaying
**Current single line to REPLACE** (`TrackMenu.svelte:176`):
```svelte
<div class="menu-head">{names.dnTitle(track.title)} · {names.dnArtist(track.artist)}</div>
```
**Copy NowPlaying's exact structure** (`NowPlaying.svelte:697–700`) — but use `<div>` not `<button>` for the rows (D-10 display-only):
```svelte
{#key player.current?.uid}
	<div class="title" use:marquee><span class="marquee-inner">{player.current ? names.dnTitle(player.current.title) : ''}</span></div>
	<button class="artist" use:marquee onclick={openArtist}><span class="marquee-inner">{player.current ? names.dnArtist(player.current.artist) : ''}</span></button>
{/key}
```
- Wrap both TrackMenu rows in `{#key track.uid}` (stub→resolved width change → remount → `use:marquee` re-measures — Pitfall 2). ADD `import { marquee } from '$lib/actions/marquee'`.
- Each clip: `overflow:hidden; white-space:nowrap; text-overflow:ellipsis; min-width:0; max-width:100%`; inner `<span class="marquee-inner">`.
- DO NOT redefine `@keyframes marquee-scroll` / `.marquee-on .marquee-inner` — they are GLOBAL in `app.css:72–84` (Pitfall 4). The component styles only the clip wrappers.
- Right cluster (Like + Close) — header-cluster idiom from the RESEARCH Code Examples block + the `Heart` fill idiom from NowPlaying's transport (`NowPlaying.svelte:731`):
```svelte
<button class="t" class:on={currentLiked} aria-label={currentLiked ? t('menu.liked') : t('menu.like')} onclick={toggleCurrentLike}><Heart size={20} fill={currentLiked ? 'currentColor' : 'none'} /></button>
```
Like → reuse the existing `like()` (lines 47–53). Close → `close()`. Both ≥44×44 hit area; `aria-pressed={liked}` on Like; `liked` derived already exists (`TrackMenu.svelte:33`).

#### Always-visible buttons + gated resolve-then-act (replaces `loading` gate, lines 177–200)
**Current gate to REMOVE** (`TrackMenu.svelte:177–183`) — the 9-row `.mi-skel` `{#if loading} … {:else} buttons {/if}`:
```svelte
{#if loading}
	{#each Array(9) as _, i (i)}
		<div class="mi-skel" aria-hidden="true"><span class="sk-ico"></span><span class="sk-bar" style:width={`${70 - (i % 3) * 12}%`}></span></div>
	{/each}
{:else}
	<button class="mi" onclick={playNext}>...</button>
	...
{/if}
```
**New behavior (D-01):** action list ALWAYS renders; `loading` becomes a HEADER-ONLY skeleton signal (two stacked `.sk` bars using the GLOBAL `.sk` class — NOT the bespoke `.mi-skel`/`.sk-bar`/`@keyframes mi-shimmer`, which are REMOVED with the gate, `TrackMenu.svelte:244–253`).

**Gated set** (use `track-menu-gate.isGatedReady`; tappable on a stub, resolve-then-act): **Download** (`doDownload`, 74–110 — needs `audioUrl`), **Detail** (`doDetail`, 123–127 — needs resolved fields), **Remix** (NEW). The gated handler wraps the existing `ensureTrackDetails` await (RESEARCH Pattern 2) and shows the inline spinner on that row.

**Ungated set** (work on the stub object alone — unchanged handlers): `playNext` (39), `addQueue` (40), `like` (47), `addToPlaylist`/picker (128/192), `gotoArtist` (63–67 via `overlays.navigateAway`), sleep timer (195), `doShare` (111–122 — NOT gated, A2; `shareUrl(track, player.queue)` builds from uid/title/artist + queue), plus `shuffleQueue`/`clearQueue` gated only on `player.queue.length > 1` (186–189, UNCHANGED).

#### Remix row (NEW — gated, in the queue-actions cluster near Play-next/Add-to-queue)
Render exactly like an existing `.mi` row (e.g. `TrackMenu.svelte:184`), with `Sparkles size={18}` and the inline spinner when `inFlight.has('remix')`. Handler (RESEARCH Code Examples + verified store APIs):
```typescript
function doRemix(seed: Track) {
	toast(t('toast.remixing'));            // D-07 toast on trigger (toast() helper exists, lines 28–32)
	player.setQueue([seed], 'remix');      // D-06 force-generate context (setQueue verified, player.svelte.ts:912)
	player.play(seed, { fresh: true });    // D-04 reuse existing path (play(_,{fresh}) verified, 1276–1281)
	close();
}
```
`setQueue(tracks, context)` records `queueContext` (915); the fresh-play branch reads `settings.effectiveUpnextMode(this.queueContext)` (`player.svelte.ts:1280`) → `regenerate` → `dedupeBest([seed, ...manualEntries, ...auto])` (1323), which preserves `manualUids` (D-05). NO new queue mechanism.

#### Inline row spinner CSS (Claude's discretion, spec'd in RESEARCH Code Examples)
Add scoped `.row-spinner` (16px, `border-top-color: transparent`, `animation: spin .7s linear infinite`) with `--color-text-muted` (NEUTRAL, not accent); reduced-motion fallback (`prefers-reduced-motion` + `:root[data-reduce-motion]` → `animation:none` + `menu.preparing` aria-label). Mirrors the existing skeleton's reduced-motion guard idiom (`TrackMenu.svelte:253`).

#### Style notes (scoped block, lines 233–259)
- KEEP: `.menu`/`.modal` container metrics (235), `.mi`/`.mi:hover`/`.mi:disabled`/`.mi.accent` (239–243), `.toast` (259), detail `dl` (254–258).
- REMOVE: `.mi-skel`, `.sk-ico`, `.sk-bar`, `@keyframes mi-shimmer` (244–253) — replaced by header-only `.sk`.
- REWORK: `.menu-head` (236) → the new `.sheet-head` flex layout (left text column `flex:1; min-width:0` + right cluster `flex:0 0 auto; gap:18px`). The `.menu-head.row` / `.x` detail-modal styles (237–238) stay for the detail sheet.

---

### `src/lib/config/defaults.ts` (config — 1-line type edit)

**Analog:** the existing `QueueContext` union (lines 94–103).
```typescript
export type QueueContext =
	| 'liked'
	| 'search'
	| 'downloads'
	| 'playlist'
	| 'album'
	| 'artist'
	| 'home-discovery'
	| 'history'
	| null;
```
**Edit (D-06):** add `| 'remix'` to the union. Note `UPNEXT_DEFAULTS.perContext` is `{}` (108) so `'remix'` has no override → resolves to the global `mode: 'generated'` (106) UNLESS the user globally set `'same-list'` — which is why the settings early-return below is required.

---

### `src/lib/stores/settings.svelte.ts` (store — 1-line resolver edit)

**Analog:** `effectiveUpnextMode` (lines 442–445).
```typescript
effectiveUpnextMode(ctx: QueueContext): UpnextMode {
	if (!ctx) return this.upnextMode;
	return this.upnextPerContext[ctx] ?? this.upnextMode;
}
```
**Edit (D-06, RESEARCH Pattern 3):** add an explicit early return as the FIRST line so Remix ALWAYS generates regardless of any user override:
```typescript
if (ctx === 'remix') return 'generated';
```
This makes D-06 airtight even when the user has globally chosen `'same-list'`. Add a Wave-0 unit test asserting `effectiveUpnextMode('remix') === 'generated'` after setting `upnextMode = 'same-list'`.

---

### `src/lib/stores/player.svelte.ts` (store — likely ZERO edit)

**Analog / reuse target:** `setQueue` (912–917), `play(_,{fresh})` fresh branch (1276–1284), `regenerate` (1305–1327).

Remix reuses these verbatim — no method change needed (the `'remix'` enum value + the settings early-return carry D-06). `regenerate` already filters `manualEntries = this.queue.filter(t => this.manualUids.has(t.uid) && t.uid !== seed.uid)` (1311–1313) and writes `this.queue = dedupeBest([seed, ...manualEntries, ...auto], settings.preferredSource)` (1323) — D-04/D-05 preserved. Add a player `*.svelte.test.ts` case (Wave 0): Remix context → regenerate preserves a manual-pinned uid, discards the prior generated tail.

---

### Long-press TRIGGER SITES (MENU-03 / D-12 — Contract 4)

All 6 files use `use:longpress onlongpress={...}`. The trailing-click half is ALREADY handled by `longpress.ts` (`suppressNextClick`, 36/60/73–79). The MISSING half is the stuck `:active`/`:hover`/focus visual. Apply per-site (or via the global `app.css` pass below).

**`src/routes/(app)/+page.svelte`** — analog: itself. Tiles/albums at 648, 687, 721, 738, 752; `tileMenu` at 543–558; sticky `.album:active { transform: scale(0.96); }` (845) and `.tile:active { transform: scale(0.96); }` (873). On `onlongpress`, `(e.currentTarget as HTMLElement).blur()`; guard the `:active` scale so a held finger doesn't stick.

**`src/routes/(app)/library/+page.svelte`** — `.row` triggers at 158/183/200/231 (`openMenu`); sticky `.row:hover { background: var(--color-surface); }` (259).

**`src/routes/(app)/search/+page.svelte`** — `.row` trigger at 384; sticky `.row:hover` (461).

**`src/routes/(app)/artist/[name]/+page.svelte`** — `.row` trigger at 376; sticky `.row:hover` (470).

**`src/routes/(app)/album/[name]/+page.svelte`** — `.row` trigger at 484 (`openMenu`, stub-resolve `openMenu`/`menuLoading` at 213–225); sticky `.row:hover` (536).

**`src/lib/components/NowPlaying.svelte`** — queue row (774, also `use:swipeRemove`) + related row (814), both `openMenu`; sticky `.row:hover` (904).

**Fix mechanism (RESEARCH Pitfall 6, A3 — DEVICE-verify on iOS Safari + Android Chrome):**
1. `-webkit-tap-highlight-color: transparent` (global on interactive elements — kills iOS grey flash).
2. Wrap each `:hover` rule in `@media (hover: hover) { … }` so touch never latches `:hover`.
3. `(e.currentTarget as HTMLElement).blur()` in the `onlongpress` handler; rely on `longpress.ts`'s `pointercancel`/`pointerup` `clear()` (83–85) for `:active` release.

---

### `src/app.css` (optional global — recommended single-pass MENU-03 fix)

**Analog:** the global `.marquee-on` block (66–84) shows the "one global rule shared by all surfaces" idiom. There is currently NO `-webkit-tap-highlight-color` and NO `@media (hover: hover)` guard (verified by grep — only `button { font-family: inherit; }` at line 63). RESEARCH Open Question 2 recommends the global pass (fewer edits, more correct). Add:
```css
button, a, [role="button"] { -webkit-tap-highlight-color: transparent; }
```
…and convert each trigger site's `.row:hover` / `.tile:active` into `@media (hover: hover)` (those rules are scoped per-component, so the wrap happens in each `+page.svelte`/`NowPlaying.svelte`, while the tap-highlight reset is the one global line here).

---

## Shared Patterns

### Resolve-then-act (gated actions)
**Source:** `src/lib/services/catalog.ts:181–193` (`ensureTrackDetails`, idempotent — resolved track short-circuits at 186) + the existing `doDownload` (`TrackMenu.svelte:74–110`) and `doDetail` (123–127) which already await it.
**Apply to:** Download, Detail, Remix rows in TrackMenu — wrap the await with the `inFlight` Set guard + inline spinner + `finally` clear (RESEARCH Pattern 2). Never a stuck spinner; toast `toast.noAudio` on `!audioUrl`/throw.

### Single dismiss path (overlay invariant)
**Source:** `src/lib/components/TrackMenu.svelte:142–158` (the `$effect`) + `overlays.svelte.ts` (history==stack depth).
**Apply to:** the new Close-X — it ONLY flips state via `close()` (35–38); the `$effect` cleanup is the SOLE `overlays.dismiss` caller. Never add `track` to the dep; never call `overlays.dismiss` from a button.

### Two-row marquee header
**Source:** `src/lib/components/NowPlaying.svelte:691–701` (`{#key uid}` + `use:marquee` + `.marquee-inner`) + global keyframe `src/app.css:72–84`.
**Apply to:** TrackMenu header rows (display-only `<div>` per D-10). The action only toggles `.marquee-on` + sets `--marquee-dx` (`marquee.ts:55–56`).

### Liked-heart fill idiom
**Source:** `src/lib/components/NowPlaying.svelte:731` (`class:on` + `Heart fill={currentLiked ? 'currentColor' : 'none'}`) and the existing TrackMenu `liked` derived (33) + `like()` (47–53).
**Apply to:** the header Like button — `fill="currentColor"` + accent color when liked; `aria-pressed`.

### Exported-pure-helper + sibling test
**Source:** `marquee.ts` (`isOverflowing`) / `marquee.test.ts`; `longpress.ts` (`shouldSuppressClickAfterLongpress`) / `longpress.test.ts`.
**Apply to:** the new `track-menu-gate.ts` / `track-menu-gate.test.ts` pair.

### i18n key parity across 15 dicts
**Source:** existing `menu.*` / `toast.*` keys in `en.ts:225–281` (flat dotted keys, grouped by section comment) + the parity test `i18n.test.ts:43–50`.
**Apply to:** add `menu.remix` (`Remix`), `toast.remixing` (`Remixing from this song`), `menu.preparing` (`Preparing…`) to ALL 15 dicts: `ar, de, en, es, fr, hi, id, it, pt, ru, th, tr, vi, zh-Hans, zh-Hant`. `menu.closeMenu` already exists (en.ts:238) — REUSE, do not add. The Remix row label matches the short-label style of `menu.shuffleQueue` (en.ts:278). EXTEND `i18n.test.ts:43–50` to iterate ALL `Object.keys(dicts)` (currently only en/zh-Hant/zh-Hans — Pitfall 5, Wave 0), so the 12 other locales are covered.

---

## No Analog Found

None. Every file in this rework has a concrete in-repo analog (verified by source read this session). The two NEW files (`track-menu-gate.ts` / `.test.ts`) follow the established exported-pure-helper + sibling-test idiom exactly.

---

## Metadata

**Analog search scope:** `src/lib/components/`, `src/lib/actions/`, `src/lib/stores/`, `src/lib/services/`, `src/lib/config/`, `src/lib/i18n/`, `src/routes/(app)/`, `src/app.css`, `node_modules/@lucide/svelte/dist/icons/`
**Files scanned:** TrackMenu.svelte, NowPlaying.svelte, marquee.ts, longpress.ts, marquee.test.ts, player.svelte.ts, settings.svelte.ts, defaults.ts, catalog.ts, library.svelte.ts, en.ts, i18n.test.ts, all 6 trigger-site route/component files, app.css, sparkles.svelte (existence)
**Pattern extraction date:** 2026-06-11
