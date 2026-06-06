// Home-layout config resolution — PURE helpers (quick-260606-w87).
//
// This module is the ROBUSTNESS LAYER between attacker/corruption-controllable persisted
// config (localStorage `openmusic:settings:v1`) and the home render. localStorage is an
// untrusted input (threats T-w87-01/02/03/05): a poisoned shelf size, an unknown section
// id, a tag no longer in the pool, or a garbage landing tab must NEVER break the home
// page's first paint — they clamp, drop, or fall back to the default that reproduces
// today's behavior. Every helper here is deterministic, imports NOTHING from stores/$app,
// and runs in the node Vitest project alongside discovery.test.ts.

// ---- Section order + visibility --------------------------------------------------------

/**
 * Stable, canonical section ids for the four home discovery groups, in TODAY's fixed
 * render order (top hits → top artists → genre shelves → country shelves). These strings
 * are PERSISTED (they live in `homeSectionOrder`/`homeHidden`), so they must never change.
 *
 * Note that the per-tag and per-country SHELVES are each grouped under ONE id ('tags' /
 * 'countries') rather than one id per shelf: a reorder moves the whole group as a block,
 * which matches the current four-block layout and keeps the persisted order tiny + stable
 * regardless of which tags/countries the user has selected.
 */
export const HOME_SECTIONS = ['top-hits', 'top-artists', 'tags', 'countries'] as const;

export type HomeSectionId = (typeof HOME_SECTIONS)[number];

/**
 * Default order === HOME_SECTIONS (preserves today's fixed order). A fresh spread so the
 * caller can never accidentally mutate the canonical constant.
 */
export const DEFAULT_SECTION_ORDER: HomeSectionId[] = [...HOME_SECTIONS];

/**
 * Resolve a persisted section order into a VALID render order. Always returns a
 * permutation-superset covering every known section id, so the home page can iterate it
 * directly and a corrupt/old saved value can never blank the render (T-w87-02):
 *   - undefined / empty / non-array (corrupt) → a fresh copy of DEFAULT_SECTION_ORDER.
 *   - unknown / old ids in `saved` are dropped.
 *   - any known id MISSING from `saved` is appended in canonical order (so a newly-added
 *     section never vanishes for an existing user).
 *   - duplicate ids collapse to a single occurrence (the first).
 */
export function resolveSectionOrder(saved: string[] | undefined): HomeSectionId[] {
	if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_SECTION_ORDER];
	const known = new Set<string>(HOME_SECTIONS);
	const out: HomeSectionId[] = [];
	const seen = new Set<HomeSectionId>();
	// Keep the user's order, dropping unknown ids and de-duping.
	for (const id of saved) {
		if (known.has(id) && !seen.has(id as HomeSectionId)) {
			out.push(id as HomeSectionId);
			seen.add(id as HomeSectionId);
		}
	}
	// Append any known id the user's order omitted (canonical order) so the result always
	// covers every section — a newly-shipped section is never silently lost.
	for (const id of HOME_SECTIONS) {
		if (!seen.has(id)) out.push(id);
	}
	// If `saved` held ONLY garbage, `out` is now just the appended defaults — still valid.
	return out.length ? out : [...DEFAULT_SECTION_ORDER];
}

// ---- Tag / country subset --------------------------------------------------------------

/**
 * Resolve a persisted tag/country SUBSET against the available `pool`, falling back to the
 * full pool whenever the resolved subset would be empty (T-w87-03 — a poisoned tag string
 * is dropped before it ever reaches the edge, and an empty/garbage selection never yields a
 * blank discovery surface):
 *   - undefined / non-array (corrupt) → the full pool (default = everything, preserves today).
 *   - otherwise, filter `pool` to members the user selected (so the RESULT ORDER follows the
 *     pool's canonical order, NOT the selection order), dropping any selection not in the pool.
 *   - if that filter is empty (none selected, or every selection invalid) → the full pool.
 * Returns a fresh array; never mutates `pool`.
 */
export function resolveSubset(saved: string[] | undefined, pool: string[]): string[] {
	if (!Array.isArray(saved)) return [...pool];
	const picked = new Set(saved);
	const filtered = pool.filter((item) => picked.has(item));
	return filtered.length ? filtered : [...pool];
}

// ---- Items per shelf -------------------------------------------------------------------

export const SHELF_MIN = 6;
export const SHELF_MAX = 24;
export const SHELF_DEFAULT = 18;

/**
 * Coerce a persisted items-per-shelf value into a SAFE integer in [SHELF_MIN, SHELF_MAX]
 * (T-w87-01 — a poisoned `999` / `"x"` / negative can never produce a giant fan-out limit
 * or a NaN page size that breaks a discovery request):
 *   - non-number / NaN / undefined → SHELF_DEFAULT.
 *   - floors fractionals, then clamps to [6, 24].
 */
export function clampShelfSize(n: unknown): number {
	if (typeof n !== 'number' || !Number.isFinite(n)) return SHELF_DEFAULT;
	const floored = Math.floor(n);
	if (floored < SHELF_MIN) return SHELF_MIN;
	if (floored > SHELF_MAX) return SHELF_MAX;
	return floored;
}

// ---- Density + landing tab -------------------------------------------------------------

/** Tile density for the home shelves/grid. */
export type HomeDensity = 'comfortable' | 'compact';
/** Which bottom-nav tab the app opens on at `/`. */
export type HomeLandingTab = 'home' | 'search' | 'library';

/**
 * Fixed mapping from a landing-tab choice to its in-app path. The redirect target is ALWAYS
 * looked up here, never taken from the raw persisted string (T-w87-05 — no open-redirect /
 * arbitrary-path navigation from a poisoned `homeLandingTab`).
 */
export const LANDING_PATHS: Record<HomeLandingTab, string> = {
	home: '/',
	search: '/search',
	library: '/library'
};
