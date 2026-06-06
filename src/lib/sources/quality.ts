// PURE quality-ladder reordering (D-03). NO runes, NO `$app`, NO store import —
// the caller passes the preference as an ARGUMENT so this is node-unit-testable
// without mocking the settings store (RESEARCH Open Question 2).
//
// The per-source ladders (QQ `pickBestPlayUrl`, JOOX `JOOX_QUALITY_ORDER`) are
// ordered top-tier-first. `pickByQualityPref` reorders that list to put the band
// matching the user's `defaultQuality` preference FIRST, preserving the relative
// order within and outside the band (a stable partition). The adapter then picks
// the first PRESENT/REACHABLE tier off the reordered list, so the pref biases the
// selection toward the requested band while still falling through to whatever the
// source actually has (best-effort — matches the honest `defaultQualityNote`).
import type { DefaultQuality } from '$lib/stores/settings.svelte';

/** 128–160k band — JOOX `AAC 192`/`OGG 192`/`MP3 128`, QQ STD (128kbps). */
const BAND_128 = /128|192|aac/i;
/** 320k band. */
const BAND_320 = /320/i;
/** Lossless / hi-res / atmos band — same vocabulary used in joox.ts/dedupe.ts. */
const BAND_LOSSLESS = /flac|lossless|atmos|hi-?res|母带|无损/i;

/**
 * Return a REORDERED copy of `tiers` with the band matching `pref` moved to the
 * front (stable). `'lossless'` and `'auto'` return the input order unchanged
 * (top-tier-first, today's behavior). Never mutates `tiers`.
 */
export function pickByQualityPref(tiers: string[], pref: DefaultQuality): string[] {
	const band = pref === '128' ? BAND_128 : pref === '320' ? BAND_320 : null;
	// 'lossless' / 'auto' → leave the ladder as-is (top tier first).
	if (!band) return [...tiers];

	const inBand: string[] = [];
	const rest: string[] = [];
	for (const tier of tiers) {
		(band.test(tier) ? inBand : rest).push(tier);
	}
	return [...inBand, ...rest];
}
