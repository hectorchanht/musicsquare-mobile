// cover-backfill — the LAZY, concurrency-capped cover resolver that fills the cover-cache
// for discovery tiles that have no Last.fm image and no MusicBrainz mbid.
//
// quick-260606-rvy FIX-A + quick-260606-v7k. Design contract:
//  - PRIMARY cheap path (track): the EXISTING CN-source infra (searchAll → dedupeBest),
//    the same resolver resolveStub / picks / similar already use — NO new endpoint, NO
//    rate limit (T-rvy-01).
//  - FALLBACK (track, quick-260606-v7k): when the CN cover MISSES (null/empty — common for
//    the Western Last.fm-chart catalog), fall back to itunesSongCover — a no-auth, CORS-open
//    iTunes Search lookup (no key, no env var, T-v7k-01). CAA-by-mbid stays a tileCover-level
//    step (an <img> 404 → gradient), NOT a backfill step.
//  - ARTIST pass (quick-260606-v7k): backfillArtistCovers resolves 熱門歌手 tile images via
//    itunesArtistCover and caches them under the ARTIST-only key (never collides with a track).
//  - LAZY (post-paint): callers fire-and-forget this AFTER first render — it never blocks
//    the critical path. A miss leaves the gradient (never a broken image).
//  - CAPPED: at most CAP=3 resolves in flight via the existing mapWithConcurrency pool, and a
//    total `max` cap (24 tracks / 12 artists) so a cold visit does not fan out over every tile
//    at once; the iTunes fallback rides the SAME pool + the per-call AbortSignal.timeout inside
//    itunes-cover (Pitfall 11 / T-v7k-02 self-DoS). Already-cached items are SKIPPED so repeat
//    visits issue zero requests.
//  - CACHED: a non-empty resolved cover is written via setCachedCover / setCachedArtistCover; an
//    onResolved callback lets the page bump a reactive counter so each cover appears as it lands.
//  - NEVER throws: per-item failures degrade to null (like resolveStub / mapWithConcurrency).
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { settings } from '$lib/stores/settings.svelte';
import {
	getCachedCover,
	setCachedCover,
	coverCacheKey,
	getCachedArtistCover,
	setCachedArtistCover,
	artistCoverCacheKey
} from '$lib/services/cover-cache';
import { mapWithConcurrency } from '$lib/services/discovery';
import { itunesSongCover, itunesArtistCover } from '$lib/services/itunes-cover';

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

	// (3) resolveOne: CN-first (searchAll → dedupeBest[0].cover), then iTunes-fallback on a
	//     CN miss (quick-260606-v7k); cache + notify whichever resolves.
	async function resolveOne(item: CoverNeed): Promise<void> {
		if (signal?.aborted) return;
		try {
			const r = await searchAll(`${item.artist} ${item.title}`, 1);
			if (signal?.aborted) return;
			let cover = dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
			// FALLBACK: CN missed (Western catalog gap) → no-auth iTunes Search lookup.
			if (!cover) {
				cover = await itunesSongCover(item.artist, item.title, signal);
				if (signal?.aborted) return;
			}
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

/**
 * Lazily resolve + cache real ARTIST cover images for the given names (quick-260606-v7k).
 *
 * 熱門歌手 tiles never had a cover source (Last.fm artist art is deprecated → null). This
 * mirrors backfillCovers but resolves via the no-auth itunesArtistCover and stores under the
 * ARTIST-only key: de-dupes names, skips already-cached artists, slices to `max`, then runs
 * the resolves through the same CAP=3 pool. Each non-empty image is cached + surfaced via
 * onResolved (keyed by artistCoverCacheKey). Best-effort: never throws; a miss → gradient.
 */
export async function backfillArtistCovers(
	names: string[],
	opts: BackfillOpts = {}
): Promise<void> {
	const { signal, onResolved, max = DEFAULT_MAX } = opts;

	// (1) De-dupe + skip already-cached artists (warm visit issues zero requests).
	const seen = new Set<string>();
	const remaining: string[] = [];
	for (const raw of names) {
		const name = (raw ?? '').trim();
		if (!name) continue;
		const key = artistCoverCacheKey(name);
		if (seen.has(key)) continue;
		seen.add(key);
		if (getCachedArtistCover(name)) continue;
		remaining.push(name);
	}

	// (2) Cap the total fan-out for a cold visit.
	const work = remaining.slice(0, Math.max(0, max));
	if (!work.length) return;

	// (3) resolveOneArtist: itunesArtistCover → cache + notify under the artist key.
	async function resolveOneArtist(name: string): Promise<void> {
		if (signal?.aborted) return;
		try {
			const url = await itunesArtistCover(name, signal);
			if (signal?.aborted) return;
			if (url) {
				setCachedArtistCover(name, url);
				onResolved?.(artistCoverCacheKey(name), url);
			}
		} catch {
			// Swallow — a miss leaves the artist tile's gradient.
		}
	}

	await mapWithConcurrency(work, CAP, resolveOneArtist);
}
