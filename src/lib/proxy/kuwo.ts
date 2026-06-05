// Kuwo proxy adapter — STUB. Body (upstream URL build) filled in plan 01-02.
// Upstream: kw-api.cenguigui.cn (legacy:2124 / 2399).
import type { ProxyAdapter, Env } from './proxy-types';

export const kuwoProxy: ProxyAdapter = {
	id: 'kuwo',
	buildUrl(_path: string, _searchParams: URLSearchParams, _env: Env | undefined): string {
		throw new Error('not-implemented: kuwo');
	}
};
