// Module-scoped morph store (quick-260607-gte). Carries the captured "from" rects of the now-bar's
// cover / title / artist slots through the moment the now-bar unmounts and NowPlaying mounts.
// NowPlaying.onMount reads these rects, measures its own target rects, computes the inverse FLIP
// transforms, applies them as the initial visual state, then drops them on the next rAF so a CSS
// transition runs the shared-element morph (small → big, nowbar slot → NP slot).
//
// `from` is intentionally NOT $state — the consumer reads it once on mount inside onMount() (so
// reactivity isn't needed) and we don't want Svelte to track it as a dependency of an effect that
// might re-run mid-morph and clobber the transform.

export interface MorphRect {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Captured font-size in px so the title/artist text scales by ratio (transform isn't used —
	 *  font-size is animated via a CSS var so line breaks / wrapping stay correct). */
	fontPx?: number;
}

export interface MorphFrom {
	art: MorphRect;
	title: MorphRect;
	artist: MorphRect;
}

let _from: MorphFrom | null = null;

/** Snapshot the now-bar slot rects (call BEFORE flipping `player.expanded = true`). */
export function captureFrom(art: HTMLElement | null, title: HTMLElement | null, artist: HTMLElement | null): boolean {
	if (!art || !title || !artist) return false;
	const ar = art.getBoundingClientRect();
	const tr = title.getBoundingClientRect();
	const arr = artist.getBoundingClientRect();
	const tFs = parseFloat(getComputedStyle(title).fontSize) || 0;
	const aFs = parseFloat(getComputedStyle(artist).fontSize) || 0;
	_from = {
		art: { left: ar.left, top: ar.top, width: ar.width, height: ar.height },
		title: { left: tr.left, top: tr.top, width: tr.width, height: tr.height, fontPx: tFs },
		artist: { left: arr.left, top: arr.top, width: arr.width, height: arr.height, fontPx: aFs }
	};
	return true;
}

/** Read the captured from-rects (one-shot — clears on read so a later mount doesn't re-fire). */
export function takeFrom(): MorphFrom | null {
	const out = _from;
	_from = null;
	return out;
}

/** Discard any captured rects (used when an in-flight gesture is cancelled). */
export function clearFrom(): void {
	_from = null;
}

/** Reduced-motion guard — when true, callers skip the morph and snap into rest state instantly. */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}
