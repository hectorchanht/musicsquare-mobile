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
	/** Ordered album tracklist — present ONLY for album.getinfo (Phase 9, D-05). */
	tracks?: { artist: string; title: string }[];
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

// ---- Discovery list builders (Phase 9, D-02) -------------------------------------
// The list-shaped sibling of enrich*: each hits /api/lastfm/discovery (the dedicated
// LIST proxy) and returns the already-cleaned, placeholder-filtered list — or [] on ANY
// failure / absent-key empty shape (never throws). The LASTFM_KEY stays server-side;
// these only ever see the clean { items } shape. The image-array → URL pick lives ON
// THE EDGE (pickImage in +server.ts); the builder just consumes image: string | null.
// Concurrency capping when the home page fans out many shelves lives in the Plan-02
// builder, not here (Pitfall 11).

/** A chart/tag/geo top-track item (already cleaned on the edge). */
export interface DiscoveryTrack {
	artist: string;
	title: string;
	image: string | null;
}
/** A top-artist item. */
export interface DiscoveryArtist {
	name: string;
	image: string | null;
}
/** An artist top-album item. */
export interface DiscoveryAlbum {
	name: string;
	image: string | null;
}

/** The discovery endpoint's clean response shape. */
interface LastfmList<T> {
	items?: T[];
}

/**
 * Fetch one discovery list call → { items }. Resolves to { items: [] } on ANY failure
 * (never throws) — mirrors fetchInfo's posture against /api/lastfm/discovery.
 */
async function fetchList<T>(params: Record<string, string>): Promise<LastfmList<T>> {
	try {
		const qs = new URLSearchParams(params).toString();
		const res = await fetch(`/api/lastfm/discovery?${qs}`);
		const data = (await res.json()) as LastfmList<T>;
		return data ?? { items: [] };
	} catch {
		return { items: [] };
	}
}

/** Global trending songs (DISCO-01 — Top hits shelf). */
export async function getChartTopTracks(limit = 30): Promise<DiscoveryTrack[]> {
	const data = await fetchList<DiscoveryTrack>({
		method: 'chart.gettoptracks',
		limit: String(limit)
	});
	return data.items ?? [];
}

/** Global top artists (DISCO-01 — Top artists shelf; tap → /artist/[name]). */
export async function getChartTopArtists(limit = 30): Promise<DiscoveryArtist[]> {
	const data = await fetchList<DiscoveryArtist>({
		method: 'chart.gettopartists',
		limit: String(limit)
	});
	return data.items ?? [];
}

/** Top tracks for a genre/mood tag (DISCO-02 — per-tag shelf). */
export async function getTagTopTracks(tag: string, limit = 30): Promise<DiscoveryTrack[]> {
	const data = await fetchList<DiscoveryTrack>({
		method: 'tag.gettoptracks',
		tag,
		limit: String(limit)
	});
	return data.items ?? [];
}

/**
 * Top tracks for a country (DISCO-03 — per-country shelf). NOTE: `country` is the
 * ISO 3166-1 NAME (e.g. `United States`), NOT the code (e.g. `US`) — per FEATURES.md.
 */
export async function getGeoTopTracks(country: string, limit = 30): Promise<DiscoveryTrack[]> {
	const data = await fetchList<DiscoveryTrack>({
		method: 'geo.gettoptracks',
		country,
		limit: String(limit)
	});
	return data.items ?? [];
}

/** An artist's top albums (D-04 — real artist-page album list). */
export async function getArtistTopAlbums(artist: string, limit = 30): Promise<DiscoveryAlbum[]> {
	const data = await fetchList<DiscoveryAlbum>({
		method: 'artist.gettopalbums',
		artist,
		limit: String(limit)
	});
	return data.items ?? [];
}

/**
 * An album's ordered tracklist (D-05 — real album-page tracklist). Unlike the other
 * builders this consumes the Task-2 /api/lastfm/info album.getinfo `tracks` field, not
 * the discovery list endpoint. Returns [] on any failure / absent-key miss.
 */
export async function getAlbumTracklist(
	album: string,
	artist: string
): Promise<{ artist: string; title: string }[]> {
	const info = await fetchInfo({ method: 'album.getinfo', album, artist });
	return info.tracks ?? [];
}
