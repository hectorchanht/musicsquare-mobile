import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDeezerSearchUrl, deezerSongCover, deezerArtistCover } from './deezer';

// deezer.ts (quick-260606-wv8) is the thin, never-throws client that fetches the
// OWN-ORIGIN /api/deezer/search proxy (NOT api.deezer.com directly — the browser fetch to
// Deezer is CORS-blocked). It mirrors the itunes-cover never-throws + AbortSignal contract:
// a miss → null → the caller's gradient. These tests pin the URL build/encoding, the
// song/artist resolve, the empty-term + already-aborted-signal (no fetch) short-circuits,
// and the non-ok / null-field / malformed-JSON / fetch-throws → null paths — all node-
// runnable via vi.stubGlobal('fetch', ...) (NO live network).

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/** A minimal `Response`-like ok JSON stub. */
function jsonResponse(body: unknown, ok = true): Response {
	return {
		ok,
		json: async () => body
	} as unknown as Response;
}

const COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';
const PIC = 'https://cdn-images.dzcdn.net/images/artist/def/1000x1000-000000-80-0-0.jpg';

describe('buildDeezerSearchUrl — own-origin URL build + encoding', () => {
	it('builds /api/deezer/search?q=... pointed at the own-origin proxy', () => {
		const url = buildDeezerSearchUrl('Jay Chou Simple Love');
		expect(url.startsWith('/api/deezer/search?')).toBe(true);
		// q round-trips via URLSearchParams parsing.
		const params = new URLSearchParams(url.split('?')[1]);
		expect(params.get('q')).toBe('Jay Chou Simple Love');
	});

	it('encodes special chars in q (no raw spaces / & / / leak)', () => {
		const url = buildDeezerSearchUrl('A&B C/D');
		expect(url).not.toContain(' ');
		const params = new URLSearchParams(url.split('?')[1]);
		expect(params.get('q')).toBe('A&B C/D');
	});

	it('does NOT point at api.deezer.com (must go through the proxy for CORS)', () => {
		expect(buildDeezerSearchUrl('x')).not.toContain('api.deezer.com');
	});
});

describe('deezerSongCover — resolve cover via the proxy', () => {
	it('fetches the proxy for `${artist} ${title}` and returns .cover', async () => {
		const fetchMock = vi.fn(async (_url: string) =>
			jsonResponse({ cover: COVER, artistPicture: PIC })
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerSongCover('Jay Chou', 'Simple Love');
		expect(out).toBe(COVER);
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called.startsWith('/api/deezer/search?')).toBe(true);
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('Jay Chou Simple Love');
	});

	it('returns null on an empty term (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ cover: COVER }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerSongCover('', '')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ cover: COVER }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerSongCover('X', 'Y', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: COVER }, false)));
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null when the proxy returns { cover: null }', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: null, artistPicture: null })));
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null on malformed JSON (json() throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						json: async () => {
							throw new Error('bad json');
						}
					}) as unknown as Response
			)
		);
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});
});

describe('deezerArtistCover — resolve artist picture via the proxy', () => {
	it('fetches the proxy for the artist name and returns .artistPicture', async () => {
		const fetchMock = vi.fn(async (_url: string) =>
			jsonResponse({ cover: COVER, artistPicture: PIC })
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerArtistCover('Taylor Swift');
		expect(out).toBe(PIC);
		const called = String(fetchMock.mock.calls[0][0]);
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('Taylor Swift');
	});

	it('returns null on an empty artist (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ artistPicture: PIC }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtistCover('   ')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ artistPicture: PIC }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerArtistCover('X', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null when the proxy returns { artistPicture: null }', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: COVER, artistPicture: null })));
		await expect(deezerArtistCover('X')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerArtistCover('X')).resolves.toBeNull();
	});
});
