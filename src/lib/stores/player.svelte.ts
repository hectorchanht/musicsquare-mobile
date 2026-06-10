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
import { browser } from '$app/environment';
import { ensureTrackDetails } from '$lib/services/catalog';
import { tryFallback } from '$lib/services/fallback';
import { buildDiversePicks } from '$lib/services/picks';
import { buildSimilarQueue } from '$lib/services/similar';
import { dedupeBest } from '$lib/services/dedupe';
import { buildArtwork, safePositionState, playbackStateFor } from '$lib/services/media-session';
import { resolveStub } from '$lib/services/discovery';
import { blobStore } from '$lib/services/blob-store';
import { settings } from '$lib/stores/settings.svelte';
import { history } from '$lib/stores/history.svelte';
import { library } from '$lib/stores/library.svelte';
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

/**
 * Store→UI notice channel (PLAY-08 / D-02, D-04, D-05). The never-stop chain ORIGINATES inside
 * the player store (runFallback total-failure, the stall watchdog, the offline gate) but stores
 * never import UI — so it surfaces resilience messages on a reactive `player.notice` field that a
 * layout-level toast host (16-03) reads one-way, mirroring the existing `player.error → Nowbar`
 * read. The store carries RAW, i18n-free data (D-03: 16-03 owns the wording):
 *
 *  - `kind: 'skip'`    → an auto-skip after a track failed all sources. `count` is how many songs
 *                        were skipped in the current burst (D-02 batching: N consecutive skips
 *                        within ~1.5s collapse into one "{count} songs skipped" message). `title`
 *                        is the last-skipped track's title (the host may show it). Auto-dismissing,
 *                        no action.
 *  - `kind: 'stopped'` → a STICKY notice with no auto-dismiss. Either the loop-guard tripped
 *                        (~5 consecutive failures, `reason: 'loop-guard'`, carries a Retry `action`
 *                        that skips ahead + re-arms per D-05) OR the player went offline with no
 *                        downloads to fall back to (`reason: 'offline'`, no action — playback
 *                        resumes when connectivity + a user gesture return).
 *
 * 16-03 maps (kind, reason, count, title) → a localized string via `t()`; the store stays
 * i18n-free. `msg` holds a stable token key for hosts that prefer a direct lookup.
 */
