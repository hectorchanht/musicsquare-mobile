// cover-backfill — the LAZY, concurrency-capped CN-source cover resolver that fills the
// cover-cache for discovery tiles that have no Last.fm image and no MusicBrainz mbid.
//
// quick-260606-rvy FIX-A. Design contract:
//  - PRIMARY cheap path: reuses the EXISTING CN-source infra (searchAll → dedupeBest),
//    the same resolver resolveStub / picks / similar already use — NO new endpoint, NO
//    rate limit, NO new untrusted input (T-rvy-01). MusicBrainz no-mbid search stays
//    DEFERRED; Last.fm album.getInfo art is a possible lower-priority FUTURE source but
//    is NOT added here.
//  - LAZY (post-paint): callers fire-and-forget this AFTER first render — it never blocks
//    the critical path. A miss leaves the gradient (never a broken image).
//  - CAPPED: at most CAP=3 searches in flight via the existing mapWithConcurrency pool,
//    and a total `max` cap (default 24) so a cold visit does not fan out over all ~72
//    tiles at once (Pitfall 11 / T-rvy-02 self-DoS). Already-cached items are SKIPPED so
//    repeat visits issue zero searches.
//  - CACHED: a non-empty resolved cover is written via setCachedCover; an onResolved
//    callback lets the page bump a reactive counter so each cover appears as it lands.
//  - NEVER throws: per-item failures degrade to null (like resolveStub / mapWithConcurrency).
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { settings } from '$lib/stores/settings.svelte';
import { getCachedCover, setCachedCover, coverCacheKey } from '$lib/services/cover-cache';
import { mapWithConcurrency } from '$lib/services/discovery';

/** A cover-needing row — callers pass DiscoveryTrack rows (artist tiles are excluded). */
export interface CoverNeed {
	artist: string;
	title: string;
}

export interface BackfillOpts {
	/** Abort the remaining resolves (e.g. on unmount / a newer refresh). */
	signal?: AbortSignal;
	/** Called with (cacheKey, url) as each cover lands, so the page can re-render reactively. */
	onResolved?: (key: string, url: string) => void;
	/** Total cap on how many uncached items to resolve this call (default 24). */
	max?: number;
}

const CAP = 3; // ≤3 searches in flight (reuse mapWithConcurrency — do NOT Promise.all all rows)
const DEFAULT_MAX = 24;

/**
 * Lazily resolve + cache real CN-source covers for the given {artist,title} rows.
 *
 * Skips any row already in the cover-cache (never re-searches a cached cover), slices the
 * remaining work to `max`, then resolves it through a concurrency-capped pool. Each non-empty
 * cover is written to the cache and surfaced via `onResolved`. Best-effort: never throws.
 */
export async function backfillCovers(items: CoverNeed[], opts: BackfillOpts = {}): Promise<void> {
	const { signal, onResolved, max = DEFAULT_MAX } = opts;

	// (1) Skip rows that already have a cached cover — repeat visits issue zero searches.
	const seen = new Set<string>();
	const remaining: CoverNeed[] = [];
	for (const it of items) {
		const artist = it.artist ?? '';
		const title = it.title ?? '';
		if (!artist && !title) continue;
		const key = coverCacheKey(artist, title);
		if (seen.has(key)) continue; // de-dupe identical rows across shelves
		seen.add(key);
		if (getCachedCover(artist, title)) continue; // already cached
		remaining.push({ artist, title });
	}

	// (2) Cap the total fan-out for a cold visit.
	const work = remaining.slice(0, Math.max(0, max));
	if (!work.length) return;

	// (3) resolveOne mirrors resolveStub: searchAll → dedupeBest[0].cover; cache + notify.
	async function resolveOne(item: CoverNeed): Promise<void> {
		if (signal?.aborted) return;
		try {
			const r = await searchAll(`${item.artist} ${item.title}`, 1);
			if (signal?.aborted) return;
			const cover = dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
			if (cover) {
				setCachedCover(item.artist, item.title, cover);
				onResolved?.(coverCacheKey(item.artist, item.title), cover);
			}
		} catch {
			// Swallow — a miss leaves the gradient (never a broken image / never blocks).
		}
	}

	await mapWithConcurrency(work, CAP, resolveOne);
}
