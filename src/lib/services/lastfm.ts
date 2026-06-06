// Client Last.fm enrichment service (Phase 8, ENRICH-01/02). The client-side sibling
// of similar.ts: it fetches the clean, placeholder-filtered shape from the edge
// /api/lastfm/info proxy and reshapes it into an additive EnrichResult that the UI
// merges ONTO (never replacing) the existing per-source Track data.
//
// Invariants:
//  - The LASTFM_KEY stays SERVER-SIDE (T-08-01). This module only ever sees the clean
//    shape — it NEVER references platform / platform.env.
//  - No-key-is-fine: an absent key makes the endpoint return an all-empty shape, so
//    every export here resolves to the all-empty EnrichResult — silent degradation.
//  - Off the playback critical path (ENRICH-01 / Pitfall 8): these calls are
//    `void`-fired by callers AFTER audio starts; they are never awaited before
//    playback and NEVER throw (any failure resolves to the all-empty shape).
//  - The SWAP decision (strictly-larger cover guard) lives in the CONSUMER
//    (NowPlaying), not here. This service only SUPPLIES the placeholder-filtered
//    candidate (`lastfmArt`); it never decides whether to swap.
import type { Track } from '$lib/sources/types';

const MAX_TAGS = 5;

/** Clean additive enrichment shape the UI merges onto a Track. */
export interface EnrichResult {
	tags: string[];
	bio: string | null;
	bioUrl: string | null;
	lastfmArt: string | null;
	/** Album consumers (Plan 03) surface these; undefined for track/artist. */
	listeners?: number | null;
	playcount?: number | null;
}

/** The endpoint's clean response shape (mirrors LastfmInfo in +server.ts). */
interface LastfmInfo {
	tags?: string[];
	bio?: string | null;
	bioUrl?: string | null;
	image?: string | null;
	listeners?: number | null;
	playcount?: number | null;
}

const EMPTY: EnrichResult = { tags: [], bio: null, bioUrl: null, lastfmArt: null };

/** Fetch one getInfo call → clean LastfmInfo. Resolves to {} on ANY failure (never throws). */
async function fetchInfo(params: Record<string, string>): Promise<LastfmInfo> {
	try {
		const qs = new URLSearchParams(params).toString();
		const res = await fetch(`/api/lastfm/info?${qs}`);
		const data = (await res.json()) as LastfmInfo;
		return data ?? {};
	} catch {
		return {};
	}
}

function capTags(tags?: string[]): string[] {
	return Array.isArray(tags) ? tags.slice(0, MAX_TAGS) : [];
}

/**
 * Enrich a Track: tags from track.getInfo, bio+bioUrl from artist.getInfo, and the
 * cover-art candidate from album.getInfo (D-04 guardrail 1 — the most-reliable art
 * source). Issued as parallel best-effort calls (allSettled); a failed sub-call
 * contributes its empty default and never rejects the whole. Always resolves to a
 * clean EnrichResult — NEVER throws.
 *
 * Note: Last.fm `autocorrect=1` may return data for a near-miss artist/track. A
 * drift guard (comparing the returned canonical name against matchKey(track)) is a
 * Phase-13 follow-up — it needs the endpoint to surface the canonical name, which
 * the current clean shape intentionally drops. Enrichment is additive-only, so a
 * drifted result degrades to slightly-off tags/art, never broken playback.
 */
export async function enrichTrack(track: Track): Promise<EnrichResult> {
	try {
		const [trackInfo, artistInfo, albumInfo] = await Promise.allSettled([
			fetchInfo({ method: 'track.getinfo', artist: track.artist, track: track.title }),
			fetchInfo({ method: 'artist.getinfo', artist: track.artist }),
			track.album
				? fetchInfo({ method: 'album.getinfo', album: track.album, artist: track.artist })
				: Promise.resolve<LastfmInfo>({})
		]);

		const tInfo = trackInfo.status === 'fulfilled' ? trackInfo.value : {};
		const aInfo = artistInfo.status === 'fulfilled' ? artistInfo.value : {};
		const albInfo = albumInfo.status === 'fulfilled' ? albumInfo.value : {};

		// Tags: prefer the track's top tags, fall back to artist tags.
		const tags = capTags(tInfo.tags?.length ? tInfo.tags : aInfo.tags);
		// Cover candidate: album.getInfo art ONLY (most reliable; D-04 guardrail 1).
		const lastfmArt = albInfo.image ?? null;

		return {
			tags,
			bio: aInfo.bio ?? null,
			bioUrl: aInfo.bioUrl ?? null,
			lastfmArt
		};
	} catch {
		return { ...EMPTY };
	}
}

/**
 * Build an EnrichResult from a clean LastfmInfo. `listeners`/`playcount` are included
 * ONLY when present so a miss/absent-key result deep-equals the bare all-empty shape.
 */
function toResult(info: LastfmInfo): EnrichResult {
	const out: EnrichResult = {
		tags: capTags(info.tags),
		bio: info.bio ?? null,
		bioUrl: info.bioUrl ?? null,
		lastfmArt: info.image ?? null
	};
	if (info.listeners != null) out.listeners = info.listeners;
	if (info.playcount != null) out.playcount = info.playcount;
	return out;
}

/** Enrich an artist (Plan 02): bio+bioUrl+tags + image surfaced as lastfmArt (hero candidate). */
export async function enrichArtist(name: string): Promise<EnrichResult> {
	try {
		return toResult(await fetchInfo({ method: 'artist.getinfo', artist: name }));
	} catch {
		return { ...EMPTY };
	}
}

/** Enrich an album (Plan 03): lastfmArt + tags + listeners/playcount via the clean shape. */
export async function enrichAlbum(album: string, artist: string): Promise<EnrichResult> {
	try {
		return toResult(await fetchInfo({ method: 'album.getinfo', album, artist }));
	} catch {
		return { ...EMPTY };
	}
}