export interface PlayerNotice {
	kind: 'skip' | 'stopped';
	/** Stable token the UI may map directly via t(); the structured fields below are preferred. */
	msg: string;
	/** Why a 'stopped' notice fired — distinguishes the loop-guard from the offline pause. */
	reason?: 'loop-guard' | 'offline';
	/** 'skip' only: number of consecutive skips collapsed into this one message (D-02). */
	count?: number;
	/** 'skip' only: the title of the most recently skipped track. */
	title?: string;
	/** 'stopped'/loop-guard only: Retry — skips ahead to the next track, resets the counter,
	 *  re-arms the never-stop chain (D-05). Absent on the offline-pause notice. */
	action?: () => void;
}

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
	 * Resilience notice channel (PLAY-08 / D-02, D-04, D-05). One-way reactive read by the
	 * layout toast host (16-03). See PlayerNotice for the shape + token contract. null = nothing
	 * to show. The store sets this from runFallback (skip / loop-guard) and handleOffline (offline
	 * pause); a real `playing` event clears any 'stopped' notice (the success reset).
	 */
	notice = $state<PlayerNotice | null>(null);

	/**
	 * Consecutive-failure counter (PLAY-08 / D-04, Pitfall 1). Incremented on every auto-skip that
	 * did NOT reach a real `playing` event; reset to 0 by the `play` listener (D-06 success reset)
	 * and by recoverFromStop. PLAIN field (not $state) — an internal loop-guard budget, never read
	 * reactively by the UI (the UI reads `notice` instead). Offline does NOT burn it (D-08).
	 */
	private consecutiveFailures = 0;
	/** Loop-guard cap: after this many consecutive failures with zero successful plays, STOP and
	 *  surface a sticky Retry notice instead of auto-advancing again (D-04). */
	private static FAILURE_CAP = 5;
	/** Skip-burst batch counter (D-02): how many skips have collapsed into the current notice. Reset
	 *  by the debounce window below. Plain field — not reactive. */
	private skipBurst = 0;
	/** Debounce timer for the skip-burst collapse window (~1.5s). While it is live, further skips
	 *  increment skipBurst into ONE notice rather than stacking N notices (D-02). */
	private skipBurstTimer: ReturnType<typeof setTimeout> | null = null;
	/** Skip-burst collapse window in ms (D-02 / CONTEXT D-49). */
	private static SKIP_BURST_WINDOW_MS = 1500;

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
	/** 2-state repeat (PLAY-10 / D-10): 'off' = today; 'one' = loop the current track on ended.
	 * Cycle: off → one → off. Repeat-all was removed in favor of auto-generated up-next
	 * (ensureAhead/regenerate) — that grow-and-advance IS the semantic successor of repeat-all,
	 * so next() no longer wraps the queue. */
	repeatMode = $state<'off' | 'one'>('off');

	/** Monotonic play generation (gte): bumped at the top of every play() so the cross-source
	 * fallback can detect a newer play() and abort its in-flight retries. Plain field — no $state
	 * reactivity (it's an internal supersedence guard, like pendingGen). */
	private playGen = 0;

	/** kyf: when audio.src is set to a `blob:` Object URL (from the offline cache), track the
	 * URL here so we can revoke it when a new track starts. Revoking the previous URL on every
	 * play prevents Object-URL leaks across long sessions. */
	private cachedBlobUrl: string | null = null;

	/** Persistent state key — localStorage shape `openmusic:player:v1`. */
	private static STATE_KEY = 'openmusic:player:v1';
	/** Throttle timer for currentTime persistence (timeupdate fires ~4×/sec). */
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	/** Seek-position that should be applied as soon as audio.duration becomes finite (i.e. on
	 *  the next `loadedmetadata`). Set by restore() with the saved currentTime, and also
	 *  written by seekFraction() when the user seeks while metadata is still loading. Cleared
	 *  once applied, or when a successful in-range seek lands. */
	private pendingSeek: number | null = null;
	/** Same idea as pendingSeek but holds a FRACTION [0,1] when the user seeks before metadata
	 *  loads (we don't know the absolute seconds yet). Wins over pendingSeek if both are set
	 *  (user intent supersedes restored progress). */
	private pendingSeekFrac: number | null = null;

	/** Strip volatile fields (audioUrl / lrc / lrcUrl / detailsLoaded) before persisting a
	 *  Track to localStorage — they expire and must be re-resolved on the next load. Mirrors
	 *  the legacy serializeTrack whitelist + the history-entry shape. */
	private serializeTrack(t: Track): Partial<Track> {
		return {
			uid: t.uid,
			source: t.source,
			songid: t.songid,
			title: t.title,
			artist: t.artist,
			album: t.album,
			cover: t.cover,
			quality: t.quality,
			qualityLabel: t.qualityLabel,
			keyword: t.keyword,
			displayIndex: t.displayIndex
		};
	}

	/** Write the persistable slice of player state to localStorage. Called immediately on
	 *  imperative state changes (play/setQueue/toggleShuffle/cycleRepeat) and throttled to
	 *  ~2s on the audio `timeupdate` firehose. SSR-safe + try/catch-guarded. */
	private persist() {
		if (!browser) return;
		if (!this.current) {
			try { localStorage.removeItem(Player.STATE_KEY); } catch { /* ignore */ }
			return;
		}
		try {
			localStorage.setItem(
				Player.STATE_KEY,
				JSON.stringify({
					v: 1,
					current: this.serializeTrack(this.current),
					queue: this.queue.map((t) => this.serializeTrack(t)),
					currentTime: this.currentTime,
					shuffle: this.shuffle,
					repeatMode: this.repeatMode
				})
			);
		} catch {
			/* quota — non-fatal */
		}
	}
	/** Coalesce currentTime writes so the timeupdate firehose doesn't spam localStorage. */
	private persistThrottled() {
		if (this.persistTimer) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			this.persist();
		}, 2000);
	}

	/** Restore the last played track + queue + progress + shuffle/repeat from localStorage.
	 *  Called once from the layout on mount. Doesn't autoplay — restored audio is paused
	 *  with audio.currentTime seeded; the user must tap play (browser autoplay policy).
	 *  Audio URLs aren't persisted (they expire), so the resolved track is re-fetched via
	 *  ensureTrackDetails — same path play() takes. */
	async restore() {
		if (!browser) return;
		let payload: {
			v?: number;
			current?: Partial<Track> | null;
			queue?: Partial<Track>[];
			currentTime?: number;
			shuffle?: boolean;
			repeatMode?: 'off' | 'one';
		} | null = null;
		try {
			const raw = localStorage.getItem(Player.STATE_KEY);
			if (!raw) return;
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		if (!payload?.current?.uid) return;
		const reshape = (p: Partial<Track>): Track => ({
			uid: p.uid ?? '',
			source: p.source ?? ('netease' as Track['source']),
			songid: p.songid ?? '',
			title: p.title ?? '',
			artist: p.artist ?? '',
			album: p.album ?? '',
			cover: p.cover ?? null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: p.quality ?? null,
			qualityLabel: p.qualityLabel ?? null,
			keyword: p.keyword ?? '',
			displayIndex: p.displayIndex ?? 1
		});
		const target = reshape(payload.current as Partial<Track>);
		const seek = Math.max(0, Number(payload.currentTime) || 0);
		this.queue = (payload.queue ?? []).map(reshape);
		this.shuffle = !!payload.shuffle;
		// D-11: 2-state migration — only an explicit 'one' is kept; any persisted repeat-all (from
		// a prior tri-state session), missing, or tampered value collapses to the safe 'off' default.
		this.repeatMode = payload.repeatMode === 'one' ? 'one' : 'off';
		this.current = target;
		this.loading = true;
		try {
			// Offline-first restore: if the track is in library.downloads AND its blob is in
			// IDB, skip the network ensureTrackDetails entirely. Lets the user resume a
			// downloaded track with no network at all (the resolve would otherwise throw +
			// the user would see the player stuck).
			let resolved: Track = target;
			let offlineBlob: Blob | null = null;
			if (library.isDownloaded(target.uid)) {
				offlineBlob = await blobStore.get(target.uid).catch(() => null);
			}
			if (!offlineBlob) {
				resolved = await ensureTrackDetails(target);
				this.current = resolved;
				const i = this.indexOf(target);
				if (i >= 0) this.queue[i] = resolved;
			} else {
				this.current = { ...target, detailsLoaded: true };
			}
			if (!this.audio) return;
			if (this.cachedBlobUrl) {
				URL.revokeObjectURL(this.cachedBlobUrl);
				this.cachedBlobUrl = null;
			}
			let src: string;
			if (offlineBlob) {
				this.cachedBlobUrl = URL.createObjectURL(offlineBlob);
				src = this.cachedBlobUrl;
			} else if (resolved.audioUrl) {
				src = resolved.audioUrl;
			} else {
				return;
			}
			const audio = this.audio;
			// Mark the saved seek-time as PENDING so the single loadedmetadata listener (added
			// in attach()) applies it once metadata loads. seekFraction() owns the same pending
			// slot — if the user manually seeks before metadata lands, their target wins.
			this.pendingSeek = seek > 0 ? seek : null;
			audio.src = src;
			// If duration is already finite (cached load, identical src reset), apply
			// immediately and clear so the listener doesn't double-fire.
			if (Number.isFinite(audio.duration) && audio.duration > 0 && this.pendingSeek != null) {
				audio.currentTime = Math.min(this.pendingSeek, audio.duration);
				this.pendingSeek = null;
			}
		} catch {
			/* re-resolve failed — track stays in `current`, user can tap play to retry */
		} finally {
			this.loading = false;
		}
	}

	/** Re-resolve audio URL for the CURRENT track (fresh upstream call) and re-attach to the
	 *  audio element while preserving the user's intended seek position via pendingSeek.
	 *  Used by the audio.error path when a seek triggers a stale-URL failure — we keep the
	 *  same track, just refresh the URL. Generation-guarded by the pre-call playGen snapshot
	 *  so a newer play() supersedes a stale retry. Never throws. */
	private async reresolveCurrent() {
		const current = this.current;
		if (!current || !this.audio) return;
		const audio = this.audio;
		const desiredSeek = this.currentTime > 0 ? this.currentTime : null;
		const myGen = this.playGen;
		// Force a re-resolve by clearing detailsLoaded + audioUrl on a SHALLOW COPY (don't
		// mutate the queue entry).
		const stub: Track = { ...current, detailsLoaded: false, audioUrl: null, lrc: null };
		try {
			const resolved = await ensureTrackDetails(stub);
			if (myGen !== this.playGen) return; // newer play() superseded
			if (!resolved.audioUrl) return;
			this.current = resolved;
			const i = this.indexOf(stub);
			if (i >= 0) this.queue[i] = resolved;
			if (this.cachedBlobUrl) {
				URL.revokeObjectURL(this.cachedBlobUrl);
				this.cachedBlobUrl = null;
			}
			let src: string = resolved.audioUrl;
			if (library.isDownloaded(resolved.uid)) {
				const blob = await blobStore.get(resolved.uid).catch(() => null);
				if (blob) {
					this.cachedBlobUrl = URL.createObjectURL(blob);
					src = this.cachedBlobUrl;
				}
			}
			this.pendingSeek = desiredSeek;
			// NOT an initial-load arming point (D-14): reresolveCurrent is a seek-recovery re-attach
			// of the SAME track after a stale-URL error, not a fresh play. Arming the stall watchdog
			// here would double-count a seek recovery as a load failure, so we deliberately do not.
			audio.src = src;
			// Attempt synchronous seek if duration already loaded; else loadedmetadata listener
			// will pick up pendingSeek when it lands.
			if (Number.isFinite(audio.duration) && audio.duration > 0 && desiredSeek != null) {
				audio.currentTime = Math.min(desiredSeek, audio.duration);
				this.pendingSeek = null;
			}
			void audio.play().catch(() => {
				/* autoplay restriction — user can tap play (seek-recovery, not a load stall) */
			});
		} catch {
			/* re-resolve failed — leave audio in current state */
		}
	}

	/** Timestamp (Date.now()) of the most recent seekFraction() call. The audio.error handler
	 *  ignores errors that fire within SEEK_ERROR_WINDOW_MS of a seek — seeking past the
	 *  buffered range on some CDNs raises an error the browser recovers from, but our
	 *  cross-source fallback was treating that as a playback failure + calling play() again,
	 *  which reset currentTime to 0 (visible to user as "seek restarted the song"). */
	private lastSeekAt = 0;
	private static SEEK_ERROR_WINDOW_MS = 1500;

	/**
	 * Initial-load stall watchdog (PLAY-07 / D-13, D-14). A freshly started track whose src was
	 * just set but that produces NO `playing`/`timeupdate` within STALL_TIMEOUT_MS is treated as a
	 * failure and routed into runFallback (D-13). This is the detector for the iOS "play() rejected
	 * after an async src swap, no audio, no error event" case (Pitfall 3) — the rejection itself is
	 * swallowed by .catch, so the watchdog is what actually notices the silent stop.
	 *
	 * D-14 mid-track distinction: `hasPlayedSinceSrc` is set false the instant a NEW src is
	 * assigned for initial load and flipped true on the first `playing`/`timeupdate`. The watchdog
	 * only fails over when it is still false — a buffer-dry stall AFTER playback started (timeupdate
	 * already fired) is buffering, not a load failure, and must NOT fail over.
	 */
	private static STALL_TIMEOUT_MS = 15000;
	private stallTimer: ReturnType<typeof setTimeout> | null = null;
	/** True once the current src has produced audio (a `playing`/`timeupdate`); false from the
	 *  moment a new initial-load src is set. Distinguishes initial-load stall (D-13) from a
	 *  mid-track buffer-dry (D-14). Plain field — internal watchdog state, not reactive. */
	private hasPlayedSinceSrc = false;

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

	/**
	 * Arm the initial-load stall watchdog (D-13). Snapshot playGen so a newer play() supersedes
	 * this timer (the gen-check inside the callback discards a stale arm). When STALL_TIMEOUT_MS
	 * elapses with no audio (hasPlayedSinceSrc still false) for the still-current track, route into
	 * runFallback — runFallback owns its OWN gen-guard + AbortController, so the watchdog just fires
	 * the failover and lets it decide supersedence. Always clears any prior timer first.
	 */
	private armStall() {
		const gen = this.playGen;
		this.disarmStall();
		this.stallTimer = setTimeout(() => {
			this.stallTimer = null;
			if (this.playGen !== gen) return; // a newer play() superseded this arm
			if (this.hasPlayedSinceSrc) return; // audio actually started — not a load stall (D-14)
			if (!this.current) return;
			void this.runFallback(this.current);
		}, Player.STALL_TIMEOUT_MS);
	}

	/** Disarm the stall watchdog (a real playing/timeupdate, an error, or end-of-track). */
	private disarmStall() {
		if (this.stallTimer) {
			clearTimeout(this.stallTimer);
			this.stallTimer = null;
		}
	}

	/** Bind the single long-lived <audio> element (called once from the layout). */
	attach(el: HTMLAudioElement) {
		this.audio = el;
		el.setAttribute('referrerpolicy', 'no-referrer');
		el.addEventListener('play', () => {
			this.playing = true;
			this.syncPlaybackState();
			// D-13/D-14: a real `play` event means audio started — mark the src as having played and
			// disarm the initial-load stall watchdog so it can't fire a false failover.
			this.hasPlayedSinceSrc = true;
			this.disarmStall();
			// D-06 success reset: a real `playing` event is the natural counter reset — the track
			// is actually producing audio, so the never-stop chain has recovered. Clear the
			// consecutive-failure budget and drop any sticky 'stopped' (loop-guard / offline) notice
			// so the UI stops showing "playback stopped" the instant playback resumes.
			this.consecutiveFailures = 0;
			if (this.notice?.kind === 'stopped') this.notice = null;
		});
		el.addEventListener('pause', () => {
			this.playing = false;
			this.syncPlaybackState();
		});
		el.addEventListener('timeupdate', () => {
			this.currentTime = el.currentTime || 0;
			this.syncPosition(el);
			// D-13/D-14: the first timeupdate since src-set is the "we are actually playing" signal —
			// flip the flag + disarm the stall watchdog. This is what makes a mid-track buffer-dry
			// (timeupdate already fired) NOT fail over, while an initial-load that never produced a
			// timeupdate still does.
			this.hasPlayedSinceSrc = true;
			this.disarmStall();
			// Coalesce currentTime writes to localStorage so a refresh resumes near where the
			// user left off (within ~2s). Throttled to avoid the 4×/sec timeupdate firehose.
			this.persistThrottled();
		});
		const syncDur = () => {
			this.duration = Number.isFinite(el.duration) ? el.duration : 0;
			// Apply any pending seek the moment duration becomes known. Order: a user-issued
			// pendingSeekFrac (clicked progress before metadata loaded) wins over a restored
			// pendingSeek (saved currentTime from the last session). Both cleared after apply.
			if (Number.isFinite(el.duration) && el.duration > 0) {
				if (this.pendingSeekFrac != null) {
					el.currentTime = this.pendingSeekFrac * el.duration;
					this.pendingSeekFrac = null;
					this.pendingSeek = null;
				} else if (this.pendingSeek != null) {
					el.currentTime = Math.min(this.pendingSeek, el.duration);
					this.pendingSeek = null;
				}
			}
			this.syncPosition(el);
		};
		el.addEventListener('loadedmetadata', syncDur);
		el.addEventListener('durationchange', syncDur);
		el.addEventListener('ended', () => {
			this.playing = false;
			this.syncPlaybackState();
			this.disarmStall(); // track finished — no initial-load stall to watch for
			// Repeat-one (D-10): loop the current track without advancing. The `ended` event
			// already paused the element; rewind + play(). 'off' is the straight advance into
			// next() (which grows auto up-next at the end of the queue — no repeat-all wrap).
			if (this.repeatMode === 'one' && this.audio) {
				this.audio.currentTime = 0;
				// Not an initial-load arming point (D-14): repeat-one rewinds an already-playing
				// src, so a rejection here is a paused-loop, not a load failure — the watchdog
				// stays disarmed and we rely on the user to tap play.
				void this.audio.play().catch(() => {
					/* autoplay may require gesture — controls still work */
				});
				return;
			}
			this.next();
		});
		el.addEventListener('error', () => {
			this.disarmStall(); // an error event is the failure signal — the watchdog is redundant now
			// lw9-followup: if the error fires WITHIN the seek window, the user just clicked the
			// progress bar — but the audio element may not be able to honor the seek because the
			// audio.src is a stale CDN URL (typical after a page-reload restore: the resolved URL
			// from minutes ago can still stream-from-0 but rejects range requests on a new edge
			// node / expired signature). Don't fall back across sources — RE-RESOLVE the same
			// track to get a fresh URL, then re-apply the user's seek via pendingSeek so the
			// audio resumes at the position they clicked. A genuine non-seek failure (no recent
			// seek) still routes through the cross-source path below.
			const sinceSeek = Date.now() - this.lastSeekAt;
			if (sinceSeek < Player.SEEK_ERROR_WINDOW_MS) {
				void this.reresolveCurrent();
				return;
			}
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
			this.lastSeekAt = Date.now();
			el.currentTime = Math.max(0, el.currentTime - offset);
		});
		ms.setActionHandler('seekforward', (details) => {
			const offset = Number.isFinite(details.seekOffset) ? (details.seekOffset as number) : 10;
			const cap = Number.isFinite(el.duration) ? el.duration : el.currentTime + offset;
			this.lastSeekAt = Date.now();
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
		this.persist();
	}

	/** Insert a track right after the current one (de-duped). Plays it if nothing is playing. */
	playNext(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		const q = this.queue.filter((x) => x.uid !== t.uid);
		const i = q.findIndex((x) => x.uid === this.current?.uid);
		q.splice(i >= 0 ? i + 1 : 0, 0, t);
		this.queue = q;
		if (!this.current) this.play(t);
		else this.persist();
	}

	/** Append a track to the end of the queue (de-duped). Plays it if nothing is playing. */
	addToQueue(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		if (!this.queue.some((x) => x.uid === t.uid)) this.queue = [...this.queue, t];
		if (!this.current) this.play(t);
		else this.persist();
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
			// Offline-first: if the track is in library.downloads AND we have its blob cached,
			// skip the network resolve entirely and play straight from the local blob. The
			// blob *is* the audio — no need to fetch a fresh URL just to ignore it again on
			// the route-to-blob branch below. Lets the player work with NO network when a
			// song was downloaded earlier.
			if (library.isDownloaded(track.uid)) {
				const offlineBlob = await blobStore.get(track.uid).catch(() => null);
				if (offlineBlob && this.audio) {
					if (this.cachedBlobUrl) {
						URL.revokeObjectURL(this.cachedBlobUrl);
					}
					this.cachedBlobUrl = URL.createObjectURL(offlineBlob);
					this.current = { ...track, detailsLoaded: true };
					this.persist();
					const ms = this.ms;
					if (ms) {
						ms.metadata = new MediaMetadata({
							title: names.dnTitle(track.title),
							artist: names.dnArtist(track.artist),
							album: track.album,
							artwork: buildArtwork(track.cover)
						});
						ms.playbackState = 'playing';
					}
					// Initial-load arming point (D-13): a NEW src for this track. Reset the played
					// flag + arm the stall watchdog so a silent no-audio start routes into failover.
					this.hasPlayedSinceSrc = false;
					this.audio.src = this.cachedBlobUrl;
					this.armStall();
					// D-06: a rejected play() is intentionally surfaced to the stall/failure path,
					// not swallowed — if play() rejects (iOS gesture loss) and no `play` event
					// follows, the armed watchdog above routes into runFallback. .catch only prevents
					// an unhandled rejection.
					await this.audio.play().catch(() => {
						/* rejection owned by the stall watchdog — see comment above */
					});
					this.loading = false;
					return;
				}
			}
			const resolved = await ensureTrackDetails(track);
			this.current = resolved;
			// keep the queue entry in sync with the resolved track
			const i = this.indexOf(track);
			if (i >= 0) this.queue[i] = resolved;
			// Persist the new current+queue immediately so a reload mid-resolve still has the
			// right track to restore (the throttled timeupdate write covers progress alone).
			this.persist();
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
				// kyf: prefer the offline blob when the track is in library.downloads AND the
				// blob is still in the IDB cache. A miss / SSR / IDB-unavailable falls through to
				// the CDN URL (never throws). Always revoke the prior Object URL first.
				if (this.cachedBlobUrl) {
					URL.revokeObjectURL(this.cachedBlobUrl);
					this.cachedBlobUrl = null;
				}
				let src: string = resolved.audioUrl;
				if (library.isDownloaded(resolved.uid)) {
					const blob = await blobStore.get(resolved.uid).catch(() => null);
					if (blob) {
						this.cachedBlobUrl = URL.createObjectURL(blob);
						src = this.cachedBlobUrl;
					}
				}
				// Initial-load arming point (D-13): a NEW src for this track. Reset the played flag +
				// arm the stall watchdog so a silent no-audio start (no `playing`/`timeupdate`
				// within ~15s) routes into failover.
				this.hasPlayedSinceSrc = false;
				this.audio.src = src;
				this.armStall();
				// D-06: a rejected play() is intentionally surfaced to the stall/failure path, not
				// swallowed — if play() rejects (iOS gesture loss after the async resolve) and no
				// `play` event follows, the armed watchdog above routes into runFallback. The .catch
				// only prevents an unhandled rejection; it is NOT a silent no-op.
				await this.audio.play().catch(() => {
					/* rejection owned by the stall watchdog — see comment above */
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
			// End-of-queue (D-10/D-12): no repeat-all wrap any more — auto-generated up-next is the
			// continuation. Grow the queue via ensureAhead, then advance to the freshly-added track.
			// (16-02 adds the runtime break-to-off when a repeat-one track fails all sources.)
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
		if (!next) { this.persist(); return; }
		const i = this.indexOf(this.current);
		const start = (i >= 0 ? i : -1) + 1; // shuffle everything strictly after current
		if (start >= this.queue.length - 1) { this.persist(); return; }
		const arr = [...this.queue];
		// Fisher-Yates over [start, arr.length). Use ((Date.now() ^ idx) % range) is not a real
		// CSPRNG — but Math.random() is fine for queue-shuffle UX.
		for (let k = arr.length - 1; k > start; k--) {
			const j = start + Math.floor(Math.random() * (k - start + 1));
			[arr[k], arr[j]] = [arr[j], arr[k]];
		}
		this.queue = arr;
		this.persist();
	}

	/** Toggle the repeat mode (PLAY-10 / D-10): off → one → off (no repeat-all). */
	cycleRepeat() {
		this.repeatMode = this.repeatMode === 'off' ? 'one' : 'off';
		this.persist();
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
			// Every remaining source exhausted for THIS song. Instead of just surfacing the error
			// and stopping (the old behavior), run the never-stop policy (PLAY-07 / D-02, D-04,
			// D-05, D-12): break a failing repeat-one loop, count the failure, then either auto-skip
			// to the next track (below the cap) or trip the loop-guard and STOP with a sticky Retry
			// notice (at the cap). The finally below clears loading for the loop-guard stop; the
			// skip path's next()→play() bumps playGen and owns loading from there.
			this.handleTotalFailure(failed);
		} finally {
			clearInterval(watchdog);
			if (this.playGen === gen) this.loading = false;
		}
	}

	/**
	 * Never-stop total-failure policy (PLAY-07/08 / D-02, D-04, D-05, D-12). Called from
	 * runFallback when EVERY source is exhausted for the current song. NOT called when offline —
	 * the offline gate short-circuits before any failure is counted (D-08), so an offline dry spell
	 * never burns the loop-guard budget.
	 *
	 *  - D-12: a failing repeat-one loop breaks repeat first (never-stop wins over explicit repeat),
	 *    so we don't loop a dead track forever.
	 *  - The failure is counted. At/over the cap (D-04) we STOP: pause, set a sticky loop-guard
	 *    notice carrying a Retry action (recoverFromStop), keep `error` for the inline now-bar, and
	 *    do NOT advance. Below the cap (D-02) we emit a batched skip notice and auto-skip via next().
	 *
	 * The skip path goes through the existing next() → play() which bumps playGen, so a user manual
	 * skip mid-failover supersedes correctly (Pitfall 2) — there is NO parallel fast-skip path.
	 */
	private handleTotalFailure(failed: Track) {
		// D-12: never-stop wins over explicit repeat — break a repeat-one loop on a failing track so
		// it doesn't loop a dead song forever, then continue with the skip/up-next path.
		if (this.repeatMode === 'one') {
			this.repeatMode = 'off';
			this.persist();
		}
		this.consecutiveFailures++;
		// Keep the inline now-bar error string as before (the toast host renders `notice`; the
		// now-bar still reads `error`).
		this.error = 'playback failed (source may be region-locked or expired)';
		if (this.consecutiveFailures >= Player.FAILURE_CAP) {
			// D-04 loop-guard: stop auto-advancing. Pause, clear the OS media UI, surface ONE sticky
			// notice with a Retry action. recoverFromStop skips ahead + resets + re-arms (D-05).
			this.audio?.pause();
			this.clearMedia();
			this.notice = {
				kind: 'stopped',
				reason: 'loop-guard',
				msg: 'player.notice.loopGuard',
				action: () => this.recoverFromStop()
			};
			return;
		}
		// D-02 below the cap: emit a batched skip notice and auto-skip to the next track.
		this.emitSkipNotice(failed.title);
		this.next();
	}

	/**
	 * Recovery from the loop-guard stopped state (D-05). Bound to the sticky notice's Retry action
	 * and reused by a user "tap play" recovery: skip AHEAD to the next track (NOT retry-current, NOT
	 * regenerate), reset the consecutive-failure counter, and re-arm the never-stop chain. next()
	 * bumps playGen via play(), so this correctly supersedes any stale in-flight fallback.
	 */
	private recoverFromStop() {
		this.consecutiveFailures = 0;
		if (this.notice?.kind === 'stopped') this.notice = null;
		this.next();
	}

	/**
	 * Emit a batched auto-skip notice (D-02). N consecutive skips within SKIP_BURST_WINDOW_MS
	 * collapse into ONE notice carrying the running `count` (so the UI shows "{count} songs
	 * skipped" rather than N stacked toasts). Each skip (re)starts the debounce; when it elapses
	 * with no further skip the burst counter resets so the NEXT isolated failure starts at 1.
	 */
	private emitSkipNotice(title: string) {
		this.skipBurst++;
		this.notice = {
			kind: 'skip',
			msg: 'player.notice.skip',
			count: this.skipBurst,
			title
		};
		if (this.skipBurstTimer) clearTimeout(this.skipBurstTimer);
		this.skipBurstTimer = setTimeout(() => {
			this.skipBurst = 0;
			this.skipBurstTimer = null;
		}, Player.SKIP_BURST_WINDOW_MS);
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
		if (!this.audio) return;
		// lw9-followup: stamp the seek time so a sympathetic audio.error fired by the same
		// seek (past-buffered-range on a non-range-capable CDN) doesn't kick off runFallback().
		this.lastSeekAt = Date.now();
		const clamped = Math.max(0, Math.min(1, frac));
		if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
			// Duration is known — apply immediately + clear any pending restore-seek so the
			// loadedmetadata listener doesn't overwrite the user's intent later.
			this.audio.currentTime = clamped * this.audio.duration;
			this.pendingSeek = null;
		} else {
			// Metadata not loaded yet (fresh post-restore audio.src, or just-set src). Park the
			// target on pendingSeek so the loadedmetadata listener applies it the moment
			// duration lands.
			this.pendingSeekFrac = clamped;
		}
		// fab67f8-followup: if audio is paused (typical post-restore state — restore() doesn't
		// auto-play due to browser policy), the audio element hasn't started downloading
		// anything yet; just setting currentTime makes the browser snap back to 0 on the next
		// read because nothing is buffered to seek INTO. Kick off play() so the browser
		// actually fetches the byte range around the seek target. Matches industry behavior
		// (clicking the seek bar implies "play from here"). The user gesture from the click
		// satisfies autoplay restrictions.
		if (this.audio.paused) {
			void this.audio.play().catch(() => {
				/* autoplay rejected (rare on click) — user can tap play */
			});
		}
	}

	expand() {
		if (this.current) this.expanded = true;
	}
	collapse() {
		this.expanded = false;
	}
}

export const player = new Player();
