import type { Action } from 'svelte/action';

// use:dragScroll — pointer/mouse drag-to-scroll for a horizontal shelf (quick-260606-rvy FIX-B).
//
// The discovery shelves (.albumrow) already scroll natively on TOUCH. On a DESKTOP/MOUSE the
// only scroll affordance was the scrollbar; this action makes the row grabbable so a click-drag
// pans it horizontally — additive for mouse, leaving touch's native momentum scroll untouched
// (so we deliberately do NOT set touch-action:none, unlike dragClose).
//
// THE TAP-VS-DRAG GUARD (the load-bearing bit): each shelf tile is a <button> whose onclick
// plays a song / navigates. Without a guard, releasing a drag over a tile would also fire that
// click → a shelf-pan would accidentally play a song. So we accumulate the total |dx| during a
// drag and, if it exceeds `threshold` (default 6px = a deliberate drag, not a jittery tap), we
// arm a one-shot CAPTURE-PHASE click suppressor: the very next `click` on the node is
// preventDefault()+stopPropagation()'d BEFORE it reaches the child tile button, then disarmed.
// A genuine tap (|dx| ≤ threshold) never arms it, so tile clicks fire normally. This mirrors
// dragClose's dy/velocity tap-preserving release contract.

/**
 * Pure helper: does a release that moved `totalDx` px horizontally count as a DRAG (suppress
 * the trailing click) rather than a TAP? True when |totalDx| strictly exceeds `threshold`
 * (default 6). Exported for unit testing the threshold in isolation.
 */
export function shouldSuppressClick(totalDx: number, threshold = 6): boolean {
	return Math.abs(totalDx) > threshold;
}

export interface DragScrollOpts {
	/** px of horizontal movement past which a release suppresses the trailing click. Default 6. */
	threshold?: number;
	/** When false the action is inert (no grab cursor, no drag). Default true. */
	enabled?: boolean;
}

export const dragScroll: Action<HTMLElement, DragScrollOpts | undefined> = (node, opts) => {
	let threshold = opts?.threshold ?? 6;
	let enabled = opts?.enabled ?? true;

	let dragging = false;
	let startX = 0;
	let startScrollLeft = 0;
	let totalDx = 0; // accumulated |dx| this gesture — decides drag vs tap on release
	let suppressNextClick = false; // armed when a drag exceeded threshold; eats the next click

	function applyCursor() {
		node.style.cursor = enabled ? 'grab' : '';
	}
	applyCursor();

	function down(e: PointerEvent) {
		if (!enabled) return;
		// Only hijack mouse/pen drags; let touch keep its native momentum scroll.
		if (e.pointerType === 'touch') return;
		dragging = true;
		startX = e.clientX;
		startScrollLeft = node.scrollLeft;
		totalDx = 0;
		node.style.cursor = 'grabbing';
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		const dx = e.clientX - startX;
		// Track the largest distance reached this gesture: a quick out-and-back drag is still a
		// drag (suppress the click) even if it ends near where it began.
		if (Math.abs(dx) > Math.abs(totalDx)) totalDx = dx;
		node.scrollLeft = startScrollLeft - dx;
	}
	function up() {
		if (!dragging) return;
		dragging = false;
		node.style.cursor = enabled ? 'grab' : '';
		// Arm the one-shot click suppressor only when this was a real drag, so a tap still plays.
		if (shouldSuppressClick(totalDx, threshold)) suppressNextClick = true;
	}
	// CAPTURE phase so we intercept before the child tile button's bubble-phase onclick.
	function clickCapture(e: MouseEvent) {
		if (suppressNextClick) {
			e.preventDefault();
			e.stopPropagation();
			suppressNextClick = false;
		}
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);
	node.addEventListener('pointerleave', up);
	node.addEventListener('click', clickCapture, true);

	return {
		update(next: DragScrollOpts | undefined) {
			threshold = next?.threshold ?? 6;
			enabled = next?.enabled ?? true;
			applyCursor();
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('pointerleave', up);
			node.removeEventListener('click', clickCapture, true);
			node.style.cursor = '';
		}
	};
};
