---
phase: 23-ux-audit-homepage-artist-polish
plan: 06
subsystem: chart-pages
tags: [routes, charts, deep-list, swipe, longpress, skeleton, discovery, i18n]
requires:
  - src/lib/services/lastfm.ts (getChartTopTracks/getChartTopArtists/getTagTopTracks/getGeoTopTracks)
  - src/lib/services/discovery.ts (resolveStub)
  - src/lib/actions/swipeAction.ts (Plan 02)
  - src/lib/stores/toast.svelte.ts (Plan 01)
  - src/lib/util/haptics.ts (Plan 01)
provides:
  - "/charts/top deep Top Hits + Top Artists chart page (toggle)"
  - "/charts/tags/[tag] per-tag deep chart page"
  - "/charts/countries/[country] per-country deep chart page"
affects:
  - "Home section-title nav (Plan 04) lands on these routes"
  - "src/lib/i18n/*.ts — added charts.* key block to all 15 dicts"
tech-stack:
  added: []
  patterns:
    - "Deep vertical .row list cloned from the search page (lazyCover art, marquee title/sub, dwell-floored skeleton)"
    - "Discovery stub → real Track on demand: tap = player.playStub (home-discovery path); long-press/swipe = resolveStub then act"
    - "swipeAction host wiring: onSwipeRight=queue (player.addToQueue), onSwipeLeft=like-toggle (library.toggleLike), each + toast.show + haptics.tick"
    - "Route-param refetch via \$derived param + \$effect with a generation race guard; defensive decodeURIComponent (try/catch → raw)"
key-files:
  created:
    - src/routes/(app)/charts/top/+page.svelte
    - src/routes/(app)/charts/tags/[tag]/+page.svelte
    - src/routes/(app)/charts/countries/[country]/+page.svelte
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/vi.ts
    - src/lib/i18n/th.ts
decisions:
  - "Top-level split (D-11 discretion): Top Hits + Top Artists live on ONE /charts/top route as an aria-pressed Songs/Artists toggle (UI-SPEC §5.2 per-type convention). Artist rows = round avatar, tap → /artist/{name}, no swipe/no ⋮ (D-09 — artists aren't tracks)."
  - "Single fetch with limit=100 (no load-more): D-12 specifies ~50–100 rows, so one deep fetch covers the page; the search sentinel/load-more was intentionally NOT reused (simpler, within the row cap)."
  - "Tap-to-play uses player.playStub (the optimistic home-discovery path) rather than a bare resolveStub→player.play, matching the home page exactly: instant now-bar lock + same-song dedupe + supersede + unplayable toast gated on pendingTrack."
  - "QueueContext: chart surfaces use the existing 'home-discovery' union member (no new union value added — these are discovery surfaces sharing the same resolve path)."
metrics:
  duration: ~22m
  completed: 2026-06-12
  tasks: 2
  files: 18
---

# Phase 23 Plan 06: Per-Type Chart Pages Summary

Built the three per-type chart pages (HOME-04, D-11/D-12): `/charts/top` (Top Hits + Top Artists toggle), `/charts/tags/[tag]`, and `/charts/countries/[country]`. Each is a deep ~100-row vertical list of the standard `.row` pattern cloned from the search page, fetched from the matching Last.fm chart via the never-throw `lastfm.ts` builders. Track rows inherit tap-to-play, long-press menu, and swipe-actions (queue/like) by wiring the Plan 01/02 primitives; a dwell-floored 12-row skeleton shows before first paint and an empty result hides the list.

## What Was Built

