// Netease client adapter — STUB created in Task 2 so the registry's 4 imports resolve.
// Task 3 REPLACES this file with the real port of searchNetease (legacy:1986-2038) +
// fetchNeteaseDetails (legacy:2268-2308).
import type { SourceAdapter, Track } from './types';

export const netease: SourceAdapter = {
	id: 'netease',
	label: '网易云音乐',
	enabledByDefault: true,
	async search(_keyword: string, _page: number, _signal: AbortSignal): Promise<Track[]> {
		throw new Error('not-implemented: netease');
	},
	async resolve(_track: Track, _signal: AbortSignal): Promise<Track> {
		throw new Error('not-implemented: netease');
	}
};
