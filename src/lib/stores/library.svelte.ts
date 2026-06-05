// Local-only library (Svelte 5 runes singleton) — liked songs, playlists, and a
// "downloads" reference list. Persisted to localStorage `openmusic:library:v1`,
// SSR-guarded. This is a demo-scoped slice of the planned Phase-3 Library.
import { browser } from '$app/environment';
import type { Track } from '$lib/sources/types';

const KEY = 'openmusic:library:v1';

export interface Playlist {
	id: string;
	name: string;
	tracks: Track[];
}

interface LibShape {
	liked: Track[];
	playlists: Playlist[];
	downloads: Track[];
}

class Library {
	liked = $state<Track[]>([]);
	playlists = $state<Playlist[]>([]);
	downloads = $state<Track[]>([]);
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from a layout onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<LibShape>;
				this.liked = v.liked ?? [];
				this.playlists = v.playlists ?? [];
				this.downloads = v.downloads ?? [];
			}
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ liked: this.liked, playlists: this.playlists, downloads: this.downloads })
			);
		} catch {
			/* quota — non-fatal */
		}
	}

	isLiked(uid: string): boolean {
		return this.liked.some((t) => t.uid === uid);
	}
	toggleLike(t: Track) {
		this.liked = this.isLiked(t.uid) ? this.liked.filter((x) => x.uid !== t.uid) : [t, ...this.liked];
		this.save();
	}

	createPlaylist(name: string): Playlist {
		const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
		const pl: Playlist = { id, name: name.trim() || 'Untitled', tracks: [] };
		this.playlists = [...this.playlists, pl];
		this.save();
		return pl;
	}
	addToPlaylist(id: string, t: Track) {
		this.playlists = this.playlists.map((p) =>
			p.id === id && !p.tracks.some((x) => x.uid === t.uid) ? { ...p, tracks: [...p.tracks, t] } : p
		);
		this.save();
	}
	removeFromPlaylist(id: string, uid: string) {
		this.playlists = this.playlists.map((p) =>
			p.id === id ? { ...p, tracks: p.tracks.filter((x) => x.uid !== uid) } : p
		);
		this.save();
	}
	deletePlaylist(id: string) {
		this.playlists = this.playlists.filter((p) => p.id !== id);
		this.save();
	}

	isDownloaded(uid: string): boolean {
		return this.downloads.some((t) => t.uid === uid);
	}
	addDownload(t: Track) {
		if (!this.isDownloaded(t.uid)) {
			this.downloads = [t, ...this.downloads];
			this.save();
		}
	}
	removeDownload(uid: string) {
		this.downloads = this.downloads.filter((t) => t.uid !== uid);
		this.save();
	}

	clearAll() {
		this.liked = [];
		this.playlists = [];
		this.downloads = [];
		this.save();
	}
}

export const library = new Library();
