// cover-cache — the pure localStorage store of lazily-resolved CN-source covers.
//
// quick-260606-rvy FIX-A: chart/tag/geo discovery tiles with NO Last.fm image AND no
// MusicBrainz mbid render a bare color gradient. cover-backfill resolves a real album
// cover for them from the CN sources (searchAll → dedupeBest) AFTER first paint and
// stows it here, keyed by the normalized {artist,title} identity (matchKey, reused —
// NOT reinvented). On the next visit / re-render the cover is read back synchronously
// so the tile shows real art instantly with zero re-search.
//
// Stored shape is a single flat JSON `Record<string,string>` (matchKey → cover URL) at
// `openmusic:cover-cache:v1` — simpler than the home shelf cache since values are tiny.
// All localStorage access is wrapped in try/catch returning null / no-op on failure
// (corrupt JSON, quota, privacy-mode / unavailable storage). These functions run only
// in browser handlers / onMount, never SSR. Values are plain URL strings rendered into
// an `<img src>` ATTRIBUTE (never CSS url()) — no script/CSS-injection surface (T-rvy-01).

import { matchKey } from './match-key';

const CACHE_KEY = 'openmusic:cover-cache:v1';

/** The cache key for an {artist,title} pair — delegates to matchKey (artist-first, folded). */
export function coverCacheKey(artist: string, title: string): string {
	return matchKey(artist, title);
}

/** Read the whole record; returns {} on absent / corrupt / unavailable storage (never throws). */
function readRecord(): Record<string, string> {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
		return {};
	} catch {
		return {};
	}
}

/**
 * Return the cached cover URL for {artist,title}, or null when absent / on corrupt /
 * unavailable storage. Pure read — never throws (mirrors +page.svelte loadCache).
 */
export function getCachedCover(artist: string, title: string): string | null {
	const rec = readRecord();
	const url = rec[coverCacheKey(artist, title)];
	return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Merge `{ [key]: url }` into the stored record and write it back. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache).
 * Persists across calls within the same storage.
 */
export function setCachedCover(artist: string, title: string, url: string): void {
	const clean = (url ?? '').trim();
	if (!clean) return; // no-op — never cache an empty cover (keeps the gradient)
	try {
		const rec = readRecord();
		rec[coverCacheKey(artist, title)] = clean;
		localStorage.setItem(CACHE_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the tile simply keeps its gradient */
	}
}
