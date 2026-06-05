import { describe, it, expect } from 'vitest';
import { parseLRC, inferQualityFromUrl } from './lrc';

describe('parseLRC', () => {
	// Test 1: sorted ascending by time, blank lines dropped.
	it('parses [mm:ss.xxx] lyrics into a time-sorted array, dropping blanks', () => {
		expect(parseLRC('[00:12.34]hello\n[00:01.00]world')).toEqual([
			{ time: 1, text: 'world' },
			{ time: 12.34, text: 'hello' }
		]);
	});

	// Test 2: the no-millis branch.
	it('handles the no-millis branch [mm:ss]', () => {
		expect(parseLRC('[01:05]line')).toEqual([{ time: 65, text: 'line' }]);
	});

	it('returns [] for empty/falsy input', () => {
		expect(parseLRC('')).toEqual([]);
	});

	it('drops lines whose text is blank after stripping the timestamp', () => {
		expect(parseLRC('[00:00.00]\n[00:02.00]kept')).toEqual([{ time: 2, text: 'kept' }]);
	});
});

describe('inferQualityFromUrl', () => {
	// Test 3: lossless vs 320k branches.
	it('returns lossless for .flac', () => {
		expect(inferQualityFromUrl('https://x/y.flac')).toEqual({ tag: 'lossless', label: 'LOSSLESS' });
	});

	it('returns 320k for .mp3 (the everything-else branch)', () => {
		expect(inferQualityFromUrl('https://x/y.mp3')).toEqual({ tag: '320k', label: '320K' });
	});

	it('treats wav/ape/alac/aiff as lossless', () => {
		for (const ext of ['wav', 'ape', 'alac', 'aiff']) {
			expect(inferQualityFromUrl(`https://x/y.${ext}`)).toEqual({
				tag: 'lossless',
				label: 'LOSSLESS'
			});
		}
	});

	it('returns {tag:null,label:""} for a null url', () => {
		expect(inferQualityFromUrl(null)).toEqual({ tag: null, label: '' });
	});

	it('ignores query strings when sniffing the extension', () => {
		expect(inferQualityFromUrl('https://x/y.flac?token=abc')).toEqual({
			tag: 'lossless',
			label: 'LOSSLESS'
		});
	});
});
