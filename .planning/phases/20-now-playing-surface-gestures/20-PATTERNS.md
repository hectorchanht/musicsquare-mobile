# Phase 20: Now-Playing Surface & Gestures - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 4 (3 modified surfaces + 1 likely-new action; carousel logic may live inline or as 1 extracted action)
**Analogs found:** 4 / 4 (every new gesture has an exact in-repo idiom to mirror)

> **Phase shape:** INTERACTION/MOTION. This phase LAYERS gestures onto existing surfaces. It is net-new code inside existing files, NOT new screens. There is one strong candidate for a genuinely new file (a `coverSwipe`/`trackSwipe` action), but per CONTEXT D-05 / discretion the carousel branch MAY instead be added inline to NowPlaying's existing `npTop*` handlers. Both paths reuse the SAME analogs below.

---

## LOAD-BEARING INVARIANT (applies to every horizontal/tap branch this phase adds)

> **Never `setPointerCapture` on `pointerdown`. Arm on down; commit axis in `pointermove` after the 8px slop + axis-dominance check; capture only then. Sub-slop movement must still reach `onclick`.**

This is verified in BOTH analogs and is the single highest-risk pitfall (ROADMAP Pitfall 7):
- `swipeRemove.ts:79-82` — comment + `down()` deliberately does NOT capture; `swipeRemove.ts:97-100` captures inside `move()` only after horizontal commit.
- `dragClose.ts:60-63` (down, no capture) + `dragClose.ts:71-74` (capture in move after `dy > DRAG_START`).
- `NowPlaying.svelte:377-382` (`npTopDown` only records start) + `NowPlaying.svelte:387-396` (`npTopMove` captures only after `dy > DRAG_SLOP && |dy| > |dx|`).
- `swipeRemove.ts:61-65,108-128` — the trailing-click suppressor (`suppressClick`, capture-phase, one-shot, armed only when `captured`) is REQUIRED on the cover/nowbar too: a committed swipe must NOT replay its `onclick` (tap-to-collapse / tap-to-expand).

Pin the shared motion constants byte-for-byte: `SLOP/DRAG_SLOP/DRAG_START = 8`, `FLICK_V = 0.5` px/ms, settle curve `cubic-bezier(.22,1,.36,1)`, snap duration `0.28s`, cover-reflow duration `0.32s`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/components/NowPlaying.svelte` (modify — cover carousel NP-01, rubber-band NP-02 edge, tap-collapse NP-03, top loader NP-04, scroll containment NP-02) | component (gesture host) | event-driven (pointer) + CRUD-of-DOM-transform | self: `npTop*` handlers (`NowPlaying.svelte:377-406`) + `swipeRemove.ts` | exact |
| `src/lib/components/Nowbar.svelte` (modify — slide-and-snap NP-05, tap-expand preserved) | component (gesture host) | event-driven (pointer) | `swipeRemove.ts` (track-and-snap idiom) | exact |
| `src/lib/actions/coverSwipe.ts` *(candidate NEW — only if extracted; else logic lands inline in NowPlaying)* | action (Svelte `use:`) | event-driven (pointer) | `src/lib/actions/swipeRemove.ts` | exact (structural mirror) |
| `src/lib/stores/player.svelte.ts` (NO modify — read-only consumption of `next/prev/queue/loading`) | store | request-response | n/a — already exists, do not change | n/a (consume) |

> **No new files are strictly required.** The new gesture either (a) attaches `swipeRemove`-style logic inline to `.np-top` / nowbar markup, or (b) is extracted into `coverSwipe.ts` mirroring `swipeRemove.ts`'s exported-Action shape. Per the established convention (every gesture in this repo is a `use:` action: `swipeRemove`, `dragClose`, `longpress`, `dragReorder`, `chipReorder`, `dragScroll`), **extraction into an action is the on-pattern choice** if the carousel logic grows past a few lines.

---

## Pattern Assignments

### `src/lib/actions/coverSwipe.ts` (NEW action, or inline branch) — carousel + nowbar swipe (NP-01 / NP-05)

**Analog:** `src/lib/actions/swipeRemove.ts` (the only horizontal-swipe action in the repo; D-08 says reuse it verbatim and change ONLY the distance basis flat→proportional). Mirror its file shape: `import type { Action }`, `import { createVelocityTracker }`, an `*Opts` interface, the `down/move/up` triad, reactive `update()`, `destroy()` that resets inline styles + `touchAction`.

**Imports + Action signature pattern** (`swipeRemove.ts:1-2, 25-34`):
```typescript
import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';

