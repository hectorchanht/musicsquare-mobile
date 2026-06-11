// PURE typeahead-autocomplete logic (quick-260611-ql0) — NO runes, NO `$state`, NO DOM,
// NO fetch, NO timers-over-runes, NO `$app/environment`. This is the Node-Vitest-testable
// core; the search `+page.svelte` component merely WRAPS these helpers (it owns the runes
// state, the debounced fetch via `deezerSearchTopN`, the AbortController, and the render),
// exactly as `search-history-logic.ts` is wrapped by the searchHistory runes store.
//
// Why a separate pure module: the suggestion derivation (dedupe / cap / interleave) and the
// debounce primitive are framework-free algorithms. Keeping them out of the `.svelte` file
// lets them be unit-tested in the node Vitest project without a DOM and keeps the component
// thin — same split discipline the repo already uses for search history.

import type { DeezerHit } from '$lib/services/deezer';

/** Minimum trimmed query length before any suggestion is produced. Below this we return []
 *  (a 1-char query is too noisy to suggest on and would hammer the proxy for nothing). */
export const MIN_QUERY_LEN = 2;

/** Default debounce window (ms) for the component's suggestion fetch. A typing pause shorter
 *  than this never triggers a network call — the component cancels + restarts the timer on
 *  each keystroke so only the trailing pause fetches. */
export const SUGGEST_DEBOUNCE_MS = 300;

/** Maximum number of combined (song + artist) suggestions surfaced at once. Keeps the
 *  typeahead list short on a mobile screen and bounds the render. */
export const SUGGEST_CAP = 8;

/**
 * A single typeahead suggestion. `kind` distinguishes a song row (carries the performing
 * `artist` for muted secondary display) from an artist row (the artist name is the `title`).
 * `key` is stable + unique within a derived list, suitable for a Svelte `{#each (key)}`.
 */
export interface Suggestion {
	kind: 'song' | 'artist';
	/** The primary text + the text the component fills the input with on tap. */
	title: string;
	/** Present only for `kind:'song'` — the performing artist, shown as muted secondary text. */
	artist?: string;
	/** Stable, unique-within-the-list key for keyed `{#each}` rendering. */
	key: string;
}

/**
 * Derive a deduped, capped, song+artist suggestion list from Deezer hits for `query`.
 *
 * Rules:
 *  - An empty/whitespace `query` OR a trimmed length `< MIN_QUERY_LEN` → `[]` (never suggest
 *    on too-short input).
 *  - SONG suggestions: one per hit (kind:'song', title=hit.title, artist=hit.artist),
 *    preserving Deezer's relevance order; hits with an empty/whitespace title are skipped;
 *    duplicates are dropped case-insensitively on `${title}|${artist}` (first wins).
 *  - ARTIST suggestions: the DISTINCT artist names across the hits (case-insensitive dedupe,
 *    first-seen casing + order preserved); empty artist names are skipped.
 *  - The combined list is capped at `SUGGEST_CAP`, interleaved songs-first then filled with
 *    not-yet-shown artists then remaining songs, so at least a couple of artist rows surface
 *    near the top when present. `key` is `song:${title}|${artist}` / `artist:${name}`,
 *    guaranteed unique because the songs and artists are each deduped first.
 *
 * Pure: tolerates missing/nullish `title`/`artist` fields (treats them as empty → skipped),
 * never throws, never touches the network/DOM/timers.
 */
export function deriveSuggestions(hits: DeezerHit[], query: string): Suggestion[] {
	const q = (query ?? '').trim();
	if (q.length < MIN_QUERY_LEN) return [];
	if (!Array.isArray(hits) || hits.length === 0) return [];

	// --- songs: preserve relevance order, drop empty-title, case-insensitive dedupe on title|artist
	const songs: Suggestion[] = [];
	const seenSong = new Set<string>();
	for (const h of hits) {
		const title = (h?.title ?? '').trim();
		if (!title) continue;
		const artist = (h?.artist ?? '').trim();
		const dedupeKey = `${title.toLowerCase()}|${artist.toLowerCase()}`;
		if (seenSong.has(dedupeKey)) continue;
		seenSong.add(dedupeKey);
		songs.push({ kind: 'song', title, artist, key: `song:${title}|${artist}` });
	}

	// --- artists: distinct names, first-seen casing + order, skip empty
	const artists: Suggestion[] = [];
	const seenArtist = new Set<string>();
	for (const h of hits) {
		const name = (h?.artist ?? '').trim();
		if (!name) continue;
		const norm = name.toLowerCase();
		if (seenArtist.has(norm)) continue;
		seenArtist.add(norm);
		artists.push({ kind: 'artist', title: name, key: `artist:${name}` });
	}

	// --- interleave: a few songs first, then surface artists near the top, then fill the rest.
	// Take the leading songs, then the leading artists, then whatever space remains with the
	// remaining songs — never exceeding the cap. This guarantees at least a couple of artist
	// rows ride near the top when artists exist, without burying songs.
	const out: Suggestion[] = [];
	const SONGS_FIRST = 3; // show a few top songs before the artist block
	const ARTISTS_NEAR_TOP = 2; // then a couple of artist rows near the top

	let si = 0; // song cursor
	let ai = 0; // artist cursor

	for (; si < songs.length && out.length < SUGGEST_CAP && si < SONGS_FIRST; si++) {
		out.push(songs[si]);
	}
	for (; ai < artists.length && out.length < SUGGEST_CAP && ai < ARTISTS_NEAR_TOP; ai++) {
		out.push(artists[ai]);
	}
	// Fill the remainder: alternate remaining songs and artists so both kinds keep appearing
	// until the cap is reached.
	while (out.length < SUGGEST_CAP && (si < songs.length || ai < artists.length)) {
		if (si < songs.length) out.push(songs[si++]);
		if (out.length >= SUGGEST_CAP) break;
		if (ai < artists.length) out.push(artists[ai++]);
	}

	return out;
}

/** A debounced callable: invoking it (re)schedules `fn`; `.cancel()` drops any pending call. */
export interface Debounced<F extends (...args: never[]) => void> {
	(...args: Parameters<F>): void;
	/** Cancel a pending invocation (e.g. on submit, on too-short query, on destroy). */
	cancel(): void;
}

/**
 * Framework-free debounce: returns a callable that delays `fn` by `delayMs`, restarting the
 * timer on every call so only the trailing call within a quiet window fires. `.cancel()`
 * clears any pending invocation. Plain setTimeout/clearTimeout — no runes, no DOM. Used by
 * the component to throttle suggestion fetches to at most one per typing pause.
 */
export function debounce<F extends (...args: never[]) => void>(
	fn: F,
	delayMs: number
): Debounced<F> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const debounced = (...args: Parameters<F>): void => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delayMs);
	};

	debounced.cancel = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return debounced;
}
