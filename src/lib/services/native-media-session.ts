// Native (Capacitor/Android WebView) Media Session adapter — D-04/D-05.
//
// The Android System WebView has NO `navigator.mediaSession`, so the player store's
// existing Web Media Session wiring is a silent no-op on Android: no system media
// notification, no lock-screen transport, and (without an FGS) the OS suspends the
// backgrounded WebView audio within minutes. This adapter bridges the EXACT subset of
// the Web `MediaSession` surface the player calls onto the `@jofr/capacitor-media-session`
// plugin (v4.0.0 — its API is intentionally Web-MediaSession-API-shaped, so the bridge
// is thin; the Cap-8 build compatibility was confirmed by the Plan-04 Task-1 spike).
//
// CRITICAL (RESEARCH Pattern 5 / Pitfall 1): on native the plugin CANNOT detect WebView
// `<audio>` playback automatically — the notification only appears once playbackState is
// explicitly set to 'playing' AND action handlers are registered. The player store already
// does both (it sets `playbackState = 'playing'` on every metadata write and registers all
// transport handlers once in attach()); this adapter just forwards those same calls to the
// plugin so they take effect natively. The pure helpers in media-session.ts (buildArtwork,
// safePositionState, playbackStateFor) are unchanged and still produce the values fed here.
//
// All plugin methods return Promises; the Web surface the player uses is synchronous
// (`ms.metadata = …`, `ms.playbackState = …`, `ms.setPositionState(st)`,
// `ms.setActionHandler(action, cb)`). The adapter therefore fire-and-forgets each plugin
// call (best-effort, never throws) to preserve the player's synchronous, never-block posture
// — a failed native UI update degrades to "no notification update", never a crashed player.
import { MediaSession } from '@jofr/capacitor-media-session';

/**
 * The minimal structural slice of the Web `MediaSession` interface the player store
 * actually calls. Both `navigator.mediaSession` (web) and the native adapter satisfy it,
 * so the `ms` accessor can return either behind a `Capacitor.isNativePlatform()` branch
 * without the player code changing at any call site.
 */
export interface PlayerMediaSession {
	metadata: MediaMetadata | null;
	playbackState: MediaSessionPlaybackState;
	setPositionState(state?: MediaPositionState): void;
	setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
}

/** Swallow any rejection from a fire-and-forget plugin call (never crash the player). */
function fire(p: Promise<unknown>): void {
	void p.catch(() => {});
}

/**
 * Build the native adapter. Returned by the player's `ms` accessor when
 * `Capacitor.isNativePlatform()` is true. The `metadata`/`playbackState` SETTERS forward
 * to the plugin; the getters return the last value written so the player's read-after-write
 * idioms still observe consistent state. `null` metadata / 'none' state clear the native UI.
 */
export function createNativeMediaSession(): PlayerMediaSession {
	let lastMetadata: MediaMetadata | null = null;
	let lastState: MediaSessionPlaybackState = 'none';

	return {
		get metadata() {
			return lastMetadata;
		},
		set metadata(value: MediaMetadata | null) {
			lastMetadata = value;
			if (value) {
				// Forward a FRESH metadata snapshot (the player always assigns a brand-new
				// MediaMetadata so the lock screen repaints — Pitfall 4 — and we mirror that here).
				fire(
					MediaSession.setMetadata({
						title: value.title,
						artist: value.artist,
						album: value.album,
						// MediaImage[] is the exact shape buildArtwork() produces and the plugin accepts.
						artwork: Array.from(value.artwork ?? [])
					})
				);
			}
			// No native "clear metadata" call exists; clearing state to 'none' (below, via the
			// player's clearMedia()) removes the notification. Leaving lastMetadata null is enough.
		},
		get playbackState() {
			return lastState;
		},
		set playbackState(value: MediaSessionPlaybackState) {
			lastState = value;
			// Explicit setPlaybackState — REQUIRED on native or the notification never appears.
			fire(MediaSession.setPlaybackState({ playbackState: value }));
		},
		setPositionState(state?: MediaPositionState) {
			// Web semantics: setPositionState() with no arg clears the position. The plugin has no
			// dedicated clear, so an undefined state forwards a zeroed position (best-effort).
			fire(
				MediaSession.setPositionState({
					duration: state?.duration ?? 0,
					position: state?.position ?? 0,
					playbackRate: state?.playbackRate ?? 1
				})
			);
		},
		setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
			// The plugin's ActionDetails carries { action, seekTime? } — a structural superset of the
			// fields the player's seek handlers read (details.seekTime / details.seekOffset). Forward
			// it as-is; the player's handlers already guard every field as untrusted (finite checks).
			fire(
				MediaSession.setActionHandler(
					{ action },
					handler
						? (details) => handler(details as unknown as MediaSessionActionDetails)
						: null
				)
			);
		}
	};
}
