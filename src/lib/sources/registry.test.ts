import { describe, it, expect } from 'vitest';
import { SOURCES, getEnabledAdapters } from './registry';
import { makeUid, type SourceId } from './types';

const EXPECTED_KEYS: SourceId[] = ['netease', 'qq', 'kuwo', 'joox'];

describe('SOURCES registry (DATA-04 — single enumeration point)', () => {
	// Test 4: exactly the 4 keys; each value's .id matches its key.
	it('enumerates exactly netease,qq,kuwo,joox', () => {
		expect(Object.keys(SOURCES)).toEqual(EXPECTED_KEYS);
	});

	it('each adapter .id matches its registry key', () => {
		for (const key of EXPECTED_KEYS) {
			expect(SOURCES[key].id).toBe(key);
		}
	});

	// Test 5: every adapter exposes search + resolve functions (stubs are conformant).
	it('every adapter exposes search() and resolve() functions', () => {
		for (const key of EXPECTED_KEYS) {
			expect(typeof SOURCES[key].search).toBe('function');
			expect(typeof SOURCES[key].resolve).toBe('function');
		}
	});

	it('the 3 not-yet-implemented adapters throw not-implemented from search/resolve', async () => {
		const stub: SourceId[] = ['qq', 'kuwo', 'joox'];
		const ac = new AbortController();
		for (const key of stub) {
			await expect(SOURCES[key].search('x', 1, ac.signal)).rejects.toThrow(/not-implemented/);
			await expect(
				SOURCES[key].resolve(
					{
						uid: makeUid(key, '1'),
						source: key,
						songid: '1',
						title: '',
						artist: '',
						album: '',
						cover: null,
						audioUrl: null,
						lrc: null,
						lrcUrl: null,
						detailsLoaded: false,
						quality: null,
						qualityLabel: null,
						keyword: 'x',
						displayIndex: 1
					},
					ac.signal
				)
			).rejects.toThrow(/not-implemented/);
		}
	});
});

describe('getEnabledAdapters', () => {
	it('returns only enabledByDefault adapters when no prefs given', () => {
		const enabled = getEnabledAdapters();
		const enabledIds = enabled.map((a) => a.id);
		for (const a of Object.values(SOURCES)) {
			if (a.enabledByDefault) expect(enabledIds).toContain(a.id);
			else expect(enabledIds).not.toContain(a.id);
		}
	});

	it('prefs override enabledByDefault (explicit false disables, explicit true enables)', () => {
		const onlyNetease = getEnabledAdapters({ netease: true, qq: false, kuwo: false, joox: false });
		expect(onlyNetease.map((a) => a.id)).toEqual(['netease']);
	});
});

describe('makeUid', () => {
	it('produces the colon form (D-10)', () => {
		expect(makeUid('netease', '123')).toBe('netease:123');
	});
});
