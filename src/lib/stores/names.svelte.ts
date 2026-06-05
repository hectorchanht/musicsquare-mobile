// Reactive display-name translation. `dn(text)` returns the translated title/artist
// if cached, else the ORIGINAL immediately and lazily batches a translation request;
// when results arrive it bumps `rev` so any template that read `dn(...)` re-renders.
// Standalone (only depends on settings + translate); SSR returns the input unchanged.
import { browser } from '$app/environment';
import { settings } from '$lib/stores/settings.svelte';
import { translateLines } from '$lib/services/translate';

class Names {
	rev = $state(0); // bump → callers re-evaluate dn()
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

	dn(text: string): string {
		const lang = settings.nameLang;
		void this.rev; // reactive dependency
		if (!text || lang === 'off' || !browser) return text;
		const m = this.langCache(lang);
		const hit = m.get(text);
		if (hit !== undefined) return hit;
		let set = this.pending.get(lang);
		if (!set) {
			set = new Set();
			this.pending.set(lang, set);
		}
		if (!set.has(text)) {
			set.add(text);
			this.schedule(lang);
		}
		return text;
	}
}

export const names = new Names();
