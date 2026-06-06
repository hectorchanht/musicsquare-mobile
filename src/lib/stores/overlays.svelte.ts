// Centralized History-API "back-to-close" overlay stack (Svelte 5 runes singleton,
// same shape as player.svelte.ts). NET-NEW: no popstate/history wiring existed before.
//
// INVARIANT: history depth == overlay stack depth.
//   - open(id, close)   pushes ONE entry AND ONE history state.
//   - dismiss(id)        UI close (scrim / X / drag / cover-collapse): removes the
//                        entry AND calls history.back() ONCE to pop the matching
//                        history state. A `popping` flag swallows the resulting
//                        popstate so we don't double-close.
//   - back gesture       fires popstate with our state non-empty → closeTop() pops the
//                        top entry and runs its close() handler.
// Because both UI-close and the back gesture pop exactly one history state and one
// stack entry, the two depths never desync — this is what keeps Back from getting
// stuck or double-closing.
//
// Single dismiss path (host components): UI close handlers only flip their own state
// (e.g. `menuOpen = false`); a host-side `$effect` cleanup is the ONLY caller of
// overlays.dismiss(id). That way scrim / X / drag / cover-collapse / back-gesture all
// converge on one dismiss site and history depth stays balanced.

interface OverlayEntry {
	id: string;
	close: () => void;
	/** Did we push a history state for this entry? (false if opened during SSR / no history) */
	pushed: boolean;
}

const HAS_WINDOW = typeof window !== 'undefined';

class Overlays {
	/** Stack of open overlays, top = last. $state so a depth readout could react if needed. */
	private stack = $state<OverlayEntry[]>([]);
	/** True while WE triggered history.back() in dismiss() — swallows the echo popstate. */
	private popping = false;
	private listening = false;

	/** Current open-overlay depth (reactive). */
	get depth(): number {
		return this.stack.length;
	}

	/** Is `id` currently the top of the stack? */
	private isTop(id: string): boolean {
		return this.stack.length > 0 && this.stack[this.stack.length - 1].id === id;
	}

	private has(id: string): boolean {
		return this.stack.some((e) => e.id === id);
	}

	/**
	 * Register an open overlay. Idempotent: if `id` is already the top, do nothing
	 * (rapid re-open won't push duplicate history states). Pushes one history state
	 * so the OS/browser Back gesture has something to pop.
	 */
	open(id: string, close: () => void) {
		if (this.isTop(id)) return;
		// If it exists deeper in the stack (shouldn't normally happen), drop the stale one.
		if (this.has(id)) this.stack = this.stack.filter((e) => e.id !== id);
		let pushed = false;
		if (HAS_WINDOW) {
			history.pushState({ gsdOverlay: id }, '');
			pushed = true;
		}
		this.stack = [...this.stack, { id, close, pushed }];
	}

	/** Pop the top entry and run its close handler. Invoked by the popstate listener. */
	closeTop() {
		if (this.stack.length === 0) return;
		const top = this.stack[this.stack.length - 1];
		this.stack = this.stack.slice(0, -1);
		top.close();
	}

	/**
	 * Programmatic close from the UI (scrim / X / drag-close / cover-collapse). Removes
	 * the entry and, if it pushed a history state, calls history.back() ONCE to keep
	 * history depth balanced. The `popping` flag swallows the echo popstate so close()
	 * is not invoked twice. No-op if `id` isn't in the stack (guards rapid/stale calls).
	 */
	dismiss(id: string) {
		if (!this.has(id)) return;
		const entry = this.stack.find((e) => e.id === id)!;
		this.stack = this.stack.filter((e) => e.id !== id);
		if (entry.pushed && HAS_WINDOW) {
			this.popping = true;
			history.back();
			// Safety net: clear the flag even if popstate never fires (some browsers
			// no-op history.back() at the very first entry of a fresh session).
			setTimeout(() => (this.popping = false), 0);
		}
	}

	/**
	 * Install the single popstate listener. Call ONCE from the app layout onMount and
	 * run the returned teardown in its cleanup. SSR-safe.
	 */
	init(): () => void {
		if (!HAS_WINDOW || this.listening) return () => {};
		this.listening = true;
		const onpop = () => {
			if (this.popping) {
				// This popstate is the echo of our own dismiss() history.back() — ignore.
				this.popping = false;
				return;
			}
			if (this.stack.length > 0) {
				// Genuine OS/browser Back with an overlay open → close the topmost.
				this.closeTop();
			}
		};
		window.addEventListener('popstate', onpop);
		return () => {
			window.removeEventListener('popstate', onpop);
			this.listening = false;
		};
	}
}

export const overlays = new Overlays();