export interface SwipeRemoveOpts {
	onremove: () => void;
	threshold?: number;
	enabled?: boolean;
}
export const swipeRemove: Action<HTMLElement, SwipeRemoveOpts> = (node, opts) => {
	let onremove = opts.onremove;
	let threshold = opts.threshold ?? 96;   // ← D-08: REPLACE flat default with proportional basis
	let enabled = opts.enabled ?? true;
	...
```
> New action exposes `onprev: () => void; onnext: () => void;` instead of `onremove`, and reports a live `dx` (or takes a per-frame callback) so the host can drive the 3-cover strip translate. The proportional commit (`0.28 × coverWidth`, UI-SPEC §3) replaces the flat `threshold` — measure element width at `down()` like NowPlaying measures `closedOffset`/`halfOffset` at drag start (`NowPlaying.svelte:440-458`).

**Arm-on-down, no-capture pattern** (`swipeRemove.ts:67-83`) — copy verbatim:
```typescript
function down(e: PointerEvent) {
	if (!enabled) return;
	node.removeEventListener('click', suppressClick, true);
	dragging = true;
	captured = false;
	startX = e.clientX;
	startY = e.clientY;
	dx = 0;
	vel.reset();
	vel.sample(e.clientX, e.timeStamp);
	// Do NOT setPointerCapture here ... Capture only once an actual horizontal drag begins (in move()).
	node.style.transition = 'none';
}
```

**Slop + axis-dominance commit, capture-in-move** (`swipeRemove.ts:85-106`) — the exact arbitration the cover needs (D-05); vertical yields to the existing collapse handler:
```typescript
function move(e: PointerEvent) {
	if (!dragging) return;
	const ddx = e.clientX - startX;
	const ddy = e.clientY - startY;
	if (!captured) {
		if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;   // sub-slop → still a tap
		if (Math.abs(ddy) > Math.abs(ddx)) { dragging = false; return; } // vertical wins → yield
		node.setPointerCapture(e.pointerId);                         // horizontal commit → capture HERE
		captured = true;
	}
	dx = e.clientX - startX;
	vel.sample(e.clientX, e.timeStamp);
	node.style.transform = `translateX(${dx}px)`;                    // 1:1 live follow (carousel strip)
	node.style.opacity = String(1 - Math.min(1, Math.abs(dx) / FADE_DISTANCE)); // nowbar optional fade (D-06)
}
```
> Carousel difference (NP-01/D-01): instead of translating one node, translate the rigid 3-cover strip `translateX(dx)` (UI-SPEC §1: 1:1 lockstep, no parallax/scale/fade on the cover). Direction → action: `dx > 0` (drag right) = `onprev()`; `dx < 0` (drag left) = `onnext()` (D-03).

**Commit-or-springback + trailing-click suppression** (`swipeRemove.ts:108-128`) — copy the structure; swap remove→prev/next and apply the proportional + flick rule (D-08):
```typescript
function up() {
	if (!dragging) return;
	dragging = false;
	if (captured) node.addEventListener('click', suppressClick, true); // swallow trailing click on commit
	captured = false;
	const v = vel.velocity();
	if (Math.abs(dx) > threshold || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
		onremove();                                                    // → onprev()/onnext()
	} else {
		node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1), opacity 0.28s';
		node.style.transform = 'translateX(0)';                        // spring back
		node.style.opacity = '1';
	}
	dx = 0;
}
```
> **Rubber-band at a true boundary (D-02 / UI-SPEC §2):** when `onprev` has no neighbor (index 0, `currentTime ≤ 3`) — i.e. the host passes `hasPrev:false` — clamp the live translate to `offset = sign(dx)·maxPull·(1 − e^(−|dx|/maxPull))` with `maxPull = 0.18×coverWidth`, IGNORE flick, and ALWAYS spring back to 0 with the `0.32s` curve. "next" almost always has an auto-generated neighbor so it rarely resists.

**Trailing-click suppressor** (`swipeRemove.ts:61-65`) — REQUIRED so a committed swipe does not also fire the cover's tap-to-collapse / nowbar's tap-to-expand:
```typescript
function suppressClick(e: MouseEvent) {
	e.stopPropagation();
	e.preventDefault();
	node.removeEventListener('click', suppressClick, true);
}
```

**Listener wiring + reactive update + destroy** (`swipeRemove.ts:130-151`) — copy verbatim, including `node.style.touchAction = 'pan-y'` on attach (KEY: yields only the X axis; vertical scroll/collapse stays with the browser/collapse handler) and the `destroy()` that drops the armed suppressor + resets inline styles.

---

### `src/lib/components/NowPlaying.svelte` (modify) — cover carousel host + tap-collapse + top loader + scroll containment

**Analog (axis-arbitration coexistence):** the file's OWN `npTopDown/npTopMove/npTopUp` vertical-collapse handlers. The new horizontal carousel branch must arbitrate with these by axis dominance, NOT race them.

**Existing vertical-collapse handlers the horizontal branch coexists with** (`NowPlaying.svelte:371-406`):
```typescript
let dragArmed = false; let startY = 0; let startX = 0;
const DRAG_SLOP = 8;
function npTopDown(e: PointerEvent) {            // arm only — no capture (Pitfall 7)
	dragArmed = true; dragging = false; startY = e.clientY; startX = e.clientX;
}
function npTopMove(e: PointerEvent) {
	if (!dragArmed) return;
	const dy = e.clientY - startY; const dx = e.clientX - startX;
	if (!dragging) {
		if (dy > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)) {        // vertical-dominant → claim
			dragging = true;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} else { return; }                                          // ← horizontal falls through to carousel
	}
	dragY = Math.max(0, dy);
}
function npTopUp() {
	const wasDragging = dragging; dragArmed = false; dragging = false;
	if (!wasDragging) return;                       // tap path — let onclick run (tap-collapse, D-04)
	if (dragY > 120) player.collapse(); dragY = 0;
}
```
> **Arbitration plan (D-05, Claude's discretion on shape):** Option A — add the horizontal branch INSIDE these handlers (when `|dx| > |dy|` past slop, drive the carousel instead of `dragY`). Option B — attach a separate `coverSwipe` action on `.cover` (`pan-y` touch-action yields X to it) while `npTop*` keeps Y. EITHER WAY: `|dy|>|dx|` → vertical collapse (existing); `|dx|>|dy|` → carousel; sub-slop on both → the cover's `onclick`. The two must not both capture.

**`.np-top` / `.cover` markup the gesture attaches to** (`NowPlaying.svelte:673-689`):
```svelte
<div class="np-top" role="group" aria-label={t('nowplaying.albumArt')}
	onpointerdown={npTopDown} onpointermove={npTopMove} onpointerup={npTopUp} onpointercancel={npTopUp}>
	<div class="cover" role="button" tabindex="0" bind:this={coverEl}
		aria-label={t('nowplaying.albumArt')}
		style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}></div>
