// score-context — the PURE per-result-set summary scoreMatch reads for set-relative boosts
// (Phase 21, SRCH-01 / D-05 / D-06).
//
// A single candidate's score (score-match.ts) cannot know how the WHOLE result set looks:
// whether the candidate's artist shows up under several DISTINCT sources (a strong "this is
// the real artist" signal) and how long the user's query was (for the short-title proximity
// boost). computeSetContext folds the set once into a cheap summary that scoreMatch consults
// per candidate — so the O(set) work happens ONCE, not per candidate per signal.
//
// artistSources is keyed ARTIST-ONLY via `matchKey(artist, '')` (mirroring cover-cache's
// artistCoverCacheKey) so two different titles by the same artist collapse to one entry, and
// its value is the SET of distinct SourceIds — D-05 rewards cross-source PRESENCE, never raw
// row count (5 rows from one source is still size 1).
//
// PURE + import-light (only matchKey + the SourceId/Track types): no $state, no $app/*, no I/O.
// node-Vitest-testable exactly like score-match.ts / match-key.ts.
import { matchKey } from '$lib/services/match-key';
import type { SourceId, Track } from '$lib/sources/types';

export interface SetContext {
	/** matchKey(artist,'') → the set of DISTINCT sources that artist appears under (D-05). */
	artistSources: Map<string, Set<SourceId>>;
	/** Trimmed length of the user's query string (D-06 short-title proximity). */
	queryLen: number;
}

/**
 * Fold a result set + query into the cheap summary scoreMatch reads for set-relative boosts.
 * Pure: no I/O, no mutation of inputs. Deterministic.
 */
export function computeSetContext(rows: Track[], query: string): SetContext {
	const artistSources = new Map<string, Set<SourceId>>();
	for (const r of rows) {
		const key = matchKey(r.artist, ''); // artist-only key (D-05): titles must not split it
		let set = artistSources.get(key);
		if (!set) {
			set = new Set<SourceId>();
			artistSources.set(key, set);
		}
		set.add(r.source); // Set de-dupes: 5 rows from one source stays size 1 (rows != sources)
	}
	return { artistSources, queryLen: (query || '').trim().length };
}
