// Netease proxy adapter — STUB created in Task 2 so PROXIES enumerates all 4.
// Task 3 REPLACES this with the real upstream URL build (api.qijieya.cn/meting/ —
// legacy:1988 search, 2271/2274 detail). No auth for Netease.
import type { ProxyAdapter, Env } from './proxy-types';

export const neteaseProxy: ProxyAdapter = {
	id: 'netease',
	buildUrl(_path: string, _searchParams: URLSearchParams, _env: Env | undefined): string {
		throw new Error('not-implemented: netease');
	}
};
