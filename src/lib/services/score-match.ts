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
import type { SetContext } from '$lib/services/score-context';

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
	'speed up',
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
	'加速版',
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

// --- Phase 21 set-relative tuning (SRCH-01) ---------------------------------------------
/** A track strictly SHORTER than this many seconds is a 試聽 preview clip (D-04). A length
 *  AT the threshold is a full track. undefined/0 = unknown = NEVER penalized (D-03). */
export const SHORT_CLIP_SEC = 60;
/** Max reward for a candidate title whose length is close to the query length (D-06). */
export const SHORT_TITLE_BOOST_MAX = 3;
/** Flat reward when the candidate's artist appears under 2+ distinct sources (D-05). */
export const ARTIST_FREQ_BOOST = 2;
/** 試聽 penalty — DERIVED to strictly dominate the full boost stack (Pitfall 2): a clip can
 *  carry SIM_EXACT + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST at most, so subtracting one
 *  more than that guarantees NO boost combination lifts a sub-60s clip above a clean full
 *  track (D-04 penalty-dominance). Not an independently-chosen magnitude. */
export const PREVIEW_PENALTY = SIM_EXACT + SHORT_TITLE_BOOST_MAX + ARTIST_FREQ_BOOST + 1;

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

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Precomputed keyword testers. Latin/ASCII keywords match on WORD BOUNDARIES (CR-01) so
 * `live` does NOT fire inside `Olive`/`Relive` and `cover` does NOT fire inside `Discover`.
 * CJK keywords have no word separators, so they match as a substring (safe — low false-
 * positive risk for CJK). `\b` (ASCII word boundary) still fires at a latin↔CJK seam, so
 * `\blive\b` correctly matches inside `live版`.
 */
const ASCII_ONLY = /^[\x00-\x7f]+$/;
const KW_TESTERS: { kw: string; re: RegExp | null }[] = VARIANT_KEYWORDS.map((kw) => ({
	kw,
	re: ASCII_ONLY.test(kw) ? new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i') : null
}));
function kwHit(text: string, t: { kw: string; re: RegExp | null }): boolean {
	return t.re ? t.re.test(text) : text.includes(t.kw);
}

/**
 * Variant penalty (D-02a): scan the candidate TITLE for VARIANT_KEYWORDS terms NOT present
 * in the query TITLE (WR-02 — title only, so a band literally named "Live" no longer
 * suppresses the live-penalty for every candidate). Word-boundary match for latin (CR-01).
 * Paired keywords are de-duped so `live`⊂`live版` counts ONCE, not twice (CR-02). Non-negative.
 */
function variantPenalty(query: { artist: string; title: string }, candidate: Track): number {
	const title = (candidate.title || '').toLowerCase();
	const qTitle = (query.title || '').toLowerCase(); // WR-02: query TITLE only, not artist

	// Keywords present in the candidate title that the query did NOT ask for.
	const matched: string[] = [];
	for (const t of KW_TESTERS) {
		if (!kwHit(title, t)) continue;
		if (kwHit(qTitle, t)) continue; // query asked for this variant — do not penalize
		matched.push(t.kw);
	}
	// CR-02: drop a matched keyword that is a substring of ANOTHER matched keyword
	// (e.g. `live` when `live版` also matched) so the same variant token counts once.
	const deduped = matched.filter(
		(kw) => !matched.some((other) => other !== kw && other.includes(kw))
	);
	return deduped.length * VARIANT_WEIGHT;
}

/**
 * 試聽 preview penalty (D-03 / D-04). Fires ONLY for a finite, positive, sub-SHORT_CLIP_SEC
 * duration. undefined / null / 0 = the source did not report a length = unknown = NO penalty
 * (so a source that omits duration is never falsely down-ranked). A flat large subtraction so
 * no boost can lift a clip above a full track (PREVIEW_PENALTY is derived to dominate).
 */
function previewPenalty(candidate: Track): number {
	const d = candidate.duration;
	return typeof d === 'number' && d > 0 && d < SHORT_CLIP_SEC ? PREVIEW_PENALTY : 0;
}

/**
 * Short-title proximity boost (D-06). Rewards a candidate TITLE whose length is CLOSE to the
 * query length — proximity, NOT "shorter is always better" (a long title the user actually
 * typed must not be punished). Graded SHORT_TITLE_BOOST_MAX..0 by absolute length delta.
 * Returns 0 when ctx is absent or queryLen is 0 (nothing to compare against).
 */
function shortTitleBoost(candidate: Track, ctx: SetContext): number {
	if (ctx.queryLen <= 0) return 0;
	const titleLen = (candidate.title || '').trim().length;
	const delta = Math.abs(titleLen - ctx.queryLen);
	// Linear decay: delta 0 → full boost; delta >= queryLen → 0. Bounded, never negative.
	const frac = Math.max(0, 1 - delta / ctx.queryLen);
	return SHORT_TITLE_BOOST_MAX * frac;
}

/**
 * Cross-source artist boost (D-05). Adds ARTIST_FREQ_BOOST only when the candidate's artist
 * (keyed artist-only, matching computeSetContext) appears under 2+ DISTINCT sources — i.e.
 * cross-source PRESENCE, never raw row count from a single source. Returns 0 otherwise.
 */
function artistFrequencyBoost(candidate: Track, ctx: SetContext): number {
	const sources = ctx.artistSources.get(matchKey(candidate.artist, ''));
	return sources && sources.size >= 2 ? ARTIST_FREQ_BOOST : 0;
}

/**
 * Pure best-match score for one candidate against a {artist, title} query.
 * Higher = better. Base score = similarity − variantPenalty (UNCHANGED for 2-arg callers —
 * resolveStub / tryFallback see byte-identical values). When the optional `ctx` is supplied
 * (Phase 21 search page) the set-relative short-title + cross-source-artist boosts are added,
 * and the 試聽 sub-60s penalty is subtracted whenever the candidate carries a known sub-clip
 * duration (the penalty does NOT require ctx — it fires off duration alone). Never null/NaN,
 * no threshold, no source/quality logic (dedupeBest owns that).
 */
export function scoreMatch(
	query: { artist: string; title: string },
	candidate: Track,
	ctx?: SetContext
): number {
	let score = similarity(query, candidate) - variantPenalty(query, candidate);
	// 試聽 penalty fires off duration alone (D-04) — independent of ctx.
	score -= previewPenalty(candidate);
	// Set-relative boosts require the per-set summary; absent ctx the 2-arg behavior is unchanged.
	if (ctx) {
		score += shortTitleBoost(candidate, ctx);
		score += artistFrequencyBoost(candidate, ctx);
	}
	return score;
}
