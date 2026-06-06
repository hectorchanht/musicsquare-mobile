import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichTrack, enrichArtist, enrichAlbum } from './lastfm';
import type { Track } from '$lib/sources/types';

// services/lastfm.ts is the CLIENT enrichment service. It only ever sees the clean
// shape from /api/lastfm/info — the LASTFM_KEY stays server-side (T-08-01). Every
// export resolves to an all-empty result on ANY failure and NEVER throws (ENRICH-01,
// off the playback critical path). It never touches platform.env.

const EMPTY = { tags: [], bio: null, bioUrl: null, lastfmArt: null };

function track(over: Partial<Track> = {}): Track {
	return {
		uid: 'netease:1',
		source: 'netease',
		songid: '1',
		title: '稻香',
		artist: '周杰伦',
		album: '魔杰座',
		cover: 'https://src/cover.jpg',
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '稻香',
		displayIndex: 1,
		...over
	};
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

/** Stub fetch returning a per-method clean LastfmInfo shape. */
function stubInfo(byMethod: Record<string, object>) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const u = new URL(String(input), 'https://x');
			const m = u.searchParams.get('method') ?? '';
			const body = byMethod[m] ?? {
				tags: [],
				bio: null,
				bioUrl: null,
				image: null,
				listeners: null,
				playcount: null
			};
			return new Response(JSON.stringify(body), { status: 200 });
		})
	);
}

describe('enrichTrack — additive merge, never throws, album.getInfo art', () => {
	it('merges tags (track.getinfo), bio+bioUrl (artist.getinfo), lastfmArt (album.getinfo)', async () => {
		stubInfo({
			'track.getinfo': { tags: ['mandopop', 'pop'], bio: null, bioUrl: null, image: null, listeners: 1, playcount: 2 },
			'artist.getinfo': {
				tags: ['pop'],
				bio: 'Jay Chou is huge.',
				bioUrl: 'https://www.last.fm/music/Jay+Chou',
				image: 'https://lastfm/artist.png',
				listeners: 9,
				playcount: 8
			},
			'album.getinfo': { tags: ['rnb'], bio: null, bioUrl: null, image: 'https://lastfm/album-xl.png', listeners: null, playcount: null }
		});

		const out = await enrichTrack(track());
		expect(out.tags).toEqual(['mandopop', 'pop']);
		expect(out.bio).toBe('Jay Chou is huge.');
		expect(out.bioUrl).toBe('https://www.last.fm/music/Jay+Chou');
		// cover candidate MUST come from album.getInfo (D-04 guardrail 1), not artist image
		expect(out.lastfmArt).toBe('https://lastfm/album-xl.png');
	});

	it('caps tags at 5', async () => {
		stubInfo({
			'track.getinfo': {
				tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
				bio: null,
				bioUrl: null,
				image: null,
				listeners: null,
				playcount: null
			}
		});
		const out = await enrichTrack(track());
		expect(out.tags.length).toBeLessThanOrEqual(5);
		expect(out.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('resolves to all-empty (never throws) when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(enrichTrack(track())).resolves.toEqual(EMPTY);
	});

	it('resolves to all-empty when the endpoint returns the absent-key empty shape', async () => {
		stubInfo({}); // every method → the all-empty shape (absent-key posture)
		await expect(enrichTrack(track())).resolves.toEqual(EMPTY);
	});

	it('a single failing sub-call still yields the other fields (allSettled)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const u = new URL(String(input), 'https://x');
				const m = u.searchParams.get('method') ?? '';
				if (m === 'album.getinfo') throw new Error('album fetch failed');
				if (m === 'track.getinfo')
					return new Response(
						JSON.stringify({ tags: ['pop'], bio: null, bioUrl: null, image: null, listeners: null, playcount: null }),
						{ status: 200 }
					);
				return new Response(JSON.stringify({ tags: [], bio: 'bio', bioUrl: 'u', image: null, listeners: null, playcount: null }), {
					status: 200
				});
			})
		);
		const out = await enrichTrack(track());
		expect(out.tags).toEqual(['pop']);
		expect(out.bio).toBe('bio');
		expect(out.lastfmArt).toBeNull(); // album sub-call failed → no art, but no throw
	});
});

describe('enrichArtist / enrichAlbum — clean shapes consumed by Plans 02/03', () => {
	it('enrichArtist returns bio+bioUrl+tags + image as lastfmArt', async () => {
		stubInfo({
			'artist.getinfo': {
				tags: ['pop', 'mandopop'],
				bio: 'About the artist.',
				bioUrl: 'https://last.fm/x',
				image: 'https://lastfm/hero.png',
				listeners: 5,
				playcount: 6
			}
		});
		const out = await enrichArtist('Jay Chou');
		expect(out.bio).toBe('About the artist.');
		expect(out.bioUrl).toBe('https://last.fm/x');
		expect(out.tags).toEqual(['pop', 'mandopop']);
		expect(out.lastfmArt).toBe('https://lastfm/hero.png');
	});

	it('enrichAlbum returns lastfmArt + tags + listeners/playcount', async () => {
		stubInfo({
			'album.getinfo': {
				tags: ['rock'],
				bio: null,
				bioUrl: null,
				image: 'https://lastfm/album.png',
				listeners: 111,
				playcount: 222
			}
		});
		const out = await enrichAlbum('魔杰座', '周杰伦');
		expect(out.lastfmArt).toBe('https://lastfm/album.png');
		expect(out.tags).toEqual(['rock']);
		expect(out.listeners).toBe(111);
		expect(out.playcount).toBe(222);
	});

	it('enrichArtist never throws on fetch failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('boom');
			})
		);
		await expect(enrichArtist('X')).resolves.toEqual(EMPTY);
	});
});
