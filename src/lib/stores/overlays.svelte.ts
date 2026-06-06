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
	/** True during an outbound navigateAway() — suppresses dismiss()'s history.back() so the
	 *  hosts unmounting under the new route can't pop the just-navigated destination off. */
	private navigating = false;
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
			// Raw history.pushState (NOT SvelteKit's shallow-routing pushState from
			// $app/navigation). This is deliberate: a shallow-routing entry makes goto() a
			// NO-OP while it's the current entry (SvelteKit refuses to navigate out of a
			// shallow state), and history.go() desyncs SvelteKit's router index — both of which
			// break the track menu's "Go to artist"/"Go to album" navigation. A raw entry is a
			// plain Back target that goto() can cleanly replace. SvelteKit warns about raw
			// pushState, but our usage is narrow (a dummy Back sentinel, popped via history.back
			// on dismiss or replaced via goto on an outbound nav) and works correctly.
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
		// During an outbound navigateAway() we do NOT history.back(): the destination route has
		// just been pushed and the hosts are unmounting under it; a back() here would pop that
		// destination right back off (the "Go to artist snaps home" over-pop). The leftover raw
		// Back entry is harmless — backing into it lands on the origin URL with an empty stack.
		if (entry.pushed && HAS_WINDOW && !this.navigating) {
			this.popping = true;
			history.back();
			// Safety net: clear the flag even if popstate never fires (some browsers
			// no-op history.back() at the very first entry of a fresh session).
			setTimeout(() => (this.popping = false), 0);
		}
	}

	/**
	 * Perform an outbound goto() from INSIDE an overlay (the track menu's "Go to artist" /
	 * "Go to album"). Pass a thunk that runs the SvelteKit goto(); returns its promise.
	 *
	 * The ordering here is load-bearing — it's the result of empirically tracing every failure
	 * mode:
	 *  - goto() runs FIRST, while the overlays are still OPEN. SvelteKit only navigates out of
	 *    an overlay's raw Back entry while that entry is the live current one; closing the
	 *    overlay first makes goto() resolve as a silent NO-OP (URL never changes).
	 *  - `navigating` is set for the whole call so the history.back() each overlay's
	 *    $effect-cleanup dismiss() would fire — as the destination route unmounts the hosts —
	 *    is SUPPRESSED. Without this, that back() pops the just-pushed destination straight back
	 *    off ("Go to artist" flashes the artist page then snaps to the origin).
	 *  - AFTER navigation settles, any overlay still mounted (the now-playing sheet lives in the
	 *    root layout and survives the route change) is closed and its UI reset — still with
	 *    back() suppressed — then the flag clears.
	 *
	 * Leftover raw Back entries are harmless: backing into one lands on the origin URL with an
	 * empty stack, so the popstate listener simply no-ops.
	 */
	async navigateAway(navigate: () => Promise<void>): Promise<void> {
		this.navigating = true;
		try {
			await navigate();
		} finally {
			const entries = this.stack;
			this.stack = [];
			for (let i = entries.length - 1; i >= 0; i--) entries[i].close();
			this.navigating = false;
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
