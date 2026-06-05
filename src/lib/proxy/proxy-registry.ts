// The ONLY place server proxy adapters are enumerated (DATA-04), mirroring SOURCES
// by id. The /api/[source]/[...path] route looks adapters up here. Adding a source =
// a new proxy file + one import line.
import type { ProxyAdapter } from './proxy-types';
import type { SourceId } from '../sources/types';
import { neteaseProxy } from './netease';
import { qqProxy } from './qq';
import { kuwoProxy } from './kuwo';
import { jooxProxy } from './joox';

export const PROXIES: Record<SourceId, ProxyAdapter> = {
	netease: neteaseProxy,
	qq: qqProxy,
	kuwo: kuwoProxy,
	joox: jooxProxy
};
