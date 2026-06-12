// Global toast store (Svelte 5 runes singleton). One transient message at a time — no
// stacking/queue. Consolidates the three local `toast()` copies (TrackMenu et al.) into a
// single source of truth so the feedback layer never drifts (D-15). In-memory only (no
// localStorage), SSR-guarded so the browser-only timer never runs on the server.
import { browser } from '$app/environment';

class Toast {
	/** Currently-visible message ('' = nothing showing). Reactive via $state. */
	msg = $state('');
	private timer: ReturnType<typeof setTimeout> | null = null;

	/** Show `msg` as a transient toast. A second call before the 2000ms timeout REPLACES the
	 *  message and RESETS the timer (no stacking — one message at a time). After 2000ms with no
	 *  further calls the message clears to ''. The 2000ms duration is locked (matches every
	 *  existing local copy). SSR-safe: the timer is only armed in the browser. */
	show(msg: string): void {
		this.msg = msg;
		if (this.timer) clearTimeout(this.timer);
		if (browser) {
			this.timer = setTimeout(() => {
				this.msg = '';
				this.timer = null;
			}, 2000);
		}
	}
}

export const toast = new Toast();
