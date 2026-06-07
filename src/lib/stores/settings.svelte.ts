// App settings (Svelte 5 runes singleton). Standalone — imports nothing from
// player/library to avoid circular deps. Persisted to localStorage, SSR-guarded.
import { browser } from '$app/environment';
import type { SourceId } from '$lib/sources/types';
import { detectAppLang, type AppLang } from '$lib/i18n';
import { DEFAULTS } from '$lib/config/defaults';
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
	// ju0: 'auto' means "follow settings.appLang at translation time" — resolved by
	// names.dn*/lyrics-translate effect via effectiveTarget(). Pre-existing bioLang has
	// always been ('auto' | LyricsLang); ju0 widens this union so all 4 per-part pickers
	// share the same shape (artistLang/titleLang/lyricsLang/lastfmLang).
	| 'auto'
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
/** UI theme. Light theme overrides surface/text/border tokens via `[data-theme='light']`
 *  in app.css; dark is the default (no data-theme attribute). */
export type Theme = 'dark' | 'light';

const KEY = 'openmusic:settings:v1';
const DEFAULT_ACCENT = '#7c5cff';

/** Appearance-scale bounds (percent), shared by the store + the appearance settings UI. */
export const FONT_SCALE_MIN = 70;
export const FONT_SCALE_MAX = 160;
export const COVER_SCALE_MIN = 70;
export const COVER_SCALE_MAX = 150;
export const GRID_COLS_MIN = 2;
export const GRID_COLS_MAX = 5;

