// Deezer cover/search edge proxy (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for the home discovery tiles. This route mirrors
// the /api/lastfm/discovery posture VERBATIM (own-origin CORS, OPTIONS 204 preflight,
// caches.default edge cache keyed by the OWN-ORIGIN Request, fetchWithRetry + native
// AbortSignal.timeout, a safeImageUrl host allow-list) — but carries NO secret: Deezer's
// public search needs no key, so there is NO env/secret read and NO proxy-types.ts Env
// change.
//
// LIVE Deezer probe (2026-06-06, curl vs api.deezer.com — the facts this route is built on):
//  - GET https://api.deezer.com/search?q=<term> → { data: [...], total }. A no-match returns
//    { data: [], total: 0 } — a CLEAN 200 with NO error envelope. No API key is required.
//  - data[0].album.cover_xl (1000) / cover_big (500) / cover_medium (250);
//    data[0].artist.picture_xl / picture_big.
//  - Image host is cdn-images.dzcdn.net (under .dzcdn.net); all https:.
//  - api.deezer.com sends NO Access-Control-Allow-Origin → a browser fetch is CORS-BLOCKED,
//    so this edge proxy is REQUIRED (it also adds caching + own-origin posture parity).
//  - Rate limit ~50 req / 5 s → caches.default TTL 86400 + the client CAP=3 + AbortSignal.timeout
//    keep us well under it (T-wv8-04 self-DoS guard).
//
// COVERS/search SCOPE ONLY: the upstream parse + reshape is funnelled through a single
// reshapeSearch() so the proxy can be EXTENDED later for charts/album/artist-info (tasks
// 3b/3c) WITHOUT restructuring — but only the search → { cover, artistPicture } path ships now.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

const DEEZER_SEARCH = 'https://api.deezer.com/search';

// Cover/artist-picture is near-static; one full day keeps re-browsing off Deezer's rate cap.
const TTL = 86400;

/** Client-facing reshape of a Deezer search top result. */
export interface DeezerCover {
	cover: string | null;
	artistPicture: string | null;
}

// The Cloudflare Cache API extends the standard CacheStorage with a `default` cache
// (caches.default). The DOM lib's CacheStorage does NOT declare `default` and shadows
// @cloudflare/workers-types' global, so we narrow through a minimal local interface for the
// subset we use. Absent in the dev runtime (`vite dev`) — guarded with `typeof caches`.
interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}
interface EdgeCacheStorage {
	default?: EdgeCache;
}
function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}

function jsonResult(result: DeezerCover, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerCover), { status: 200, headers });
}

/**
 * Validate an image URL before it leaves the edge (parity with the discovery route's
 * safeImageUrl, threat T-wv8-05). The client renders it as an `<img src>` attribute; even so
 * we reject anything that could break out of an attribute / inject a CSS url() layer. Allowed:
 * https:// only, on a *.dzcdn.net host, with NO CSS/attribute-breaking characters. Anything
 * else → null (the field becomes null → the tile keeps its gradient, never a broken image).
 */
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

// ---- Deezer response sub-shapes (only the fields we read; all optional — untrusted JSON). ----
interface DzAlbum {
	cover_xl?: string;
	cover_big?: string;
	cover_medium?: string;
}
interface DzArtist {
	picture_xl?: string;
	picture_big?: string;
}
interface DzResult {
	album?: DzAlbum;
	artist?: DzArtist;
}
interface DeezerSearchResponse {
	data?: DzResult[];
	total?: number;
}

/**
 * Reshape a Deezer search envelope into { cover, artistPicture } from data[0]. The cover
 * prefers cover_xl → cover_big → cover_medium; the artist picture prefers picture_xl →
 * picture_big. Both are run through safeImageUrl (off-host / non-https / CSS-breaker → null).
 * Empty data → both null. Funnel point for future charts/info extension (scope: search only).
 */
function reshapeSearch(data: DeezerSearchResponse): DeezerCover {
	const top = data?.data?.[0];
	if (!top) return { cover: null, artistPicture: null };
	const rawCover = top.album?.cover_xl ?? top.album?.cover_big ?? top.album?.cover_medium ?? null;
	const rawPicture = top.artist?.picture_xl ?? top.artist?.picture_big ?? null;
	return {
		cover: safeImageUrl(rawCover),
		artistPicture: safeImageUrl(rawPicture)
	};
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	// No secret/env read: Deezer public search is keyless. There is intentionally NO
	// platform.env access here (T-wv8-03 — nothing to leak).
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty/missing q → empty result with NO upstream fetch (T-wv8-01 short-circuit).
	if (!q) return jsonResult({ cover: null, artistPicture: null }, origin);

	// Passthrough-only upstream: q is encodeURIComponent'd into the fixed search string — no
	// command/template construction (T-wv8-01). limit=1 keeps the payload tiny.
	const upstream = `${DEEZER_SEARCH}?q=${encodeURIComponent(q)}&limit=1`;

	// Cache key = the OWN-ORIGIN request (NEVER the upstream api.deezer.com URL — T-wv8-06).
	// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
			// CORS-FREE body, so a cross-origin (preview vs prod) hit never receives a prior
			// requester's Access-Control-Allow-Origin.
			const cached = (await hit.json()) as DeezerCover;
			return jsonResult(
				{ cover: cached.cover ?? null, artistPicture: cached.artistPicture ?? null },
				origin,
				TTL
			);
		}
	}

	try {
		// Bounded retry + native timeout (T-wv8-04, 429/5xx backoff is free).
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as DeezerSearchResponse;
		const result = reshapeSearch(data);
		if (cache) {
			// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
			const cached = new Response(JSON.stringify(result satisfies DeezerCover), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonResult(result, origin, TTL);
	} catch {
		// Upstream error / malformed JSON / non-ok-throw → best-effort empty (NO cache write).
		return jsonResult({ cover: null, artistPicture: null }, origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
