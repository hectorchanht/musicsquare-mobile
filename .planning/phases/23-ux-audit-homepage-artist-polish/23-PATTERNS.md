# Phase 23: UX Audit & Homepage/Artist Polish - Pattern Map

**Mapped:** 2026-06-12
**Files analyzed:** 21 (12 new, 9 modified)
**Analogs found:** 21 / 21

> Source of file list: 23-CONTEXT.md (D-01..D-19) + 23-UI-SPEC.md (§1–§11). No RESEARCH.md exists; UI-SPEC is the technical contract. This is **polish over an established design system** — every file extends or consolidates existing code. Do not invent new tokens, gestures, or skeleton mechanics.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/stores/toast.svelte.ts` (NEW) | store | event-driven | `src/lib/stores/settings.svelte.ts` (runes singleton, SSR-guard) + the 3 local `toast()` copies | role-match |
| `src/lib/components/ToastHost.svelte` (NEW) | component | event-driven | the existing `.toast` block in `+page.svelte` (~342) / `TrackMenu.svelte` (306, 342) | exact (style is byte-identical) |
| `src/lib/actions/inflightGuard.ts` (NEW) | action/util | request-response | `src/lib/components/track-menu-gate.ts` (`shouldStartResolve`) + TrackMenu `inFlight` Set | exact (promote existing helper) |
| `src/lib/util/haptics.ts` (NEW) | utility | event-driven | `src/lib/services/color.ts` / `velocity.ts` (pure leaf util, no imports) | role-match |
| `src/lib/actions/swipeAction.ts` (NEW) | action | event-driven (gesture) | `src/lib/actions/swipeRemove.ts` | exact (generalize) |
| `src/lib/actions/focusTrap.ts` (NEW) | action | event-driven | `src/lib/actions/longpress.ts` (hand-rolled action, listener add/remove, destroy) | role-match |
| `src/lib/components/CompactRow.svelte` (NEW) | component | CRUD/transform | search `.row` markup (`+page.svelte` 511–525) + home tile interactions | role-match |
| `src/lib/components/CompactPager.svelte` (NEW) | component | transform | home `.albumrow` + `use:dragScroll` (`+page.svelte` 685–695) | partial (scroll-snap is new CSS) |
| `src/lib/services/home-layout.ts` (MODIFY) | service | transform (pure) | self — extend with `resolveSectionDensity` mirroring `resolveSectionOrder` | exact |
| `src/lib/stores/settings.svelte.ts` (MODIFY) | store | CRUD | self — Phase 17 plumbing pattern (field + load-guard + reset) | exact |
| `src/lib/config/defaults.ts` (MODIFY) | config | — | self — `HOME_DEFAULTS` group | exact |
| `src/routes/(app)/+page.svelte` (MODIFY) | route | transform | self — section snippets + `.subhead` + density branch | exact |
| `src/routes/(app)/settings/home/+page.svelte` (MODIFY) | route | CRUD | self — existing order/hide section-list controls | exact |
| `src/routes/(app)/charts/top/+page.svelte` (NEW) | route | request-response | search `+page.svelte` (deep list + skeleton + sentinel) | role-match |
| `src/routes/(app)/charts/tags/[tag]/+page.svelte` (NEW) | route | request-response | search `+page.svelte` + `getTagTopTracks` | role-match |
| `src/routes/(app)/charts/countries/[country]/+page.svelte` (NEW) | route | request-response | search `+page.svelte` + `getGeoTopTracks` | role-match |
| `src/routes/(app)/search/+page.svelte` (MODIFY) | route | request-response | self — add `use:swipeAction` to `.row` | exact |
| `src/routes/(app)/library/+page.svelte` (MODIFY) | route | CRUD | self — `.row` + tab buttons + `aria-pressed`/redirect targets | exact |
| `src/routes/(app)/album/[name]/+page.svelte` (MODIFY) | route | request-response | self — tracklist `.row` skeleton + swipe | role-match |
| `src/routes/(app)/artist/[name]/+page.svelte` (MODIFY) | route | request-response | self — `albumsFor` effect + album-card skeleton (334–360) | exact |
| `src/routes/api/deezer/artist-albums/+server.ts` (NEW, optional per §8.2) | route (proxy) | request-response | `src/routes/api/deezer/search/+server.ts` | exact |
| `src/lib/services/deezer.ts` (MODIFY, optional per §8.2) | service | request-response | self — `deezerArtist`/`deezerAlbum` never-throws client fn | exact |

---

## Shared Patterns

### Global Toast Store (D-15, §3.1)
**Source:** runes-singleton posture from `src/lib/stores/settings.svelte.ts` lines 1-3, 198-200, 468; the 3 existing local copies are the migration source.

Existing local toast (TrackMenu `src/lib/components/TrackMenu.svelte` lines 28-34 — identical shape in home `+page.svelte` ~217-222 and NowPlaying `flash()`):
```typescript
let toastMsg = $state('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(m: string) {
	toastMsg = m;
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toastMsg = ''), 2000);
}
```
New store: lift this into a runes singleton (`export const toast = new Toast()`) with `show(msg)`, SSR-guarded (`browser` from `$app/environment`), in-memory only. `show()` replaces + resets the timer (no stacking). The 2000ms is the locked timeout (matches all 3 copies). **Apply to:** all 3 call sites migrate to `toast.show(t('...'))`.

**Toast component style (byte-identical, copy verbatim)** — `src/lib/components/TrackMenu.svelte` line 342 / home `+page.svelte` ~342:
```css
.toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 14px); z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
```
Render guard + transition (verbatim) — `src/lib/components/TrackMenu.svelte` line 306:
```svelte
{#if toastMsg}<div class="toast" transition:fly={{ y: -20, duration: 180 }}>{toastMsg}</div>{/if}
```
`ToastHost.svelte` adds `role="status" aria-live="polite"` (UX-06) and mounts once in `src/routes/(app)/+layout.svelte` alongside `<NowPlaying />` / `<SleepTimerSheet />` (lines 154, 159).

### Double-click in-flight guard (D-16, §3.2)
**Source:** `src/lib/components/track-menu-gate.ts` (pure helper, node-testable) + `src/lib/components/TrackMenu.svelte` lines 42-57.

Canonical pure seed (`track-menu-gate.ts`):
```typescript
export function shouldStartResolve(inFlight: Set<string>, key: string): boolean {
	return !inFlight.has(key); // second tap while same key resolving = no-op
}
```
Component usage to generalize (TrackMenu lines 42-57 — reassign-for-reactivity discipline, `finally` clears the key on resolve OR throw → never a stuck spinner):
```typescript
let inFlight = $state(new Set<string>());
async function gated(key: string, run: (resolved: Track) => void | Promise<void>) {
	if (!shouldStartResolve(inFlight, key)) return;
	inFlight = new Set(inFlight).add(key);
	try { /* await action */ } finally {
		const next = new Set(inFlight); next.delete(key); inFlight = next;
	}
}
```
New `inflightGuard.ts` keeps the **pure decision** node-testable (mirror `track-menu-gate.ts`); the `new Set(...)` reassign stays in the COMPONENT. While in-flight: `aria-busy={true}` + the existing `.row-spinner` (TrackMenu lines 254/262/273, 333-336 — neutral, reduced-motion drops the spin).

### Haptics — commit-tier only (D-17, §3.3)
**Source:** there is NO `navigator.vibrate` usage today; model the LEAF-util posture of `src/lib/services/color.ts` / `gestures/velocity.ts` (zero imports, pure, SSR-safe).
```typescript
// src/lib/util/haptics.ts — never throws, no-ops where unsupported (iOS Safari)
export function tick(): void {
	try { navigator.vibrate?.(15); } catch { /* unsupported — silent */ }
}
```
**Apply to exactly 6 commit events** (§3.3): swipe-queue commit, swipe-like commit, TrackMenu `addQueue`, like toggle (menu/NowPlaying/row), `longpress` fire, swipeRemove `onremove`. Silent on plain taps/nav/seek.

### Skeleton (`.sk`) reuse (UX-01, §2)
**Source:** `src/app.css` lines 100-128 (global `.sk` + `sk-shimmer` + reduced-motion auto-disable) and the search-page `.skel` row precedent. **No new skeleton system.**
```css
/* app.css:105 — add .sk to any element sized to match the real content */
.sk { position: relative; overflow: hidden; background: rgba(255,255,255,0.11); border-radius: 6px; }
.sk::after { content:''; position:absolute; inset:0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%); transform: translateX(-100%); animation: sk-shimmer 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }
```
Search skeleton-row shape to mirror (count/size/bar-widths) — `src/routes/(app)/search/+page.svelte` lines 473-485 + styles 611-641: art 48px, `.bar-title` 62%, `.bar-artist` 40%, **280ms dwell floor** (lines 61-67, 230-290) so a cache hit never flickers.

### Hand-rolled action posture (UX-06 focusTrap)
**Source:** `src/lib/actions/longpress.ts` — the canonical `Action<HTMLElement, …>` shape: add listeners on attach, return `{ destroy() { remove listeners } }`, pure decision helper exported for node tests. `focusTrap.ts` follows this (no new dependency). Must coexist with the overlay `$effect` history invariant (`TrackMenu.svelte` lines 180-208) — it manages focus ONLY, never open/close state.

---

## Pattern Assignments

### `src/lib/actions/swipeAction.ts` (action, gesture) — generalizes swipeRemove (UX-04, D-01/D-02)

**Analog:** `src/lib/actions/swipeRemove.ts` (read in full — copy the gesture mechanics verbatim, change only the commit semantics).

Inherit **verbatim** (these are load-bearing Phase 15/20 invariants):
- `SLOP = 8`, `FLICK_V = 0.5`, `createVelocityTracker()` seeded on X (lines 41-44, 77-78).
- `node.style.touchAction = 'pan-y'` so vertical scroll/longpress yields (line 47).
- **No `setPointerCapture` on pointerdown** — capture only after horizontal commit in `move()` (lines 79-101). Sub-slop = tap reaches `onclick`; vertical-dominant = go passive (lines 91-96).
- The WR-01 trailing-click suppressor `suppressClick` armed only on a committed drag (lines 55-65, 110-115).

**Change for swipeAction (full-commit, spring-back — never removed, D-02):**
```typescript
// swipeRemove.up() (line 108) commits with onremove(); swipeAction commits per-direction
// then ALWAYS springs back (the row is never removed):
function up() {
	if (!dragging) return;
	dragging = false;
	if (captured) node.addEventListener('click', suppressClick, true); // WR-01
	captured = false;
	const v = vel.velocity();
	const committed = Math.abs(dx) > threshold || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP);
	if (committed) {
		if (dx > 0) onSwipeRight?.();   // queue (D-03)  + haptics.tick()
		else        onSwipeLeft?.();    // like toggle (D-04) + haptics.tick()
	}
	// ALWAYS spring back (no removal) — swipeRemove.ts lines 122-126 pattern, applied unconditionally:
	node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1)';
	node.style.transform = 'translateX(0)';
	dx = 0;
}
```
Opts shape: `{ onSwipeRight?: () => void; onSwipeLeft?: () => void; threshold?: number (default 96); enabled?: boolean }`. The reveal icon/background renders BEHIND the row (the host wraps the `.row` and reveals via the row's translateX); reuse `--color-primary` for queue, `--src-netease` for unlike (§6). Drop swipeRemove's `FADE_DISTANCE`/opacity fade (lines 43, 105) — these rows don't fade.

**Apply to (D-01):** `.row` on search (511), library (170), album tracklist, artist hit-songs (384), and the new chart pages. Coexists with the existing `use:longpress` + `onclick` already on those rows.

### `src/lib/services/home-layout.ts` (service, pure) — add `resolveSectionDensity` (D-07, §4.2)

**Analog:** self — `resolveSectionOrder` lines 131-150 (corrupt-input posture: unknown id / garbage → fall back to default, never blank the render).
```typescript
// Mirror resolveSubset's "unknown key dropped, fallback never blanks" posture (lines 165-180):
export function resolveSectionDensity(
	sectionId: HomeSectionId,
	perSection: Partial<Record<HomeSectionId, HomeDensity>> | undefined,
	globalDefault: HomeDensity
): HomeDensity {
	const v = perSection?.[sectionId];
	return v === 'comfortable' || v === 'compact' ? v : globalDefault;
}
```
**Phase intent (§4.2):** ship compact-by-default — either flip the resolver's home-section default to `'compact'` or special-case it (planner's choice; `HomeDensity` type already exists, lines 206).

### `src/lib/stores/settings.svelte.ts` + `src/lib/config/defaults.ts` (Phase 17 plumbing, D-07)

**Analog:** self — the `enabledSources` object-not-array load guard is the exact template for the new per-section density map.

defaults.ts `HOME_DEFAULTS` (lines 117-127) — add one field:
```typescript
homeSectionDensity: {} as Partial<Record<HomeSectionId, HomeDensity>>,
```
settings.svelte.ts — 3 touch points (the documented WR-10 pattern, lines 169-189 field / 266-291 load / 451-465 reset):
1. Field init: `homeSectionDensity = $state<Partial<Record<HomeSectionId,HomeDensity>>>({ ...HOME_DEFAULTS.homeSectionDensity });`
2. Load guard — copy the `enabledSources` object-not-array guard verbatim (lines 221-224):
```typescript
this.homeSectionDensity =
	v.homeSectionDensity && typeof v.homeSectionDensity === 'object' && !Array.isArray(v.homeSectionDensity)
		? (v.homeSectionDensity as Partial<Record<HomeSectionId, HomeDensity>>)
		: {};
