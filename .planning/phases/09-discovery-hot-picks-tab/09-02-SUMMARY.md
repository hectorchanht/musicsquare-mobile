---
phase: 09-discovery-hot-picks-tab
plan: 02
subsystem: ui
tags: [lastfm, discovery, home, svelte5-runes, resolve-on-tap, concurrency-cap, i18n]

# Dependency graph
requires:
  - phase: 09-discovery-hot-picks-tab
    plan: 01
    provides: "services/lastfm.ts discovery builders (getChartTopTracks/getChartTopArtists/getTagTopTracks/getGeoTopTracks), services/discovery.ts resolveStub, /api/lastfm/discovery edge endpoint (absent-key + code-29 → { items: [] })"
  - phase: 01-foundation
    provides: "buildDiversePicks (picks.ts) D-06 fallback, player.setQueue/play, names.dn, longpress, TrackMenu, i18n t()"
provides:
  - "Home is now the Last.fm discovery surface (D-01): FOUR horizontal shelves — top hits, top artists, per-tag genre/mood rows, per-country rows"
  - "DISCOVERY_TAGS + DISCOVERY_COUNTRIES curated editable sets (discovery.ts)"
  - "mapWithConcurrency<T,R>: order-preserving async pool (default cap 4) — the home tag/country fan-out cap (Pitfall 11)"
  - "Resolve-on-tap wiring: discovery track tile → resolveStub → player.play; top-artist tile → /artist/[name]; D-06 buildDiversePicks fallback when key absent/empty"
  - "home.topHits/topArtists/tagShelf/countryShelf/unplayable i18n keys in en/zh-Hant/zh-Hans"
  - "v2 localStorage shelf cache (CACHE_KEY musicsquare:top-picks:v2): instant render + background revalidate"
affects: [09-03-artist-top-albums-album-tracklist]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mapWithConcurrency: index-claiming worker-pool (≤cap in-flight, order-preserving, never-reject) for capped shelf fan-out — reusable wherever many best-effort fetches must not burst one shared key (Pitfall 11)"
    - "Discovery-stub resolve-on-tap in a Svelte component: async onclick → resolveStub → (Track ? setQueue+play : unplayable toast)"
    - "Versioned localStorage shelf cache + background-revalidate (stale-while-revalidate on the home page); v-bumped to drop the old flat v1 list"

key-files:
  created: []
  modified:
    - src/lib/services/discovery.ts
    - src/lib/services/discovery.test.ts
    - src/routes/(app)/+page.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts

key-decisions:
  - "Templated tag/country shelf headings (home.tagShelf {tag} / home.countryShelf {country}) rather than one key per tag/country — keeps the curated sets editable without touching i18n"
  - "CACHE_KEY bumped v1→v2: the cache now holds the four discovery shelves + a fallback flag (a structured object), so the legacy flat-array v1 entry is ignored, not mis-parsed"
  - "Top-of-each-row image art only (already edge-filtered for placeholder stars); fallbackCover gradient seeded by artist+title (tracks) / name (artists) when image is null"
  - "Background revalidate (refresh(false)) on warm cache does NOT re-seed the player queue, to avoid clobbering an in-flight ?play shared-link playback"
  - "Component-local toast (same lightweight pattern as TrackMenu) for the resolve-miss unplayable case — no global toast store exists in the repo"

requirements-completed: [DISCO-01, DISCO-02, DISCO-03, DISCO-04]

# Metrics
duration: 4min
completed: 2026-06-06
---

# Phase 9 Plan 02: Home Last.fm Discovery Surface Summary

**The home landing page is now the Last.fm discovery surface — four horizontal shelves (top hits, top artists, per-tag genre/mood rows, per-country rows), each track tap-to-play via `resolveStub`, top-artist tiles linking to the artist page, with a concurrency-capped fan-out, a versioned localStorage shelf cache, and the `buildDiversePicks` fallback so home is never blank signed-out / no-key.**

## Performance