```
> Keep `role="button"` + `tabindex="0"` + `aria-label` (UI-SPEC accessibility). The 3-cover carousel strip wraps INSIDE the `.cover` box (or replaces its single background-image with a 3-cell `overflow:hidden` track); neighbor covers come from `player.queue[i±1]` (see store consumption below).

**Tap-cover → collapse (NP-03 / D-04):** add an `onclick` on `.cover` that, when `sheetState === 'half'`, snaps to `closed`. Reuse the EXISTING closed-snap idiom already used by the grip TAP path (`NowPlaying.svelte:511`): `sheetState = 'closed'` drives the `.sheet` transform transition (`NowPlaying.svelte:748-749`, `transform 0.28s cubic-bezier(.22,1,.36,1)`) + the `.cover` reflow (`:839`, `0.32s`) concurrently — no new animation. The `onclick` only fires when movement stayed sub-slop (guaranteed by the no-capture invariant + the trailing-click suppressor on commit).

**`SheetState` machine + closed snap** (`NowPlaying.svelte:413-414, 460-557`) — the target for D-04 already exists. The grip TAP single-step (`:489-513`) shows the exact `sheetState = ...` reassignment that animates via the reactive `class:`/`style:transform` bindings.

**Top running-line loader (NP-04 / UI-SPEC §6):** copy the markup + class names from Nowbar (see Shared Patterns → Loader) and mount it at the top edge of `.np` (`NowPlaying.svelte:647-654` is the `.np` root; `:831` is its CSS — `position:fixed; inset:0; padding:0 18px env(safe-area-inset-bottom)`). Anchor full-bleed under `env(safe-area-inset-top)`, above `.bar` (`:663`), `z-index` above the cover. Drive by `player.loading`. Default: show in all sheet states; suppress in `full` only if it visually duplicates the embedded Nowbar's own `.np-prog`.

**Scroll containment (NP-02 / UI-SPEC §7):** add `overscroll-behavior-y: contain;` to `.panel` (`NowPlaying.svelte:901`, currently `.panel { flex: 1; overflow-y: auto; }`). Do NOT set `touch-action: none` on `.panel` — it must keep `pan-y` scroll. The carousel swipe lives on `.cover`/`.np-top`, not `.panel`, so there is no horizontal collision.

**`touch-action` reconcile (UI-SPEC cross-browser):** `.np-top` is currently `touch-action: pan-x` (`NowPlaying.svelte:838`, with the comment "none here, but defensive ... future swipe" — this phase IS that anticipated case). `pan-x` already yields the horizontal axis the carousel needs; the vertical collapse claims Y after slop in JS. Keep `pan-x` (or set on the gesture container) so the browser owns horizontal pan handoff to the action.

---

### `src/lib/components/Nowbar.svelte` (modify) — slide-and-snap prev/next (NP-05 / D-06, D-07)

**Analog:** `src/lib/actions/swipeRemove.ts` (lighter use — single-node slide, optional fade, no carousel). Attach the same swipe action to the `.np-open` content row.

**The sliding content row + tap-to-expand to preserve** (`Nowbar.svelte:49-70`):
```svelte
<button class="np-open" aria-label={t("nowbar.openNowPlaying")} disabled={resolving} onclick={handleOpen}>
	<span class="np-art" style:background-image={...}></span>
	<span class="np-meta"> ...title / artist... </span>
