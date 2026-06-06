// Aggregation layer (Phase 1, DATA-03 + DATA-04). Ports the monolith's
// `searchAllSources` (legacy/index.html:2216-2263), `getInterleavedSearchList`
// (1691-1707) and `ensureTrackDetails` (2506-2513) — generalized to the registry so
// NO source is ever named here. All DOM/render calls (dom.searchStatus,
// renderMiniSearchList, playFromList) are dropped — those are Phase 4.
import { SOURCES, getEnabledAdapters } from '$lib/sources/registry';
import type { SourceId, Track, SettledSourceResult } from '$lib/sources/types';
import { cached, __clearSearchCache } from './ttl-cache';

// Re-exported so tests (and any future cache-busting caller) can reset the search
// cache between cases — the 3 existing fan-out spy tests rely on this in afterEach.
export { __clearSearchCache };

export interface SearchResult {
	/** Per-source outcome (DATA-03): one failure is isolated, not fatal. */
	perSource: SettledSourceResult[];
	/** Deduped (by colon uid), round-robin-interleaved in registry order. */
	interleaved: Track[];
}

/**
 * D-04 search-result TTL (ms). Search/discovery metadata changes infrequently, so a
 * few minutes of memoization gives instant repeat responses + fewer proxy calls
 * without serving stale data for long. This caches the SearchResult METADATA only —
 * never resolved (short-lived) audio URLs, which stay un-cached in `ensureTrackDetails`.
 */
const SEARCH_TTL_MS = 5 * 60 * 1000;

/**
 * Fan out a search across all enabled sources with per-source isolation, memoized at
 * the catalog seam (D-04). Every search/discovery-resolution path funnels through here
 * (`resolveStub`, `buildDiversePicks`, `buildSimilarQueue`, the search page), so the
 * single TTL wrap covers them all.
 *
 * Cache key = `${normQuery}|${enabledSources}|${page}` — it INCLUDES `page` so each
 * cumulative-superset page caches independently (D-04 Pitfall 3: a page-less key would
 * serve the wrong superset). The raw `keyword` (not the normalized key) is passed to
 * the adapters, so upstream calls are unchanged. Normalization (trim + lowercase) is
 * for the cache key ONLY, so "Jay" and "jay " share an entry. The cached value is the
 * resolved SearchResult; a HIT returns instantly (nothing in flight to abort, so the
 * AbortSignal is moot on a hit; a MISS still honors `signal`).
 */
export async function searchAll(
	keyword: string,
	page = 1,
	prefs: Partial<Record<SourceId, boolean>> = {},
	signal?: AbortSignal
): Promise<SearchResult> {
	const enabledKey = getEnabledAdapters(prefs)
		.map((a) => a.id)
		.join(',');
	const key = `${keyword.trim().toLowerCase()}|${enabledKey}|${page}`;
	return cached(key, SEARCH_TTL_MS, () => searchAllUncached(keyword, page, prefs, signal));
}

/**
 * The actual fan-out (un-memoized). Split out of `searchAll` so the exported function
 * is purely the D-04 cache wrapper.
 *
 * Uses `Promise.allSettled` (NOT `Promise.all`, legacy 2244) so one rejecting
 * adapter yields a typed `status:'error'` entry while the others' results survive
 * (DATA-03 / criterion #1). Results are deduped by canonical colon uid and
 * interleaved round-robin in registry order — no source named (DATA-04).
 */
async function searchAllUncached(
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
