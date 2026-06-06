import type { Action } from 'svelte/action';

// use:marquee — marquee-bounce a label whose text overflows its box (quick-260606-rvy FIX-C).
//
// Discovery tile titles/artists (.al-name / .al-count) are nowrap+ellipsis clipped boxes. When
// the text is wider than the box this action reveals the hidden tail by bounce-scrolling it
// (a CSS keyframe in the consuming component, keyed off the `.marquee-on` class this action
// adds + the `--marquee-dx` custom property it sets to the exact overflow distance). When the
// text fits, the class is removed → the default static ellipsis stays.
//
// SSR-SAFE: all DOM/observer/matchMedia access is guarded behind `typeof` checks so the action
// is a no-op on the server. REDUCED-MOTION: when the user prefers reduced motion we never add
// the class (static ellipsis), as defense-in-depth alongside the component's @media gate. A
// ResizeObserver re-measures on layout changes (font load, container resize, language switch).

/**
 * Pure helper: is the content (`scrollWidth`) wider than the visible box (`clientWidth`)?
 * Strict `>` so an exact fit does NOT marquee. Exported for unit testing in isolation.
 */
export function isOverflowing(scrollWidth: number, clientWidth: number): boolean {
	return scrollWidth > clientWidth;
}

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

// Marquee tuning. MIN_OVERFLOW_PX: below this much clipping, don't animate (static ellipsis —
// a 2-3px crawl reads as a twitch). SPEED_PX_PER_S: scroll speed (lower = slower/calmer).
// HOLD_S: total time held at the start + end so the text rests fully revealed before reversing.
const MIN_OVERFLOW_PX = 8;
const SPEED_PX_PER_S = 38; // scroll speed — visibly moving but still calm/readable
const HOLD_S = 1.8; // total of the short start + end holds (keyframe % below)

export const marquee: Action<HTMLElement> = (node) => {
	let observer: ResizeObserver | null = null;

	function measure() {
		// Reduced-motion users always get the static ellipsis.
		if (prefersReducedMotion()) {
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
			return;
		}
		const overflow = node.scrollWidth - node.clientWidth;
		// Only animate a MEANINGFUL overflow. A few px of clipping is not worth a marquee and
		// reads as a twitch; below the threshold keep the static ellipsis.
		if (overflow > MIN_OVERFLOW_PX) {
			// Distance the text must travel to reveal its hidden tail.
			node.style.setProperty('--marquee-dx', `${overflow}px`);
			// Constant-ish SLOW speed: the scroll time scales with distance (+ fixed end holds),
			// so a short 11px overflow and a long 80px one both crawl smoothly at the same pace
			// instead of a fixed 5s that looked like a jitter on short labels. Paired with a
			// LINEAR timing function in the CSS so there is no ease-in/out wobble at the turns.
			const dur = overflow / SPEED_PX_PER_S + HOLD_S;
			node.style.setProperty('--marquee-dur', `${dur.toFixed(1)}s`);
			node.classList.add('marquee-on');
		} else {
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
			node.style.removeProperty('--marquee-dur');
		}
	}

	// Initial measure (after the current frame so layout/fonts have settled when possible).
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
	else measure();

	// Re-measure on size changes (font swap, container resize, i18n name length change), but
	// ONLY when the box WIDTH actually changed. Re-measuring on every observer callback (incl.
	// sub-pixel/height churn while the animation runs) would remove+re-add .marquee-on and
	// restart the animation → a visible twitch.
	if (typeof ResizeObserver !== 'undefined') {
		let lastWidth = -1;
		observer = new ResizeObserver((entries) => {
			const w = Math.round(entries[0]?.contentRect?.width ?? node.clientWidth);
			if (w === lastWidth) return;
			lastWidth = w;
			measure();
		});
		observer.observe(node);
	}

	return {
		destroy() {
			observer?.disconnect();
			observer = null;
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
		}
	};
};
