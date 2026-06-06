import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { backfillCovers, backfillArtistCovers } from './cover-backfill';
import * as catalog from './catalog';
import * as deezer from './deezer';
import {
	getCachedCover,
	getCachedArtistCover,
	setCachedArtistCover,
	artistCoverCacheKey
} from './cover-cache';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// cover-backfill (quick-260606-wv8 supersedes v7k). These tests pin the NEW Deezer-first →
// CN-fallback ordering on the TRACK path (Deezer is PRIMARY), the Deezer-backed artist
// backfill pass + its distinct artist-only cache key, and the never-throws posture. searchAll
// + the deezer resolvers are spied; the cover-cache reads/writes a real in-memory localStorage
// stub (no jsdom, no live network), mirroring discovery.test.ts + cover-cache.test.ts.

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

function mk(source: SourceId, songid: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist: 'a',
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

function result(tracks: Track[]): catalog.SearchResult {
	return { perSource: [], interleaved: tracks };
}

const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', {
		value: new MemStorage(),
		configurable: true,
		writable: true
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Object.defineProperty(globalThis, 'localStorage', {
		value: originalLocalStorage,
		configurable: true,
		writable: true
	});
});

describe('backfillCovers — Deezer-first, CN fallback (quick-260606-wv8)', () => {
	it('uses the Deezer cover when present and does NOT call searchAll (Deezer is PRIMARY)', async () => {
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/dz-cover.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Drake', title: 'Hotline Bling' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(deezerSpy).toHaveBeenCalledWith('Drake', 'Hotline Bling', undefined);
		expect(searchSpy).not.toHaveBeenCalled(); // Deezer hit → no CN search
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe(
			'https://cdn-images.dzcdn.net/dz-cover.jpg'
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cdn-images.dzcdn.net/dz-cover.jpg');
	});

	it('falls back to the CN cover when Deezer misses, then caches + notifies', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn-cover.jpg' });
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Jay Chou', title: 'Simple Love' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(deezerSpy).toHaveBeenCalled();
		expect(searchSpy).toHaveBeenCalledWith('Jay Chou Simple Love', 1);
		expect(getCachedCover('Jay Chou', 'Simple Love')).toBe('https://cn.example/cn-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cn.example/cn-cover.jpg');
	});

	it('falls back to CN when Deezer misses and searchAll has a hit even from no Deezer match', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/x.jpg' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		await backfillCovers([{ artist: 'Olivia Rodrigo', title: 'vampire' }]);
		expect(getCachedCover('Olivia Rodrigo', 'vampire')).toBe('https://cn.example/x.jpg');
	});

	it('leaves the gradient (no cache, no notify) when BOTH Deezer and CN miss', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'X', title: 'Y' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('X', 'Y')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('never throws when deezerSongCover throws (degrades to the gradient)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer down'));
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		await expect(backfillCovers([{ artist: 'X', title: 'Y' }])).resolves.toBeUndefined();
		expect(getCachedCover('X', 'Y')).toBeNull();
	});

	it('never throws when searchAll throws on the CN fallback (degrades to the gradient)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		await expect(backfillCovers([{ artist: 'X', title: 'Y' }])).resolves.toBeUndefined();
	});

	it('skips an already-cached track (zero resolves on a warm pass)', async () => {
		const { setCachedCover } = await import('./cover-cache');
		setCachedCover('Cached', 'Song', 'https://cdn-images.dzcdn.net/cached.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://x/y.jpg');
		const searchSpy = vi.spyOn(catalog, 'searchAll');

		await backfillCovers([{ artist: 'Cached', title: 'Song' }]);
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
	});

	it('caps the track fan-out to `max`', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillCovers(
			[
				{ artist: 'A', title: '1' },
				{ artist: 'B', title: '2' },
				{ artist: 'C', title: '3' }
			],
			{ max: 2 }
		);
		expect(deezerSpy).toHaveBeenCalledTimes(2);
	});
});

describe('backfillArtistCovers — capped artist pass via Deezer (quick-260606-wv8)', () => {
	it('resolves + caches an artist cover under the ARTIST key and fires onResolved', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/artist.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillArtistCovers(['Taylor Swift'], { onResolved: (k, u) => resolved.push([k, u]) });

		expect(deezerSpy).toHaveBeenCalledWith('Taylor Swift', undefined);
		expect(getCachedArtistCover('Taylor Swift')).toBe('https://cdn-images.dzcdn.net/artist.jpg');
		expect(resolved).toHaveLength(1);
		// The onResolved key is the ARTIST key, not the track key.
		expect(resolved[0][0]).toBe(artistCoverCacheKey('Taylor Swift'));
	});

	it('skips an already-cached artist (zero Deezer calls on a warm pass)', async () => {
		setCachedArtistCover('Drake', 'https://cached/artist.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue('https://it/x.jpg');

		await backfillArtistCovers(['Drake']);
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(getCachedArtistCover('Drake')).toBe('https://cached/artist.jpg');
	});

	it('de-dupes identical names so a repeated artist resolves once', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillArtistCovers(['Drake', 'Drake', 'Drake']);
		expect(deezerSpy).toHaveBeenCalledTimes(1);
	});

	it('does not cache or notify on a miss (artist tile keeps its gradient)', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue(null);
		const resolved: string[] = [];
		await backfillArtistCovers(['Nobody'], { onResolved: (k) => resolved.push(k) });
		expect(getCachedArtistCover('Nobody')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('never throws when the artist resolver throws', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockRejectedValue(new Error('boom'));
		await expect(backfillArtistCovers(['X'])).resolves.toBeUndefined();
		expect(getCachedArtistCover('X')).toBeNull();
	});

	it('caps the artist fan-out to `max`', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillArtistCovers(['A', 'B', 'C', 'D', 'E'], { max: 2 });
		expect(deezerSpy).toHaveBeenCalledTimes(2);
	});
});
