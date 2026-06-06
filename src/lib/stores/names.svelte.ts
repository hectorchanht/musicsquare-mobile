// Reactive display-name translation. `dnArtist(text)` / `dnTitle(text)` / `dnLastfm(tag)`
// return the translated text if cached, else the ORIGINAL immediately and lazily batch a
// translation request; when results arrive they bump `rev` so any template that read a
// resolver re-renders. Each part uses its own target language + skip whitelist (settings),
// but the cache is keyed by TARGET lang (translation output depends only on the target, so
// parts sharing a target share cached results). Standalone (settings + translate + detect);
// SSR returns the input unchanged.
import { browser } from '$app/environment';
import { settings } from '$lib/stores/settings.svelte';
import { translateLines } from '$lib/services/translate';
import { shouldTranslate } from '$lib/i18n/detect';

class Names {
	rev = $state(0); // bump → callers re-evaluate resolvers
	private cache = new Map<string, Map<string, string>>(); // lang → (original → translated)
	private pending = new Map<string, Set<string>>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private hydrated = new Set<string>();

	private langCache(lang: string): Map<string, string> {
		let m = this.cache.get(lang);
		if (!m) {
			m = new Map();
			if (browser && !this.hydrated.has(lang)) {
				this.hydrated.add(lang);
				try {
					const raw = localStorage.getItem(`openmusic:name-tr:${lang}`);
					if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) m.set(k, v);
				} catch {
					/* ignore */
				}
			}
			this.cache.set(lang, m);
		}
		return m;
	}

	private persist(lang: string) {
		if (!browser) return;
		try {
			const m = this.cache.get(lang);
			if (m) localStorage.setItem(`openmusic:name-tr:${lang}`, JSON.stringify(Object.fromEntries(m)));
		} catch {
			/* quota */
		}
	}

	private schedule(lang: string) {
		if (this.timers.has(lang)) return;
		this.timers.set(
			lang,
			setTimeout(() => {
				this.timers.delete(lang);
				const set = this.pending.get(lang);
				if (!set || !set.size) return;
				const items = [...set];
				this.pending.set(lang, new Set());
				translateLines(items, lang)
					.then((out) => {
						const m = this.langCache(lang);
						items.forEach((orig, i) => m.set(orig, out[i] ?? orig));
						this.persist(lang);
						this.rev++;
					})
					.catch(() => {
						/* leave originals */
					});
			}, 160)
		);
	}

	/**
	 * Core resolver: returns the translated text for `target` if available, else the
	 * original immediately and queues a translation. Returns the original (no queue)
	 * when shouldTranslate(text, target, whitelist) is false (off / whitelisted source /
	 * already-in-target). Cache is keyed by target lang only.
	 */
	private resolve(text: string, target: string, whitelist: readonly string[]): string {
		void this.rev; // reactive dependency
		if (!text || target === 'off' || !browser) return text;
		if (!shouldTranslate(text, target, whitelist)) return text;
		const m = this.langCache(target);
		const hit = m.get(text);
		if (hit !== undefined) return hit;
		let set = this.pending.get(target);
		if (!set) {
			set = new Set();
			this.pending.set(target, set);
		}
		if (!set.has(text)) {
			set.add(text);
			this.schedule(target);
		}
		return text;
	}

	/** Artist name → artistLang + artistSkip. */
	dnArtist(text: string): string {
		return this.resolve(text, settings.artistLang, settings.artistSkip);
	}

	/** Song / album title → titleLang + titleSkip. */
	dnTitle(text: string): string {
		return this.resolve(text, settings.titleLang, settings.titleSkip);
	}

	/** Last.fm tag → lastfmLang + lastfmSkip. */
	dnLastfm(text: string): string {
		return this.resolve(text, settings.lastfmLang, settings.lastfmSkip);
	}
}

export const names = new Names();
