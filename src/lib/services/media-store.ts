// Public Music/ MediaStore bridge (999.1-06, D-11) -------------------------------------------
//
// TS wrapper around the HAND-WRITTEN local Capacitor plugin `MediaStoreSaver`
// (android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt — NO npm/git dependency,
// T-999.1-07 mitigation). The plugin writes downloaded audio into the public `Music/OpenMusic/`
// collection via MediaStore.Audio.Media (API 29+ RELATIVE_PATH + IS_PENDING; API <=28 legacy
// DIRECTORY_MUSIC) so a downloaded song is visible to file managers and other audio apps.
//
// blob-store.ts native put() calls saveToMusic() to land the file in public Music/ and records the
// returned content URI; del() calls deleteFromMusic({ uri }) to remove the entry the app created.
// blob-store maps any reject/throw here to its never-throws sentinel (put -> false / del -> void),
// so a failed public-Music write degrades to CDN playback and never crashes the player (T-999.1-19).

import { registerPlugin } from '@capacitor/core';

export interface MediaStoreSaverPlugin {
	/**
	 * Insert `base64`-decoded audio bytes into the public `Music/OpenMusic/` collection under
	 * `fileName`. Resolves the content URI of the created entry; rejects on any MediaStore failure.
	 */
	saveToMusic(opts: { fileName: string; base64: string }): Promise<{ uri: string }>;
	/**
	 * Delete the MediaStore entry previously created by `saveToMusic` (the `uri` it returned).
	 * Resolves even when the entry is already absent (the plugin swallows not-found).
	 */
	deleteFromMusic(opts: { uri: string }): Promise<void>;
}

export const MediaStoreSaver = registerPlugin<MediaStoreSaverPlugin>('MediaStoreSaver');
