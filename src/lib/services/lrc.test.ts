import { describe, it, expect } from 'vitest';
import {
	parseLRC,
	inferQualityFromUrl,
	splitParenLines,
	dominantScript,
	reorderPairs
} from './lrc';

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

describe('splitParenLines', () => {
	it('splits a line with one ASCII parens clause into two entries sharing the timestamp', () => {
		const out = splitParenLines([{ time: 10, text: 'or never (我们可以一同去往世界各地)' }]);
		expect(out).toEqual([
			{ time: 10, text: 'or never' },
			{ time: 10, text: '我们可以一同去往世界各地', fromParen: true }
		]);
	});

	it('recognises full-width parens too', () => {
		const out = splitParenLines([{ time: 5, text: '愛 (love) ／ 永遠（forever）' }]);
		expect(out[0]).toEqual({ time: 5, text: '愛 ／ 永遠' });
		expect(out[1]).toEqual({ time: 5, text: 'love', fromParen: true });
		expect(out[2]).toEqual({ time: 5, text: 'forever', fromParen: true });
		expect(out).toHaveLength(3);
	});

	it('passes lines without parens through untouched (no fromParen)', () => {
		const out = splitParenLines([{ time: 0, text: 'plain line' }]);
		expect(out).toEqual([{ time: 0, text: 'plain line' }]);
	});

	it('treats a whole-line parens (no other text) as a single line, no split', () => {
		const out = splitParenLines([{ time: 1, text: '(only this)' }]);
		expect(out).toEqual([{ time: 1, text: '(only this)' }]);
	});
});

describe('dominantScript', () => {
	it('classifies a pure-Han (CN) line as han', () => {
		expect(dominantScript('稻香')).toBe('han');
	});

	it('classifies a kanji+kana (JP) line as kana — any kana presence wins over Han count (A1)', () => {
		expect(dominantScript('君のため')).toBe('kana');
		// kanji-heavy JP line with only a little kana still resolves to kana
		expect(dominantScript('心配だ')).toBe('kana');
	});

	it('classifies a hangul (KR) line as hangul', () => {
		expect(dominantScript('사랑해')).toBe('hangul');
	});

	it('classifies an English (latin) line as latin', () => {
		expect(dominantScript('or never')).toBe('latin');
	});

	it('classifies a digits/punctuation-only line as other', () => {
		expect(dominantScript('123 ... !!!')).toBe('other');
		expect(dominantScript('')).toBe('other');
	});

	it('resolves a mixed Han+Latin line by max count (no kana → max wins)', () => {
		// mostly Han, a couple of latin chars → han
		expect(dominantScript('告白气球 oh')).toBe('han');
		// mostly latin, a couple of Han → latin
		expect(dominantScript('hello world 你')).toBe('latin');
	});
});

describe('reorderPairs', () => {
	it('moves the EN original above its CN translation within a same-timestamp group', () => {
		// Song is EN-dominant overall; CN line is the translation → original (EN) first.
		const input = [
			{ time: 10, text: '我们可以一同去往世界各地' },
			{ time: 10, text: 'we can go anywhere together' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 10, text: 'we can go anywhere together' },
			{ time: 10, text: '我们可以一同去往世界各地' }
		]);
	});

	it('returns a pure-CN song unchanged (no-op)', () => {
		const input = [
			{ time: 0, text: '稻香' },
			{ time: 5, text: '麦田' },
			{ time: 10, text: '回家' }
		];
		expect(reorderPairs(input)).toEqual(input);
	});

	it('moves a JP-kana original above its CN translation', () => {
		const input = [
			{ time: 3, text: '永远的爱' },
			{ time: 3, text: '君のため' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 3, text: '君のため' },
			{ time: 3, text: '永远的爱' }
		]);
	});

	it('moves a KR-hangul original above its CN translation', () => {
		const input = [
			{ time: 7, text: '我爱你' },
			{ time: 7, text: '사랑해' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 7, text: '사랑해' },
			{ time: 7, text: '我爱你' }
		]);
	});

	it('preserves stable relative order of non-reordered lines in a 3-line group', () => {
		// EN-dominant song; one EN original + two CN translation siblings.
		// Original moves to front; the two CN lines keep their relative order.
		const input = [
			{ time: 4, text: '第一句翻译' },
			{ time: 4, text: 'the only english line' },
			{ time: 4, text: '第二句翻译' }
		];
		const out = reorderPairs(input);
		expect(out).toEqual([
			{ time: 4, text: 'the only english line' },
			{ time: 4, text: '第一句翻译' },
			{ time: 4, text: '第二句翻译' }
		]);
	});

	it('is idempotent: reorderPairs(reorderPairs(x)) === reorderPairs(x)', () => {
		const input = [
			{ time: 10, text: '我们可以一同去往世界各地' },
			{ time: 10, text: 'we can go anywhere together' },
			{ time: 20, text: '另一句' },
			{ time: 20, text: 'another line here' }
		];
		const once = reorderPairs(input);
		const twice = reorderPairs(once);
		expect(twice).toEqual(once);
	});
});