</button>
```
> Apply the swipe to `.np-open` (D-06: thumb art + text slide together). `handleOpen` (`Nowbar.svelte:32-35` → `player.expand()`) is the sub-slop tap that MUST keep firing (D-07). Same no-capture-on-pointerdown + trailing-click-suppress invariant; horizontal drag past slop = track change, sub-slop = expand.

**Commit motion (UI-SPEC §5):** content travels 1:1 with `dx`; optional opacity fade across `FADE_DISTANCE = 120` (`swipeRemove.ts:43,105`); on commit slide fully off over `0.28s cubic-bezier(.22,1,.36,1)`, fire `player.next()`/`prev()`, store swap repaints content. Spring-back below threshold = `translateX(0)` over `0.28s`. Proportional commit = `0.28 × nowbarContentWidth` (same fraction as the cover, D-08).

**Loader rail must NOT slide** (UI-SPEC §5, last row): the `.np-prog` rail (`Nowbar.svelte:40-48`) sits OUTSIDE `.np-open`. Attach the swipe to `.np-open` only, so the loader stays visually pinned while content slides.

---

### `src/lib/stores/player.svelte.ts` (READ-ONLY — do not modify)

The carousel/nowbar consume these EXISTING members; no new advance functions (D-03).

**`next()` / `prev()`** (`player.svelte.ts:1386-1412`) — prev restarts the song when `currentTime > 3` (this is why the true rubber-band case is narrow, D-02):
```typescript
next() {
	this.abortFade();
	const i = this.indexOf(this.current);
	if (i >= 0 && i + 1 < this.queue.length) this.play(this.queue[i + 1]);
	else void this.ensureAhead().then(() => {              // grow auto up-next, then advance
		const j = this.indexOf(this.current);
		if (j >= 0 && j + 1 < this.queue.length) this.play(this.queue[j + 1]);
	});
}
prev() {
	this.abortFade();
	if (this.audio && this.audio.currentTime > 3) { this.audio.currentTime = 0; return; } // restart, not skip
	const i = this.indexOf(this.current);
	if (i > 0) this.play(this.queue[i - 1]);
	else if (this.audio) this.audio.currentTime = 0;
}
```

**Neighbor lookup for the carousel peek** — `indexOf` is PRIVATE (`player.svelte.ts:1039-1042`, `findIndex(t => t.uid === track.uid)`). The host computes neighbors from the PUBLIC `player.queue` (`:160`, `$state<Track[]>`) and `player.current` (`:99`):
```typescript
const i = player.queue.findIndex(t => t.uid === player.current?.uid);
const prevCover = i > 0 ? player.queue[i - 1] : null;        // null → rubber-band (D-02)
const nextCover = i >= 0 && i + 1 < player.queue.length ? player.queue[i + 1] : null;
```
> `nextCover` is almost always present because `ensureAhead()` (`:1013-1037`) grows the queue when within 2 of the end. So `hasNext` is effectively always true; `hasPrev` is the only common resist case.

**`loading`** (`player.svelte.ts:101`, `loading = $state(false)`; set true `:1138/:1181`, false `:1164/:1242/:1269/:1346`) — drives the NP-04 top loader visibility, exactly as Nowbar's `.np-prog.indet` uses it (`Nowbar.svelte:40-41`).

---

## Shared Patterns

### Velocity tracker (flick commit, 0.5px/ms)
**Source:** `src/lib/gestures/velocity.ts` (`createVelocityTracker()`, 3-sample, px/ms, SSR-safe — caller supplies `e.timeStamp`).
**Apply to:** cover carousel + nowbar swipe (flick-always-commits, D-08), EXCEPT at a true boundary where flick is ignored (D-02).
```typescript
const vel = createVelocityTracker();
// down: vel.reset(); vel.sample(e.clientX, e.timeStamp);
// move: vel.sample(e.clientX, e.timeStamp);
// up:   if (Math.abs(vel.velocity()) > 0.5 && Math.abs(dx) > 8) commit();
```
> Already imported in NowPlaying (`NowPlaying.svelte:25`) and used by the grip drag (`:431-432, 475-476, 483, 521`). `velocity()` is signed: positive = increasing coordinate.

### Settle/spring motion vocabulary (REUSE byte-for-byte)
**Source:** `swipeRemove.ts:123`, `dragClose.ts:91`, `NowPlaying.svelte:653,749,839`.
**Apply to:** every spring-back / commit-settle this phase adds.
- Snap-back / nowbar commit: `transform 0.28s cubic-bezier(.22,1,.36,1)` (+ `opacity 0.28s` if fading).
- Cover carousel commit-settle & rubber-band spring-back: `0.32s cubic-bezier(.22,1,.36,1)` (matches the cover's own reflow personality, `:839`).
- Reduced motion: honor `@media (prefers-reduced-motion: reduce)` AND `:root[data-reduce-motion]` (app.css:92) — springs collapse to instant snap; the loader keyframe slows to `2.2s` (the existing override, `Nowbar.svelte:207-211`). Track change still happens; only the animation is removed.

### Trailing-click suppression (tap vs committed-swipe)
**Source:** `swipeRemove.ts:55-65, 108-128, 146`.
**Apply to:** cover (tap-collapse vs swipe) and nowbar (tap-expand vs swipe).
- Arm a capture-phase one-shot `click` suppressor in `up()` ONLY when the gesture `captured`.
- Drop a stale suppressor on the next `pointerdown` and in `destroy()`.
- This is what stops a committed swipe from ALSO firing `onclick`.

### Running-line loader markup + keyframe (NP-04)
**Source:** `src/lib/components/Nowbar.svelte:40-48` (markup) + `:177-211` (CSS) — copy class names verbatim so it inherits the keyframe.
**Apply to:** the new top-of-`.np` loader in NowPlaying.
```svelte
<div class="np-prog indet"><i class="sliver"></i></div>
```
```css
.np-prog { position: absolute; top: 0; left: 0; right: 0; height: 3px; background: rgba(255,255,255,0.12); }
.np-prog.indet { overflow: hidden; }
.np-prog.indet > i.sliver { width: 35%; transition: none; animation: np-indet 1.1s ease-in-out infinite; }
@keyframes np-indet { 0% { transform: translateX(-110%); } 100% { transform: translateX(310%); } }
@media (prefers-reduced-motion: reduce) { .np-prog.indet > i.sliver { animation-duration: 2.2s; } }
```
> Sliver fill = `var(--color-primary)` (`#7c5cff`) — THE ONLY accent use this phase (UI-SPEC Color). Rail = `rgba(255,255,255,0.12)`. Height `3px`. Mount full-bleed under `env(safe-area-inset-top)`, above `.bar`.

