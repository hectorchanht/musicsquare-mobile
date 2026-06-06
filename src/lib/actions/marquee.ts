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
		if (isOverflowing(node.scrollWidth, node.clientWidth)) {
			// Distance the text must travel to reveal its hidden tail (+ a small reveal margin).
			node.style.setProperty('--marquee-dx', `${overflow}px`);
			node.classList.add('marquee-on');
		} else {
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
		}
	}

	// Initial measure (after the current frame so layout/fonts have settled when possible).
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
	else measure();

	// Re-measure on size changes (font swap, container resize, i18n name length change).
	if (typeof ResizeObserver !== 'undefined') {
		observer = new ResizeObserver(() => measure());
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
