import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';

// use:dragClose — finger-drag-DOWN to dismiss any sheet/modal element.
// Mirrors NowPlaying's coverDown/coverMove/coverUp live-drag idiom.
//
// Contract:
//  - While the finger is down the node follows it via inline translateY (transition
//    off) — a live, finger-following drag, never a tap-then-snap.
//  - On release: dragged DOWN past `threshold` (default 120px, matching the cover's
//    existing 120px) OR a fast downward flick (velocity > V with dy > 8) → call onclose()
//    immediately so the host's existing {#if} transition:fly plays the close animation (we
//    reset our inline transform first so the fly-out starts clean). Below threshold and no
//    flick → animate back to 0 (snap-back).
//  - TAP-PRESERVING: we never preventDefault on pointerdown and only dismiss when the
//    release distance exceeds `threshold` OR a deliberate flick is detected; a tap (dy<8,
//    low velocity) NEVER dismisses, so child onclick handlers (e.g. `.mi` menu buttons)
//    keep firing normally.
//  - touch-action:none + user-select:none are set on attach so a drag never selects
//    text or scrolls the page on mobile.
//  - Reactive `update(opts)` swaps onclose / toggles `enabled`. `enabled:false` makes
//    the action inert (no drag). destroy() removes listeners + resets inline styles.
export interface DragCloseOpts {
	onclose: () => void;
	threshold?: number;
	enabled?: boolean;
}

export const dragClose: Action<HTMLElement, DragCloseOpts> = (node, opts) => {
	let onclose = opts.onclose;
	let threshold = opts.threshold ?? 120;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let captured = false;
	let startY = 0;
	let dy = 0;
	const DRAG_START = 8; // px before a press becomes a drag (and we capture the pointer)
	const vel = createVelocityTracker();
	const FLICK_V = 0.5; // px/ms — a fast downward flick dismisses even when not dragged far

	// Prevent text-selection / page-scroll while dragging on touch devices.
	node.style.touchAction = 'none';
	node.style.userSelect = 'none';
	(node.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';

	function resetTransform() {
		node.style.transform = '';
		node.style.transition = '';
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		dragging = true;
		captured = false;
		startY = e.clientY;
		dy = 0;
		vel.reset();
		vel.sample(e.clientY, e.timeStamp);
		// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click
		// to THIS node, so a tap on a child .mi button never reaches its onclick (the menu
		// actions "did nothing"). Capture only once an actual drag begins (in move()).
		node.style.transition = 'none';
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		vel.sample(e.clientY, e.timeStamp);
		dy = Math.max(0, e.clientY - startY);
		// Capture once the gesture is clearly a drag — keeps pointer events flowing past the
		// node edge, while a tap (never reaching DRAG_START) leaves the click to the child.
		if (!captured && dy > DRAG_START) {
			node.setPointerCapture(e.pointerId);
			captured = true;
		}
		if (captured) node.style.transform = `translateY(${dy}px)`;
	}
	function up() {
		if (!dragging) return;
		dragging = false;
		captured = false;
		// Dismiss on a far drag OR a fast downward flick (v > 0 = moving DOWN). The dy > 8
		// guard keeps the tap contract intact: a tap (dy < 8, low velocity) never dismisses.
		const v = vel.velocity();
		if (dy > threshold || (v > FLICK_V && dy > 8)) {
			// Hand off to the host's transition:fly — reset our inline transform first
			// so the fly-out animates from the resting position, not the dragged one.
			resetTransform();
			onclose();
		} else {
			// Snap back: re-enable the transition, animate translateY → 0.
			node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1)';
			node.style.transform = 'translateY(0)';
		}
		dy = 0;
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: DragCloseOpts) {
			onclose = next.onclose;
			threshold = next.threshold ?? 120;
			enabled = next.enabled ?? true;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			resetTransform();
			node.style.touchAction = '';
			node.style.userSelect = '';
		}
	};
};
