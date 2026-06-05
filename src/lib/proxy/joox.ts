// JOOX proxy adapter — STUB. Body filled in plan 01-03. This is the ONLY proxy that
// reads env (env.JOOX_TOKEN) to inject the secret into the upstream URL on the edge
// (success criterion #2). Upstream: apicx.asia/api/joox_music (legacy:2170 / 2426);
// token legacy:2165, br legacy:2166.
import type { ProxyAdapter, Env } from './proxy-types';

export const jooxProxy: ProxyAdapter = {
	id: 'joox',
	buildUrl(_path: string, _searchParams: URLSearchParams, _env: Env | undefined): string {
		throw new Error('not-implemented: joox');
	}
};
