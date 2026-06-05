// App-scoped playback store (Svelte 5 runes singleton). Basic playback for the
// home-shell demo — the full audio engine (MediaSession, queue, etc.) is Phase 6.
// Audio is browser-direct (a single <audio> whose .src is the resolved CDN URL);
// metadata was already proxied via the data layer. referrerpolicy=no-referrer
// reproduces the legacy <meta no-referrer> so referer-gated CDNs don't 403.
import { ensureTrackDetails } from '$lib/services/catalog';
import type { Track } from '$lib/sources/types';

class Player {
	current = $state<Track | null>(null);
	playing = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);
	private audio: HTMLAudioElement | null = null;

	/** Bind the single long-lived <audio> element (called once from the layout). */
	attach(el: HTMLAudioElement) {
		this.audio = el;
		el.setAttribute('referrerpolicy', 'no-referrer');
		el.addEventListener('play', () => (this.playing = true));
		el.addEventListener('pause', () => (this.playing = false));
		el.addEventListener('ended', () => (this.playing = false));
		el.addEventListener('error', () => {
			this.error = 'playback failed (source may be region-locked or expired)';
			this.playing = false;
		});
	}

	async play(track: Track) {
		this.error = null;
		this.loading = true;
		this.current = track;
		try {
			const resolved = await ensureTrackDetails(track);
			this.current = resolved;
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
}

export const player = new Player();
