// App settings (Svelte 5 runes singleton). Standalone — imports nothing from
// player/library to avoid circular deps. Persisted to localStorage, SSR-guarded.
import { browser } from '$app/environment';
import type { SourceId } from '$lib/sources/types';
import { detectAppLang, type AppLang } from '$lib/i18n';
import {
	DEFAULT_SECTION_ORDER,
	clampShelfSize,
	SHELF_DEFAULT,
	DEFAULT_HOME_TAGS,
	DEFAULT_HOME_COUNTRIES,
	type HomeDensity,
	type HomeLandingTab
} from '$lib/services/home-layout';

export type LyricsLang =
	| 'off'
	| 'zh-Hant'
	| 'zh-Hans'
	| 'en'
	| 'ja'
	| 'ko'
	| 'es'
	| 'fr'
	| 'de'
	| 'pt'
	| 'ru'
	| 'ar'
	| 'hi'
	| 'id'
	| 'it'
	| 'vi'
	| 'th'
	| 'tr';
export type TranslateMode = 'replace' | 'below';
export type DefaultQuality = 'auto' | 'lossless' | '320' | '128';
export type DefaultSource = 'auto' | SourceId;

const KEY = 'openmusic:settings:v1';
const DEFAULT_ACCENT = '#7c5cff';

/** Source-language tags usable in a per-part skip whitelist (LyricsLang minus 'off'). */
export type SourceLang =
	| 'zh-Hant'
	| 'zh-Hans'
	| 'en'
	| 'ja'
	| 'ko'
	| 'es'
	| 'fr'
	| 'de'
	| 'pt'
	| 'it'
	| 'ru'
	| 'tr'
	| 'ar'
	| 'hi'
	| 'id'
	| 'vi'
	| 'th';

class Settings {
	/** UI-chrome language (separate from content translation; stays en/zh-Hant/zh-Hans). */
	appLang = $state<AppLang>('en');
	/** Per-part CONTENT translation targets (independent; reuse LyricsLang incl. ja/ko). */
	lyricsLang = $state<LyricsLang>('off');
	/** Translate displayed ARTIST names to this language. */
	artistLang = $state<LyricsLang>('off');
	/** Translate displayed SONG/ALBUM titles to this language. */
	titleLang = $state<LyricsLang>('off');
	/** Translate Last.fm info (tags) to this language. */
	lastfmLang = $state<LyricsLang>('off');
	/** Per-part skip whitelists: a text whose detected source ∈ list renders untouched. */
	artistSkip = $state<SourceLang[]>([]);
	titleSkip = $state<SourceLang[]>([]);
	lyricsSkip = $state<SourceLang[]>([]);
	lastfmSkip = $state<SourceLang[]>([]);
	translateMode = $state<TranslateMode>('below');
	// D-03: default to the 128–160k band so audio URLs resolve/stream faster. The
	// source ladders (QQ/JOOX/Kuwo) read this via pickByQualityPref; higher tiers
	// remain user-selectable.
	defaultQuality = $state<DefaultQuality>('128');
	/** Quality used when DOWNLOADING (re-resolved at this tier); favours quality over speed. */
	downloadQuality = $state<DefaultQuality>('lossless');
	defaultSource = $state<DefaultSource>('auto');
	accent = $state(DEFAULT_ACCENT);
	reduceMotion = $state(false);
	autoExpandOnPlay = $state(false);

	// --- home layout (quick-260606-w87) ---------------------------------------------
	// Every default here reproduces TODAY's home exactly, so a returning user with a v1
	// blob that has none of these fields loads with no visible change (non-destructive).
	/** Render order of the four discovery section groups (resolved via resolveSectionOrder). */
	homeSectionOrder = $state<string[]>([...DEFAULT_SECTION_ORDER]);
	/** Section ids the user has hidden (intersected with the known set at render). */
	homeHidden = $state<string[]>([]);
	/** Selected GENRE-tag subset (ordered — drives genre shelf order); default = curated set. */
	homeTags = $state<string[]>([...DEFAULT_HOME_TAGS]);
	/** Selected COUNTRY subset (ordered — drives country shelf order); default = curated set. */
	homeCountries = $state<string[]>([...DEFAULT_HOME_COUNTRIES]);
	/** Tiles per shelf (clamped to [6,24]; default 18 = today). */
	homeShelfSize = $state<number>(SHELF_DEFAULT);
	/** Which tab the app opens on at `/`. */
	homeLandingTab = $state<HomeLandingTab>('home');
	/** Home tile density. */
	homeDensity = $state<HomeDensity>('comfortable');
	/** Show the search pill on home (default TRUE = today). */
	homeShowSearchPill = $state<boolean>(true);
	/** Show the Randomize button on home (default TRUE = today). */
	homeShowRandomize = $state<boolean>(true);

	private loaded = false;

