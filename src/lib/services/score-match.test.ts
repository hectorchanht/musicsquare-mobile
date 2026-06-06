import { describe, it, expect } from 'vitest';
import { scoreMatch, VARIANT_KEYWORDS } from './score-match';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// scoreMatch (Phase 10, LFSRC-03 / D-02) is the PURE re-ranking term Task 2 wires into
// resolveStub. It returns a number (higher = better) computed as
// `similarity(query, candidate) − variantPenalty(query, candidate)`:
//   - similarity reuses matchKey (artist-first normalization) — an exact key match scores
//     highest, a loose match lower.
//   - variantPenalty down-ranks a candidate whose TITLE carries a cover/karaoke/live/
//     instrumental/remix (+ CJK 翻唱/伴奏/现场…) keyword — UNLESS the QUERY asked for it.
// It NEVER reads source/quality/preferredSource (dedupeBest's job) and NEVER nulls/NaNs.

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

describe('scoreMatch — variant-keyword penalty (D-02a)', () => {
	it('ranks a clean title above an English karaoke variant of the same song', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const clean = mk('netease', 'clean', '周杰伦', { title: '稻香' });
		const karaoke = mk('qq', 'karaoke', '周杰伦', { title: '稻香 (Karaoke)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, karaoke));
	});

	it('ranks a clean title above a cover / live / instrumental variant', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'clean', 'X', { title: 'Song' });
		const cover = mk('qq', 'cover', 'X', { title: 'Song (Cover)' });
		const live = mk('kuwo', 'live', 'X', { title: 'Song (Live)' });
		const instrumental = mk('joox', 'inst', 'X', { title: 'Song - Instrumental' });
		const cleanScore = scoreMatch(query, clean);
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, cover));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, live));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, instrumental));
	});

	it('penalizes a CJK variant term (翻唱 cover / 伴奏 instrumental)', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const clean = mk('netease', 'clean', '周杰伦', { title: '稻香' });
		const fanchang = mk('qq', 'fc', '周杰伦', { title: '稻香 翻唱' });
		const banzou = mk('kuwo', 'bz', '周杰伦', { title: '稻香 伴奏' });
		const cleanScore = scoreMatch(query, clean);
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, fanchang));
		expect(cleanScore).toBeGreaterThan(scoreMatch(query, banzou));
	});
});

describe('scoreMatch — query-asked-for-variant exception (D-02a)', () => {
	it('does NOT penalize a Live candidate when the query itself asked for Live', () => {
		const query = { artist: 'X', title: 'Song (Live)' };
		const liveCandidate = mk('netease', 'live', 'X', { title: 'Song (Live)' });
		const cleanCandidate = mk('qq', 'clean', 'X', { title: 'Song' });
		// The user tapped a Live track → the live take must NOT be down-ranked below the
		// clean studio cut. The exact-variant candidate should score at least as high.
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(
			scoreMatch(query, cleanCandidate)
		);
	});

	it('does NOT penalize a CJK variant candidate when the query asked for that variant', () => {
		const query = { artist: '周杰伦', title: '稻香 现场' };
		const liveCandidate = mk('netease', 'live', '周杰伦', { title: '稻香 现场' });
		// query asked for 现场 → the 现场 keyword must not be penalized for this resolve.
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(0);
		// Compare to a plain studio candidate of a (slightly) different normalized title:
		const plain = mk('qq', 'plain', '周杰伦', { title: '稻香' });
		expect(scoreMatch(query, liveCandidate)).toBeGreaterThanOrEqual(scoreMatch(query, plain));
	});
});

describe('scoreMatch — artist+title similarity reward (D-02b)', () => {
	it('ranks an exact matchKey candidate above a loosely-matching one', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const exact = mk('netease', 'exact', '周杰伦', { title: '稻香' });
		const loose = mk('qq', 'loose', '林俊杰', { title: '江南' });
		expect(scoreMatch(query, exact)).toBeGreaterThan(scoreMatch(query, loose));
	});

	it('ranks a same-title-wrong-artist candidate below an exact match', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const exact = mk('netease', 'exact', '周杰伦', { title: '稻香' });
		const wrongArtist = mk('qq', 'wrong', '某某', { title: '稻香' });
		expect(scoreMatch(query, exact)).toBeGreaterThan(scoreMatch(query, wrongArtist));
	});
});

