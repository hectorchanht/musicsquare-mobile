// App-scoped playback store (Svelte 5 runes singleton). Basic playback for the
// demo — the full audio engine (real queue model) is Phase 2/6/7; the W3C Media
// Session slice was pulled forward here so the OS/browser media UI (Chrome media
// hub, macOS Now Playing, lock screens) shows the current track + working
// transport. Audio is browser-direct (a single <audio> whose .src is the resolved
// CDN URL); metadata was already proxied via the data layer. referrerpolicy=
// no-referrer reproduces the legacy <meta no-referrer> so referer-gated CDNs don't
// 403. All Media Session access goes through the single `ms` accessor, which
// enforces the SSR guard + feature detection (MS-05) — every call early-returns
// when unsupported. The throw-prone artwork/position/state logic lives in the pure,
// node-tested media-session.ts; this store is a thin caller of those helpers.
import { ensureTrackDetails } from '$lib/services/catalog';
import { tryFallback } from '$lib/services/fallback';
import { buildDiversePicks } from '$lib/services/picks';
import { buildSimilarQueue } from '$lib/services/similar';
import { dedupeBest } from '$lib/services/dedupe';
import { buildArtwork, safePositionState, playbackStateFor } from '$lib/services/media-session';
import { resolveStub } from '$lib/services/discovery';
import { settings } from '$lib/stores/settings.svelte';
import { history } from '$lib/stores/history.svelte';
import { names } from '$lib/stores/names.svelte';
import type { Track } from '$lib/sources/types';

/**
 * The minimal display shape the now-bar renders the INSTANT a discovery stub is tapped,
 * before resolveStub finishes (~5-10s). It is NOT a Track (no uid/source/audioUrl) — just
 * enough to lock the tapped song's identity into the now-bar with a loading indicator.
 */
export interface PendingTrack {
	artist: string;
	title: string;
	cover: string | null;
}