	/** Preferred source for dedupe tie-break (undefined = no preference). */
	get preferredSource(): SourceId | undefined {
		return this.defaultSource === 'auto' ? undefined : this.defaultSource;
	}

	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<Settings>;
				// First-visit-only auto-detect: if no appLang was ever saved, infer it from
				// the browser; otherwise the saved choice always wins. (browser-guarded above.)
				this.appLang = (v.appLang as AppLang) ?? detectAppLang(navigator.language);
				this.lyricsLang = (v.lyricsLang as LyricsLang) ?? 'off';
				// Non-destructive migration: a saved `nameLang` mirrors into BOTH new
				// per-part targets. New `artistLang`/`titleLang` win when present.
				const savedNameLang = (v as { nameLang?: LyricsLang }).nameLang;
				this.artistLang = (v.artistLang as LyricsLang) ?? savedNameLang ?? 'off';
				this.titleLang = (v.titleLang as LyricsLang) ?? savedNameLang ?? 'off';
				this.lastfmLang = (v.lastfmLang as LyricsLang) ?? 'off';
				this.artistSkip = Array.isArray(v.artistSkip) ? (v.artistSkip as SourceLang[]) : [];
				this.titleSkip = Array.isArray(v.titleSkip) ? (v.titleSkip as SourceLang[]) : [];
				this.lyricsSkip = Array.isArray(v.lyricsSkip) ? (v.lyricsSkip as SourceLang[]) : [];
				this.lastfmSkip = Array.isArray(v.lastfmSkip) ? (v.lastfmSkip as SourceLang[]) : [];
				this.translateMode = (v.translateMode as TranslateMode) ?? 'below';
				this.defaultQuality = (v.defaultQuality as DefaultQuality) ?? '128';
				this.downloadQuality = (v.downloadQuality as DefaultQuality) ?? 'lossless';
				this.defaultSource = (v.defaultSource as DefaultSource) ?? 'auto';
				this.accent = (v.accent as string) ?? DEFAULT_ACCENT;
				this.reduceMotion = !!v.reduceMotion;
				this.autoExpandOnPlay = !!v.autoExpandOnPlay;
				// --- home layout (w87) — every default reproduces today's home -----------
				// Arrays use an Array.isArray guard → fall back to the today-equivalent
				// default (full order / nothing hidden / full tag+country pool). The pure
				// resolvers (resolveSectionOrder/resolveSubset) do the corrupt-VALUE
				// cleanup at render time; here we only guard the TYPE.
				this.homeSectionOrder = Array.isArray(v.homeSectionOrder)
					? (v.homeSectionOrder as string[])
					: [...DEFAULT_SECTION_ORDER];
				this.homeHidden = Array.isArray(v.homeHidden) ? (v.homeHidden as string[]) : [];
				this.homeTags = Array.isArray(v.homeTags) ? (v.homeTags as string[]) : [...DEFAULT_HOME_TAGS];
				this.homeCountries = Array.isArray(v.homeCountries)
					? (v.homeCountries as string[])
					: [...DEFAULT_HOME_COUNTRIES];
				// Shelf size is clamped to [6,24] on load (T-w87-01): a poisoned 999/"x"/
				// negative becomes a safe value, never breaking the fan-out / page size.
				this.homeShelfSize = clampShelfSize(v.homeShelfSize);
				this.homeLandingTab = (v.homeLandingTab as HomeLandingTab) ?? 'home';
				this.homeDensity = (v.homeDensity as HomeDensity) ?? 'comfortable';
				// Booleans default TRUE via nullish-coalescing — NOT `!!v.x`, which would flip
				// an ABSENT field to false and HIDE the chrome for a returning user (regression).
				this.homeShowSearchPill = v.homeShowSearchPill ?? true;
				this.homeShowRandomize = v.homeShowRandomize ?? true;
			} else {
				// Truly first visit (nothing saved yet): auto-detect UI language once.
				this.appLang = detectAppLang(navigator.language);
			}
		} catch {
			/* corrupt — keep defaults */
		}
		this.applyTheme();
	}

	save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					appLang: this.appLang,
					lyricsLang: this.lyricsLang,
					// `nameLang` is now a read-only migration source (load() still reads it),
					// so we stop writing it; the per-part fields below supersede it.
					artistLang: this.artistLang,
					titleLang: this.titleLang,
					lastfmLang: this.lastfmLang,
					artistSkip: this.artistSkip,
					titleSkip: this.titleSkip,
					lyricsSkip: this.lyricsSkip,
					lastfmSkip: this.lastfmSkip,
					translateMode: this.translateMode,
					defaultQuality: this.defaultQuality,
					downloadQuality: this.downloadQuality,
					defaultSource: this.defaultSource,
					accent: this.accent,
					reduceMotion: this.reduceMotion,
					autoExpandOnPlay: this.autoExpandOnPlay,
					// --- home layout (w87) ---
					homeSectionOrder: this.homeSectionOrder,
					homeHidden: this.homeHidden,
					homeTags: this.homeTags,
					homeCountries: this.homeCountries,
					homeShelfSize: this.homeShelfSize,
					homeLandingTab: this.homeLandingTab,
					homeDensity: this.homeDensity,
					homeShowSearchPill: this.homeShowSearchPill,
					homeShowRandomize: this.homeShowRandomize
				})
			);
		} catch {
			/* quota */
		}
		this.applyTheme();
	}

	/** Apply live-affecting settings to <html>. */
	applyTheme() {
		if (!browser) return;
		const r = document.documentElement;
		r.style.setProperty('--color-primary', this.accent);
		if (this.reduceMotion) r.dataset.reduceMotion = '1';
		else delete r.dataset.reduceMotion;
	}
}

export const settings = new Settings();

export const ACCENT_PRESETS = ['#7c5cff', '#1db954', '#ff0033', '#00c2b8', '#ff8a00', '#ff4d6d'];
