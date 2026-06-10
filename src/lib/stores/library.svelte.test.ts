// Cover-chain (library.adoptCover) — a cover fetched once at play time must be shared
// with every same-song library entry (uid OR normalized {artist,title} identity match),
// without churning entries that already carry art.
import { describe, expect, it } from 'vitest';
import { library } from './library.svelte';
import type { Track } from '$lib/sources/types';

const mk = (over: Partial<Track>): Track =>
	({
		uid: 'netease-1',
		source: 'netease',
		id: '1',
		title: '多远都要在一起',
		artist: 'G.E.M. 邓紫棋',
		album: '',
		cover: null,
		audioUrl: null,
		detailsLoaded: false,
		...over
	}) as Track;

describe('library.adoptCover (cover-chain)', () => {
	it('fills empty covers on same-uid and same-{artist,title} entries across liked/downloads/playlists', () => {
		library.liked = [
			mk({ uid: 'netease-1' }), // same uid, no cover → fill
			mk({ uid: 'qq-9', source: 'qq' }), // different uid, same song → fill
			mk({ uid: 'kuwo-7', title: '光年之外', cover: null }) // different song → untouched
		];
		library.downloads = [mk({ uid: 'joox-3', source: 'joox' })]; // same song → fill
		library.playlists = [
			{ id: 'pl_x', name: 'mix', tracks: [mk({ uid: 'netease-1' }), mk({ uid: 'kuwo-7', title: '光年之外' })] }
		];

		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/cover.jpg' }));

		expect(library.liked[0].cover).toBe('https://img/cover.jpg');
		expect(library.liked[1].cover).toBe('https://img/cover.jpg');
		expect(library.liked[2].cover).toBeNull();
		expect(library.downloads[0].cover).toBe('https://img/cover.jpg');
		expect(library.playlists[0].tracks[0].cover).toBe('https://img/cover.jpg');
		expect(library.playlists[0].tracks[1].cover).toBeNull();
	});

	it('never overwrites an existing cover and no-ops on a coverless source track', () => {
		library.liked = [mk({ uid: 'netease-1', cover: 'https://img/original.jpg' })];
		const before = library.liked[0];

		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/other.jpg' }));
		expect(library.liked[0].cover).toBe('https://img/original.jpg');
		expect(library.liked[0]).toBe(before); // untouched reference — no churn

		library.adoptCover(mk({ uid: 'netease-1', cover: null }));
		expect(library.liked[0].cover).toBe('https://img/original.jpg');
	});

	it('matches identity case/whitespace-insensitively via matchKey', () => {
		library.liked = [mk({ uid: 'qq-2', artist: ' g.e.m. 邓紫棋 ', title: '多远都要在一起' })];
		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/c.jpg' }));
		expect(library.liked[0].cover).toBe('https://img/c.jpg');
	});
});
