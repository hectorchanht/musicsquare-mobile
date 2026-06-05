import type { Action } from 'svelte/action';

// use:longpress — fires an `onlongpress` CustomEvent after a hold (~450ms).
// Cancels on >8px move or pointer up/leave. Suppresses the native context menu.
export const longpress: Action<HTMLElement, number | undefined, { onlongpress: (e: CustomEvent) => void }> = (
	node,
	duration = 450
) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let sx = 0;
	let sy = 0;
	const clear = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};
	const down = (e: PointerEvent) => {
		sx = e.clientX;
		sy = e.clientY;
		clear();
		timer = setTimeout(() => {
			timer = null;
			node.dispatchEvent(new CustomEvent('longpress'));
		}, duration ?? 450);
	};
	const move = (e: PointerEvent) => {
		if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) clear();
	};
	const ctx = (e: Event) => e.preventDefault();
	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', clear);
	node.addEventListener('pointerleave', clear);
	node.addEventListener('pointercancel', clear);
	node.addEventListener('contextmenu', ctx);
	return {
		destroy() {
			clear();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', clear);
			node.removeEventListener('pointerleave', clear);
			node.removeEventListener('pointercancel', clear);
			node.removeEventListener('contextmenu', ctx);
		}
	};
};
