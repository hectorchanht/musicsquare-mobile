// JOOX client adapter — STUB (interface-conformant). Body filled in plan 01-03
// (ports searchJoox legacy:2169-2212 + fetchJooxDetails/probeJooxAudioUrl/
// pickJooxPlayUrl legacy:2424-2504, with the position-index identity FIX per D-10 /
// Pitfall 4). The registry already enumerates this entry, so 01-03 touches NO shared
// code (DATA-04).
import type { SourceAdapter, Track } from './types';

export const joox: SourceAdapter = {
	id: 'joox',
	label: 'JOOX',
	enabledByDefault: true,
	async search(_keyword: string, _page: number, _signal: AbortSignal): Promise<Track[]> {
		throw new Error('not-implemented: joox');
	},
	async resolve(_track: Track, _signal: AbortSignal): Promise<Track> {
		throw new Error('not-implemented: joox');
	}
};