### Measure-at-drag-start (proportional commit / coverWidth)
**Source:** `NowPlaying.svelte:440-458` (`measureOffsets()` reads `getBoundingClientRect()` at gesture start).
**Apply to:** the proportional `0.28 × elementWidth` commit and `0.18 × coverWidth` `maxPull` — measure the cover/nowbar content width on `down()` from the live layout (cover CSS width = `min(72vw, 320px)`, `NowPlaying.svelte:839`), don't hardcode px.

---

## No Analog Found

None. Every new gesture maps to an existing in-repo idiom:

| Concern | Covered by analog |
|---------|-------------------|
| Horizontal swipe + axis-lock + tap-preserve | `swipeRemove.ts` (exact) |
| Vertical-drag coexistence | `NowPlaying.svelte` `npTop*` + `dragClose.ts` |
| Flick velocity | `velocity.ts` |
| Loader markup/keyframe | `Nowbar.svelte` `.np-prog.indet` |
| Sheet `closed` snap (tap-collapse) | `NowPlaying.svelte` grip TAP path |
| prev/next + neighbor lookup | `player.svelte.ts` `next/prev/queue/ensureAhead` |

The only genuinely NEW motion (carousel 3-cover strip + iOS rubber-band easing) has no exact analog but is a documented composition of the swipe action (`swipeRemove`) + the measure idiom (`measureOffsets`) + the UI-SPEC §1/§2 formulas — not a new pattern, a new application.

## Metadata

**Analog search scope:** `src/lib/actions/`, `src/lib/gestures/`, `src/lib/components/` (NowPlaying, Nowbar), `src/lib/stores/player.svelte.ts`
**Files scanned:** 6 (+ directory listings of actions/gestures)
**Pattern extraction date:** 2026-06-11
