import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';

// use:coverSwipe — finger-drag-SIDEWAYS to change track (Phase 20, NP-01 cover carousel / NP-05
// nowbar slide). A structural X-axis MIRROR of swipeRemove.ts: same arm-on-down /
// commit-axis-after-slop / capture-only-in-move / trailing-click-suppressor idiom, reused so the
// load-bearing Pitfall-7 invariant is shared verbatim across every horizontal gesture in the repo.
//
// LOAD-BEARING INVARIANT (ROADMAP Pitfall 7 — the single highest-risk interaction in v1.2):
//   Never `setPointerCapture` on `pointerdown`. Arm on down; commit axis in `pointermove` after
//   the 8px slop + axis-dominance check; capture only then. Sub-slop movement must still reach
//   `onclick` (the host's tap-to-collapse / tap-to-expand keeps firing).
//
// Three deltas from the swipeRemove.ts analog, pinned by the 20-UI-SPEC:
//  1. Proportional commit (D-08): the distance commit is `0.28 × measuredWidth` (measured at
//     down() via getBoundingClientRect, mirroring NowPlaying's measure-at-drag-start idiom),
//     NOT a flat 96px. maxPull for the boundary rubber-band is `0.18 × measuredWidth`.
//  2. prev/next + live dx (D-03): exposes `onprev`/`onnext` (drag RIGHT = onprev, drag LEFT =
//     onnext — reuse player.prev()/next(), NO new advance logic) plus a per-frame `ondrag(dx)`
//     so a host can drive a 3-cover carousel strip (1:1 lockstep, UI-SPEC §1) or a nowbar slide.
//  3. iOS rubber-band at a true boundary (D-02 / UI-SPEC §2): when the relevant neighbor is
//     absent (prev gesture && hasPrev:false, or next gesture && hasNext:false) the live translate
//     is clamped to `sign(dx)·maxPull·(1 − e^(−|dx|/maxPull))`, flick is IGNORED, and the gesture
//     ALWAYS springs back to translateX(0) over 0.32s (the heavier cover-reflow settle).
//
// Shared with the analog byte-for-byte: SLOP = 8, FLICK_V = 0.5 px/ms, settle curve
// cubic-bezier(.22,1,.36,1), pan-y touch-action on attach, the capture-phase one-shot
// suppressClick armed in up() only when captured, and a destroy() that drops the suppressor +
// resets inline styles + clears touchAction.
export interface CoverSwipeOpts {
	onprev: () => void;
	onnext: () => void;
	/** Live per-frame running dx (px) during a committed horizontal drag — host drives its strip. */
	ondrag?: (dx: number) => void;
	/** False = no prev neighbor → a prev (drag-right) gesture rubber-bands and never fires. Default true. */
	hasPrev?: boolean;
	/** False = no next neighbor → a next (drag-left) gesture rubber-bands and never fires. Default true. */
	hasNext?: boolean;
	enabled?: boolean;
}

