// Lightweight runes-based i18n for UI chrome (NO external dependency).
//
// Design:
//  - `en` is the source/reference dictionary; its keys define `TranslationKey`,
//    so a missing key is a compile error at every `t()` call site.
//  - PURE helpers (`lookupKey`, `interpolate`, `detectAppLang`, the dicts) are
//    importable WITHOUT touching `$state` — the i18n unit test drives these in the
//    node Vitest project (which can't compile runes).
//  - `t()` is the ONLY reactive wrapper: it reads `settings.appLang` ($state) on
//    every call, so any template / `$derived` re-renders when the language changes
//    (same model as names.dn + rev). No page reload.
import en from './en';
import zhHant from './zh-Hant';
import zhHans from './zh-Hans';
import { settings } from '$lib/stores/settings.svelte';

export type AppLang = 'en' | 'zh-Hant' | 'zh-Hans';
export type TranslationKey = keyof typeof en;
export type Dict = Record<TranslationKey, string>;

export const dicts: Record<AppLang, Dict> = {
	en,
	'zh-Hant': zhHant,
	'zh-Hans': zhHans
};

/** Replace `{token}` occurrences with params[token]; leave unknown tokens intact. Pure. */
export function interpolate(str: string, params?: Record<string, string | number>): string {
	if (!params) return str;
	return str.replace(/\{(\w+)\}/g, (whole, token: string) =>
		Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : whole
	);
}

/** Pure resolver: dicts[lang][key] → dicts.en[key] → raw key (NEVER blank). */
export function lookupKey(key: TranslationKey | string, lang: AppLang): string {
	const inLang = dicts[lang]?.[key as TranslationKey];
	if (inLang !== undefined) return inLang;
	const inEn = dicts.en[key as TranslationKey];
	if (inEn !== undefined) return inEn;
	return key;
}

/**
 * Map a navigator-style language string to an AppLang. Pure + SSR-safe
 * (takes the string as an argument; no `navigator` access here).
 *   zh-TW / zh-Hant → zh-Hant; zh-CN / zh-Hans / zh → zh-Hans; else en.
 */
export function detectAppLang(navLang?: string): AppLang {
	if (!navLang) return 'en';
	const l = navLang.toLowerCase();
	if (l.startsWith('zh')) {
		if (l.includes('tw') || l.includes('hant') || l.includes('hk') || l.includes('mo')) return 'zh-Hant';
		return 'zh-Hans';
	}
	return 'en';
}

/**
 * Reactive translate. Reads `settings.appLang` ($state) on EVERY call so callers
 * re-render on language change. Returns interpolate(lookupKey(...), params).
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
	return interpolate(lookupKey(key, settings.appLang), params);
}
