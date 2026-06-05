// Aggregation layer (Phase 1, DATA-03 + DATA-04). Ports the monolith's
// `searchAllSources` (legacy/index.html:2216-2263), `getInterleavedSearchList`
// (1691-1707) and `ensureTrackDetails` (2506-2513) — generalized to the registry so
// NO source is ever named here. All DOM/render calls (dom.searchStatus,
// renderMiniSearchList, playFromList) are dropped — those are Phase 4.
import { SOURCES, getEnabledAdapters } from '$lib/sources/registry';
import type { SourceId, Track, SettledSourceResult } from '$lib/sources/types';

export interface SearchResult {
	/** Per-source outcome (DATA-03): one failure is isolated, not fatal. */
	perSource: SettledSourceResult[];
	/** Deduped (by colon uid), round-robin-interleaved in registry order. */
	interleaved: Track[];
}

/**
 * Fan out a search across all enabled sources with per-source isolation.
 *
 * Uses `Promise.allSettled` (NOT `Promise.all`, legacy 2244) so one rejecting
 * adapter yields a typed `status:'error'` entry while the others' results survive
 * (DATA-03 / criterion #1). Results are deduped by canonical colon uid and
 * interleaved round-robin in registry order — no source named (DATA-04).
 */
export async function searchAll(
	keyword: string,
	page = 1,
	prefs: Partial<Record<SourceId, boolean>> = {},
	signal?: AbortSignal
): Promise<SearchResult> {
	const adapters = getEnabledAdapters(prefs);
	const sig = signal ?? new AbortController().signal;

	const settled = await Promise.allSettled(adapters.map((a) => a.search(keyword, page, sig)));

	const perSource: SettledSourceResult[] = adapters.map((adapter, i) => {
		const outcome = settled[i];
		if (outcome.status === 'fulfilled') {
			return { source: adapter.id, status: 'ok', tracks: outcome.value };
		}
		const reason = outcome.reason;
		return {
			source: adapter.id,
			status: 'error',
			tracks: [],
			error: reason instanceof Error ? reason.message : String(reason)
		};
	});

	return { perSource, interleaved: interleave(perSource) };
}

/**
 * Round-robin merge in registry order with uid dedupe. Generalized from the
 * monolith's hard-coded `order = ['netease','qq','kuwo','joox']` (legacy 1691) to
 * `Object.keys(SOURCES)` so a new source needs no edit here (DATA-04).
 */
function interleave(perSource: SettledSourceResult[]): Track[] {
	const order = Object.keys(SOURCES) as SourceId[];
	const queues = new Map<SourceId, Track[]>();
	for (const r of perSource) queues.set(r.source, [...r.tracks]);

	const seen = new Map<string, Track>(); // dedupe by colon uid (legacy trackMap, 1657)
	const out: Track[] = [];
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const sid of order) {
			const queue = queues.get(sid);
			if (!queue || queue.length === 0) continue;
			const track = queue.shift() as Track;
			progressed = true;
			if (seen.has(track.uid)) continue;
			seen.set(track.uid, track);
			out.push(track);
		}
	}
	return out;
}

/**
 * Lazily resolve a track's audioUrl + lyrics through its source adapter.
 *
 * Dispatches via `SOURCES[track.source]` (registry, no source named — DATA-04) and
 * preserves the monolith readiness guard VERBATIM (legacy 2507): a track that is
 * loaded, has an audioUrl, and either has lyrics or never had an `lrcUrl` is
 * already complete. Netease resolves `lrc` from a separate `lrcUrl`, so a track
 * with an unresolved `lrcUrl` still re-resolves.
 */
export async function ensureTrackDetails(track: Track, signal?: AbortSignal): Promise<Track> {
	if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) {
		return track;
	}
	const sig = signal ?? new AbortController().signal;
	return SOURCES[track.source].resolve(track, sig);
}
