// Recently-played history (Svelte 5 runes singleton). WRAPS the pure node-testable
// logic module (src/lib/history/history-logic.ts) — same separation as t() over the
// pure i18n helpers. Standalone: imports NOTHING from player/library so the edge is
// one-way (player imports history, never the reverse → no circular dep). Persisted
// to localStorage `openmusic:history:v1`, SSR-guarded.
import { browser } from '$app/environment';
import type { Track } from '$lib/sources/types';
import {
	HISTORY_KEY,
	parseHistory,
	recordEntry,
	toEntry,
	type HistoryEntry
} from '$lib/history/history-logic';

class History {
	/** Most-recent-first, capped, uid-deduped. */
	entries = $state<HistoryEntry[]>([]);
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from each sub-route onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.entries = parseHistory(localStorage.getItem(HISTORY_KEY));
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	/** Record a played track: prepend (dedupe-by-uid → replay moves to top), cap, persist. */
	record(track: Track) {
		this.entries = recordEntry(this.entries, toEntry(track));
		this.save();
	}

	/** Wipe history. */
	clear() {
		this.entries = [];
		this.save();
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(this.entries));
		} catch {
			/* quota — non-fatal */
		}
	}
}

export const history = new History();
