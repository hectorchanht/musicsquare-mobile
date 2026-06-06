// Resolve-on-tap shim (Phase 9, D-03) — THE LOAD-BEARING transform.
//
// Discovery items are Last.fm {artist, title} stubs: they have no uid/source/audioUrl,
// so they are NOT Tracks and cannot be handed to player.play() directly the way the
// existing pages hand real Tracks. resolveStub re-searches the stub through the EXISTING
// searchAll + dedupeBest resolver (the same path picks.ts/similar.ts use) and returns
// the best playable Track, or null on a miss.
//
// Strictly LAZY / on-tap (CONTEXT discretion): resolve ONLY the tapped item — one tap →
// one searchAll — never eager-resolve a whole shelf or album (Pitfall 11 fan-out).
// Graceful degrade (D-03): null → caller shows unplayable / skips, never breaks the
// surface or the player. catalog.ts / dedupe.ts are pure reuse — NOT modified here.
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { settings } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/sources/types';

/**
 * Resolve a Last.fm {artist, title} stub to a playable Track via searchAll + dedupeBest.
 * Returns the best cross-source hit, or null when nothing matches / on any failure.
 * Never throws (best-effort, like buildDiversePicks / buildSimilarQueue).
 */
export async function resolveStub(artist: string, title: string): Promise<Track | null> {
	try {
		const r = await searchAll(`${artist} ${title}`, 1);
		return dedupeBest(r.interleaved, settings.preferredSource)[0] ?? null;
	} catch {
		return null;
	}
}
