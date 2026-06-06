import type { Action } from 'svelte/action';

// use:chipReorder — drag-to-reorder for a WRAP-FLOW row of chips (the section dragReorder
// action is vertical-list-only; chips wrap in 2D). Attaches to the chips CONTAINER; only
// children carrying `data-chip-index` (the SELECTED chips, in order) are draggable. A drag
// past THRESHOLD lifts the chip to follow the pointer (transform) and, on release, reorders to
// the index of the nearest other chip (2D center distance) via onReorder(from, to). A drag
// also arms a one-shot capture-phase click suppressor so the chip's tap-to-toggle onclick does
// NOT fire after a reorder (mirrors dragScroll's tap-vs-drag guard). A plain tap (no movement
// past THRESHOLD) falls through to the click. Reorder happens on DROP — not live — so the
// Svelte re-render of the reordered list never races the in-progress pointer capture.

const THRESHOLD = 6; // px of movement before a press becomes a drag (not a tap)

/** Pure: index of the chip center nearest (x,y); `fromIndex` if `centers` is empty. */
export function nearestChipIndex(
	x: number,
	y: number,
	centers: { index: number; cx: number; cy: number }[],
	fromIndex: number
): number {
	let best = fromIndex;
	let bestDist = Infinity;
	for (const c of centers) {
		const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = c.index;
		}
	}
	return best;
}

export interface ChipReorderOpts {
	onReorder: (from: number, to: number) => void;
}

export const chipReorder: Action<HTMLElement, ChipReorderOpts> = (node, opts) => {
	let onReorder = opts.onReorder;
	let chip: HTMLElement | null = null;
	let fromIndex = -1;
	let startX = 0;
	let startY = 0;
	let dragging = false;

	function draggableChip(e: PointerEvent): HTMLElement | null {
		const el = (e.target as HTMLElement | null)?.closest('[data-chip-index]');
		return el instanceof HTMLElement ? el : null;
	}

	function onDown(e: PointerEvent) {
		if (e.button != null && e.button !== 0) return;
		const c = draggableChip(e);
		if (!c) return;
		chip = c;
		fromIndex = Number(c.dataset.chipIndex);
		startX = e.clientX;
		startY = e.clientY;
		dragging = false;
		// NOTE: do NOT setPointerCapture here. Capturing on pointerdown retargets the trailing
		// `click` to the container, so a plain TAP never reaches the chip's onclick → the chip
		// could not be toggled off. Capture only once a DRAG actually starts (below).
	}

	function onMove(e: PointerEvent) {
		if (!chip) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!dragging && Math.hypot(dx, dy) > THRESHOLD) {
			dragging = true;
			chip.classList.add('chip-dragging');
			// Capture now (mid-drag) so pointer events keep flowing even past the container edge;
			// the post-drag click is suppressed in onUp, so retargeting is harmless here.
			node.setPointerCapture?.(e.pointerId);
		}
		if (dragging) {
			e.preventDefault();
			chip.style.transform = `translate(${dx}px, ${dy}px)`;
		}
	}

	function onUp(e: PointerEvent) {
		const c = chip;
		const wasDragging = dragging;
		if (c && wasDragging) {
			const centers = ([...node.querySelectorAll('[data-chip-index]')] as HTMLElement[])
				.filter((s) => s !== c)
				.map((s) => {
					const r = s.getBoundingClientRect();
					return { index: Number(s.dataset.chipIndex), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
				});
			const to = nearestChipIndex(e.clientX, e.clientY, centers, fromIndex);
			c.style.transform = '';
			c.classList.remove('chip-dragging');
			if (Number.isInteger(to) && Number.isInteger(fromIndex) && to !== fromIndex) {
				onReorder(fromIndex, to);
			}
			// Suppress the click that fires after a drag so tap-to-toggle doesn't run on drop.
			const suppress = (ev: Event) => {
				ev.stopPropagation();
				ev.preventDefault();
				node.removeEventListener('click', suppress, true);
			};
			node.addEventListener('click', suppress, true);
			setTimeout(() => node.removeEventListener('click', suppress, true), 0);
		}
		chip = null;
		dragging = false;
		fromIndex = -1;
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);

	return {
		update(next: ChipReorderOpts) {
			onReorder = next.onReorder;
		},
		destroy() {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
		}
	};
};
