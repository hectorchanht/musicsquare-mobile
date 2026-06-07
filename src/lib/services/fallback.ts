// Cross-source playback fallback (gte / SRC-FB-01). When a track fails to play on its native
// source (no audioUrl, region-block, expired URL, audio `error` event), this helper searches the
// OTHER enabled sources for the same {artist,title}, picks the best deduped candidate, resolves
// its audio URL, and returns it. The player store calls this from play() / the audio error
// listener; on a null return (all sources exhausted) the existing player.error surfaces.
//
// Reuses the same primitives as resolveStub: searchAll → dedupeBest → ensureTrackDetails. The
// source-filtering happens by passing per-call `prefs` to searchAll so each attempt fans out to
// exactly ONE source — keeping the per-source attempts cheap and isolating any source failure.

import { searchAll, ensureTrackDetails } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { getEnabledAdapters } from '$lib/sources/registry';
import type { SourceId, Track } from '$lib/sources/types';

/**
 * Build the ordered list of source ids to try as a fallback, given the source that just failed.
 * Drops the failed source; surfaces `preferred` first when set. Pure — exported for testability.
 */
export function fallbackOrder(failed: SourceId, preferred?: SourceId): SourceId[] {
	const enabled = getEnabledAdapters({}).map((a) => a.id);
	const remaining = enabled.filter((s) => s !== failed);
	if (preferred && remaining.includes(preferred)) {
		return [preferred, ...remaining.filter((s) => s !== preferred)];
	}
	return remaining;
}

/** Per-source prefs object that limits searchAll to a single source id. */
function onlySource(id: SourceId): Partial<Record<SourceId, boolean>> {
	const out: Partial<Record<SourceId, boolean>> = { netease: false, qq: false, kuwo: false, joox: false };
	out[id] = true;
	return out;
}

/**
 * Try to find a playable equivalent of `failed` on another enabled source. Returns the resolved
 * Track (audioUrl truthy) from the first source that yields one, or null when every remaining
 * source has been tried unsuccessfully. Never throws — all per-source failures are swallowed
 * (the failure-to-find IS the fallback's signal).
 *
 * `signal` aborts the in-flight searchAll/ensureTrackDetails when a newer play() supersedes; the
 * caller is responsible for bumping its generation and aborting the controller.
 */
export async function tryFallback(
	failed: Track,
	preferred: SourceId | undefined,
	signal?: AbortSignal
): Promise<Track | null> {
	const query = `${failed.artist} ${failed.title}`.trim();
	if (!query) return null;
	const order = fallbackOrder(failed.source, preferred);
	for (const src of order) {
		if (signal?.aborted) return null;
		try {
			const result = await searchAll(query, 1, onlySource(src), signal);
			if (signal?.aborted) return null;
			const candidates = dedupeBest(result.interleaved, src);
			const stub = candidates[0];
			if (!stub) continue;
			const resolved = await ensureTrackDetails(stub, signal);
			if (signal?.aborted) return null;
			if (resolved.audioUrl) return resolved;
		} catch {
			/* this source dry / threw — move on */
		}
	}
	return null;
}
