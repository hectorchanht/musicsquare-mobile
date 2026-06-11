import type { Action } from 'svelte/action';
import type { Track } from '$lib/sources/types';
import { getCachedCoverByUid, getCachedCover } from '$lib/services/cover-cache';
import { resolveCoverForTrack } from '$lib/services/cover-backfill';

// use:lazyCover — resolve a track-row cover ONLY when the row scrolls into view (COVER-02).
//
// WHY (Phase 21): a search / list surface renders dozens of rows; eagerly resolving every cover
// would fan out a network storm and refetch the same song on every re-render. This action defers
// the resolve to first intersection, reads the two-layer cache first (uid → name, D-13), repairs a
// broken existing cover via an Image() probe (D-15), and reuses the SHARED single-item tier chain
// (resolveCoverForTrack — Deezer→iTunes→CN, never a new resolver). It fires AT MOST ONCE per row
// (unobserve-after-first + one-shot done flag), de-dupes concurrent resolves for the same uid via a
// module-level in-flight Set (Pitfall 5), and disconnects the observer on destroy (T-21-05 DoS).
//
// SECURITY (T-0bb-01): only the SOLID https URLs the cache/chain already gate ever reach onResolved;
// the resolved string is consumed by the caller as an `<img src>` ATTRIBUTE (never CSS url()).
//
// The action mirrors longpress.ts: a classic Action<HTMLElement, Param> closure that returns
// { destroy }. It is browser-only — the IntersectionObserver + Image() are guarded for SSR.

export interface LazyCoverParam {
	track: Track;
	/** Called with (uid, url) when a SOLID cover is available (cache hit, good existing cover, or resolved). */
	onResolved: (uid: string, url: string) => void;
}

// Module-level de-dupe: a uid currently resolving anywhere on the page is in this Set, so two
// observers for the same song (e.g. the row + a duplicate) run the chain only once (Pitfall 5).
const inFlight = new Set<string>();

/** SOLID = a non-empty https URL (the only thing we render / cache). */
function isHttps(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
}

/**
 * Resolve a row's cover, never throwing. Read order (D-13): uid-first then name; on a cache hit fire
 * onResolved and return (no network). Else if the track already carries a non-empty https cover,
 * probe it with new Image() — onload keeps it (no chain), onerror treats it as broken and runs the
 * chain (D-15). On empty / broken / cache-miss, run the shared single-item resolve helper; a SOLID
 * result fires onResolved (the helper already wrote both cache layers).
 */
async function resolveCoverForRow(track: Track, onResolved: (uid: string, url: string) => void) {
	try {
		// (1) Cache-first — uid layer, then the {artist,title} name layer (D-13). No network on a hit.
		const cached = getCachedCoverByUid(track.uid) ?? getCachedCover(track.artist, track.title);
		if (isHttps(cached)) {
			onResolved(track.uid, cached);
			return;
		}

		// (2) An existing non-empty https cover → probe it; keep on load, repair on error (D-15).
		if (isHttps(track.cover)) {
			const keep = await probeImage(track.cover);
			if (keep) {
				onResolved(track.uid, track.cover);
				return;
			}
			// onerror → fall through to the chain (broken-URL repair).
		}

		// (3) Empty / broken / cache-miss → run the shared tier chain (de-duped per uid).
		if (inFlight.has(track.uid)) return;
		inFlight.add(track.uid);
		try {
			const url = await resolveCoverForTrack(track);
			if (isHttps(url)) onResolved(track.uid, url);
		} finally {
			inFlight.delete(track.uid);
		}
	} catch {
		// Best-effort — a failure leaves the gradient (never a broken image, never throws).
	}
}

/**
 * Probe a cover URL with new Image(). Resolves true if it loads (keep it), false on error (treat as
 * broken → repair). SSR guard: when Image is undefined, resolve false so the chain repairs it via
 * the (also-guarded) network path. Never rejects.
 */
function probeImage(url: string): Promise<boolean> {
	if (typeof Image === 'undefined') return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		try {
			const img = new Image();
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = url;
		} catch {
			resolve(false);
		}
	});
}

export const lazyCover: Action<HTMLElement, LazyCoverParam> = (node, param) => {
	let current = param;
	let done = false; // one-shot: a row resolves at most once

	// SSR / no-IO guard — the action is a no-op (the caller keeps whatever cover it has).
	if (typeof IntersectionObserver === 'undefined') {
		return {
			update(next: LazyCoverParam) {
				current = next;
			},
			destroy() {
				/* nothing observed — no-op */
			}
		};
	}

	const io = new IntersectionObserver(
		(entries) => {
			if (done) return;
			if (entries[0]?.isIntersecting) {
				done = true;
				io.unobserve(node); // fire at most once — stop observing after the first intersection
				void resolveCoverForRow(current.track, current.onResolved);
			}
		},
		// rootMargin 200px: prefetch slightly before the row is truly on-screen for a smoother scroll
		// (discretion — tighter than the search sentinel's 400px since covers are cheaper than a page).
		{ root: null, rootMargin: '200px 0px' }
	);
	io.observe(node);

	return {
		update(next: LazyCoverParam) {
			current = next;
		},
		destroy() {
			io.disconnect();
		}
	};
};
