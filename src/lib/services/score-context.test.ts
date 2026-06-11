import { describe, it, expect } from 'vitest';
import { computeSetContext, type SetContext } from './score-context';
import { matchKey } from './match-key';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// computeSetContext (SRCH-01 / D-05) is the PURE per-result-set summary scoreMatch reads to
// award the cross-source artist boost. It keys each row on `matchKey(artist, '')` (artist-only,
// mirroring artistCoverCacheKey) and records the DISTINCT SourceIds that artist appears under —
// so the boost rewards cross-source PRESENCE, never raw row count from a single source.

function mk(source: SourceId, songid: string, artist: string, title = 't'): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

describe('computeSetContext — cross-source artist map (D-05)', () => {
	it('an artist appearing from 2 DISTINCT sources yields a Set of size 2', () => {
		const rows = [mk('qq', '1', '周杰倫'), mk('netease', '2', '周杰倫')];
		const ctx = computeSetContext(rows, '周杰倫 稻香');
		const set = ctx.artistSources.get(matchKey('周杰倫', ''));
		expect(set?.size).toBe(2);
		expect(set?.has('qq')).toBe(true);
		expect(set?.has('netease')).toBe(true);
	});

	it('an artist in 5 rows but ALL from one source yields a Set of size 1 (rows ≠ sources)', () => {
		const rows = [
			mk('qq', '1', '周杰倫', 'a'),
			mk('qq', '2', '周杰倫', 'b'),
			mk('qq', '3', '周杰倫', 'c'),
			mk('qq', '4', '周杰倫', 'd'),
			mk('qq', '5', '周杰倫', 'e')
		];
		const ctx = computeSetContext(rows, '周杰倫');
		expect(ctx.artistSources.get(matchKey('周杰倫', ''))?.size).toBe(1);
	});

	it('queryLen equals the TRIMMED query length', () => {
		const ctx: SetContext = computeSetContext([], '  稻香  ');
		expect(ctx.queryLen).toBe('稻香'.length);
	});

	it('keys are artist-ONLY: two different titles by the same artist collapse to one entry', () => {
		const rows = [mk('qq', '1', '周杰倫', '稻香'), mk('qq', '2', '周杰倫', '晴天')];
		const ctx = computeSetContext(rows, '周杰倫');
		// one artist-only key, regardless of differing titles
		expect(ctx.artistSources.size).toBe(1);
		expect(ctx.artistSources.has(matchKey('周杰倫', ''))).toBe(true);
		// and it correctly records the single source once
		expect(ctx.artistSources.get(matchKey('周杰倫', ''))?.size).toBe(1);
	});
});
