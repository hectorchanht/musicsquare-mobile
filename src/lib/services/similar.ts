// Similar-vibe queue builder (quick-260606-5ug). The similar-seeded sibling of
// buildDiversePicks (picks.ts): instead of random artists, it seeds from Last.fm
// artist.getSimilar for the current track's artist, searches each similar artist's
// top track, cross-source-dedupes, and excludes the seed + already-queued uids.
//
// Graceful fallback (REQUIRED, T-5ug-03): when /api/similar returns no artists — no
// LASTFM_KEY configured, or Last.fm dry/errored — fall back to same-artist search
// (the Related-tab behavior). The feature works end-to-end with NO key, just with
// less variety. The Last.fm key stays server-side; this client module only ever sees
// the clean { artists: string[] } list (threat T-5ug-01).
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { deezerRelatedArtists } from '$lib/services/deezer';
import { settings } from '$lib/stores/settings.svelte';
import { cached } from '$lib/services/ttl-cache';
import { apiFetch } from '$lib/services/api-base';
import type { Track } from '$lib/sources/types';

const SIMILAR_ARTIST_COUNT = 8; // how many similar artists to search (top N)
const FALLBACK_LIMIT = 20; // same-artist fallback cap (matches the Related tab)
const TTL_SIMILAR = 6 * 60 * 60 * 1000; // 6h (lry-followup: similar-artist sets are stable)

/**
 * Fetch artists similar to `artist`. Last.fm primary; on empty (no LASTFM_KEY, or Last.fm
 * dry/errored) fall through to Deezer's `artist/{id}/related` via /api/deezer/related
 * (quick-260607-jau — gives the no-key state a genuinely useful path). On both miss the
 * caller falls back to same-artist (today). Returns the clean name list (never throws).
 */
export async function getSimilarArtists(artist: string): Promise<string[]> {
	const clean = (artist ?? '').trim();
	if (!clean) return [];
	return cached(`lf:similar:${clean}|${SIMILAR_ARTIST_COUNT}`, TTL_SIMILAR, async () => {
		try {
			const res = await apiFetch(
				`/api/similar?artist=${encodeURIComponent(clean)}&limit=${SIMILAR_ARTIST_COUNT}`
			);
			const data = (await res.json()) as { artists?: string[] };
			if (data?.artists?.length) return data.artists;
		} catch {
			/* fall through to Deezer */
		}
		// jau: Deezer is the metadata-only fallback. Same shape, no secret.
		return deezerRelatedArtists(clean, SIMILAR_ARTIST_COUNT);
	});
}

/**
 * Build the auto portion of Up-Next from songs similar in vibe/genre to `track`.
 *
 * Last.fm path: get similar artists → search each artist's top track in parallel →
 * dedupeBest → drop the seed track + any excludeUids.
 * Fallback path: when no similar artists are returned, same-artist search of
 * `track.artist` → dedupeBest → drop seed + excludeUids → cap at FALLBACK_LIMIT.
 *
 * Best-effort, like buildDiversePicks: artists that error or return nothing are
 * silently skipped.
 */
export async function buildSimilarQueue(
	track: Track,
	excludeUids: Set<string> = new Set()
): Promise<Track[]> {
	const keep = (t: Track) => t.uid !== track.uid && !excludeUids.has(t.uid);

	const names = await getSimilarArtists(track.artist);

	if (names.length) {
		const results = await Promise.allSettled(
			names.slice(0, SIMILAR_ARTIST_COUNT).map((n) => searchAll(n, 1))
		);
		const tops: Track[] = [];
		for (const r of results) {
			if (r.status !== 'fulfilled') continue;
			const top = r.value.interleaved[0];
			if (top) tops.push(top);
		}
		return dedupeBest(tops, settings.preferredSource).filter(keep);
	}

	// Fallback: same-artist similarity (Related-tab behavior).
	try {
		const r = await searchAll(track.artist, 1);
		return dedupeBest(r.interleaved, settings.preferredSource).filter(keep).slice(0, FALLBACK_LIMIT);
	} catch {
		return [];
	}
}