/** Coerce a persisted number into a safe integer in [min,max]; non-numbers → def. */
function clampInt(n: unknown, min: number, max: number, def: number): number {
	if (typeof n !== 'number' || !Number.isFinite(n)) return def;
	const f = Math.round(n);
	return f < min ? min : f > max ? max : f;
}

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
	/** Per-source enable map (ii6). Empty/absent → each adapter falls back to its
	 *  `enabledByDefault`. Explicit true/false overrides. Lets a user opt INTO 5sing
	 *  (`enabledByDefault: false`) without changing the adapter contract. */
	enabledSources = $state<Partial<Record<SourceId, boolean>>>({});
	/** Bio (Last.fm artist bio) target language. `'auto'` = follow appLang (default); `'off'` =
	 * untranslated; otherwise an explicit language (quick-260607-fnp; supersedes the f4y note). */
	bioLang = $state<'auto' | LyricsLang>('auto');
	translateMode = $state<TranslateMode>('below');

	// --- appearance / per-part sizing (quick-260607-fnp) -----------------------------------
	// Percent scales (100 = today's size). Applied app-wide as CSS custom properties in
	// applyTheme(); `app.css :root` defaults to 1× so SSR / no-JS / returning users see no change.
	/** Song/track TITLE font scale, percent (clamped 70–160). */
	fontScaleTitle = $state<number>(100);
	/** ARTIST/subtitle font scale, percent (clamped 70–160). */
	fontScaleArtist = $state<number>(100);
	/** LYRICS line font scale, percent (clamped 70–160). */
	fontScaleLyrics = $state<number>(100);
	/** Home COVER/tile size scale, percent (clamped 70–150). */
	coverScale = $state<number>(100);
	/** Home fallback-grid COLUMN count (clamped 2–5; default 3 = today). */
	homeGridCols = $state<number>(3);
	// D-03: default to the 128–160k band so audio URLs resolve/stream faster. The
	// source ladders (QQ/JOOX/Kuwo) read this via pickByQualityPref; higher tiers
	// remain user-selectable.
	defaultQuality = $state<DefaultQuality>('128');
	/** Quality used when DOWNLOADING (re-resolved at this tier); favours quality over speed. */
	downloadQuality = $state<DefaultQuality>('lossless');
	defaultSource = $state<DefaultSource>('auto');
	accent = $state(DEFAULT_ACCENT);
	reduceMotion = $state(false);
	/** Light/dark theme. Default 'dark' (today's design). applyTheme() flips
	 *  the `data-theme` attribute on <html>. */
	theme = $state<Theme>('dark');
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
				// Names default to NO translation (quick-260607-f4y): the legacy `nameLang`
				// migration is intentionally dropped so returning users are NOT auto-translated.
				// Only an explicit per-part `artistLang`/`titleLang` opts back in.
				this.artistLang = (v.artistLang as LyricsLang) ?? 'off';
				this.titleLang = (v.titleLang as LyricsLang) ?? 'off';
				this.lastfmLang = (v.lastfmLang as LyricsLang) ?? 'off';
				this.artistSkip = Array.isArray(v.artistSkip) ? (v.artistSkip as SourceLang[]) : [];
				this.titleSkip = Array.isArray(v.titleSkip) ? (v.titleSkip as SourceLang[]) : [];
				this.lyricsSkip = Array.isArray(v.lyricsSkip) ? (v.lyricsSkip as SourceLang[]) : [];
				this.lastfmSkip = Array.isArray(v.lastfmSkip) ? (v.lastfmSkip as SourceLang[]) : [];
				this.enabledSources =
					v.enabledSources && typeof v.enabledSources === 'object' && !Array.isArray(v.enabledSources)
						? (v.enabledSources as Partial<Record<SourceId, boolean>>)
						: {};
				this.bioLang = (v.bioLang as 'auto' | LyricsLang) ?? 'auto';
				// Appearance scales (fnp): clamp to safe bounds; absent → today's 100 / 3 cols.
				this.fontScaleTitle = clampInt(v.fontScaleTitle, FONT_SCALE_MIN, FONT_SCALE_MAX, 100);
				this.fontScaleArtist = clampInt(v.fontScaleArtist, FONT_SCALE_MIN, FONT_SCALE_MAX, 100);
				this.fontScaleLyrics = clampInt(v.fontScaleLyrics, FONT_SCALE_MIN, FONT_SCALE_MAX, 100);
				this.coverScale = clampInt(v.coverScale, COVER_SCALE_MIN, COVER_SCALE_MAX, 100);
				this.homeGridCols = clampInt(v.homeGridCols, GRID_COLS_MIN, GRID_COLS_MAX, 3);
				this.translateMode = (v.translateMode as TranslateMode) ?? 'below';
				this.defaultQuality = (v.defaultQuality as DefaultQuality) ?? '128';
				this.downloadQuality = (v.downloadQuality as DefaultQuality) ?? 'lossless';
				this.defaultSource = (v.defaultSource as DefaultSource) ?? 'auto';
				this.accent = (v.accent as string) ?? DEFAULT_ACCENT;
				this.reduceMotion = !!v.reduceMotion;
				this.theme = v.theme === 'light' ? 'light' : 'dark';
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
					// `nameLang` is fully retired (quick-260607-f4y): no longer written and no
					// longer read on load. The per-part fields below are the only name targets.
					artistLang: this.artistLang,
					titleLang: this.titleLang,
					lastfmLang: this.lastfmLang,
					artistSkip: this.artistSkip,
					titleSkip: this.titleSkip,
					lyricsSkip: this.lyricsSkip,
					lastfmSkip: this.lastfmSkip,
					enabledSources: this.enabledSources,
					bioLang: this.bioLang,
					fontScaleTitle: this.fontScaleTitle,
					fontScaleArtist: this.fontScaleArtist,
					fontScaleLyrics: this.fontScaleLyrics,
					coverScale: this.coverScale,
					homeGridCols: this.homeGridCols,
					translateMode: this.translateMode,
					defaultQuality: this.defaultQuality,
					downloadQuality: this.downloadQuality,
					defaultSource: this.defaultSource,
					accent: this.accent,
					reduceMotion: this.reduceMotion,
					theme: this.theme,
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
		// Appearance scales (fnp) — multipliers off the per-rule base sizes. 100% → 1 (no change).
		r.style.setProperty('--fs-title', String(this.fontScaleTitle / 100));
		r.style.setProperty('--fs-artist', String(this.fontScaleArtist / 100));
		r.style.setProperty('--fs-lyrics', String(this.fontScaleLyrics / 100));
		r.style.setProperty('--cover-scale', String(this.coverScale / 100));
		r.style.setProperty('--home-grid-cols', String(this.homeGridCols));
		if (this.reduceMotion) r.dataset.reduceMotion = '1';
		else delete r.dataset.reduceMotion;
		// Light/dark theme: set `data-theme="light"` for the light token set; remove the attr
		// for the default dark theme so `:root` rules apply without any extra specificity.
		if (this.theme === 'light') r.dataset.theme = 'light';
		else delete r.dataset.theme;
	}

	/** Reset the appearance scales to their defaults (k3y: now reads `DEFAULTS.appearance`
	 *  from config/defaults.ts). Used by the /settings/appearance reset button + Data tab. */
	resetAppearance() {
		const d = DEFAULTS.appearance;
		this.fontScaleTitle = d.fontScaleTitle;
		this.fontScaleArtist = d.fontScaleArtist;
		this.fontScaleLyrics = d.fontScaleLyrics;
		this.coverScale = d.coverScale;
		this.homeGridCols = d.homeGridCols;
		this.save();
	}

	/** Reset the General settings group (app language, accent, reduce-motion, theme). k3y. */
	resetGeneral() {
		const d = DEFAULTS.general;
		this.appLang = d.appLang;
		this.accent = d.accent;
		this.reduceMotion = d.reduceMotion;
		this.theme = d.theme;
		this.save();
	}

	/** Reset the Translation settings (all per-part target langs + skip whitelists + mode). k3y. */
	resetTranslation() {
		const d = DEFAULTS.translation;
		this.lyricsLang = d.lyricsLang;
		this.artistLang = d.artistLang;
		this.titleLang = d.titleLang;
		this.lastfmLang = d.lastfmLang;
		this.bioLang = d.bioLang;
		this.artistSkip = [...d.artistSkip];
		this.titleSkip = [...d.titleSkip];
		this.lyricsSkip = [...d.lyricsSkip];
		this.lastfmSkip = [...d.lastfmSkip];
		this.translateMode = d.translateMode;
		this.save();
	}

	/** Reset the Playback settings (quality + source + auto-expand + per-source toggles). k3y. */
	resetPlayback() {
		const d = DEFAULTS.playback;
		this.defaultQuality = d.defaultQuality;
		this.downloadQuality = d.downloadQuality;
		this.defaultSource = d.defaultSource;
		this.autoExpandOnPlay = d.autoExpandOnPlay;
		this.enabledSources = { ...d.enabledSources };
		this.save();
	}

	/** Reset the Home layout settings (section order/hidden + tag/country selection + size +
	 *  density + landing tab + chrome toggles). k3y. */
	resetHome() {
		const d = DEFAULTS.home;
		this.homeSectionOrder = [...d.homeSectionOrder];
		this.homeHidden = [...d.homeHidden];
		this.homeTags = [...d.homeTags];
		this.homeCountries = [...d.homeCountries];
		this.homeShelfSize = d.homeShelfSize;
		this.homeLandingTab = d.homeLandingTab;
		this.homeDensity = d.homeDensity;
		this.homeShowSearchPill = d.homeShowSearchPill;
		this.homeShowRandomize = d.homeShowRandomize;
		this.save();
	}
}

export const settings = new Settings();

/** Resolve an 'auto' translation target to the current app language (ju0). Off + explicit
 * lang codes pass through. appLang ⊆ LyricsLang so the result is always a usable token for
 * translateLines / shouldTranslate. */
export function effectiveTarget(target: 'auto' | LyricsLang): LyricsLang {
	return target === 'auto' ? (settings.appLang as LyricsLang) : target;
}

export const ACCENT_PRESETS = ['#7c5cff', '#1db954', '#ff0033', '#00c2b8', '#ff8a00', '#ff4d6d'];
