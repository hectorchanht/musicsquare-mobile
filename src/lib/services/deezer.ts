// deezer — the thin, never-throws Deezer cover client (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for home discovery tiles (it has far stronger
// Western + decent CN album-cover coverage and — unlike iTunes / Last.fm — real artist-
// picture coverage). This module ONLY builds the search URL and does a bounded fetch through
// the OWN-ORIGIN proxy /api/deezer/search. It does NOT call api.deezer.com directly: the
// browser fetch to Deezer is CORS-blocked (api.deezer.com sends no Access-Control-Allow-Origin),
// so the request MUST go through the edge proxy (which also gives caching + posture parity).
//
// POSTURE (mirrors itunes-cover.ts, which this supersedes):
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

const PROXY_PATH = '/api/deezer/search';
const FETCH_TIMEOUT_MS = 6000;

/** The proxy's client-facing reshape (mirrors the +server.ts DeezerCover interface). */
interface DeezerCover {
	cover: string | null;
	artistPicture: string | null;
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
	const result = await fetchDeezer(term, signal);
	return result?.cover ?? null;
}

/**
 * Resolve an artist picture via the Deezer proxy for the artist name. Returns the artist
 * picture URL or null on any miss/abort/throw (never throws). Deezer (unlike iTunes/Last.fm)
 * carries a real artist picture, so this is the artist-tile cover source.
 */
export async function deezerArtistCover(
	artist: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = (artist ?? '').trim();
	if (!term) return null;
	const result = await fetchDeezer(term, signal);
	return result?.artistPicture ?? null;
}
