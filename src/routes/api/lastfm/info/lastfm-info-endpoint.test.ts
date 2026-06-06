import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET, OPTIONS } from './+server';

// The LASTFM_KEY must NEVER appear in any client-facing artifact (threat T-08-01,
// mirrors similar-endpoint.test.ts). A fake key lets us assert the key reaches the
// upstream URL but is absent from the response body + headers.
const FAKE_KEY = 'TESTLASTFMKEY';
const GREY_STAR = '2a96cbd8b46e442fc41c2b86b821562f';

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.pages.dev/api/lastfm/info');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.pages.dev' } })
	};
}

type Info = {
	tags: string[];
	bio: string | null;
	bioUrl: string | null;
	image: string | null;
	listeners: number | null;
	playcount: number | null;
};

const TRACK_PAYLOAD = JSON.stringify({
	track: {
		listeners: '123',
		playcount: '456',
		toptags: {
			tag: [
				{ name: 'mandopop' },
				{ name: 'pop' },
				{ name: 'chinese' },
				{ name: 'ballad' },
				{ name: 'rnb' },
				{ name: 'sixth-should-be-dropped' }
			]
		},
		album: {
			image: [
				{ '#text': 'https://lastfm/small.png', size: 'small' },
				{ '#text': 'https://lastfm/extralarge.png', size: 'extralarge' }
			]
		},
		wiki: { summary: 'A great track. Second sentence here.' }
	}
});

describe('/api/lastfm/info — Last.fm key injected upstream, ABSENT from client response (no-leak)', () => {
	it('injects the key into the upstream fetch but never echoes it to the client body/headers', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				return new Response(TRACK_PAYLOAD, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// (a) upstream URL carries the injected key + method + the encoded non-ASCII fixture
		expect(capturedUpstreamUrl).toContain(`api_key=${FAKE_KEY}`);
		expect(capturedUpstreamUrl).toContain('method=track.getinfo');
		expect(capturedUpstreamUrl).toContain(encodeURIComponent('周杰伦'));
		// (b) the client-facing response body does NOT contain the key
		expect(body).not.toContain(FAKE_KEY);
		// (c) no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_KEY);

		// returns the clean reshaped info (tags capped at 5, album art picked)
		const parsed = JSON.parse(body) as Info;
		expect(parsed.tags).toEqual(['mandopop', 'pop', 'chinese', 'ballad', 'rnb']);
		expect(parsed.image).toBe('https://lastfm/extralarge.png');
		expect(parsed.listeners).toBe(123);
		expect(parsed.playcount).toBe(456);
	});

	it('returns 200 all-empty shape and does NOT fetch when LASTFM_KEY is missing', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent({ method: 'track.getinfo', artist: '周杰伦', track: '稻香' }); // no platform.env
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed).toEqual({
			tags: [],
			bio: null,
			bioUrl: null,
			image: null,
			listeners: null,
			playcount: null
		});

		// must NOT have fetched an upstream (esp. not api_key=undefined)
		expect(fetchSpy).not.toHaveBeenCalled();
		const calledWithUndefinedKey = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('api_key=undefined')
		);
		expect(calledWithUndefinedKey).toBe(false);
	});

	it('returns all-empty shape on malformed upstream JSON (best-effort fallback)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json at all', { status: 200 }))
		);
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(parsed.image).toBeNull();
	});

	it('returns all-empty shape on a Last.fm error-6 body (silent best-effort)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 6, message: 'Track not found' }), { status: 200 })
			)
		);
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: 'Nope', track: 'Nope' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(parsed.bio).toBeNull();
		expect(parsed.image).toBeNull();
	});

	it('rejects a method outside the allow-list with the empty shape and no fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const event = fakeEvent(
			{ method: 'user.getlovedtracks', artist: 'x' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('placeholder filter: grey-star hash image is never returned (image: null)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							album: {
								tags: { tag: [{ name: 'rock' }] },
								image: [
									{ '#text': '', size: 'small' },
									{ '#text': `https://lastfm.freetls.fastly.net/i/u/300x300/${GREY_STAR}.png`, size: 'extralarge' }
								]
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'album.getinfo', artist: 'X', album: 'Y' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.image).toBeNull(); // grey-star / empty filtered → null
		expect(parsed.tags).toEqual(['rock']);
	});

	it('artist.getinfo: extracts bio summary (HTML-stripped) + attribution bioUrl', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							artist: {
								stats: { listeners: '999', playcount: '8888' },
								tags: { tag: [{ name: 'pop' }, { name: 'mandopop' }] },
								bio: {
									summary:
										'Jay Chou is a Taiwanese musician. He is huge. <a href="https://www.last.fm/music/Jay+Chou">Read more on Last.fm</a>.'
								}
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'artist.getinfo', artist: 'Jay Chou' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.bio).toContain('Jay Chou is a Taiwanese musician');
		expect(parsed.bio).not.toContain('<a href'); // HTML stripped
		expect(parsed.bioUrl).toBe('https://www.last.fm/music/Jay+Chou');
		expect(parsed.tags).toEqual(['pop', 'mandopop']);
		expect(parsed.listeners).toBe(999);
	});
});

describe('/api/lastfm/info — CORS preflight', () => {
	it('OPTIONS returns 204 with scoped corsHeaders', async () => {
		const req = new Request('https://openmusic.pages.dev/api/lastfm/info', {
			method: 'OPTIONS',
			headers: { origin: 'https://openmusic.pages.dev' }
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await OPTIONS({ request: req } as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.pages.dev');
		// never `*`
		expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
	});
});
