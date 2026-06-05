// App settings (Svelte 5 runes singleton). Standalone — imports nothing from
// player/library to avoid circular deps. Persisted to localStorage, SSR-guarded.
import { browser } from '$app/environment';
import type { SourceId } from '$lib/sources/types';
import { detectAppLang, type AppLang } from '$lib/i18n';

export type LyricsLang = 'off' | 'zh-Hant' | 'zh-Hans' | 'en' | 'ja' | 'ko';
export type TranslateMode = 'replace' | 'below';
export type DefaultQuality = 'auto' | 'lossless' | '320' | '128';
export type DefaultSource = 'auto' | SourceId;

const KEY = 'openmusic:settings:v1';
const DEFAULT_ACCENT = '#7c5cff';

class Settings {
	/** UI-chrome language (separate from lyricsLang/nameLang content translation). */
	appLang = $state<AppLang>('en');
	lyricsLang = $state<LyricsLang>('off');
	/** Translate displayed song titles + artist names to this language (separate from lyrics). */
	nameLang = $state<LyricsLang>('off');
	translateMode = $state<TranslateMode>('below');
	defaultQuality = $state<DefaultQuality>('auto');
	defaultSource = $state<DefaultSource>('auto');
	accent = $state(DEFAULT_ACCENT);
	reduceMotion = $state(false);
	autoExpandOnPlay = $state(false);
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
				this.nameLang = (v.nameLang as LyricsLang) ?? 'off';
				this.translateMode = (v.translateMode as TranslateMode) ?? 'below';
				this.defaultQuality = (v.defaultQuality as DefaultQuality) ?? 'auto';
				this.defaultSource = (v.defaultSource as DefaultSource) ?? 'auto';
				this.accent = (v.accent as string) ?? DEFAULT_ACCENT;
				this.reduceMotion = !!v.reduceMotion;
				this.autoExpandOnPlay = !!v.autoExpandOnPlay;
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
					nameLang: this.nameLang,
					translateMode: this.translateMode,
					defaultQuality: this.defaultQuality,
					defaultSource: this.defaultSource,
					accent: this.accent,
					reduceMotion: this.reduceMotion,
					autoExpandOnPlay: this.autoExpandOnPlay
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
