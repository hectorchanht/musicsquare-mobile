import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { netease } from './netease';
import type { Track } from './types';
import fixture from './__fixtures__/netease.search.json';

const ac = new AbortController();

function mockFetchOnce(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': contentType }
		});
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('netease.search (fixture-backed)', () => {
	// Test 1: normalization — colon uid, source, audioUrl+lrcUrl populated, songid from ?id=.
	it('normalizes the recorded search fixture into canonical Track[]', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(fixture));

		const tracks = await netease.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(fixture.length);
		const first = tracks[0];
		// songid extracted from the audio url's ?id= param
		const expectedId = new URL(fixture[0].url).searchParams.get('id')!;
		expect(first.songid).toBe(expectedId);
		// canonical COLON-form uid (D-10)
		expect(first.uid).toBe(`netease:${expectedId}`);
		expect(first.source).toBe('netease');
		// Netease returns audioUrl + lrcUrl at SEARCH time
		expect(first.audioUrl).toBe(fixture[0].url);
		expect(first.lrcUrl).toBe(fixture[0].lrc);
		expect(first.cover).toBe(fixture[0].pic);
		expect(first.title).toBe(fixture[0].name);
		expect(first.keyword).toBe('周杰伦');
		expect(first.displayIndex).toBe(1);
		expect(first.detailsLoaded).toBe(false);
	});

	it('hits the same-origin proxy /api/netease/search with id + limit', async () => {
		const spy = mockFetchOnce(fixture);
		vi.stubGlobal('fetch', spy);

		await netease.search('hello', 2, ac.signal);

		expect(spy).toHaveBeenCalled();
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/netease\/search\?/);
		expect(calledUrl).toContain('id=hello');
		// page=2 → requestLimit = 2 * 10 = 20 (limit-multiplication pagination)
		expect(calledUrl).toContain('limit=20');
	});

	// Test 3: failure isolation — non-array body THROWS (not swallow-and-return-0).
	it('THROWS on a non-array (contract-drift) body', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ error: 'nope' }));
		await expect(netease.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});
});

describe('netease.resolve', () => {
	function stubTrack(): Track {
		return {
			uid: 'netease:509781655',
			source: 'netease',
			songid: '509781655',
			title: '想你就写信',
			artist: '周杰伦',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1
		};
	}

	// Test 2: resolve sets audioUrl + lrc (sniffed) + quality + detailsLoaded.
	it('sets audioUrl/lrcUrl, fetches a plain-text LRC, infers quality, marks loaded', async () => {
		const lrcText = '[00:01.00]line one\n[00:12.00]line two';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(lrcText, { status: 200, headers: { 'content-type': 'text/plain' } }))
		);

		const track = stubTrack();
		const out = await netease.resolve(track, ac.signal);

		expect(out.audioUrl).toBe('/api/netease/url?id=509781655');
		expect(out.lrcUrl).toBe('/api/netease/lrc?id=509781655');
		expect(out.lrc).toBe(lrcText);
		// audioUrl ends in no lossless ext → 320K
		expect(out.quality).toBe('320k');
		expect(out.qualityLabel).toBe('320K');
		expect(out.detailsLoaded).toBe(true);
	});

	it('content-type-sniffs a JSON-wrapped LRC body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ lrc: '[00:00.00]json-wrapped' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
			)
		);

		const out = await netease.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe('[00:00.00]json-wrapped');
		expect(out.detailsLoaded).toBe(true);
	});
});
