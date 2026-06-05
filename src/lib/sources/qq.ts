// QQ Music client adapter — STUB (interface-conformant). Body filled in plan 01-02
// (ports searchQQ legacy:2041-2120 + fetchQQDetails legacy:2311-2396). The registry
// already enumerates this entry, so 01-02 touches NO shared code (DATA-04).
import type { SourceAdapter, Track } from './types';

export const qq: SourceAdapter = {
	id: 'qq',
	label: 'QQ 音乐',
	enabledByDefault: true,
	async search(_keyword: string, _page: number, _signal: AbortSignal): Promise<Track[]> {
		throw new Error('not-implemented: qq');
	},
	async resolve(_track: Track, _signal: AbortSignal): Promise<Track> {
		throw new Error('not-implemented: qq');
	}
};
