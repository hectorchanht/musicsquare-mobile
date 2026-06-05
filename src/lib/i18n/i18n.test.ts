import { describe, it, expect } from 'vitest';
// Import ONLY the PURE exports — NOT `t` (it reads `$state` via settings, which the
// node Vitest project can't compile). These helpers are fully deterministic.
import { lookupKey, interpolate, detectAppLang, dicts } from './index';

describe('lookupKey', () => {
	it('returns the value for the requested locale', () => {
		expect(lookupKey('nav.home', 'en')).toBe('Home');
		expect(lookupKey('nav.home', 'zh-Hant')).toBe('首頁');
		expect(lookupKey('nav.home', 'zh-Hans')).toBe('首页');
	});

	it('falls back to the en value when a key is missing in the requested locale', () => {
		// Force a hole in zh-Hant for this assertion, then restore it.
		const original = dicts['zh-Hant']['nav.home'];
		// @ts-expect-error — intentionally deleting to simulate a missing key
		delete dicts['zh-Hant']['nav.home'];
		expect(lookupKey('nav.home', 'zh-Hant')).toBe('Home');
		dicts['zh-Hant']['nav.home'] = original;
	});

	it('returns the raw key (never blank) when the key is missing in ALL dicts', () => {
		// @ts-expect-error — unknown key on purpose
		expect(lookupKey('does.not.exist', 'en')).toBe('does.not.exist');
		// @ts-expect-error — unknown key on purpose
		expect(lookupKey('does.not.exist', 'zh-Hant')).toBe('does.not.exist');
	});
});

describe('interpolate', () => {
	it('replaces {token} with the param value', () => {
		expect(interpolate('{count} tracks', { count: 3 })).toBe('3 tracks');
	});

	it('leaves unknown tokens intact', () => {
		expect(interpolate('{count} of {total}', { count: 2 })).toBe('2 of {total}');
	});

	it('returns the string unchanged when no params are given', () => {
		expect(interpolate('plain string')).toBe('plain string');
	});
});

describe('dictionaries', () => {
	it('all three locales expose IDENTICAL key sets', () => {
		const enKeys = Object.keys(dicts.en).sort();
		const hantKeys = Object.keys(dicts['zh-Hant']).sort();
		const hansKeys = Object.keys(dicts['zh-Hans']).sort();
		expect(hantKeys).toEqual(enKeys);
		expect(hansKeys).toEqual(enKeys);
	});

	it('has no blank values in any locale', () => {
		for (const lang of ['en', 'zh-Hant', 'zh-Hans'] as const) {
			for (const [key, val] of Object.entries(dicts[lang])) {
				expect(val, `${lang}.${key} should not be blank`).not.toBe('');
			}
		}
	});
});

describe('detectAppLang', () => {
	it('maps Traditional Chinese locales to zh-Hant', () => {
		expect(detectAppLang('zh-TW')).toBe('zh-Hant');
		expect(detectAppLang('zh-Hant')).toBe('zh-Hant');
	});

	it('maps Simplified Chinese locales to zh-Hans', () => {
		expect(detectAppLang('zh-CN')).toBe('zh-Hans');
		expect(detectAppLang('zh-Hans')).toBe('zh-Hans');
		expect(detectAppLang('zh')).toBe('zh-Hans');
	});

	it('maps non-Chinese and undefined to en', () => {
		expect(detectAppLang('en-US')).toBe('en');
		expect(detectAppLang(undefined)).toBe('en');
	});
});
