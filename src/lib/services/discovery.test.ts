import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	resolveStub,
	mapWithConcurrency,
	DISCOVERY_TAGS,
	DISCOVERY_COUNTRIES
} from './discovery';
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

describe('resolveStub — scored best-match pick (LFSRC-03 / D-02)', () => {
	it('returns the CLEAN track even when a karaoke/翻唱 variant is ordered first', async () => {
		// searchAll surfaces the 翻唱 (cover) variant BEFORE the clean studio cut. The two
		// titles normalize to DIFFERENT dedupe keys (稻香翻唱 vs 稻香) so both survive dedupeBest;
		// without scoring, dedupeBest[0] would be the variant. scoreMatch must beat that.
		const variant = mk('netease', 'variant', '周杰伦', { title: '稻香 翻唱' });
		const clean = mk('qq', 'clean', '周杰伦', { title: '稻香' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([variant, clean]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(clean.uid);
	});

	it('returns the CLEAN track over an English cover variant ordered first', async () => {
		const cover = mk('netease', 'cover', 'X', { title: 'Song Cover' });
		const clean = mk('qq', 'clean', 'X', { title: 'Song' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([cover, clean]));

		const out = await resolveStub('X', 'Song');
		expect(out?.uid).toBe(clean.uid);
	});

	it('falls back to dedupeBest order among equal-scored candidates (WR-01: strict stable max, ≥2 survive)', async () => {
		// Two DISTINCT, equally-(zero-)scored candidates with DIFFERENT normalized keys so
		// BOTH survive dedupeBest (the prior version used identical 稻香/稻香 which dedupeBest
		// collapsed to one, so the ≥2-candidate stable-max never ran). Both are unrelated to
		// the query → similarity 0, penalty 0 → equal score. The strict `s > bestScore` max
		// keeps the EARLIER dedupeBest position → `first` wins the tie.
		const first = mk('netease', 'first', 'Alpha', { title: 'Aaa' });
		const second = mk('qq', 'second', 'Beta', { title: 'Bbb' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([first, second]));

		const out = await resolveStub('周杰伦', '稻香');
		expect(out?.uid).toBe(first.uid); // tie → first-wins (not last-wins)
	});

	it('still returns null on zero results and never throws (posture preserved)', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		await expect(resolveStub('Nobody', 'Nothing')).resolves.toBeNull();

		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search down'));
		await expect(resolveStub('X', 'Y')).resolves.toBeNull();
	});
});

describe('mapWithConcurrency — order-preserving capped async pool (Pitfall 11)', () => {
	it('runs at most `limit` calls in flight and preserves input order', async () => {
		const items = [0, 1, 2, 3, 4, 5];
		let inFlight = 0;
		let maxInFlight = 0;

		const out = await mapWithConcurrency(items, 2, async (n) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			// Yield a few microtasks so concurrent slots actually overlap before resolving.
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return n * 10;
		});

		// Cap of 2 is never exceeded...
		expect(maxInFlight).toBeLessThanOrEqual(2);
		// ...and at least 2 ran together (proves it isn't accidentally serial).
		expect(maxInFlight).toBe(2);
		// Result order matches input order regardless of completion order.
		expect(out).toEqual([0, 10, 20, 30, 40, 50]);
	});

	it('never rejects when an item fn throws — that slot is left empty', async () => {
		const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
			if (n === 2) throw new Error('boom');
			return n;
		});
		expect(out[0]).toBe(1);
		expect(out[1]).toBeUndefined(); // the thrown slot is swallowed, not propagated
		expect(out[2]).toBe(3);
	});

	it('handles an empty input list without spawning workers', async () => {
		const fn = vi.fn(async (n: number) => n);
		await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('curated discovery sets', () => {
	it('DISCOVERY_TAGS is a small, non-empty editable genre/mood set', () => {
		expect(Array.isArray(DISCOVERY_TAGS)).toBe(true);
		expect(DISCOVERY_TAGS.length).toBeGreaterThan(0);
		expect(DISCOVERY_TAGS).toContain('mandopop');
	});

	it('DISCOVERY_COUNTRIES is a CN-biased set of ISO 3166-1 NAMES (not codes)', () => {
		expect(DISCOVERY_COUNTRIES).toContain('China');
		expect(DISCOVERY_COUNTRIES).toContain('Taiwan');
		// Names, not codes: 'United States' (not 'US'), so no 2-letter entries.
		expect(DISCOVERY_COUNTRIES).toContain('United States');
		expect(DISCOVERY_COUNTRIES.every((c) => c.length > 2)).toBe(true);
	});
});