```
3. Add to `save()` JSON (line 341-350 block) + `resetHome()` (line 453-465). Persists in `openmusic:settings:v1` (`KEY`, line 56).

### `src/routes/(app)/+page.svelte` (route) — compact pager + title-row nav (D-05/06/14, §4.1/§5.1)

**Analog:** self — section snippets (682-815), `.subhead` (831), `.albumrow` + `use:dragScroll` (685), `use:longpress`+`onclick` tile pattern (648, 687), `tileMenu()` (543).

`.subhead` typography to preserve (line 831):
```css
.subhead { font-size: calc(0.95rem * var(--fs-title, 1)); font-weight: 700; margin: 14px 0 8px; color: var(--color-text); }
```
Title-row nav (D-14, §5.1): replace the static `<div class="subhead">` with `<button class="subhead-nav">` (full-width, trailing `ChevronRight size={18}` muted via `margin-left:auto`, `≥44px`, `aria-label = {title} + t('home.seeAll')`). Tap target maps per §5.2 (charts route / library tab / playlist deep-link). Use `goto()` (already imported across routes).

Compact branch: where each block currently renders `.albumrow`, branch on `resolveSectionDensity(id, settings.homeSectionDensity, settings.homeDensity) === 'compact'` to a `CompactPager` of `CompactRow`s instead. Existing skeleton precedent — `+page.svelte` lines 638-641 (`.al-cover.skeleton`); compact needs the 40px-art + 2-bar variant per §2.

### `src/lib/components/CompactRow.svelte` + `CompactPager.svelte` (NEW components, §4.1)

**Analog:** search `.row` (`src/routes/(app)/search/+page.svelte` 511-525, styles 596-607) for geometry; home `.albumrow use:dragScroll` (685) for the horizontal track.

Row interactions (D-09) reuse the established triple (search line 513): `use:longpress onlongpress={... menu}` + `onclick={... play}` + a trailing `<button aria-label={t('menu.options')}>` (`MoreVertical size={18}`) opening `TrackMenu`. Art 40px / radius 6px / `use:lazyCover` (search line 516), `.r-title`+`.r-sub` with `use:marquee`+`.marquee-inner` (project memory rule; TrackMenu 222-223 shows the marquee idiom). Artist-row variant: round avatar (`--radius-full`), name only, `tap = artist page`, **no ⋮**, no longpress (D-08/D-09). Pager: `scroll-snap-type: x mandatory`, columns `~90vw` + `scroll-snap-align: start`, gap 12px, `ceil(itemCount/4)` columns (§4.1). Min touch height 44px.

### Chart pages — `src/routes/(app)/charts/{top,tags/[tag],countries/[country]}/+page.svelte` (NEW, HOME-04, §5.3)

**Analog:** `src/routes/(app)/search/+page.svelte` (deep list + dwell-floored skeleton + sentinel infinite-scroll) — the closest existing deep-vertical-list route.

Data: `src/lib/services/lastfm.ts` fetchers — `getChartTopTracks(limit, page)` (line 211), `getChartTopArtists` (222), `getTagTopTracks(tag, limit, page)` (235), `getGeoTopTracks(country, limit, page)` (252) — all never-throw → `[]`, support `page` for load-more (D-12 wants ~50–100 rows). Reuse:
- The `.row` markup + `use:longpress` + `use:swipeAction` + `onclick` play pattern (search 511-525) — gives swipe + long-press menu "for free" (§6 requires it).
- The `{#snippet skeletonRows(count, label)}` + dwell-floor + sentinel pattern (search 473-535) — ~12 visible skeleton rows.
- Route params via `[tag]`/`[country]` dirs; header uses existing page-heading style (search `.head h1`, line 542). New i18n keys `charts.topTitle/tagTitle/countryTitle` (§9, add to all 15 dicts).

### `src/routes/(app)/library/+page.svelte` (MODIFY) — redirects + a11y + swipe (D-13, §5.2/§6/§7.1)

**Analog:** self — tab buttons (158-162), `Tab` union + `VALID_TABS` (20-21), `setTab` (37). Tab buttons already carry `aria-label`+`title`+`class:active`; **add `aria-pressed`/`aria-current` for the active tab** (§7.1). Existing `aria-pressed` precedent: edit-btn line 146 (`aria-pressed={editMode}`). Add `use:swipeAction` to the `.row` (line 170). D-13 redirects land here via the tab param + playlist deep-link (existing `loadInitialTab`/`setTab`).

### `src/routes/(app)/artist/[name]/+page.svelte` (MODIFY) — trackless-album gate (ART-01, D-18, §8.1)

**Analog:** self — the `albumsFor` race-guarded effect (lines 190-205) + album-card skeleton (334-346) + album render (347-360).
```typescript
// artist/[name]/+page.svelte:194 — race-guarded effect to clone for the verify step
if (n && albumsFor !== n) {
	albumsFor = n; albums = []; albumsLoading = true;
	void getArtistTopAlbums(n).then((r) => {
		if (albumsFor === n) albums = r;       // race guard — discard if name changed
	}).finally(() => { if (albumsFor === n) albumsLoading = false; });
}
```
Existing skeleton already present (334-346, `albumsLoading` flag) — D-18 only changes WHAT renders after settle: filter to non-empty albums (drop empty/placeholder names up front). The skeleton card shape matches the render block (347-360).

### Deezer artist-albums (OPTIONAL per §8.2 — AUGMENT, recommended path)

**Analog (proxy):** `src/routes/api/deezer/search/+server.ts` — copy the full posture: own-origin CORS via `corsHeaders(origin)`, `OPTIONS` 204 preflight, `edgeCache()` keyed by the own-origin Request, `fetchWithRetry` + `AbortSignal.timeout`, `safeImageUrl` host allow-list (`*.dzcdn.net`), reshape to a narrow client shape. New route `/api/deezer/artist-albums` returns each album's `nb_tracks` natively (Deezer `artist/{id}/albums`).

**Analog (client):** `src/lib/services/deezer.ts` `deezerArtist`/`deezerAlbum` (the never-throws + `cached()` + `combinedSignal` + `.catch(() => null)` posture) — add a `deezerArtistAlbums(name, signal)` that lists albums with track counts.

**Fallback path (if proxy descoped):** keep `getArtistTopAlbums` (lastfm) as the list, verify counts via existing `deezerAlbum()` (returns `nb_tracks`) OR `getAlbumTracklist` (lastfm.ts:278), **capped with `mapWithConcurrency`** (`src/lib/services/discovery.ts:110`, default cap 4, never-throws, `sig.aborted` guards). Either path: identical UX (skeleton → only non-empty albums).

---

## No Analog Found

None — every file in scope extends or consolidates an existing pattern. The two genuinely new mechanics are:
- **`scroll-snap` pager CSS** (CompactPager §4.1) — new CSS only, no behavioral analog; the horizontal track structure mirrors the existing `.albumrow use:dragScroll`.
- **`navigator.vibrate` haptics** (§3.3) — no prior usage in the codebase, but the LEAF-util shape is modeled on `color.ts`/`velocity.ts`.

---

## Metadata

**Analog search scope:** `src/lib/actions/`, `src/lib/components/`, `src/lib/stores/`, `src/lib/services/`, `src/lib/config/`, `src/lib/gestures/`, `src/routes/(app)/`, `src/routes/api/deezer/`, `src/app.css`, `src/lib/i18n/`
**Files scanned:** ~25 (read in full or targeted)
**Pattern extraction date:** 2026-06-12
**Tooling note:** node tests run under the node-only Vitest project (pure helpers: `track-menu-gate.ts`, `home-layout.ts`, `velocity.ts`); new pure helpers (`resolveSectionDensity`, `inflightGuard` decision, `haptics`) follow the same node-testable posture. Shell default node is v16 — prefix PATH with `$HOME/.nvm/versions/node/v22.22.0/bin` for any pnpm/vitest run.
