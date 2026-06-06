import { describe, it, expect } from 'vitest';
import { matchKey } from './match-key';

// matchKey is the single source of truth for the {artist}+{title} normalization used
// to align Last.fm names with local tracks (Phase 8) and — reused — by Phase 13
// loved-sync reconciliation. These tests pin the deterministic, case/space/punct-
// insensitive, bracket-/feat.-suffix-folding behavior. CJK Traditional/Simplified
// folding is explicitly OUT (deferred to Phase 13).
describe('matchKey — {artist}+{title} normalization primitive', () => {
	it('is deterministic and stable for the same inputs', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang')).toBe(matchKey('Jay Chou', 'Dao Xiang'));
	});

	it('strips case and whitespace', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang')).toBe(matchKey('  jay   chou ', ' DAO xiang  '));
	});

	it('folds bracketed and feat./remaster/live suffixes (same key as the bare form)', () => {
		expect(matchKey('Jay Chou', 'Dao Xiang (Live)')).toBe(matchKey('jay chou', 'dao xiang'));
		expect(matchKey('Adele', 'Hello - Remaster 2015')).toBe(matchKey('adele', 'hello'));
		expect(matchKey('Drake', 'One Dance (feat. Wizkid)')).toBe(matchKey('drake', 'one dance'));
		expect(matchKey('某歌手', '某歌【Live】')).toBe(matchKey('某歌手', '某歌'));
	});

	it('canonical order is normalize(artist) + "|" + normalize(title) (artist-first)', () => {
		// artist-first: swapping artist/title must produce a DIFFERENT key.
		expect(matchKey('A', 'B')).not.toBe(matchKey('B', 'A'));
		expect(matchKey('jaychou', 'daoxiang')).toBe('jaychou|daoxiang');
	});

	it('CJK fixture: 周杰伦 / 稻香 yields a non-empty, whitespace-insensitive key', () => {
		const k = matchKey('周杰伦', '稻香');
		expect(k.length).toBeGreaterThan(0);
		expect(k).not.toBe('|');
		expect(k).toBe(matchKey('周杰伦 ', ' 稻香'));
	});

	it('does NOT fold Traditional/Simplified (deferred to Phase 13)', () => {
		// 稻 (Simp) vs 稻 is identical; use a Trad/Simp pair that differs by glyph.
		// 周杰伦 (Simp 伦) vs 周杰倫 (Trad 倫) must remain DISTINCT in Phase 8.
		expect(matchKey('周杰伦', '稻香')).not.toBe(matchKey('周杰倫', '稻香'));
	});

	it('tolerates empty / missing inputs without throwing', () => {
		expect(matchKey('', '')).toBe('|');
		// @ts-expect-error — guard against undefined at runtime even though typed string
		expect(matchKey(undefined, undefined)).toBe('|');
	});
});
