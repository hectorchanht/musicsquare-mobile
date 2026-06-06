// score-match — the PURE best-match re-ranking term for resolveStub (Phase 10, LFSRC-03 / D-02).
//
// resolveStub re-searches a Last.fm {artist, title} stub through searchAll + dedupeBest.
// dedupeBest collapses same-song dupes and orders by quality + preferredSource, but its
// FIRST element can still be a karaoke / cover / live / instrumental variant of the song
// the user actually tapped (Pitfall 7 wrong-song resolution). scoreMatch re-ranks the
// candidates so a CLEAN title outranks a variant of the same song, while a candidate whose
// normalized artist+title (via matchKey) matches the query closely outranks a loose one.
//
// PURE + import-light (only matchKey + the Track type): no $state, no $app/*, no I/O,
// no source/quality/preferredSource logic (that is dedupeBest's job — Task 2 keeps it as
// the final tie-break). node-Vitest-testable like match-key.ts / dedupe.ts.
//
// Score = similarity(query, candidate) − variantPenalty(query, candidate). Higher = better.
// It NEVER returns null/NaN and NEVER applies a threshold (D-03 — scoring only re-orders).
import { matchKey } from '$lib/services/match-key';
import type { Track } from '$lib/sources/types';

/**
 * Variant-keyword list (D-02a) — English + common CJK variant terms. A candidate whose
 * TITLE contains one of these is down-ranked UNLESS the query asked for that variant.
 * Lowercased; the scanner lowercases both candidate title and query before matching, so
 * mixed-case upstream titles (e.g. "Karaoke", "卡拉OK") are caught. EDITABLE — tune freely.
 */
export const VARIANT_KEYWORDS: string[] = [
	// English
	'cover',
	'karaoke',
	'live',
	'instrumental',
	'remix',
	'sped up',
	'slowed',
	'8d',
	'tribute',
	're-recorded',
	'rerecorded',
	'acoustic',
	'demo',
	'reprise',
	// CJK (simplified + traditional)
	'翻唱',
	'卡拉ok',
	'现场',
	'現場',
	'伴奏',
	'纯音乐',
	'純音樂',
	'live版',
	'现场版',
	'現場版',
	'重制',
	'重製',
	'remix版'
];

// --- Tuning weights (named consts so the balance is explicit + editable) ---------------
// SIM_* feed the similarity reward; VARIANT_WEIGHT is subtracted per offending keyword.
// Kept so the similarity term out-weighs a single variant hit when the variant is clearly
// the intended song, but a CLEAN exact match always beats a variant of the same key.
const SIM_EXACT = 10; // candidate matchKey === query matchKey
const SIM_ARTIST = 3; // artist component matches
const SIM_TITLE = 3; // title component matches
const SIM_TOKEN = 2; // graded latin-token overlap (max contribution)
const VARIANT_WEIGHT = 4; // subtracted per un-asked-for variant keyword

/** Split a matchKey component into latin word tokens for graded partial overlap. */
function tokens(component: string): string[] {
	return component.split(/[^\p{L}\p{N}]+/u).filter((s) => s.length > 0);
}

/**
 * Graded similarity (D-02b): reuse matchKey (artist-first normalization) for both the
 * query and the candidate. Exact key match = max reward; else credit per-component
 * (artist / title) equality plus a small token-overlap term so a near-match beats an
 * unrelated one. Deterministic, never negative.
 */
function similarity(query: { artist: string; title: string }, candidate: Track): number {
	const qKey = matchKey(query.artist, query.title);
	const cKey = matchKey(candidate.artist, candidate.title);
	if (qKey === cKey) return SIM_EXACT;

	const [qArtist, qTitle] = qKey.split('|');
	const [cArtist, cTitle] = cKey.split('|');

	let score = 0;
	if (qArtist && qArtist === cArtist) score += SIM_ARTIST;
	if (qTitle && qTitle === cTitle) score += SIM_TITLE;

	// Token overlap (latin words only; CJK components have no internal spaces so they fall
	// through the per-component equality above). Graded 0..SIM_TOKEN by overlap fraction.
	const qToks = new Set([...tokens(qArtist), ...tokens(qTitle)]);
	const cToks = new Set([...tokens(cArtist), ...tokens(cTitle)]);
	if (qToks.size > 0) {
		let hit = 0;
		for (const tk of qToks) if (cToks.has(tk)) hit++;
		score += SIM_TOKEN * (hit / qToks.size);
	}
	return score;
}

/**
 * Variant penalty (D-02a): scan the candidate TITLE (lowercased) for any VARIANT_KEYWORDS
 * term that is NOT also present in the query string (artist+title, lowercased). The
 * "query asked for it" terms are excluded, so a user who tapped a "Live" track is not
 * penalized for getting the live take. Returns a non-negative penalty.
 */
function variantPenalty(query: { artist: string; title: string }, candidate: Track): number {
	const title = (candidate.title || '').toLowerCase();
	const queryStr = `${query.artist || ''} ${query.title || ''}`.toLowerCase();

	let penalty = 0;
	for (const kw of VARIANT_KEYWORDS) {
		if (!title.includes(kw)) continue;
		if (queryStr.includes(kw)) continue; // query asked for this variant — do not penalize
		penalty += VARIANT_WEIGHT;
	}
	return penalty;
}

/**
 * Pure best-match score for one candidate against a Last.fm {artist, title} query.
 * Higher = better. score = similarity − variantPenalty. Never null/NaN, no threshold,
 * no source/quality logic (dedupeBest owns that — see resolveStub).
 */
export function scoreMatch(query: { artist: string; title: string }, candidate: Track): number {
	return similarity(query, candidate) - variantPenalty(query, candidate);
}
