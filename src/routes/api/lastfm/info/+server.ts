// Last.fm read proxy for metadata enrichment (Phase 8, ENRICH-03).
//
// Dedicated route (NOT the /api/[source]/[...path] catch-all — decision fork 1):
// mirrors the shipped /api/similar exactly. Reads the OPTIONAL LASTFM_KEY from
// platform.env, calls one of track/artist/album.getInfo, and returns a CLEAN,
// placeholder-filtered shape. The key is injected into the upstream URL on the edge
// and NEVER reaches the client (threat T-08-01, parity with JOOX_TOKEN / LASTFM_KEY
// on /api/similar). The key + upstream URL are NEVER logged (V7 / T-08-01).
//
// An ABSENT key is a SUPPORTED state (T-08-02): with no key — or on any upstream
// error / malformed JSON / Last.fm error-6 — we return a 200 all-empty shape so the
// client enrichment service degrades silently and playback is never blocked.
// CORS is scoped to the own origin via corsHeaders (never `*`, T-08-05).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import type { Env } from '$lib/proxy/proxy-types';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';

// Grey-star placeholder hash Last.fm returns when an entity has no real art. A real
// cover must NEVER regress to this (ENRICH-02 / D-04 guardrail 2).
const GREY_STAR_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// Allow-list of read methods this proxy supports (T-08-03). Anything else → empty.
const ALLOWED_METHODS = new Set(['track.getinfo', 'artist.getinfo', 'album.getinfo']);

const MAX_TAGS = 5;

/** Clean client-facing shape. Absent-key / error / miss all return this all-empty. */
export interface LastfmInfo {
	tags: string[];
	bio: string | null;
	bioUrl: string | null;
	image: string | null;
	listeners: number | null;
	playcount: number | null;
}

const EMPTY: LastfmInfo = {
	tags: [],
	bio: null,
	bioUrl: null,
	image: null,
	listeners: null,
	playcount: null
};

function jsonInfo(info: LastfmInfo, origin: string | null): Response {
	return new Response(JSON.stringify(info), {
		status: 200,
		headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
	});
}

// ---- Last.fm response sub-shapes (only the fields we read) ----
interface LfmImage {
	'#text'?: string;
	size?: string;
}
interface LfmTag {
	name?: string;
}
interface LfmTagBlock {
	tag?: LfmTag[] | LfmTag;
}
interface LfmWiki {
	summary?: string;
	content?: string;
}
interface LfmEntity {
	listeners?: string | number;
	playcount?: string | number;
	stats?: { listeners?: string | number; playcount?: string | number };
	toptags?: LfmTagBlock;
	tags?: LfmTagBlock;
	image?: LfmImage[];
	album?: { image?: LfmImage[] };
	bio?: LfmWiki;
	wiki?: LfmWiki;
}

const SIZE_RANK: Record<string, number> = {
	small: 1,
	medium: 2,
	large: 3,
	extralarge: 4,
	mega: 5
};

/** Pick the largest non-placeholder, non-empty image URL, or null. */
function pickImage(images?: LfmImage[]): string | null {
	if (!Array.isArray(images)) return null;
	let best: { url: string; rank: number } | null = null;
	for (const img of images) {
		const url = img?.['#text']?.trim();
		if (!url) continue;
		if (url.includes(GREY_STAR_HASH)) continue; // ENRICH-02: never the placeholder
		const rank = SIZE_RANK[(img.size ?? '').toLowerCase()] ?? 0;
		if (!best || rank >= best.rank) best = { url, rank };
	}
	return best ? best.url : null;
}

/** Top-N tag names from a tag block (handles array or single-object Last.fm shapes). */
function pickTags(block?: LfmTagBlock): string[] {
	if (!block?.tag) return [];
	const arr = Array.isArray(block.tag) ? block.tag : [block.tag];
	const out: string[] = [];
	for (const tg of arr) {
		const name = tg?.name?.trim();
		if (name && !out.includes(name)) out.push(name);
		if (out.length >= MAX_TAGS) break;
	}
	return out;
}

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Take the first ~2-3 sentences of an already-stripped bio string (D-07). */
function firstSentences(text: string, max = 3): string {
	const parts = text.match(/[^.!?。！？]+[.!?。！？]?/g);
	if (!parts) return text;
	return parts
		.slice(0, max)
		.join('')
		.trim();
}

/** Extract bio summary text (HTML-stripped, first sentences) + the attribution URL. */
function pickBio(wiki?: LfmWiki): { bio: string | null; bioUrl: string | null } {
	const raw = wiki?.summary ?? wiki?.content;
	if (!raw) return { bio: null, bioUrl: null };
	// Attribution link: the <a href> inside the summary (Last.fm appends "Read more on Last.fm").
	const hrefMatch = raw.match(/<a\b[^>]*href=["']([^"']+)["']/i);
	const bioUrl = hrefMatch ? hrefMatch[1] : null;
	const stripped = stripHtml(raw);
	const bio = stripped ? firstSentences(stripped) : null;
	return { bio: bio || null, bioUrl };
}

function toNumber(v: string | number | undefined): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : null;
}

/** Reshape one getInfo entity (track/artist/album) into the clean LastfmInfo shape. */
function reshape(entity: LfmEntity): LastfmInfo {
	const { bio, bioUrl } = pickBio(entity.bio ?? entity.wiki);
	// Art: prefer the entity's own image[], else the embedded album image (track.getInfo).
	const image = pickImage(entity.image) ?? pickImage(entity.album?.image);
	const tags = pickTags(entity.toptags ?? entity.tags);
	const listeners = toNumber(entity.listeners ?? entity.stats?.listeners);
	const playcount = toNumber(entity.playcount ?? entity.stats?.playcount);
	return { tags, bio, bioUrl, image, listeners, playcount };
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;

	// No key configured → supported empty state. Do NOT throw, do NOT fetch
	// api_key=undefined upstream (T-08-02).
	if (!key) return jsonInfo(EMPTY, origin);

	const method = (url.searchParams.get('method') ?? '').toLowerCase();
	if (!ALLOWED_METHODS.has(method)) return jsonInfo(EMPTY, origin); // T-08-03 allow-list

	const artist = url.searchParams.get('artist') ?? '';
	const track = url.searchParams.get('track') ?? '';
	const album = url.searchParams.get('album') ?? '';

	// Build the upstream URL — all client params are encodeURIComponent'd passthrough
	// only (T-08-03, no command construction). The key is injected on the edge.
	let upstream =
		`${LASTFM_ENDPOINT}?method=${method}` +
		`&api_key=${encodeURIComponent(key)}` +
		`&format=json&autocorrect=1`;
	if (artist) upstream += `&artist=${encodeURIComponent(artist)}`;
	if (method === 'track.getinfo' && track) upstream += `&track=${encodeURIComponent(track)}`;
	if (method === 'album.getinfo' && album) upstream += `&album=${encodeURIComponent(album)}`;

	try {
		// Bounded retry + native timeout (T-08-04). NEVER log the key or upstream URL.
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as { error?: number; track?: LfmEntity; artist?: LfmEntity; album?: LfmEntity };
		// Last.fm error-6 (not found) and friends → silent empty best-effort.
		if (data?.error) return jsonInfo(EMPTY, origin);
		const entity = data.track ?? data.artist ?? data.album;
		if (!entity) return jsonInfo(EMPTY, origin);
		return jsonInfo(reshape(entity), origin);
	} catch {
		// Upstream error / malformed JSON → best-effort empty.
		return jsonInfo(EMPTY, origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-08-05).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
