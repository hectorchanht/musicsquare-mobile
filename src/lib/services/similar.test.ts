import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSimilarArtists, buildSimilarQueue } from './similar';
import * as catalog from './catalog';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// Mirrors catalog.test.ts mk() factory — a minimal valid Track for fixtures.
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

/** A SearchResult whose interleaved[0] is the given top track (or empty). */
function result(top: Track | null): catalog.SearchResult {
	return { perSource: [], interleaved: top ? [top] : [] };
}

/** Stub /api/similar to return the given artist names (no network). */
function stubSimilarFetch(artists: string[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			new Response(JSON.stringify({ artists }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		)
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('getSimilarArtists', () => {
	it('returns the artist names from /api/similar', async () => {
		stubSimilarFetch(['林俊杰', '陈奕迅']);
		const names = await getSimilarArtists('周杰伦');
		expect(names).toEqual(['林俊杰', '陈奕迅']);
	});

	it('returns [] when fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
		const names = await getSimilarArtists('周杰伦');
		expect(names).toEqual([]);
	});
});

describe('buildSimilarQueue — Last.fm path', () => {
	it('searches each similar artist, dedupes, and excludes the seed + excludeUids', async () => {
		stubSimilarFetch(['林俊杰', '陈奕迅']);
		const seed = mk('netease', 'seed', '周杰伦');
		const already = mk('qq', 'already', '陈奕迅');

		// Each similar-artist search returns one top track. One of them is the seed
		// (must be excluded), one is the excludeUids member (must be excluded), and
		// one is a fresh track (must survive).
		const fresh = mk('netease', 'fresh', '林俊杰');
		const spy = vi.spyOn(catalog, 'searchAll').mockImplementation(async (kw: string) => {
			if (kw === '林俊杰') return result(fresh);
			if (kw === '陈奕迅') return result(already); // in excludeUids → dropped
			return result(null);
		});

		const out = await buildSimilarQueue(seed, new Set([already.uid]));
		const uids = out.map((t) => t.uid);

		expect(spy).toHaveBeenCalled();
		expect(uids).toContain(fresh.uid);
		expect(uids).not.toContain(seed.uid); // seed excluded
		expect(uids).not.toContain(already.uid); // excludeUids excluded
	});

	it('drops a top result that IS the seed track', async () => {
		stubSimilarFetch(['someArtist']);
		const seed = mk('netease', 'seed', '周杰伦');
		// the similar-artist search happens to surface the seed itself
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result(seed));

		const out = await buildSimilarQueue(seed);
		expect(out.map((t) => t.uid)).not.toContain(seed.uid);
	});
});

describe('buildSimilarQueue — same-artist fallback (no key / Last.fm dry)', () => {
	it('falls back to searchAll(track.artist) when no similar artists are returned', async () => {
		stubSimilarFetch([]); // empty → fallback path
		const seed = mk('netease', 'seed', '周杰伦');
		const sameArtist = mk('qq', 'sa1', '周杰伦');

		const spy = vi.spyOn(catalog, 'searchAll').mockImplementation(async (kw: string) => {
			if (kw === '周杰伦') return { perSource: [], interleaved: [seed, sameArtist] };
			return result(null);
		});

		const out = await buildSimilarQueue(seed);
		const uids = out.map((t) => t.uid);

		expect(spy).toHaveBeenCalledWith('周杰伦', 1);
		expect(uids).toContain(sameArtist.uid);
		expect(uids).not.toContain(seed.uid); // seed still excluded in fallback
	});

	it('falls back when getSimilarArtists fails (fetch throws)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
		const seed = mk('netease', 'seed', '周杰伦');
		const sameArtist = mk('qq', 'sa1', '周杰伦');
		vi.spyOn(catalog, 'searchAll').mockResolvedValue({
			perSource: [],
			interleaved: [sameArtist]
		});

		const out = await buildSimilarQueue(seed);
		expect(out.map((t) => t.uid)).toContain(sameArtist.uid);
	});
});
