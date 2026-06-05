// Kuwo proxy adapter — real upstream URL build (plan 01-02). No auth for Kuwo.
//
// All Kuwo metadata comes from the cenguigui kw-api endpoint (legacy:2124 search,
// 2399 detail). The client hits /api/kuwo/<type>?<params> and this adapter maps the
// forwarded query onto the real upstream URL. Search and detail share ONE host; the
// shape is selected by the params (name= → search list, id=&type=song → detail object).
// D-09 passthrough: the +server.ts route forwards the upstream body unchanged.
import type { ProxyAdapter, Env } from './proxy-types';

const KUWO_BASE = 'https://kw-api.cenguigui.cn/';

// The client uses these path segments after /api/kuwo/ (e.g. "search", "detail").
const ALLOWED_TYPES = new Set(['search', 'detail']);

export const kuwoProxy: ProxyAdapter = {
	id: 'kuwo',
	buildUrl(path: string, searchParams: URLSearchParams, _env: Env | undefined): string {
		const type = (path || 'search').replace(/^\/+|\/+$/g, '');
		if (!ALLOWED_TYPES.has(type)) {
			throw new Error(`kuwo: unsupported path "${type}"`);
		}

		const upstream = new URL(KUWO_BASE);

		if (type === 'search') {
			// search: ?name={kw}&page=1&limit={n} (legacy:2124).
			const name = searchParams.get('name');
			if (name !== null) upstream.searchParams.set('name', name);
			upstream.searchParams.set('page', searchParams.get('page') || '1');
			const limit = searchParams.get('limit');
			if (limit !== null) upstream.searchParams.set('limit', limit);
		} else {
			// detail: ?id={rid}&type=song&level=zp&format=json (legacy:2399).
			const id = searchParams.get('id');
			if (id !== null) upstream.searchParams.set('id', id);
			upstream.searchParams.set('type', 'song');
			upstream.searchParams.set('level', searchParams.get('level') || 'zp');
			upstream.searchParams.set('format', 'json');
		}

		return upstream.toString();
	}
};