/** U+241F SYMBOL FOR UNIT SEPARATOR — a separator that cannot appear in a real title/artist. */
const PENDING_KEY_SEP = '␟';

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

	/**
	 * Optimistic now-bar overlay (FIX-A). Set SYNCHRONOUSLY the instant a discovery stub
	 * is tapped so the now-bar can render the tapped {artist,title,cover} with a loading
	 * indicator before resolveStub settles. Cleared once `current` is set (success) or on a
	 * miss. A NON-null pendingTrack with a null `current` means "resolving — show loading".
	 */
	pendingTrack = $state<PendingTrack | null>(null);
	/** Key (`${artist}␟${title}` lowercased/trimmed) of the in-flight stub resolve — dedupe guard. */
	private pendingKey = '';
	/** Monotonic generation: a newer playStub bumps it so a stale resolve's result is discarded. */
	private pendingGen = 0;

	/** Full-screen now-playing overlay open? */
	expanded = $state(false);
	/** Lightweight "Up-Next" — the result set the current track came from (Phase 7 = real queue). */
	queue = $state<Track[]>([]);

	/** Shuffle on: toggling true randomizes queue tail (current pinned). Off = no auto-shuffle on
	 * next play, but the already-shuffled queue stays as is (gte: user-specified, no unshuffle). */
	shuffle = $state(false);
	/** Tri-state repeat (gte): 'off' = today; 'one' = loop the current track on ended; 'all' = wrap
	 * the queue when next() hits the end. Cycle: off → one → all → off. */
	repeatMode = $state<'off' | 'one' | 'all'>('off');

	/** Monotonic play generation (gte): bumped at the top of every play() so the cross-source
	 * fallback can detect a newer play() and abort its in-flight retries. Plain field — no $state
	 * reactivity (it's an internal supersedence guard, like pendingGen). */
	private playGen = 0;

	currentTime = $state(0);
	/** 0 until loadedmetadata; never NaN. */
	duration = $state(0);

	private audio: HTMLAudioElement | null = null;
	private growing = false;
	/**
	 * uid of the track whose details are currently being pre-resolved by prefetchNext().
	 * A plain field (NOT $state) — it must not trigger reactivity; it is a pure in-flight
	 * dedupe guard so a second prefetchNext() for the same next track is a no-op.
	 */
	private prefetchingUid: string | null = null;
	/** Aborts the in-flight prefetch when a newer one supersedes it (stale-resolve guard). */
	private prefetchController: AbortController | null = null;
	/**
	 * Uids the user pinned as "manual" (Play Next / Add to Queue / reordered). These
	 * survive a fresh-play regeneration; auto-grown + similar-generated tracks do not.
	 * Plain Set (not $state) so Track objects stay clean — no origin field on Track.
	 */
	private manualUids = new Set<string>();

	/**
	 * Single SSR + feature-detection guard for the Media Session API (MS-05, T-kyf-03).
	 * Returns `navigator.mediaSession` only when running client-side on a browser that
	 * supports it; null otherwise. EVERY Media Session call goes through this accessor
	 * and early-returns when it is null, so nothing crashes under SSR or on unsupported
	 * browsers (e.g. iOS Safari prior to support).
	 */
	private get ms(): MediaSession | null {
		return typeof navigator !== 'undefined' && 'mediaSession' in navigator
			? navigator.mediaSession
			: null;
	}

	/** Push the current finite, in-range position to the OS media UI (guarded, MS-04). */
	private syncPosition(el: HTMLAudioElement) {
		const ms = this.ms;
		if (!ms) return;
		const st = safePositionState(el.duration, el.currentTime);
		if (st) ms.setPositionState(st);
	}

	/** Keep the OS media UI play/pause/none state synced with real playback (MS-02). */
	private syncPlaybackState() {
		const ms = this.ms;
		if (ms) ms.playbackState = playbackStateFor(!!this.current, this.playing);
	}

	/** Clear OS media metadata + set state 'none' when playback stops / track cleared (MS-05/MS-02). */
	private clearMedia() {
		const ms = this.ms;
		if (!ms) return;
		ms.metadata = null;
		ms.playbackState = 'none';
		ms.setPositionState(); // clears any stale position
	}

	/** Bind the single long-lived <audio> element (called once from the layout). */
	attach(el: HTMLAudioElement) {
		this.audio = el;
		el.setAttribute('referrerpolicy', 'no-referrer');
		el.addEventListener('play', () => {
			this.playing = true;
			this.syncPlaybackState();
		});
		el.addEventListener('pause', () => {
			this.playing = false;
			this.syncPlaybackState();
		});
		el.addEventListener('timeupdate', () => {
			this.currentTime = el.currentTime || 0;
			this.syncPosition(el);
		});
		const syncDur = () => {
			this.duration = Number.isFinite(el.duration) ? el.duration : 0;
			this.syncPosition(el);
		};
		el.addEventListener('loadedmetadata', syncDur);
		el.addEventListener('durationchange', syncDur);
		el.addEventListener('ended', () => {
			this.playing = false;
			this.syncPlaybackState();
			// Repeat-one (gte): loop the current track without advancing. The `ended` event
			// already paused the element; rewind + play(). 'all' is handled inside next() so
			// the end-of-queue branch wraps; 'off' is today's straight advance.
			if (this.repeatMode === 'one' && this.audio) {
				this.audio.currentTime = 0;
				void this.audio.play().catch(() => {
					/* autoplay may require gesture — controls still work */
				});
				return;
			}
			this.next();
		});
		el.addEventListener('error', () => {
			// Cross-source fallback (gte / SRC-FB-01): rather than surface the error immediately,
			// try the same {artist,title} on the remaining enabled sources. Only after every
			// source is exhausted does the existing error surface. Generation-guarded so a
			// newer play() supersedes a stale retry.
			this.playing = false;
			const failed = this.current;
			if (!failed) {
				this.error = 'playback failed (source may be region-locked or expired)';
				this.clearMedia();
				return;
			}
			void this.runFallback(failed);
		});

		// Register OS media transport + seek handlers ONCE (MS-03). They reuse the
		// existing player methods / audio element — no new playback or queue logic.
		// `details.seekOffset` / `details.seekTime` come from the user agent and are
		// treated as untrusted: only acted on when finite, and clamped into range
		// (T-kyf-01) — the same discipline the pure safePositionState enforces.
		const ms = this.ms;
		if (!ms) return;
		ms.setActionHandler('play', () => this.audio?.play().catch(() => {}));
		ms.setActionHandler('pause', () => this.audio?.pause());
		ms.setActionHandler('previoustrack', () => this.prev());
		ms.setActionHandler('nexttrack', () => this.next());
		ms.setActionHandler('seekbackward', (details) => {
			const offset = Number.isFinite(details.seekOffset) ? (details.seekOffset as number) : 10;
			el.currentTime = Math.max(0, el.currentTime - offset);
		});
		ms.setActionHandler('seekforward', (details) => {
			const offset = Number.isFinite(details.seekOffset) ? (details.seekOffset as number) : 10;
			const cap = Number.isFinite(el.duration) ? el.duration : el.currentTime + offset;
			el.currentTime = Math.min(cap, el.currentTime + offset);
		});
		ms.setActionHandler('seekto', (details) => {
			if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
			if (Number.isFinite(el.duration) && el.duration > 0) {
				this.seekFraction(details.seekTime / el.duration); // clamps [0,1] internally
			} else {
				el.currentTime = Math.max(0, details.seekTime);
			}
		});
	}

	/** Set the active list (home grid / search results) as the Up-Next source. */
	setQueue(tracks: Track[]) {
		this.queue = dedupeBest(tracks, settings.preferredSource);
	}

	/** Insert a track right after the current one (de-duped). Plays it if nothing is playing. */
	playNext(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		const q = this.queue.filter((x) => x.uid !== t.uid);
		const i = q.findIndex((x) => x.uid === this.current?.uid);
		q.splice(i >= 0 ? i + 1 : 0, 0, t);
		this.queue = q;
		if (!this.current) this.play(t);
	}

	/** Append a track to the end of the queue (de-duped). Plays it if nothing is playing. */
	addToQueue(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		if (!this.queue.some((x) => x.uid === t.uid)) this.queue = [...this.queue, t];
		if (!this.current) this.play(t);
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
			if (more.length) this.queue = dedupeBest([...this.queue, ...more], settings.preferredSource);
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

	/**
	 * Pre-resolve the track next() WOULD pick next, so a later next()/track-end starts
	 * instantly (the user-felt latency on advance is the per-source proxy round-trip inside
	 * ensureTrackDetails, NOT byte buffering). Because ensureTrackDetails is idempotent (its
	 * readiness guard short-circuits a detailsLoaded track) and play() syncs the resolved
	 * track back into queue[i], pre-resolving the next entry means the later play() hits a
	 * no-op resolve = instant start.
	 *
	 * Best-effort, fired as `void this.prefetchNext()` from play() — mirrors ensureAhead()/
	 * regenerate(): never blocks the current play(), never throws, no second <audio> element
	 * (audio byte-warming is out of scope; the iOS single-element constraint stands).
	 *
	 * Target = queue[indexOf(current)+1] — EXACTLY what next() selects (no play-mode branching).
	 * Guards: silent no-op at end of queue / no current; skip an already-complete target;
	 * dedupe a second prefetch of the same uid in flight; abort + discard a stale resolve if
	 * `current` changes mid-resolve (so a stale result never clobbers the queue).
	 */
	private async prefetchNext() {
		const i = this.indexOf(this.current);
		if (i < 0) return; // no current track in the queue — nothing to prefetch from
		const nextIndex = i + 1;
		if (nextIndex >= this.queue.length) return; // at end of queue — silent no-op (growth is ensureAhead's job)
		const target = this.queue[nextIndex];
		// Already complete? The readiness guard would no-op anyway — skip without a resolve.
		if (target.detailsLoaded && target.audioUrl && (target.lrc || !target.lrcUrl)) return;
		// In-flight dedupe: already prefetching this exact track — do not start a second resolve.
		if (this.prefetchingUid === target.uid) return;

		// Supersede any prior in-flight prefetch (different target) before claiming this one.
		this.prefetchController?.abort();
		this.prefetchingUid = target.uid;
		this.prefetchController = new AbortController();
		const sig = this.prefetchController.signal;
		const seedUid = this.current?.uid; // stale-guard: current must not change away

		try {
			const resolved = await ensureTrackDetails(target, sig);
			// Stale-guard: only write back when `current` hasn't changed AND the queue still
			// holds this target at the slot right after the (recomputed) current position.
			// Otherwise discard silently — never clobber a newer prefetch / moved queue.
			if (this.current?.uid === seedUid) {
				const j = this.indexOf(this.current);
				const slot = j + 1;
				if (j >= 0 && this.queue[slot]?.uid === target.uid) {
					this.queue[slot] = resolved; // same in-place sync play() does — later play() no-ops
				}
			}
		} catch {
			/* best-effort — abort or proxy failure leaves the queue as-is */
		} finally {
			// Clear the in-flight guard only if it still points at THIS target (a superseding
			// prefetch may have already claimed a newer uid).
			if (this.prefetchingUid === target.uid) {
				this.prefetchingUid = null;
				this.prefetchController = null;
			}
		}
	}

	/**
	 * Optimistic resolve-on-tap (FIX-A). A discovery tile is a Last.fm {artist,title} stub,
	 * NOT a Track — resolveStub re-searches it through searchAll+dedupeBest (~5-10s). This
	 * makes that feel instant + native:
	 *
	 *  - SYNCHRONOUSLY (before awaiting) it locks the tapped {artist,title,cover} into
	 *    `pendingTrack` and sets `loading`, so the now-bar renders immediately.
	 *  - DEDUPE: a second tap with the SAME pending key while one is in flight is a NO-OP
	 *    (no second resolveStub) — repeated double-taps don't stack resolves.
	 *  - SUPERSEDE: a tap with a DIFFERENT key bumps `pendingGen`; when an older resolve
	 *    settles its gen !== current → its result is discarded (never played, pendingTrack
	 *    is left pointing at the NEWER song).
	 *  - On success for the current gen → setQueue([track]) + play(track) (play() owns
	 *    loading/current from there) and pendingTrack is cleared.
	 *  - On a miss (null) for the current gen → pendingTrack + loading clear and null is
	 *    returned so the CALLER owns its own unplayable toast.
	 *
	 * Returns the resolved Track on success, or null on a miss OR a supersede. Never throws
	 * (resolveStub is best-effort; this wraps it defensively too).
	 */
	async playStub(artist: string, title: string, cover?: string | null): Promise<Track | null> {
		const key = `${artist}${PENDING_KEY_SEP}${title}`.toLowerCase().trim();

		// Dedupe: same song tapped again while its resolve is still in flight → no-op.
		// "In flight" = a pendingTrack still showing (it is cleared on success/miss/supersede).
		if (key === this.pendingKey && this.pendingTrack !== null) return null;

		const gen = ++this.pendingGen;
		this.pendingKey = key;
		this.pendingTrack = { artist, title, cover: cover ?? null };
		this.loading = true;
		this.error = null;

		let tr: Track | null = null;
		try {
			tr = await resolveStub(artist, title);
		} catch {
			tr = null; // resolveStub never throws, but stay defensive — never reject.
		}

		// Superseded by a newer tap while we were resolving → discard silently. Do NOT touch
		// pendingTrack/loading; the newer playStub call owns them now.
		if (gen !== this.pendingGen) return null;

		if (tr) {
			// Hand off to the real player. Clear the optimistic overlay; play() sets `current`
			// (and owns loading from here) so there is no flicker of a stale pending bar.
			this.pendingTrack = null;
			this.setQueue([tr]);
			void this.play(tr, { fresh: true });
			return tr;
		}

		// Genuine miss for the current generation — clear the overlay; caller toasts.
		this.pendingTrack = null;
		this.pendingKey = '';
		this.loading = false;
		return null;
	}

	/**
	 * Play a track. `opts.fresh` marks a FRESH user-initiated play (the user tapped a
	 * song in a list to start something new) — that regenerates the AUTO portion of
	 * Up-Next from songs similar to the new track, preserving the current track + all
	 * manual entries. `next()`, `prev()`, and auto-advance (ended) call the NON-fresh
	 * path, so they never regenerate.
	 */
	async play(track: Track, opts?: { fresh?: boolean; fromFallback?: boolean }) {
		// A direct play() (queue/auto-advance/share link) supersedes any optimistic overlay,
		// so a stale pending bar never lingers once a real track takes over.
		this.pendingTrack = null;
		this.pendingKey = '';
		this.error = null;
		this.loading = true;
		this.current = track;
		this.currentTime = 0;
		this.duration = 0;
		// Bump the play-generation so any older in-flight fallback bails (gte). Skipped on a
		// fallback continuation — the fallback IS the continuation of the user's original intent
		// and must not invalidate itself.
		if (!opts?.fromFallback) this.playGen++;
		// One-way edge: record the play BEFORE resolution so it lands even if audio
		// resolution later errors. history imports nothing back (no circular dep).
		// Fallback continuations DO NOT re-record — history reflects user intent, not the
		// resolved source we ended up playing.
		if (!opts?.fromFallback) history.record(track);
		if (settings.autoExpandOnPlay) this.expanded = true;
		try {
			const resolved = await ensureTrackDetails(track);
			this.current = resolved;
			// keep the queue entry in sync with the resolved track
			const i = this.indexOf(track);
			if (i >= 0) this.queue[i] = resolved;
			if (!resolved.audioUrl) {
				// Cross-source fallback (gte): try other enabled sources before surfacing the
				// error. On success, runFallback() calls play() again with fromFallback:true.
				if (!opts?.fromFallback) {
					this.loading = false;
					void this.runFallback(resolved);
					return;
				}
				this.error = 'no playable audio for this track';
				this.clearMedia(); // nothing playable — clear the OS media UI (MS-05)
				return;
			}
			// Populate the OS/browser media UI from the RESOLVED track so album/cover
			// are present (MS-01). Titles/artists go through the per-part name resolvers
			// for the active display language (returns the original under SSR/off). Guarded via `ms`.
			const ms = this.ms;
			if (ms) {
				ms.metadata = new MediaMetadata({
					title: names.dnTitle(resolved.title),
					artist: names.dnArtist(resolved.artist),
					album: resolved.album,
					artwork: buildArtwork(resolved.cover)
				});
				ms.playbackState = 'playing';
			}
			if (this.audio) {
				this.audio.src = resolved.audioUrl;
				await this.audio.play().catch(() => {
					/* autoplay may require a gesture — the controls still work */
				});
			}
			// Fresh play -> regenerate the auto portion (best-effort, never blocks
			// playback). Otherwise just keep the queue topped up via auto-grow.
			if (opts?.fresh) void this.regenerate(resolved);
			else void this.ensureAhead();
			// Pre-resolve the NEXT track so next()/track-end starts instantly. Best-effort,
			// non-blocking (like ensureAhead/regenerate above). Fired AFTER ensureAhead so a
			// freshly-grown tail exists to be prefetched on the next play()/tick; prefetchNext
			// itself never grows the queue.
			void this.prefetchNext();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Rebuild the AUTO portion of Up-Next from songs similar to `seed`, preserving the
	 * seed (current) + manual entries in their existing order. Best-effort: on any
	 * failure the queue is left as-is. Only invoked on a fresh user-initiated play.
	 */
	private async regenerate(seed: Track) {
		try {
			const manualEntries = this.queue.filter(
				(t) => this.manualUids.has(t.uid) && t.uid !== seed.uid
			);
			const exclude = new Set<string>([seed.uid, ...manualEntries.map((t) => t.uid)]);
			const auto = await buildSimilarQueue(seed, exclude);
			this.queue = dedupeBest([seed, ...manualEntries, ...auto], settings.preferredSource);
		} catch {
			/* leave queue as-is */
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
			// Repeat-all (gte): wrap to the start of the existing queue instead of growing.
			if (this.repeatMode === 'all' && this.queue.length > 0) {
				this.play(this.queue[0]);
				return;
			}
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

	/**
	 * Toggle shuffle (gte). Turning ON: Fisher-Yates the queue slice AFTER indexOf(current)+1.
	 * Current track + everything before it (history) stay pinned. Turning OFF: leave the queue
	 * as-is (user-specified — we do NOT restore the original order). Idempotent on empty/single
	 * queues. Bumps reactivity via a fresh array reference.
	 */
	toggleShuffle() {
		const next = !this.shuffle;
		this.shuffle = next;
		if (!next) return;
		const i = this.indexOf(this.current);
		const start = (i >= 0 ? i : -1) + 1; // shuffle everything strictly after current
		if (start >= this.queue.length - 1) return; // nothing to shuffle
		const arr = [...this.queue];
		// Fisher-Yates over [start, arr.length). Use ((Date.now() ^ idx) % range) is not a real
		// CSPRNG — but Math.random() is fine for queue-shuffle UX.
		for (let k = arr.length - 1; k > start; k--) {
			const j = start + Math.floor(Math.random() * (k - start + 1));
			[arr[k], arr[j]] = [arr[j], arr[k]];
		}
		this.queue = arr;
	}

	/** Cycle the repeat mode (gte): off → one → all → off. */
	cycleRepeat() {
		this.repeatMode = this.repeatMode === 'off' ? 'one' : this.repeatMode === 'one' ? 'all' : 'off';
	}

	/**
	 * Cross-source fallback driver (gte / SRC-FB-01). Capture the generation at the moment
	 * we start the fallback; abort + bail if a newer play() bumps it (e.g. user tapped the
	 * next song). On success, recurse play() with fromFallback:true so the inner play() does
	 * NOT re-record history and does NOT bump the generation. On exhaustion, surface the
	 * existing error. Never throws — tryFallback() is defensively wrapped.
	 */
	private async runFallback(failed: Track) {
		const gen = this.playGen;
		this.loading = true;
		this.error = null;
		const ac = new AbortController();
		// If a newer play() bumps the gen mid-search, abort the in-flight searchAll +
		// ensureTrackDetails so we don't burn the network on a stale attempt. The next
		// gen-check below stops us from clobbering the newer track.
		const watchdog = setInterval(() => {
			if (this.playGen !== gen) ac.abort();
		}, 200);
		try {
			const swap = await tryFallback(failed, settings.preferredSource, ac.signal);
			if (this.playGen !== gen) return; // a newer play() supersedes — discard silently
			if (swap) {
				// Sync the queue slot too so next()/prev() walk the resolved track.
				const i = this.indexOf(failed);
				if (i >= 0) this.queue[i] = swap;
				await this.play(swap, { fromFallback: true });
				return;
			}
			// Every remaining source exhausted — surface the error as before.
			this.error = 'playback failed (source may be region-locked or expired)';
			this.clearMedia();
		} finally {
			clearInterval(watchdog);
			if (this.playGen === gen) this.loading = false;
		}
	}

	/**
	 * Move a queue entry from `from` to `to` (clamped) and pin the moved track as
	 * manual so the next fresh-play regeneration preserves it. No-op if indices are
	 * out of range or equal.
	 */
	reorderQueue(from: number, to: number) {
		const n = this.queue.length;
		if (from < 0 || from >= n) return;
		const target = Math.max(0, Math.min(n - 1, to));
		if (target === from) return;
		const next = [...this.queue];
		const [moved] = next.splice(from, 1);
		next.splice(target, 0, moved);
		this.queue = next;
		this.manualUids.add(moved.uid); // reordered = pinned manual
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
