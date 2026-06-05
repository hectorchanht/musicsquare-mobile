// QQ proxy adapter — STUB. Body (upstream URL build) filled in plan 01-02.
// Upstream: tang.api.s01s.cn/music_open_api.php (legacy:2043-2046 / 2323-2327).
import type { ProxyAdapter, Env } from './proxy-types';

export const qqProxy: ProxyAdapter = {
	id: 'qq',
	buildUrl(_path: string, _searchParams: URLSearchParams, _env: Env | undefined): string {
		throw new Error('not-implemented: qq');
	}
};