describe('VARIANT_KEYWORDS — exported editable list', () => {
	it('is a non-empty array containing both an English and a CJK term', () => {
		expect(Array.isArray(VARIANT_KEYWORDS)).toBe(true);
		expect(VARIANT_KEYWORDS.length).toBeGreaterThan(0);
		expect(VARIANT_KEYWORDS).toContain('karaoke');
		expect(VARIANT_KEYWORDS).toContain('翻唱');
	});
});

describe('scoreMatch — review regressions (CR-01/CR-02/WR-02/IN-01/IN-02)', () => {
	it('CR-01: a clean title containing a keyword as a SUBSTRING is not penalized (Olive ⊅ live)', () => {
		// 'live' must not fire inside 'Olive'; 'cover' must not fire inside 'Discover'.
		// An exact-match clean title scores the same whether or not it embeds a keyword substring.
		const olive = scoreMatch({ artist: 'X', title: 'Olive' }, mk('netease', 'o', 'X', { title: 'Olive' }));
		const apple = scoreMatch({ artist: 'X', title: 'Apple' }, mk('netease', 'a', 'X', { title: 'Apple' }));
		const discover = scoreMatch({ artist: 'X', title: 'Discover' }, mk('qq', 'd', 'X', { title: 'Discover' }));
		expect(olive).toBe(apple); // both exact, both un-penalized
		expect(discover).toBe(apple);
	});

	it('CR-01: the keyword as a real WORD is still penalized', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'c', 'X', { title: 'Song' });
		const live = mk('qq', 'l', 'X', { title: 'Song (Live)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, live));
	});

	it('CR-02: a paired keyword (live ⊂ live版) counts ONCE, not twice', () => {
		const query = { artist: 'X', title: 'Song' };
		const onePair = mk('netease', 'p', 'X', { title: 'Song live版' }); // matched live+live版 → dedup → 1×
		const twoDistinct = mk('qq', 't', 'X', { title: 'Song live remix' }); // live+remix → 2×
		// One de-duped variant must be penalized LESS than two genuinely distinct variants.
		expect(scoreMatch(query, onePair)).toBeGreaterThan(scoreMatch(query, twoDistinct));
	});

	it('WR-02: an artist literally named "Live" does NOT suppress the live penalty', () => {
		const query = { artist: 'Live', title: 'Song' }; // band "Live", clean title
		const clean = mk('netease', 'c', 'Live', { title: 'Song' });
		const liveTake = mk('qq', 'l', 'Live', { title: 'Song (Live)' });
		// The exception keys off the query TITLE only — a live recording is still down-ranked.
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, liveTake));
	});

	it('IN-01: "speed up" is penalized (not only "sped up")', () => {
		const query = { artist: 'X', title: 'Song' };
		const clean = mk('netease', 'c', 'X', { title: 'Song' });
		const speedUp = mk('qq', 's', 'X', { title: 'Song (speed up)' });
		expect(scoreMatch(query, clean)).toBeGreaterThan(scoreMatch(query, speedUp));
	});

	it('IN-02: empty query / all-variant candidate still returns a finite number', () => {
		const empty = scoreMatch({ artist: '', title: '' }, mk('netease', 'e', '', { title: '' }));
		expect(Number.isFinite(empty)).toBe(true);
		const allVariant = scoreMatch(
			{ artist: 'X', title: 'Song' },
			mk('qq', 'v', 'Z', { title: 'Karaoke Cover (Live)' })
		);
		expect(Number.isFinite(allVariant)).toBe(true); // negative is fine; NaN/null is not
	});
});

describe('scoreMatch — determinism + numeric safety', () => {
	it('returns the same number for the same inputs and never NaN/null', () => {
		const query = { artist: '周杰伦', title: '稻香' };
		const c = mk('netease', 'c', '周杰伦', { title: '稻香 (Karaoke)' });
		const a = scoreMatch(query, c);
		const b = scoreMatch(query, c);
		expect(a).toBe(b);
		expect(typeof a).toBe('number');
		expect(Number.isNaN(a)).toBe(false);
		expect(a).not.toBeNull();
	});
});
