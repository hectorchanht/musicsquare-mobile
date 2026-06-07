// Central settings defaults (quick-260607-k3y). Edit this file to change what new users
// see + what reset-to-default reverts to. The Settings class in stores/settings.svelte.ts
// reads from these consts on class-field init AND on the reset-group methods.
//
// Each group is a plain literal object — `as const` keeps the strings narrow for type
// inference. Adding a new setting: 1) add it here in the right group; 2) reference it in
// the Settings class field initializer; 3) it appears in the matching reset method
// automatically. No new infrastructure needed.

import type { AppLang } from '$lib/i18n';
import {
	DEFAULT_SECTION_ORDER,
	DEFAULT_HOME_TAGS,
	DEFAULT_HOME_COUNTRIES,
	SHELF_DEFAULT,
	type HomeDensity,
	type HomeLandingTab,
	type HomeSectionId
} from '$lib/services/home-layout';
import type { SourceId } from '$lib/sources/types';
import type { LyricsLang, SourceLang, TranslateMode, DefaultQuality, DefaultSource, Theme } from '$lib/stores/settings.svelte';

/** The accent-color hex used when the user hasn't picked one. Pulled out so the General
 *  reset can restore it without importing from settings.svelte.ts (circular). */
export const DEFAULT_ACCENT = '#7c5cff';

// ---- General ---------------------------------------------------------------------------
// First-visit detection lives in settings.load() (browser-language auto-detect). Reset reverts
// to 'en' explicitly — the user can re-pick after.
export const GENERAL_DEFAULTS = {
	appLang: 'en' as AppLang,
	accent: DEFAULT_ACCENT,
	reduceMotion: false,
	/** Light/dark theme — default 'dark' (today's design). 'light' flips data-theme on <html>
	 *  to surface the `[data-theme='light']` token overrides in app.css. */
	theme: 'dark' as Theme
} as const;

// ---- Appearance (per-part sizing) ------------------------------------------------------
export const APPEARANCE_DEFAULTS = {
	fontScaleTitle: 100,
	fontScaleArtist: 100,
	fontScaleLyrics: 100,
	coverScale: 100,
	homeGridCols: 3
} as const;

// ---- Translation -----------------------------------------------------------------------
// All per-part targets default OFF (k3y: matches today's installed-app behavior — content is
// never auto-translated unless the user opts in). bioLang defaults 'auto' (bio is the one
// "wants the app language" surface, established in fnp).
export const TRANSLATION_DEFAULTS = {
	lyricsLang: 'off' as LyricsLang,
	artistLang: 'off' as LyricsLang,
	titleLang: 'off' as LyricsLang,
	lastfmLang: 'off' as LyricsLang,
	bioLang: 'auto' as 'auto' | LyricsLang,
	artistSkip: [] as readonly SourceLang[],
	titleSkip: [] as readonly SourceLang[],
	lyricsSkip: [] as readonly SourceLang[],
	lastfmSkip: [] as readonly SourceLang[],
	translateMode: 'below' as TranslateMode
} as const;

// ---- Playback --------------------------------------------------------------------------
export const PLAYBACK_DEFAULTS = {
	defaultQuality: '128' as DefaultQuality, // D-03 — 128–160k band for fast resolve
	downloadQuality: 'lossless' as DefaultQuality, // favours quality over speed
	defaultSource: 'auto' as DefaultSource,
	autoExpandOnPlay: false,
	/** Per-source enable map. Empty = each adapter's own enabledByDefault wins. */
	enabledSources: {} as Partial<Record<SourceId, boolean>>
} as const;

// ---- Home layout -----------------------------------------------------------------------
// homeSectionOrder/homeTags/homeCountries pull from the canonical pools in home-layout.ts
// so this file stays a single source of truth (no risk of drift).
export const HOME_DEFAULTS = {
	homeSectionOrder: [...DEFAULT_SECTION_ORDER] as HomeSectionId[],
	homeHidden: [] as string[],
	homeTags: [...DEFAULT_HOME_TAGS] as string[],
	homeCountries: [...DEFAULT_HOME_COUNTRIES] as string[],
	homeShelfSize: SHELF_DEFAULT,
	homeLandingTab: 'home' as HomeLandingTab,
	homeDensity: 'comfortable' as HomeDensity,
	homeShowSearchPill: true,
	homeShowRandomize: true
} as const;

/** All groups in one place — used to drive the reset-group helpers. */
export const DEFAULTS = {
	general: GENERAL_DEFAULTS,
	appearance: APPEARANCE_DEFAULTS,
	translation: TRANSLATION_DEFAULTS,
	playback: PLAYBACK_DEFAULTS,
	home: HOME_DEFAULTS
} as const;

export type DefaultsGroup = keyof typeof DEFAULTS;
