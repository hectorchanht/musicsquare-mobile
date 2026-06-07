// deezer — the thin, never-throws Deezer cover client (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for home discovery tiles (it has far stronger
// Western + decent CN album-cover coverage and — unlike Last.fm — real artist-picture
// coverage). This module ONLY builds the search URL and does a bounded fetch through
// the OWN-ORIGIN proxy /api/deezer/search. It does NOT call api.deezer.com directly: the
// browser fetch to Deezer is CORS-blocked (api.deezer.com sends no Access-Control-Allow-Origin),
// so the request MUST go through the edge proxy (which also gives caching + posture parity).
//
// POSTURE (mirrors the prior never-throws cover client this supersedes):
//  - Every network path NEVER throws: a non-ok response / { cover:null } / malformed JSON /
//    abort / any throw all return null. A null → the caller leaves the gradient (never a broken
//    image, never blocks first paint — callers fire this post-paint, capped + cached).
//  - The resolved value is a plain URL string consumed ONLY as an `<img src>` ATTRIBUTE
//    downstream (never a CSS url()); the proxy already host-allow-listed it to https *.dzcdn.net.
//  - NO secret/key/PII crosses the boundary (Deezer search is public); NO new env var, NO new
//    npm dependency (plain fetch + URL + URLSearchParams).
//  - Every call is bounded by AbortSignal.timeout(FETCH_TIMEOUT_MS) AND honors a caller signal
//    (short-circuits to null immediately if the caller's signal is already aborted), so a
//    slow/hung response can never pile up against the CAP=3 + total-max backfill pool.

import { cached } from './ttl-cache';

const PROXY_PATH = '/api/deezer/search';
const CHART_PATH = '/api/deezer/chart';
const RELATED_PATH = '/api/deezer/related';
const FETCH_TIMEOUT_MS = 6000;
// k3y client-side TTLs. The proxies already edge-cache at 24h; these wrappers eliminate the
// repeat NETWORK ROUNDTRIP entirely for same-session re-queries (no edge hit at all). Covers
// rarely change; search/related change slowly.
const TTL_COVER = 24 * 60 * 60 * 1000; // 24h — matches edge TTL
const TTL_SEARCH = 60 * 60 * 1000;     // 1h — search/related are less stable than covers
const TTL_RELATED = 60 * 60 * 1000;

/** The proxy's client-facing reshape (mirrors the +server.ts DeezerCover interface). */
interface DeezerCover {
	cover: string | null;
	artistPicture: string | null;
	/** Top-N reshaped hits when the proxy was called with `&limit=N>1` (quick-260607-jau). */
	results?: DeezerHit[];
}

/** One reshaped Deezer search hit (jau). Mirrors the +server.ts DeezerHit interface. */
export interface DeezerHit {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	preview: string | null;
}

