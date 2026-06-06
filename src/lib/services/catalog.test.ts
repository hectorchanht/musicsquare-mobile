import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchAll, ensureTrackDetails, __clearSearchCache } from './catalog';
import { SOURCES } from '$lib/sources/registry';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

const ALL: Partial<Record<SourceId, boolean>> = {
	netease: true,
	qq: true,
	kuwo: true,
	joox: true
};

function mk(source: SourceId, songid: string, displayIndex = 1, extra: Partial<Track> = {}): Track {
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
		displayIndex,
		...extra
	};
}

afterEach(() => {
	// Clear the D-04 TTL cache so the fan-out spy tests never observe a stale
	// cached SearchResult from a prior case (they all reuse the keyword 'x', page 1).
	__clearSearchCache();
	vi.restoreAllMocks();
});

describe('searchAll (DATA-03 fan-out)', () => {
	it('allSettled — one rejecting source leaves the other three intact', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockRejectedValue(new Error('qq upstream 500'));
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		const { perSource, interleaved } = await searchAll('x', 1, ALL);

		const qq = perSource.find((p) => p.source === 'qq');
		expect(qq?.status).toBe('error');
		expect(qq?.error).toContain('qq upstream 500');
		expect(qq?.tracks).toEqual([]);

		// the other three survived
		const okSources = perSource.filter((p) => p.status === 'ok').map((p) => p.source);
		expect(okSources).toEqual(expect.arrayContaining(['netease', 'kuwo', 'joox']));
		const uids = interleaved.map((t) => t.uid);
		expect(uids).toContain('netease:n1');
		expect(uids).toContain('kuwo:k1');
		expect(uids).toContain('joox:j1');
		expect(uids).not.toContain('qq:'); // dead source contributes nothing
	});

	it('dedupes by colon uid — duplicate uid yields one entry', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([
			mk('netease', 'dup'),
			mk('netease', 'dup'), // same uid → should collapse to one
			mk('netease', 'other')
		]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const { interleaved } = await searchAll('x', 1, ALL);
		const dupCount = interleaved.filter((t) => t.uid === 'netease:dup').length;
		expect(dupCount).toBe(1);
		expect(interleaved.map((t) => t.uid)).toEqual(['netease:dup', 'netease:other']);
	});

	it('interleaves round-robin in registry order (netease→qq→kuwo→joox)', async () => {
		vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1'), mk('netease', 'n2')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([mk('kuwo', 'k1')]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([mk('joox', 'j1')]);

		const { interleaved } = await searchAll('x', 1, ALL);
		expect(interleaved.map((t) => t.uid)).toEqual([
			'netease:n1',
			'qq:q1',
			'kuwo:k1',
			'joox:j1',
			'netease:n2'
		]);
	});
});

describe('searchAll (D-04 TTL cache)', () => {
	it('does NOT re-fan-out on a second call with the same (keyword, page, sources)', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		const q = vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([mk('qq', 'q1')]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		const first = await searchAll('cachekw', 1, ALL);
		const second = await searchAll('cachekw', 1, ALL);

		// adapters fanned out exactly once — the second call is a cache HIT
		expect(n).toHaveBeenCalledOnce();
		expect(q).toHaveBeenCalledOnce();
		// same resolved shape
		expect(second.interleaved.map((t) => t.uid)).toEqual(first.interleaved.map((t) => t.uid));
		expect(second.interleaved.map((t) => t.uid)).toEqual(['netease:n1', 'qq:q1']);
	});

	it('keys the cache by PAGE — page 1 and page 2 are distinct entries', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		await searchAll('pagekw', 1, ALL);
		await searchAll('pagekw', 2, ALL);

		// page 1 and page 2 are separate cache keys → two distinct fan-outs
		expect(n).toHaveBeenCalledTimes(2);
		expect(n.mock.calls[0][1]).toBe(1);
		expect(n.mock.calls[1][1]).toBe(2);
	});

	it('normalizes the cache key (trim + lowercase) so "Jay" and " jay " share an entry', async () => {
		const n = vi.spyOn(SOURCES.netease, 'search').mockResolvedValue([mk('netease', 'n1')]);
		vi.spyOn(SOURCES.qq, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.kuwo, 'search').mockResolvedValue([]);
		vi.spyOn(SOURCES.joox, 'search').mockResolvedValue([]);

		await searchAll('Jay', 1, ALL);
		await searchAll('  jay  ', 1, ALL);

		// same normalized key → only one fan-out
		expect(n).toHaveBeenCalledOnce();
	});
});

describe('ensureTrackDetails (registry dispatch + readiness guard)', () => {
	it('dispatches to SOURCES[track.source].resolve when not yet loaded', async () => {
		const t = mk('netease', 'n1');
		const resolved = { ...t, detailsLoaded: true, audioUrl: 'https://cdn/x.mp3' };
		const spy = vi.spyOn(SOURCES.netease, 'resolve').mockResolvedValue(resolved);

		const out = await ensureTrackDetails(t);
		expect(spy).toHaveBeenCalledOnce();
		expect(out.audioUrl).toBe('https://cdn/x.mp3');
	});

	it('re-resolves a Netease track whose lrcUrl is set but lrc not yet fetched', async () => {
		// readiness guard: detailsLoaded && audioUrl && (lrc || !lrcUrl)
		// here lrc=null and lrcUrl set → (null || !set) = false → NOT ready → re-resolve
		const t = mk('netease', 'n1', 1, {
			detailsLoaded: true,
			audioUrl: 'https://cdn/x.mp3',
			lrc: null,
			lrcUrl: 'https://cdn/x.lrc'
		});
		const spy = vi.spyOn(SOURCES.netease, 'resolve').mockResolvedValue({ ...t, lrc: '[00:01]hi' });

		const out = await ensureTrackDetails(t);
		expect(spy).toHaveBeenCalledOnce();
		expect(out.lrc).toBe('[00:01]hi');
	});

	it('returns early (no resolve) when fully loaded', async () => {
		const t = mk('netease', 'n1', 1, {
			detailsLoaded: true,
			audioUrl: 'https://cdn/x.mp3',
			lrc: '[00:01]hi',
			lrcUrl: 'https://cdn/x.lrc'
		});
		const spy = vi.spyOn(SOURCES.netease, 'resolve');

		const out = await ensureTrackDetails(t);
		expect(spy).not.toHaveBeenCalled();
		expect(out).toBe(t);
	});
});
