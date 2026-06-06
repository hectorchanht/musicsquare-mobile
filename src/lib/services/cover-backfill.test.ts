import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { backfillCovers, backfillArtistCovers } from './cover-backfill';
import * as catalog from './catalog';
import * as itunes from './itunes-cover';
import {
	getCachedCover,
	getCachedArtistCover,
	setCachedArtistCover,
	artistCoverCacheKey
} from './cover-cache';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// cover-backfill (quick-260606-v7k extends quick-260606-rvy FIX-A). These tests pin the
// CN-first → iTunes-fallback ordering on the TRACK path, the new artist backfill pass + its
// distinct artist-only cache key, and the never-throws posture. searchAll + the itunes-cover
// resolvers are spied; the cover-cache reads/writes a real in-memory localStorage stub (no
// jsdom, no live network), mirroring discovery.test.ts + cover-cache.test.ts.

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

describe('backfillCovers — CN-first, iTunes fallback (quick-260606-v7k)', () => {
	it('uses the CN cover when searchAll has one and does NOT call iTunes', async () => {
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn-cover.jpg' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue('https://it/x.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Drake', title: 'Hotline Bling' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(itunesSpy).not.toHaveBeenCalled();
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://cn.example/cn-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cn.example/cn-cover.jpg');
	});

	it('falls back to itunesSongCover when the CN cover is missing, then caches + notifies', async () => {
		// CN returns a track with NO cover → fallback to iTunes.
		const hit = mk('netease', 'hit', { cover: null });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://it.example/600x600bb.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Ariana Grande', title: 'thank u, next' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(itunesSpy).toHaveBeenCalledWith('Ariana Grande', 'thank u, next', undefined);
		expect(getCachedCover('Ariana Grande', 'thank u, next')).toBe(
			'https://it.example/600x600bb.jpg'
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://it.example/600x600bb.jpg');
	});

	it('falls back to iTunes when searchAll returns no hits at all', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://it.example/x.jpg');

		await backfillCovers([{ artist: 'Olivia Rodrigo', title: 'vampire' }]);
		expect(itunesSpy).toHaveBeenCalled();
		expect(getCachedCover('Olivia Rodrigo', 'vampire')).toBe('https://it.example/x.jpg');
	});

	it('leaves the gradient (no cache, no notify) when BOTH CN and iTunes miss', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'X', title: 'Y' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('X', 'Y')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('never throws when searchAll throws (degrades to the gradient)', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		await expect(
			backfillCovers([{ artist: 'X', title: 'Y' }])
		).resolves.toBeUndefined();
	});
});

describe('backfillArtistCovers — capped artist pass via iTunes (quick-260606-v7k)', () => {
	it('resolves + caches an artist cover under the ARTIST key and fires onResolved', async () => {
		const itunesSpy = vi
			.spyOn(itunes, 'itunesArtistCover')
			.mockResolvedValue('https://it.example/artist-600x600bb.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillArtistCovers(['Taylor Swift'], { onResolved: (k, u) => resolved.push([k, u]) });

		expect(itunesSpy).toHaveBeenCalledWith('Taylor Swift', undefined);
		expect(getCachedArtistCover('Taylor Swift')).toBe('https://it.example/artist-600x600bb.jpg');
		expect(resolved).toHaveLength(1);
		// The onResolved key is the ARTIST key, not the track key.
		expect(resolved[0][0]).toBe(artistCoverCacheKey('Taylor Swift'));
	});

	it('skips an already-cached artist (zero iTunes calls on a warm pass)', async () => {
		setCachedArtistCover('Drake', 'https://cached/artist.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue('https://it/x.jpg');

		await backfillArtistCovers(['Drake']);
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(getCachedArtistCover('Drake')).toBe('https://cached/artist.jpg');
	});

	it('de-dupes identical names so a repeated artist resolves once', async () => {
		const itunesSpy = vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue('https://it/x.jpg');
		await backfillArtistCovers(['Drake', 'Drake', 'Drake']);
		expect(itunesSpy).toHaveBeenCalledTimes(1);
	});

	it('does not cache or notify on a miss (artist tile keeps its gradient)', async () => {
		vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue(null);
		const resolved: string[] = [];
		await backfillArtistCovers(['Nobody'], { onResolved: (k) => resolved.push(k) });
		expect(getCachedArtistCover('Nobody')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('never throws when the artist resolver throws', async () => {
		vi.spyOn(itunes, 'itunesArtistCover').mockRejectedValue(new Error('boom'));
		await expect(backfillArtistCovers(['X'])).resolves.toBeUndefined();
		expect(getCachedArtistCover('X')).toBeNull();
	});

	it('caps the artist fan-out to `max`', async () => {
		const itunesSpy = vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue('https://it/x.jpg');
		await backfillArtistCovers(['A', 'B', 'C', 'D', 'E'], { max: 2 });
		expect(itunesSpy).toHaveBeenCalledTimes(2);
	});
});
