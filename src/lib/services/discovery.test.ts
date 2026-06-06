import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveStub } from './discovery';
import * as catalog from './catalog';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// resolveStub (Phase 9, D-03) is the LOAD-BEARING transform: a Last.fm {artist,title}
// stub is NOT a Track (no uid/source/audioUrl), so it cannot be handed to player.play()
// directly. resolveStub re-searches via searchAll + dedupeBest (the same resolver
// picks.ts/similar.ts use) and returns the best playable Track, or null on a miss.
// It NEVER throws and does NOT modify catalog.ts/dedupe.ts.

function mk(source: SourceId, songid: string, artist = 'a', extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
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
		displayIndex: 1,
		...extra
	};
}

/** A SearchResult whose interleaved holds the given tracks. */
function result(tracks: Track[]): catalog.SearchResult {
	return { perSource: [], interleaved: tracks };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('resolveStub — Last.fm {artist,title} stub → playable Track', () => {
	it('returns the top dedupeBest hit when searchAll finds a match', async () => {
		const hit = mk('netease', 'hit', '周杰伦', { title: '稻香' });
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(spy).toHaveBeenCalledWith('周杰伦 稻香', 1);
		expect(out).not.toBeNull();
		expect(out?.uid).toBe(hit.uid);
	});

	it('returns the FIRST track (best cross-source hit) when several are returned', async () => {
		const first = mk('netease', 'first', '周杰伦', { title: '稻香' });
		const second = mk('qq', 'second', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([first, second]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(first.uid);
	});

	it('returns null when searchAll returns no hits', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		await expect(resolveStub('Nobody', 'Nothing')).resolves.toBeNull();
	});

	it('returns null (never throws) when searchAll throws', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		await expect(resolveStub('X', 'Y')).resolves.toBeNull();
	});
});
