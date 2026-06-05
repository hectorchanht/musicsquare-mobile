// App-scoped playback store (Svelte 5 runes singleton). Basic playback for the
// demo — the full audio engine (MediaSession, real queue model) is Phase 2/6/7.
// Audio is browser-direct (a single <audio> whose .src is the resolved CDN URL);
// metadata was already proxied via the data layer. referrerpolicy=no-referrer
// reproduces the legacy <meta no-referrer> so referer-gated CDNs don't 403.
import { ensureTrackDetails } from '$lib/services/catalog';
import { buildDiversePicks } from '$lib/services/picks';
import { dedupeBest } from '$lib/services/dedupe';
import type { Track } from '$lib/sources/types';

/** mm:ss, NaN/Infinity-safe (avoids the "NaN:NaN" bug before metadata loads). */
export function fmtTime(s: number): string {
	if (!Number.isFinite(s) || s < 0) return '0:00';
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	return `${m}:${sec.toString().padStart(2, '0')}`;
}

class Player {
	current = $state<Track | null>(null);
	playing = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);

	/** Full-screen now-playing overlay open? */
	expanded = $state(false);
	/** Lightweight "Up-Next" — the result set the current track came from (Phase 7 = real queue). */
	queue = $state<Track[]>([]);

	currentTime = $state(0);
	/** 0 until loadedmetadata; never NaN. */
	duration = $state(0);

	private audio: HTMLAudioElement | null = null;
	private growing = false;

	/** Bind the single long-lived <audio> element (called once from the layout). */
	attach(el: HTMLAudioElement) {
		this.audio = el;
		el.setAttribute('referrerpolicy', 'no-referrer');
		el.addEventListener('play', () => (this.playing = true));
		el.addEventListener('pause', () => (this.playing = false));
		el.addEventListener('timeupdate', () => (this.currentTime = el.currentTime || 0));
		const syncDur = () => (this.duration = Number.isFinite(el.duration) ? el.duration : 0);
		el.addEventListener('loadedmetadata', syncDur);
		el.addEventListener('durationchange', syncDur);
		el.addEventListener('ended', () => {
			this.playing = false;
			this.next();
		});
		el.addEventListener('error', () => {
			this.error = 'playback failed (source may be region-locked or expired)';
			this.playing = false;
		});
	}

	/** Set the active list (home grid / search results) as the Up-Next source. */
	setQueue(tracks: Track[]) {
		this.queue = dedupeBest(tracks);
	}

	/**
	 * Append more diverse picks when the queue is within 2 of the end, so playback
	 * never runs short. Guarded against re-entry (growing flag) and dry sources.
	 */
	private async ensureAhead() {
		if (this.growing) return;
		const i = this.indexOf(this.current);
		if (i < 0 || this.queue.length - i > 2) return;
		this.growing = true;
		try {
			const have = new Set(this.queue.map((t) => t.uid));
			const more = await buildDiversePicks(8, have);
			if (more.length) this.queue = dedupeBest([...this.queue, ...more]);
		} catch {
			/* sources dry — leave the queue as-is */
		} finally {
			this.growing = false;
		}
	}

	private indexOf(track: Track | null): number {
		if (!track) return -1;
		return this.queue.findIndex((t) => t.uid === track.uid);
	}

	async play(track: Track) {
		this.error = null;
		this.loading = true;
		this.current = track;
		this.currentTime = 0;
		this.duration = 0;
		try {
			const resolved = await ensureTrackDetails(track);
			this.current = resolved;
			// keep the queue entry in sync with the resolved track
			const i = this.indexOf(track);
			if (i >= 0) this.queue[i] = resolved;
			void this.ensureAhead();
			if (!resolved.audioUrl) {
				this.error = 'no playable audio for this track';
				return;
			}
			if (this.audio) {
				this.audio.src = resolved.audioUrl;
				await this.audio.play().catch(() => {
					/* autoplay may require a gesture — the controls still work */
				});
			}
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	toggle() {
		if (!this.audio) return;
		if (this.audio.paused) this.audio.play().catch(() => {});
		else this.audio.pause();
	}

	next() {
		const i = this.indexOf(this.current);
		if (i >= 0 && i + 1 < this.queue.length) {
			this.play(this.queue[i + 1]);
		} else {
			// at/near the end — grow the queue, then advance to the freshly-added track
			void this.ensureAhead().then(() => {
				const j = this.indexOf(this.current);
				if (j >= 0 && j + 1 < this.queue.length) this.play(this.queue[j + 1]);
			});
		}
	}

	prev() {
		// restart if >3s in, else previous track
		if (this.audio && this.audio.currentTime > 3) {
			this.audio.currentTime = 0;
			return;
		}
		const i = this.indexOf(this.current);
		if (i > 0) this.play(this.queue[i - 1]);
		else if (this.audio) this.audio.currentTime = 0;
	}

	/** Seek to a fraction [0,1] of the track. */
	seekFraction(frac: number) {
		if (!this.audio || !Number.isFinite(this.audio.duration)) return;
		this.audio.currentTime = Math.max(0, Math.min(1, frac)) * this.audio.duration;
	}

	expand() {
		if (this.current) this.expanded = true;
	}
	collapse() {
		this.expanded = false;
	}
}

export const player = new Player();
