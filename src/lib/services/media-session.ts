// PURE Media Session helpers — NO runes, NO `$state`, NO `$app/environment`.
//
// This module is the node-Vitest-testable core of the Media Session wiring. The
// runes player store (src/lib/stores/player.svelte.ts) merely WRAPS these helpers
// behind its SSR + feature-detection guard, exactly as the history store wraps
// history-logic.ts. The `Track` import below is types-only — erased at runtime,
// so there is zero runtime coupling to the source layer.
//
// The throw-prone, branchy logic (artwork ladder, NaN/range-safe position state,
// playback-state mapping) lives HERE so it can be unit-tested in the node project,
// keeping the runes store a thin caller. `MediaImage`, `MediaPositionState`, and
// `MediaSessionPlaybackState` are DOM lib types (lib.dom.d.ts) — not hand-rolled.
import type { Track } from '$lib/sources/types';

// types-only import keeps the source layer fully decoupled; reference it so the
// import is not flagged as unused while still erasing at runtime.
export type ArtworkSource = Pick<Track, 'cover'>;

/** Standard artwork size ladder the OS media UI picks the best match from. */
const SIZE_LADDER = ['96x96', '128x128', '256x256', '384x384', '512x512'] as const;

/** The only raster-less art the manifest ships (no PNG exists in static/). */
const FALLBACK_ART = '/favicon.svg';

/**
 * Build the `MediaMetadata.artwork` array (MS-01).
 *
 * - Non-empty cover URL → one entry per ladder size (plus `any`), every `src`
 *   equal to the cover URL with an EMPTY `type` (the cover is a remote raster of
 *   unknown MIME — the browser content-sniffs it).
 * - null / empty-string cover → the SVG fallback array pointing at `/favicon.svg`
 *   (`type: 'image/svg+xml'`, `sizes: 'any'`). Graceful degradation on platforms
 *   that don't render SVG media-art is accepted (no binary PNG is authored).
 */
export function buildArtwork(cover: string | null): MediaImage[] {
	if (cover) {
		const ladder: MediaImage[] = SIZE_LADDER.map((sizes) => ({ src: cover, sizes, type: '' }));
		ladder.push({ src: cover, sizes: 'any', type: '' });
		return ladder;
	}
	return [{ src: FALLBACK_ART, sizes: 'any', type: 'image/svg+xml' }];
}

/**
 * Build a `MediaMetadata` for `ms.metadata` WITHOUT assuming the constructor exists
 * (CR-02). In Chromium the `MediaMetadata` constructor is gated behind the SAME
 * MediaSession feature as `navigator.mediaSession`, and the Android System WebView
 * exposes neither — so `new MediaMetadata(...)` throws a `ReferenceError` on the native
 * path, aborting `play()` before `audio.src` is ever set. The native adapter only ever
 * reads `.title/.artist/.album/.artwork` (native-media-session.ts), so a plain structural
 * literal satisfies it. On the web path (where the constructor exists) we keep the real
 * object so the browser's own MediaSession integration is unaffected.
 */
export function makeMetadata(init: MediaMetadataInit): MediaMetadata {
	return typeof MediaMetadata !== 'undefined'
		? new MediaMetadata(init)
		: ({
				title: init.title ?? '',
				artist: init.artist ?? '',
				album: init.album ?? '',
				artwork: init.artwork ?? []
			} as unknown as MediaMetadata);
}

/**
 * Build a guarded `MediaPositionState`, or `null` when no valid state is possible
 * (MS-04, T-kyf-02). `setPositionState` THROWS on a non-finite/≤0 duration or a
 * position outside `[0, duration]`, so this is the single guard that keeps the hot
 * timeupdate path from throwing.
 *
 * - Returns `null` unless `duration` is finite and `> 0`.
 * - Coerces a NaN/negative position to 0 and clamps a too-large position down to
 *   `duration`, so a late timeupdate never produces an out-of-range state.
 */
export function safePositionState(duration: number, position: number): MediaPositionState | null {
	if (!Number.isFinite(duration) || duration <= 0) return null;
	let pos = position;
	if (!Number.isFinite(pos) || pos < 0) pos = 0;
	if (pos > duration) pos = duration;
	return { duration, position: pos, playbackRate: 1 };
}

/**
 * Map the player's (hasTrack, playing) pair to the W3C playback state (MS-02).
 * No current track → `'none'`; otherwise `'playing'` / `'paused'`.
 */
export function playbackStateFor(hasTrack: boolean, playing: boolean): MediaSessionPlaybackState {
	if (!hasTrack) return 'none';
	return playing ? 'playing' : 'paused';
}
