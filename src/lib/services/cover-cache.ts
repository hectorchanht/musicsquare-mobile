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
//
// quick-260606-v7k adds an ARTIST-ONLY cover key (artistCoverCacheKey) so the 熱門歌手
// (top-artist) tiles can cache a backfilled artist image (Deezer, wv8) WITHOUT colliding with
// a {artist,title} track row of the same name. The artist entry is `'artist:' + matchKey(name, '')`
// — the `artist:` prefix is provably disjoint from any track key (matchKey never emits a
// leading `artist:`), so artist + track entries safely coexist in the same flat record.

import { matchKey } from './match-key';

const CACHE_KEY = 'openmusic:cover-cache:v1';

/** The cache key for an {artist,title} pair — delegates to matchKey (artist-first, folded). */
export function coverCacheKey(artist: string, title: string): string {
	return matchKey(artist, title);
}

/**
 * The cache key for an ARTIST-only cover (distinct from coverCacheKey). Pinned form:
 * `'artist:' + matchKey(name, '')`. The `artist:` prefix guarantees it can never collide
 * with a track key (which is `matchKey(artist,title)` and never starts with `artist:`),
 * so 'Drake' the artist and a 'Drake'|'<title>' track are disjoint entries.
 */
export function artistCoverCacheKey(artist: string): string {
	return 'artist:' + matchKey(artist, '');
}

/** Wipe the entire cover cache (used by the Data settings tab). Never throws. */
export function clearCoverCache(): void {
	try {
		localStorage.removeItem(CACHE_KEY);
	} catch {
		/* unavailable storage — no-op */
	}
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
	return readKey(coverCacheKey(artist, title));
}

/** Read the cached URL stored under `key`, or null when absent (never throws). */
function readKey(key: string): string | null {
	const url = readRecord()[key];
	return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Merge `{ [key]: url }` into the stored record and write it back. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache).
 */
function writeKey(key: string, url: string): void {
	const clean = (url ?? '').trim();
	if (!clean) return; // no-op — never cache an empty cover (keeps the gradient)
	try {
		const rec = readRecord();
		rec[key] = clean;
		localStorage.setItem(CACHE_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the tile simply keeps its gradient */
	}
}

/**
 * Merge `{ [coverCacheKey] : url }` into the stored record. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache).
 * Persists across calls within the same storage.
 */
export function setCachedCover(artist: string, title: string, url: string): void {
	writeKey(coverCacheKey(artist, title), url);
}

/**
 * Return the cached ARTIST cover URL for `artist`, or null when absent / on corrupt /
 * unavailable storage. Pure read — never throws. Disjoint from the track lookup.
 */
export function getCachedArtistCover(artist: string): string | null {
	return readKey(artistCoverCacheKey(artist));
}

/**
 * Cache an ARTIST cover URL under the artist-only key. No-op on an empty / whitespace-only
 * url; swallows quota / unavailable-storage errors. Coexists with track entries.
 */
export function setCachedArtistCover(artist: string, url: string): void {
	writeKey(artistCoverCacheKey(artist), url);
}