### Task 1 — `/charts/top` deep chart page + Songs/Artists toggle — commit `a67adb8`
- `src/routes/(app)/charts/top/+page.svelte`: fetches `getChartTopTracks(100)` (Songs) and `getChartTopArtists(100)` (Artists) in parallel on mount.
- **Songs view** (default): deep `.row` list. Each row has `use:lazyCover` art, `use:marquee` title/sub (project marquee rule), `use:longpress onlongpress` (opens TrackMenu — stub opens instantly, `resolveStub` fills the real Track in the background, generation-guarded, with the MENU-03 `(e.currentTarget).blur()` guard), `onclick` tap-to-play via `player.playStub(artist, title, image, 'home-discovery')` (the home discovery path; unplayable toast gated on `player.pendingTrack`), and `use:swipeAction` (right = queue via `player.addToQueue`, left = like-toggle via `library.toggleLike`, each + `toast.show` + `haptics.tick`).
- **Artists view**: round-avatar rows (`.art.round`, `border-radius: var(--radius-full)`), tap → `/artist/{name}`. No swipe, no ⋮ (D-09 — artists aren't tracks). Switched via an `aria-pressed` Songs/Artists toggle (UI-SPEC §7.1).
- Dwell-floored (280ms) 12-row skeleton per view; reveal layers behind each row (`--color-primary` for queue, `--src-netease` for the unlike affordance).
- Added the `charts.*` i18n key block to **all 15 dicts** (`topTitle`, `topArtists`, `topTracksTab`, `topArtistsTab`, `tagTitle`, `countryTitle`).

### Task 2 — `/charts/tags/[tag]` + `/charts/countries/[country]` — commit `c58a543`
- Both clone the Task-1 track-row/skeleton/tap/swipe scaffold (no artist toggle — tag/country are track-only).
- Tag page reads `[tag]` via `page.params.tag` (`$app/state`), `decodeURIComponent` in a try/catch, fetches `getTagTopTracks(tag, 100)`, heading `t('charts.tagTitle', { tag })`.
- Country page reads `[country]`, fetches `getGeoTopTracks(country, 100)` (the param IS the ISO 3166-1 name the API expects), heading `t('charts.countryTitle', { country })`.
- A `$derived` param + `$effect` refetch on param change with a `fetchGen` generation race guard; a blank/garbage param short-circuits to an empty result → hidden list (never crash).

## Verification

- `pnpm check` exits 0 — 4266 files, 0 errors, 0 warnings (all three routes).
- `pnpm exec vitest run src/lib/i18n/i18n.test.ts` — 12/12 pass (the parity test confirms all 15 dicts still expose an identical key set after the `charts.*` additions).
- SvelteKit manifest registers all three routes (`/(app)/charts/top`, `/(app)/charts/tags/[tag]`, `/(app)/charts/countries/[country]`).
- T-23-14 (XSS): `grep -rn "@html" src/routes/(app)/charts/` → none. Tag/country headings render as auto-escaped Svelte text.
- T-23-13 (param/SSRF): params are `decodeURIComponent`'d and passed as Last.fm query VALUES through the existing fixed proxy; a garbage param yields an empty never-throw result → hidden list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the `charts.*` i18n keys myself (not yet merged from Plan 04)**
- **Found during:** Task 1 — the plan's `<interfaces>` states `charts.topTitle/tagTitle/countryTitle` were "added in Plan 04 across all 15 dicts," but this wave-2 worktree branches off the wave-1 merge, before Plan 04 landed. `t()` is strictly typed (`key: TranslationKey`), so calling `t('charts.topTitle')` against the un-merged dict was a compile error blocking the whole plan.
- **Fix:** Added the `charts.*` key block (the three planned keys plus `topArtists` + `topTracksTab`/`topArtistsTab` for the Songs/Artists toggle) to **all 15 dicts**, with localized values where reasonable and `{tag}`/`{country}` interpolation-only for the per-type headings (matching the `home.tagShelf` precedent and the en reference). The i18n parity test stays green.
- **Files modified:** all 15 `src/lib/i18n/*.ts`
- **Commit:** `a67adb8` (with Task 1)
- **Merge note:** if Plan 04 also adds these exact keys, the orchestrator merge will collide on the three shared keys — resolution is trivial (identical/equivalent values; keep one copy). My block additionally provides the two toggle-label keys this page needs.

**2. [Rule 1 - Bug] Toggle uses `aria-pressed` on plain buttons, not `role="tab"`**
- **Found during:** Task 1 `pnpm check` (2 a11y warnings: `aria-pressed` is not supported by `role="tab"`).
- **Fix:** Dropped the `role="tablist"`/`role="tab"` and kept the Songs/Artists controls as plain toggle buttons with `aria-pressed` — which is exactly the UI-SPEC §7.1 toggle precedent (TrackMenu Like button). Warnings cleared.
- **Files modified:** src/routes/(app)/charts/top/+page.svelte
- **Commit:** `a67adb8`

## Notes

- `haptics` is imported as a namespace (`import * as haptics from '$lib/util/haptics'`) because Plan 01 exports a bare `tick()` function (not a `haptics` object); this is the first consumer, and the namespace import yields the `haptics.tick()` call shape the PATTERNS/swipeAction docs reference.
- Plan 05's SUMMARY was not present in this worktree base (different wave), so swipe/like wiring was modeled directly on the Plan 01/02 primitives + the home page's `resolveStub`/`playStub` tap pattern rather than copied from Plan 05. The wiring matches the UI-SPEC §6.1 contract (right=queue + `toast.addedToQueue`; left=like-toggle + `toast.liked`/`toast.unliked`).

## Threat Flags

None — no new network/auth/file surface. Both new param routes forward `decodeURIComponent`'d values as Last.fm query VALUES through the existing fixed proxy (T-23-13 mitigated: garbage → empty → hidden list); headings are auto-escaped text (T-23-14 mitigated: no `{@html}`); the play path reuses the existing home discovery resolver (T-23-15 accepted — no new data surface).

## Known Stubs

None. All three pages fetch live Last.fm charts and wire real tap/long-press/swipe actions against the player + library stores. Empty results intentionally hide the list per the never-throw posture (not a stub).

## Self-Check: PASSED

- FOUND: src/routes/(app)/charts/top/+page.svelte
- FOUND: src/routes/(app)/charts/tags/[tag]/+page.svelte
- FOUND: src/routes/(app)/charts/countries/[country]/+page.svelte
- FOUND commit: a67adb8 (Task 1)
- FOUND commit: c58a543 (Task 2)
- `pnpm check` exits 0 (0 errors, 0 warnings)
- i18n parity test 12/12 pass after charts.* additions
