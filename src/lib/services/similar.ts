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
import { settings } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/sources/types';

const SIMILAR_ARTIST_COUNT = 8; // how many similar artists to search (top N)
const FALLBACK_LIMIT = 20; // same-artist fallback cap (matches the Related tab)

/**
 * Fetch artists similar to `artist` via the server proxy. Returns the clean name
 * list, or [] on any failure / when no key is configured (the proxy returns
 * { artists: [] } in that case, so the caller transparently falls back).
 */
export async function getSimilarArtists(artist: string): Promise<string[]> {
	try {
		const res = await fetch(
			`/api/similar?artist=${encodeURIComponent(artist)}&limit=${SIMILAR_ARTIST_COUNT}`
		);
		const data = (await res.json()) as { artists?: string[] };
		return data?.artists ?? [];
	} catch {
		return [];
	}
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
