// Kuwo client adapter — STUB (interface-conformant). Body filled in plan 01-02
// (ports searchKuwo legacy:2123-2163 + fetchKuwoDetails legacy:2398-2422). The
// registry already enumerates this entry, so 01-02 touches NO shared code (DATA-04).
import type { SourceAdapter, Track } from './types';

export const kuwo: SourceAdapter = {
	id: 'kuwo',
	label: '酷我音乐',
	enabledByDefault: true,
	async search(_keyword: string, _page: number, _signal: AbortSignal): Promise<Track[]> {
		throw new Error('not-implemented: kuwo');
	},
	async resolve(_track: Track, _signal: AbortSignal): Promise<Track> {
		throw new Error('not-implemented: kuwo');
	}
};