- **Duration:** ~4 min (implementation tasks 1–2; task 3 is a human-verify checkpoint, partially auto-verified — see below)
- **Started:** 2026-06-06T07:59:06Z
- **Tasks:** 3 (Tasks 1–2 `auto`, committed; Task 3 `checkpoint:human-verify`)
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments
- **DISCO-01/02/03 at the user-visible layer:** the home `.section` now renders FOUR Last.fm shelves as PRIMARY — `chart.getTopTracks` (Top hits), `chart.getTopArtists` (Top artists), one `tag.getTopTracks` row per `DISCOVERY_TAGS` entry, one `geo.getTopTracks` row per `DISCOVERY_COUNTRIES` entry — each a horizontal `.albumrow` scroll row copied from the artist-page pattern.
- **D-03 resolve-on-tap:** a discovery track is a `{artist,title}` stub, not a `Track`, so tile `onclick` is async — `resolveStub(artist, title)` → on a `Track`, `player.setQueue([tr])` + `player.play(tr)`; on `null`, a local unplayable toast — never breaks the surface or the player. Strictly lazy (one tap → one `searchAll`).
- **D-02 artist navigation:** top-artist tiles `goto('/artist/' + encodeURIComponent(name))` — no resolve.
- **D-06 fallback:** when `LASTFM_KEY` is absent or every shelf returns empty (`hasAnyDiscovery` false), the page runs `buildDiversePicks(9)` and renders the existing `.grid` of real Tracks (seeded into the player queue) — home is never blank.
- **DISCO-04 fan-out cap + caching:** the tag + country shelves are fetched through `mapWithConcurrency(_, 4, _)` (≤4 in-flight, order-preserving) instead of an unbounded `Promise.all` over every shelf (Pitfall 11). Displayed shelves are cached to `localStorage` (`v2` structured payload) for instant render, then revalidated in the background.
- **i18n:** `home.topHits`, `home.topArtists`, `home.tagShelf` (templated `{tag}`), `home.countryShelf` (templated `{country}`), `home.unplayable` added to all three locales (en/zh-Hant/zh-Hans) — additive, no existing keys reordered/removed.

## Task Commits

Each implementation task was committed atomically:

1. **Task 1: Curated tag/country sets + concurrency-capped fan-out + shelf i18n** — `d8620af` (feat)
2. **Task 2: Home four-shelf discovery surface with resolve-on-tap + fallback** — `aa4c549` (feat)
3. **Task 3: Human-verify checkpoint** — no code; auto-verifiable paths run (see below), browser-visual paths deferred to human.

**Plan metadata:** committed separately with this SUMMARY + STATE/ROADMAP.

## Files Modified
- `src/lib/services/discovery.ts` — Added `DISCOVERY_TAGS` (pop/rock/electronic/lo-fi/mandopop/cantopop/jazz/workout), `DISCOVERY_COUNTRIES` (China/Taiwan/Hong Kong/United States/Japan/South Korea — ISO NAMES not codes), and `mapWithConcurrency<T,R>` (index-claiming worker pool, default cap 4, order-preserving, swallows per-item throws). `resolveStub` (Plan 01) untouched.
- `src/lib/services/discovery.test.ts` — +6 cases: `mapWithConcurrency` cap-≤2 + order, never-reject on item throw, empty-input no-spawn; `DISCOVERY_TAGS`/`DISCOVERY_COUNTRIES` curated-set assertions (non-empty, NAMES-not-codes).
- `src/routes/(app)/+page.svelte` — Reworked: four discovery shelves (`$state` arrays), `refresh(seedQueue)` builder with capped fan-out + D-06 fallback branch, `playStub` resolve-on-tap, top-artist `goto`, `v2` `ShelfCache` (`saveCache`/`loadCache`/`applyCache`), background revalidate on warm cache, preserved `?play=<token>` onMount branch, local toast, `.albumrow`/`.album`/`.al-cover(.round)` styles.
- `src/lib/i18n/en.ts` / `zh-Hant.ts` / `zh-Hans.ts` — +5 home keys each (additive).

## Decisions Made
- **Templated shelf headings** (`home.tagShelf {tag}` / `home.countryShelf {country}`) keep `DISCOVERY_TAGS`/`DISCOVERY_COUNTRIES` editable without per-entry i18n. (zh locales render `{country}熱門` / `{country}热门`.)
- **`CACHE_KEY` v1→v2:** the cache payload changed from a flat `Track[]` to a structured `{ v: 2, topHits, topArtists, tagShelves, countryShelves, useFallback, fallback }`; `loadCache` only accepts `v === 2`, so a stale v1 entry is ignored (no crash, just a one-time cold fetch).
- **Background revalidate does not re-seed the queue** (`refresh(false)` on warm cache) so it never clobbers an in-flight `?play` shared-link playback; the queue is only seeded for the fallback grid (discovery shelves play resolve-on-tap, so they never need a seeded queue).

