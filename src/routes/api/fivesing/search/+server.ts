// 5sing search edge proxy (quick-260607-hvu).
//
// Calls `search.5sing.kugou.com/home/json?keyword=…&sort=1&page=…&pagesize=…` (Kugou's UGC
// platform). Verified reachable from a non-CN edge (researcher probe, 2026-06-07).
// Passthrough only: the adapter does the reshape + <em> tag stripping client-side. No
// secrets, no signed-state — mirrors the deezer/search posture (own-origin CORS, OPTIONS
// 204 preflight, native AbortSignal.timeout, fetchWithRetry).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

// Upstream host. `https://` returns a TLS cert mismatch (cert is for a different hostname,
// verified 2026-06-07 via curl); the upstream serves the API over plain http only. Cloudflare
// Workers ALLOW outbound http: fetches, so the proxy uses http to match the upstream. The
// CLIENT still talks to this route over its own-origin https — no mixed-content surface.
const FS_SEARCH = 'http://search.5sing.kugou.com/home/json';

function jsonPassthrough(body: unknown, origin: string | null): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
	});
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	if (!keyword) return jsonPassthrough({ list: [] }, origin);

	// Bound + clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));
	const pagesize = Math.min(50, Math.max(1, Number(url.searchParams.get('pagesize')) || 20));

	// Upstream: passthrough-only. keyword is encodeURIComponent'd into the fixed template
	// — no command construction. sort=1 = "best match" per musicdl conventions.
	const upstream =
		`${FS_SEARCH}?keyword=${encodeURIComponent(keyword)}` +
		`&sort=1&page=${page}&pagesize=${pagesize}`;

	try {
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const body = await res.json();
		return jsonPassthrough(body, origin);
	} catch {
		// Upstream error → empty list (the source's per-source error is recorded by the
		// search fan-out; we don't leak upstream error text).
		return jsonPassthrough({ list: [] }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
