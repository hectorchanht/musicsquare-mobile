// Resolve-on-tap shim (Phase 9, D-03) — THE LOAD-BEARING transform.
//
// Discovery items are Last.fm {artist, title} stubs: they have no uid/source/audioUrl,
// so they are NOT Tracks and cannot be handed to player.play() directly the way the
// existing pages hand real Tracks. resolveStub re-searches the stub through the EXISTING
// searchAll + dedupeBest resolver (the same path picks.ts/similar.ts use) and returns
// the best playable Track, or null on a miss.
//
// Strictly LAZY / on-tap (CONTEXT discretion): resolve ONLY the tapped item — one tap →
// one searchAll — never eager-resolve a whole shelf or album (Pitfall 11 fan-out).
// Graceful degrade (D-03): null → caller shows unplayable / skips, never breaks the
// surface or the player. catalog.ts / dedupe.ts are pure reuse — NOT modified here.
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { scoreMatch } from '$lib/services/score-match';
import { settings } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/sources/types';

/**
 * Resolve a Last.fm {artist, title} stub to a playable Track via searchAll + dedupeBest,
 * SCORED (LFSRC-03 / D-02): instead of blindly taking dedupeBest[0] — which can be a
 * karaoke/cover/live/instrumental variant of the song the user tapped — re-rank the
 * deduped candidates by scoreMatch and return the top-scored one. dedupeBest still
 * collapses same-song dupes and orders by quality + preferredSource, so a STABLE max
 * (keeping the earlier dedupeBest position on equal scores) makes that ordering the FINAL
 * tie-break among similarly-scored candidates (D-02 tie-break).
 *
 * Returns the best cross-source match, or null ONLY when searchAll yields zero results /
 * on any failure (D-03 — no score threshold ever nulls a found result). Never throws
 * (best-effort, like buildDiversePicks / buildSimilarQueue).
 */
export async function resolveStub(artist: string, title: string): Promise<Track | null> {
	try {
		const r = await searchAll(`${artist} ${title}`, 1);
		// dedupeBest = the deduped, quality/preferredSource-ordered candidate list (FINAL
		// tie-break). Re-rank IT by scoreMatch with a stable max: only replace the current
		// best on a STRICTLY higher score, so equal scores keep the earlier dedupeBest slot.
		const candidates = dedupeBest(r.interleaved, settings.preferredSource);
		if (candidates.length === 0) return null;
		const query = { artist, title };
		let best = candidates[0];
		let bestScore = scoreMatch(query, best);
		for (let i = 1; i < candidates.length; i++) {
			const s = scoreMatch(query, candidates[i]);
			if (s > bestScore) {
				best = candidates[i];
				bestScore = s;
			}
		}
		return best;
	} catch {
		return null;
	}
}

// ---- Curated discovery sets (Phase 9, D-02 / CONTEXT discretion) ------------------
// Small, EDITABLE defaults consumed by the home tag/country shelves. Keep these short:
// every entry becomes one fanned-out shelf request, so trimming the list directly
// reduces the home page's Last.fm fan-out (Pitfall 11). Edit freely to taste.

/**
 * Curated genre/mood tags for the per-tag home shelves (DISCO-02). Each tag becomes one
 * `tag.getTopTracks` shelf. CN-biased + a few Western/utility moods. Editable.
 */
export const DISCOVERY_TAGS: string[] = [
	'pop',
	'rock',
	'electronic',
	'lo-fi',
	'mandopop',
	'cantopop',
	'jazz',
	'workout'
];

/**
 * Curated countries for the per-country home shelves (DISCO-03). Each becomes one
 * `geo.getTopTracks` shelf. CN-biased (China / Taiwan / Hong Kong) + a few others.
 * IMPORTANT: these are ISO 3166-1 NAMES (e.g. `United States`), NOT codes (e.g. `US`) —
 * the geo builder takes the country name (see getGeoTopTracks / FEATURES.md). Editable.
 */
export const DISCOVERY_COUNTRIES: string[] = [
	'China',
	'Taiwan',
	'Hong Kong',
	'United States',
	'Japan',
	'South Korea'
];

// ---- Randomize variation primitives (VX2) ----------------------------------------
// Two PURE helpers used by the home page's 隨機推薦 / Randomize button to genuinely VARY
// the discovery surface on every press WITHOUT touching the never-throws builders, the
// caching robustness, or the edge security boundary:
//   - shuffle()        varies tile order (within each shelf) AND shelf order.
//   - pickRandomPage() varies WHICH Last.fm chart/tag/geo page is fetched.
// Neither pulls in a dependency and neither adds seeding — they use the same plain
// Math.random Fisher-Yates as picks.ts `sample()` (the established pattern in this repo).

/**
 * Return a NEW array that is a uniformly-shuffled permutation of `arr` (copy-then-
 * Fisher-Yates — identical algorithm to picks.ts `sample()` but keeping the FULL
 * permutation instead of slicing). MUST NOT mutate the input. `[]` → `[]`, `[x]` → `[x]`.
 * Used to reshuffle within-shelf tile order AND the order of the tag/country shelves so
 * Randomize is visibly different even when a fetched page returns overlapping tracks.
 */
export function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * Return a random INTEGER page in `[1, max]` inclusive (Last.fm pages are 1-based).
 * `max <= 1` (or fractional/zero/negative) → always 1. Never 0, never > max, never a
 * fraction. Feeds the optional `page` arg on the discovery builders so Randomize fetches
 * a different chart/tag/geo page each press. SECURITY (T-vx2-01): the result is a BOUNDED
 * positive integer, so the value the client sends to /api/lastfm/discovery?page= is never
 * an attacker-controlled string — the edge already encodeURIComponent's it.
 */
export function pickRandomPage(max: number): number {
	const m = Math.max(1, Math.floor(max) || 1);
	return Math.floor(Math.random() * m) + 1;
}

/**
 * Map `items` through `fn` with at most `limit` calls in flight at once (a small async
 * pool), preserving input order in the returned array (per Pitfall 11 — the home tag +
 * country shelf fan-out MUST be concurrency-capped, NOT an unbounded Promise.all over
 * every shelf). Default cap 4. NEVER throws: a per-item rejection is swallowed and that
 * slot resolves to `undefined` (the caller's `fn` is expected to already degrade to a
 * safe empty value — the discovery builders return `[]` — so a thrown slot is rare).
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const cap = Math.max(1, Math.floor(limit) || 1);
	const results = new Array<R>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		// Each worker pulls the next un-started index until the list is exhausted, so at
		// most `cap` fn() calls are ever in flight; the index → results slot keeps order.
		while (next < items.length) {
			const i = next++;
			try {
				results[i] = await fn(items[i]);
			} catch {
				// Swallow — leave the slot as-is (undefined). Never reject the whole pool.
			}
		}
	}

	const workers = Array.from({ length: Math.min(cap, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}