## Deviations from Plan
None — plan executed as written. No auto-fixes were required (`pnpm check` and `pnpm test` were clean on first run for both tasks). The `mapWithConcurrency` "skipped/empty slot per the caller's fn" behavior in the acceptance criteria is realized as: a thrown slot is swallowed (left `undefined`), and the home builder maps each row's missing slot to `?? []`, so a failed shelf simply doesn't render — matching the intent.

## Threat Surface
- **T-09-07 (DoS — shelf fan-out)** mitigated: `mapWithConcurrency` caps the tag+country fan-out at 4 in-flight; chart hits+artists are 2 fixed calls; shelves cached to localStorage so re-opens don't re-fetch; the edge Cache API (Plan 01) absorbs repeats.
- **T-09-08 (DoS — resolveStub)** mitigated: resolve is strictly on-tap (one tap → one `searchAll`), never eager over a shelf; `null` → unplayable toast, never throws/stalls.
- **T-09-10 (Availability — absent-key/empty)** mitigated: D-06 `buildDiversePicks` fallback.
- **T-09-SC (installs)** N/A: no new dependencies; reuses Plan-01 services, picks.ts, player, i18n, lucide.

No new security-relevant surface beyond the plan's threat model. **No Threat Flags.**

## Known Stubs
None. The discovery items ARE `{artist,title}` stubs by design (D-03) — they resolve to real Tracks on tap via `resolveStub`; this is intended behavior, not a placeholder. The `[]`/`null` returns from the builders are the documented never-throw graceful states (absent-key / miss / failure), each covered by a Plan-01 or Plan-02 test.

## Checkpoint: Task 3 (human-verify) — auto-verified vs. deferred-to-human

**Auto-verified (headless) — PASSED:**
- `pnpm check` → 0 errors / 0 warnings (acceptance criterion for Task 2).
- `pnpm test` → 19 files / 164 tests passing (was 159 in Plan 01; +5 from the new `mapWithConcurrency`/curated-set tests). `pnpm test discovery` → 2 files / 22 tests passing.
- **No-key / empty-discovery fallback path (D-06) — traced & confirmed:** `/api/lastfm/discovery` returns `{ items: [] }` on absent key (`+server.ts:188`) AND on `data.error` incl. code-29 (`:229`); all builders therefore return `[]`; `hasAnyDiscovery()` returns false; `buildDiversePicks` fires. Logic verified by code path + existing endpoint/builder tests.
- **Resolve-on-tap behavior (D-03) — unit-covered:** `resolveStub` returns the top hit / first-of-many / `null` on miss / `null` (never throws) on `searchAll` throw (4 tests, Plan 01).
- **Concurrency cap (DISCO-04) — unit-covered:** `mapWithConcurrency` proven ≤2 in-flight at cap 2 with input-order output (Plan 02).

**Deferred to human (requires `wrangler pages dev` / `pnpm preview` build with `LASTFM_KEY` + a browser — not headless-runnable):**
1. Visual: four shelves render with the key present, each scrolls horizontally.
2. Tap a Top-hits / tag / country track → resolves and plays within ~1–2s (now-playing bar appears).
3. Tap a Top-artists tile → navigates to `/artist/<name>`.
4. Navigate away and back → shelves render instantly from the v2 cache, no long spinner, no error toast.
5. Network tab: no Last.fm code-29 / rate-limit errors on repeated home opens (served from edge + localStorage cache).

Item 6 (plain `vite dev`, no key → fallback grid plays, no blank surface, no console errors) is the no-key path, which is logic-confirmed above; the visual confirmation in a running browser is part of the deferred set.

**How to run the deferred human check:** `pnpm build && pnpm preview` (or `wrangler pages dev .svelte-kit/cloudflare`) with `LASTFM_KEY` configured, then follow the steps in 09-02-PLAN.md Task 3 `<how-to-verify>`.

## Self-Check: PASSED

- All 6 modified files present on disk and committed.
- Both task commits present in git history: `d8620af` (Task 1), `aa4c549` (Task 2).
- `pnpm check`: 0 errors / 0 warnings. `pnpm test`: 19 files / 164 tests passing.
- `src/routes/+layout.svelte` NOT touched. i18n edits are additive (5 new home keys per locale, no reorder/removal).

---
*Phase: 09-discovery-hot-picks-tab*
*Completed: 2026-06-06*
