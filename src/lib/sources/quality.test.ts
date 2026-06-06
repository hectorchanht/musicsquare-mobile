import { describe, it, expect } from 'vitest';
import { pickByQualityPref } from './quality';

// The verbatim JOOX ladder (top-tier-first) — the realistic input.
const JOOX_ORDER = [
	'Atmos全景声',
	'无损FLAC',
	'Hi-Res无损',
	'母带无损',
	'OGG 320',
	'MP3 320',
	'AAC 192',
	'OGG 192',
	'MP3 128',
	'AAC 96',
	'AAC 48'
];

describe('pickByQualityPref (D-03)', () => {
	it("pref '128' moves the 128–192/AAC band to the front (stable)", () => {
		const out = pickByQualityPref(JOOX_ORDER, '128');
		// the 128 band (192/128/aac) leads
		expect(out[0]).toBe('AAC 192');
		// first element matches the 128 band
		expect(/128|192|aac/i.test(out[0])).toBe(true);
		// the band members come first, in their original relative order
		expect(out.slice(0, 5)).toEqual(['AAC 192', 'OGG 192', 'MP3 128', 'AAC 96', 'AAC 48']);
		// lossless/320 tiers are pushed after the band
		expect(out.slice(5)).toEqual([
			'Atmos全景声',
			'无损FLAC',
			'Hi-Res无损',
			'母带无损',
			'OGG 320',
			'MP3 320'
		]);
		// no tier dropped, none duplicated
		expect(out.length).toBe(JOOX_ORDER.length);
		expect([...out].sort()).toEqual([...JOOX_ORDER].sort());
	});

	it("pref '320' moves the 320 band to the front", () => {
		const out = pickByQualityPref(JOOX_ORDER, '320');
		expect(out.slice(0, 2)).toEqual(['OGG 320', 'MP3 320']);
		expect(/320/.test(out[0])).toBe(true);
		expect(out.length).toBe(JOOX_ORDER.length);
	});

	it("pref 'lossless' returns the input order unchanged (top tier first)", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'lossless');
		expect(out).toEqual(JOOX_ORDER);
	});

	it("pref 'auto' returns the input order unchanged", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'auto');
		expect(out).toEqual(JOOX_ORDER);
	});

	it('never mutates the input array', () => {
		const input = [...JOOX_ORDER];
		pickByQualityPref(input, '128');
		expect(input).toEqual(JOOX_ORDER);
	});

	it("returns a fresh array even for the unchanged 'auto'/'lossless' path", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'auto');
		expect(out).not.toBe(JOOX_ORDER);
	});
});
