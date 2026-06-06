import { describe, it, expect } from 'vitest';
// Import ONLY the PURE exports (no $state / browser) — these run under the node
// Vitest project, mirroring i18n.test.ts.
import { detectLang, shouldTranslate } from './detect';

describe('detectLang', () => {
	it('classifies Hiragana as ja', () => {
		expect(detectLang('こんにちは')).toBe('ja');
	});

	it('classifies Katakana as ja', () => {
		expect(detectLang('テスト')).toBe('ja');
	});

	it('classifies Hangul (syllables) as ko', () => {
		expect(detectLang('안녕')).toBe('ko');
	});

	it('classifies Hangul jamo as ko', () => {
		expect(detectLang('ㄱㄴㄷ')).toBe('ko');
	});

	it('classifies Latin text as en', () => {
		expect(detectLang('Taylor Swift')).toBe('en');
		expect(detectLang('Hello World')).toBe('en');
	});

	it('classifies empty string as en', () => {
		expect(detectLang('')).toBe('en');
	});

	it('classifies simplified-only Han as zh-Hans', () => {
		// 简体 + 爱国 are simplified-only forms.
		expect(detectLang('简体')).toBe('zh-Hans');
		expect(detectLang('爱国')).toBe('zh-Hans');
	});

	it('classifies traditional-only Han as zh-Hant', () => {
		// 繁體 + 愛國 are traditional-only forms.
		expect(detectLang('繁體')).toBe('zh-Hant');
		expect(detectLang('愛國')).toBe('zh-Hant');
	});

	it('classifies ambiguous Han (no signal either way) as zh-Hant', () => {
		// Characters identical in both scripts → default Traditional.
		expect(detectLang('人山')).toBe('zh-Hant');
	});

	it('lets kana win over Han when both present', () => {
		expect(detectLang('東京テスト')).toBe('ja');
		expect(detectLang('愛のうた')).toBe('ja');
	});

	it('lets hangul win over Han when both present', () => {
		expect(detectLang('韓國안녕')).toBe('ko');
	});
});

describe('shouldTranslate', () => {
	it('returns false when target is off (regardless of whitelist)', () => {
		expect(shouldTranslate('Hello', 'off', [])).toBe(false);
		expect(shouldTranslate('简体', 'off', ['ja'])).toBe(false);
	});

	it('returns false when the detected source is in the whitelist', () => {
		expect(shouldTranslate('Taylor Swift', 'zh-Hant', ['en'])).toBe(false);
		expect(shouldTranslate('简体', 'zh-Hant', ['zh-Hans'])).toBe(false);
	});

	it('returns false when the detected source already equals the target', () => {
		expect(shouldTranslate('繁體', 'zh-Hant', [])).toBe(false);
		expect(shouldTranslate('Hello', 'en', [])).toBe(false);
	});

	it('returns true otherwise', () => {
		expect(shouldTranslate('简体', 'zh-Hant', [])).toBe(true);
		expect(shouldTranslate('Taylor Swift', 'zh-Hant', [])).toBe(true);
		expect(shouldTranslate('こんにちは', 'en', ['ko'])).toBe(true);
	});
});