/** Chart item shapes (mirror the /api/deezer/chart +server.ts reshape + lastfm Discovery* shapes). */
export interface DeezerChartTrack {
	artist: string;
	title: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChartArtist {
	name: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChartResult {
	tracks: DeezerChartTrack[];
	artists: DeezerChartArtist[];
}

const EMPTY_CHART: DeezerChartResult = { tracks: [], artists: [] };

/**
 * Fetch the Deezer top-tracks + top-artists chart through the OWN-ORIGIN proxy. Each item
 * carries its cover/picture NATIVELY (no per-tile backfill), so this is the PRIMARY home
 * top-hits + top-artists source. Never throws: any non-ok / abort / timeout / malformed JSON
 * returns { tracks: [], artists: [] } so the caller falls back to the Last.fm chart.
 */
export async function deezerChart(limit = 18, signal?: AbortSignal): Promise<DeezerChartResult> {
	if (signal?.aborted) return EMPTY_CHART;
	return cached(`dz:chart:${limit}`, TTL_RELATED, async () => {
		try {
			const url = `${CHART_PATH}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
			const res = await fetch(url, { signal: combinedSignal(signal) });
			if (!res.ok) return EMPTY_CHART;
			const data = (await res.json()) as Partial<DeezerChartResult>;
			return { tracks: data.tracks ?? [], artists: data.artists ?? [] };
		} catch {
			return EMPTY_CHART;
		}
	});
}

/**
 * Build the OWN-ORIGIN proxy URL for a search `term`. The term is encoded via URLSearchParams
 * (no raw spaces / special chars leak into the query). Points at /api/deezer/search — NEVER
 * api.deezer.com (the browser fetch to Deezer is CORS-blocked, so it must be proxied).
 */
export function buildDeezerSearchUrl(term: string): string {
	return `${PROXY_PATH}?${new URLSearchParams({ q: term }).toString()}`;
}

/**
 * Combine the caller's AbortSignal (if any) with a per-call timeout so a hung request always
 * settles. Uses AbortSignal.any when available, else falls back to the timeout signal alone
 * (still bounded — the caller's pre-fetch `aborted` check short-circuits the common case).
 */
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}

/**
 * Bounded, never-throws GET of the proxy → the parsed { cover, artistPicture } reshape, or
 * null on: already-aborted caller signal (no fetch), empty term (no fetch), non-ok response,
 * malformed JSON, abort/timeout, or any thrown error.
 */
async function fetchDeezer(term: string, signal?: AbortSignal): Promise<DeezerCover | null> {
	if (signal?.aborted) return null;
	const clean = (term ?? '').trim();
	if (!clean) return null;
	try {
		const res = await fetch(buildDeezerSearchUrl(clean), { signal: combinedSignal(signal) });
		if (!res.ok) return null;
		return (await res.json()) as DeezerCover;
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → gradient.
		return null;
	}
}

/**
 * Resolve a song album cover via the Deezer proxy for `${artist} ${title}`. Returns the cover
 * URL or null on any miss/abort/throw (never throws).
 */
export async function deezerSongCover(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = `${artist ?? ''} ${title ?? ''}`.trim();
	if (!term) return null;
	// k3y client cache: memo the resolved cover so repeat lookups skip the edge round-trip.
	return cached(`dz:cover:song:${term}`, TTL_COVER, async () => {
		const result = await fetchDeezer(term, signal);
		return result?.cover ?? null;
	});
}

/**
 * Resolve an artist picture via the Deezer proxy for the artist name. Returns the artist
 * picture URL or null on any miss/abort/throw (never throws). Deezer (unlike Last.fm)
 * carries a real artist picture, so this is the artist-tile cover source.
 */
export async function deezerArtistCover(
	artist: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = (artist ?? '').trim();
	if (!term) return null;
	return cached(`dz:cover:artist:${term}`, TTL_COVER, async () => {
		const result = await fetchDeezer(term, signal);
		return result?.artistPicture ?? null;
	});
}

/**
 * Search Deezer for top-N normalized hits (quick-260607-jau). Used for cross-source dedupe
 * signals + metadata enrichment. Returns [] on miss/abort/throw (never throws). The proxy
 * caps `limit` to [1,25].
 */
export async function deezerSearchTopN(
	term: string,
	limit = 10,
	signal?: AbortSignal
): Promise<DeezerHit[]> {
	if (signal?.aborted) return [];
	const clean = (term ?? '').trim();
	if (!clean) return [];
	// k3y client cache: key by (term, limit). Repeat callers (dedupe-deezer hot path) skip
	// the network entirely for an hour.
	return cached(`dz:search:${clean}|${limit}`, TTL_SEARCH, async () => {
		const url = `${PROXY_PATH}?${new URLSearchParams({ q: clean, limit: String(limit) }).toString()}`;
		try {
			const res = await fetch(url, { signal: combinedSignal(signal) });
			if (!res.ok) return [] as DeezerHit[];
			const data = (await res.json()) as DeezerCover;
			return data.results ?? [];
		} catch {
			return [] as DeezerHit[];
		}
	});
}

/**
 * Fetch related artists (by name) via Deezer's `artist/{id}/related` endpoint, proxied as
 * `/api/deezer/related?artist=…&limit=…`. Returns the cleaned name list, or [] on
 * miss/abort/throw. Used as a fallback for similar.ts when LASTFM_KEY is absent / Last.fm
 * returns empty (quick-260607-jau).
 */
export async function deezerRelatedArtists(
	artist: string,
	limit = 8,
	signal?: AbortSignal
): Promise<string[]> {
	if (signal?.aborted) return [];
	const clean = (artist ?? '').trim();
	if (!clean) return [];
	return cached(`dz:related:${clean}|${limit}`, TTL_RELATED, async () => {
		const url = `${RELATED_PATH}?${new URLSearchParams({ artist: clean, limit: String(limit) }).toString()}`;
		try {
			const res = await fetch(url, { signal: combinedSignal(signal) });
			if (!res.ok) return [] as string[];
			const data = (await res.json()) as { artists?: string[] };
			return Array.isArray(data?.artists) ? data!.artists! : [];
		} catch {
			return [] as string[];
		}
	});
}