export const coverSwipe: Action<HTMLElement, CoverSwipeOpts> = (node, opts) => {
	let onprev = opts.onprev;
	let onnext = opts.onnext;
	let ondrag = opts.ondrag;
	let hasPrev = opts.hasPrev ?? true;
	let hasNext = opts.hasNext ?? true;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let captured = false;
	let resisting = false; // true once a committed gesture is pulling against a true boundary
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let commitDist = 0; // 0.28 × measuredWidth, recomputed at each down()
	let maxPull = 0; // 0.18 × measuredWidth, the rubber-band asymptote
	const SLOP = 8; // px before a press becomes a drag (swipeRemove's SLOP / dragClose's DRAG_START)
	const FLICK_V = 0.5; // px/ms — a fast horizontal flick commits even when not dragged far
	const COMMIT_FRACTION = 0.28; // D-08 / UI-SPEC §3: distance commit = 28% of the element width
	const MAX_PULL_FRACTION = 0.18; // UI-SPEC §2: rubber-band asymptote = 18% of the element width
	const vel = createVelocityTracker();

	// pan-y: keep vertical scroll/collapse with the browser, yield the horizontal axis to this action.
	node.style.touchAction = 'pan-y';

	function resetTransform() {
		node.style.transform = '';
		node.style.transition = '';
	}

	// Swallow the trailing click after a COMMITTED horizontal drag. setPointerCapture retargets the
	// click to this node, and on mouse input a click fires after every mousedown→mouseup regardless
	// of travel — without this, a committed swipe would change the track AND then fire the host's
	// tap-to-collapse / tap-to-expand onclick. Armed in up() only when the gesture captured;
	// self-removes after one click; disarmed on the next pointerdown so a touch release that never
	// produces a click can't swallow a LATER genuine tap.
	function suppressClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		node.removeEventListener('click', suppressClick, true);
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// A new gesture starts clean: drop a stale suppressor from a prior committed drag whose
		// trailing click never fired (touch input suppresses it natively).
		node.removeEventListener('click', suppressClick, true);
		dragging = true;
		captured = false;
		resisting = false;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		// Measure the element width at gesture start (like NowPlaying.measureOffsets reads the live
		// layout) so the commit + rubber-band scale with the actual cover/nowbar width, never hardcoded.
		const width = node.getBoundingClientRect().width;
		commitDist = COMMIT_FRACTION * width;
		maxPull = MAX_PULL_FRACTION * width;
		vel.reset();
		vel.sample(e.clientX, e.timeStamp); // velocity tracker seeded on X (axis-agnostic helper)
		// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click to
		// THIS node, so a tap never reaches the host's onclick (tap-to-collapse / tap-to-expand
		// "did nothing"). Capture only once an actual horizontal drag begins (in move()).
		node.style.transition = 'none';
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const ddx = e.clientX - startX;
		const ddy = e.clientY - startY;
		if (!captured) {
			// Below slop on BOTH axes → still a tap; leave the click to the host (no slide yet).
			if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;
			// Vertical wins → go passive so the host's vertical-collapse handler / scroll runs (no capture).
			if (Math.abs(ddy) > Math.abs(ddx)) {
				dragging = false;
				// up() early-returns once dragging is false, so clear the transition:none set in down()
				// HERE — otherwise a vertical-collapse gesture that STARTS on this node permanently
				// defeats the host's CSS settle + reduced-motion transition (CR-02).
				node.style.transition = '';
				return;
			}
			// Horizontal commit: capture HERE (not on down) so the gesture keeps flowing past the
			// node edge while a tap (never reaching slop) leaves the click to the host.
			node.setPointerCapture(e.pointerId);
			captured = true;
		}
		dx = e.clientX - startX;
		vel.sample(e.clientX, e.timeStamp);
		ondrag?.(dx); // report the running dx so the host can translate its carousel strip / content
		// A prev gesture (drag RIGHT, dx > 0) at hasPrev:false, or a next gesture (drag LEFT,
		// dx < 0) at hasNext:false, hits a true queue wall → rubber-band clamp + flick-ignored.
		resisting = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
		if (resisting) {
			// Classic iOS rubber-band: finger travel asymptotes toward maxPull, never reaching it.
			const offset = Math.sign(dx) * maxPull * (1 - Math.exp(-Math.abs(dx) / maxPull));
			node.style.transform = `translateX(${offset}px)`;
		} else {
			node.style.transform = `translateX(${dx}px)`; // 1:1 lockstep follow (UI-SPEC §1)
		}
	}

	function up() {
		if (!dragging) return;
		dragging = false;
		// A gesture that committed (captured) must NOT let its trailing click reach the host's
		// onclick — neither after a track change nor after a spring-back (the user clearly dragged,
		// not tapped). Capture-phase, one-shot.
		if (captured) node.addEventListener('click', suppressClick, true);
		captured = false;
		// At a TRUE BOUNDARY: ignore flick entirely and ALWAYS spring back over the heavier 0.32s
		// cover-reflow settle — a hard flick into a wall must never commit (UI-SPEC §2).
		if (resisting) {
			resisting = false;
			node.style.transition = 'transform 0.32s cubic-bezier(.22,1,.36,1)';
			node.style.transform = 'translateX(0)';
			dx = 0;
			return;
		}
		// Commit on a far drag (≥ proportional commit) OR a fast horizontal flick. The |dx| > SLOP
		// guard keeps the tap contract intact: a tap (sub-slop, low velocity) never commits.
		const v = vel.velocity();
		if (Math.abs(dx) >= commitDist || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
			// Direction → action (D-03): drag RIGHT = onprev, drag LEFT = onnext. No new advance
			// logic — these are the host's player.prev()/player.next().
			if (dx > 0) onprev();
			else onnext();
			// Unlike swipeRemove (whose node leaves the DOM on commit), the carousel strip / nowbar
			// content PERSISTS across the player.prev()/next() swap. Drop the live translateX(dx) +
			// transition:none left from the drag, or the freshly-swapped cover renders frozen
			// ~commitDist off-centre (CR-01). resetTransform() restores the host CSS resting state
			// (translateX(0)); the host's own transition animates the new cover into place.
			resetTransform();
		} else {
			// Spring back: re-enable transitions, animate translateX → 0.
			node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1)';
			node.style.transform = 'translateX(0)';
		}
		dx = 0;
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: CoverSwipeOpts) {
			onprev = next.onprev;
			onnext = next.onnext;
			ondrag = next.ondrag;
			hasPrev = next.hasPrev ?? true;
			hasNext = next.hasNext ?? true;
			enabled = next.enabled ?? true;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', suppressClick, true); // drop an armed suppressor
			resetTransform();
			node.style.touchAction = '';
		}
	};
};
