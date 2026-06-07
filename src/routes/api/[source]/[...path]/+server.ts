// Same-origin metadata proxy (DATA-02, D-09 thin passthrough).
//
// One catch-all route fronts all four sources. It validates params.source against the
// PROXIES registry (404 unknown — threat T-01-01 / Security V5), builds the real
// upstream URL via the per-source ProxyAdapter (JOOX injects its token from
// platform.env here, never on the client — T-01-04), fetches with a native timeout +
// bounded retry, and forwards the upstream body UNCHANGED with CORS scoped to the own
// origin (never `*` — T-01-02).
import type { RequestHandler } from './$types';
import { PROXIES } from '$lib/proxy/proxy-registry';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import type { Env } from '$lib/proxy/proxy-types';
import type { SourceId } from '$lib/sources/types';

function isKnownSource(source: string): source is SourceId {
	return Object.prototype.hasOwnProperty.call(PROXIES, source);
}

export const GET: RequestHandler = async ({ params, url, platform, request }) => {
	const origin = request.headers.get('origin');

	if (!isKnownSource(params.source)) {
		return new Response('unknown source', { status: 404, headers: corsHeaders(origin) });
	}
	const proxy = PROXIES[params.source];
	// Sources with DEDICATED routes (e.g. fivesing) are absent from PROXIES — the catch-all
	// shouldn't match them anyway, but defend in depth (hvu).
	if (!proxy) {
		return new Response('source not served by catch-all', { status: 404, headers: corsHeaders(origin) });
	}

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;

	let upstream: string;
	try {
		upstream = proxy.buildUrl(params.path ?? '', url.searchParams, env);
	} catch (err) {
		return new Response(`bad request: ${err instanceof Error ? err.message : 'invalid path'}`, {
			status: 400,
			headers: corsHeaders(origin)
		});
	}

	const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);

	// D-09 passthrough: forward body unchanged; add only CORS + content-type.
	return new Response(res.body, {
		status: res.status,
		headers: {
			...corsHeaders(origin),
			'content-type': res.headers.get('content-type') ?? 'application/json'
		}
	});
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
