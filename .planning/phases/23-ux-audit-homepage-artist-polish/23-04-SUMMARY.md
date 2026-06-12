---
phase: 23-ux-audit-homepage-artist-polish
plan: 04
subsystem: homepage / compact-mode
tags: [home, compact, quick-picks-pager, section-nav, toast-migration, i18n, HOME-02, HOME-03, HOME-04, D-05, D-07, D-08, D-09, D-10, D-14]
requires:
  - "toast.show() global store (23-01)"
  - "haptics.tick() commit-tier helper (23-01)"
  - "resolveSectionDensity + homeSectionDensity override map (23-03)"
provides:
  - "CompactRow component (track + artist variants, D-08/D-09)"
  - "CompactPager component (scroll-snap quick-picks pager, D-05/D-06)"
  - "Home compact-by-default render branch (D-07) consuming resolveSectionDensity(id, ..., 'compact')"
  - "Full-row section-title navigation (D-14) to /charts/* + /library?tab=... + playlist deep-link"
  - "Per-section density control in /settings/home (aria-pressed)"
  - "6 new i18n keys across all 15 locales"
affects:
  - "src/routes/(app)/+page.svelte (now uses the global toast store; renders compact pagers)"
  - "downstream chart-page routes /charts/top, /charts/tags/[tag], /charts/countries/[country] (Plan 05 — title-nav already links to them)"
  - "library page ?tab=/playlist deep-link handling (Plan 05 — home now navigates with these params)"
tech-stack:
  added: []
  patterns:
    - "Svelte 5 snippet-prop component (CompactPager row snippet) + callback-prop host-owns-state component (CompactRow)"
    - "use:longpress + haptics.tick() + use:marquee + use:lazyCover row idiom (mirrors search-row)"
    - "CSS scroll-snap-type: x mandatory pager with 90vw peeking columns"
    - "resolveSectionDensity(id, map, 'compact') compact-by-default resolution at the render branch"
key-files:
  created:
    - src/lib/components/CompactRow.svelte
    - src/lib/components/CompactPager.svelte
  modified:
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/settings/home/+page.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/th.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/vi.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
decisions:
  - "CompactRow uses explicit display props (title/subtitle/cover/seed) + callback props (onplay/onrequestmenu/onopen) so one component serves BOTH DiscoveryTrack stubs and library Tracks; the host owns all TrackMenu/play/nav state"
  - "CompactPager chunks items into columns of 4 internally and takes a `row` snippet — the host supplies a CompactRow per item, keeping chunking + scroll-snap geometry in one place"
  - "Top Artists + Top Hits both link to /charts/top (per-type convention, Top Artists artists-view shape deferred to the chart-page plan)"
  - "Library-mirror sections navigate to /library?tab={liked|downloads|history|fav-artists}; per-playlist shelves deep-link to /library?tab=playlists&playlist={id} (NOT the generic tab) (D-13)"
  - "Per-section density default surfaces as 'compact' in /settings/home (absent override = compact, matching the home page's 'compact' globalDefault) so the toggle reflects the effective render"
metrics:
  duration: ~30m
  completed: 2026-06-12
  tasks: 3
  files: 17
---

# Phase 23 Plan 04: Compact Homepage Summary

Shipped the compact-by-default homepage (HOME-02/03/04): two new components (`CompactRow` track/artist variants + a `CompactPager` scroll-snap quick-picks pager), a home render branch that renders every section compact by default via `resolveSectionDensity(id, settings.homeSectionDensity, 'compact')`, full-row section-title navigation with a trailing chevron to the correct chart page / library tab / playlist detail (D-14), a per-section density control in `/settings/home`, and migrated the home local toast to the global `toast.show()` store. Item count rounds the shelf size up to a full column of 4 (D-10).

## What Was Built

### Task 1 — CompactRow + CompactPager components (D-05/06/08/09, §4.1) — commit `9bcc8d9`
- `src/lib/components/CompactRow.svelte`: a `variant: 'track' | 'artist'` component.
  - **Track variant:** `display:flex; align-items:center; gap:8px;` min-height 44px; 40×40 art with `border-radius:6px` + optional `use:lazyCover` + fallback gradient; `.r-title` (14px/600) + `.r-sub` (12px/400 muted), both `min-width:0`/`overflow:hidden` with `use:marquee` + `.marquee-inner` on the inner span; a trailing `<button class="opt">` (`MoreVertical size={18}`, 44×44 tap target, `aria-label={t('menu.options')}`). Long-press fires `(e.currentTarget)?.blur()` (MENU-03 guard) + `haptics.tick()` + `onrequestmenu`; tap fires `onplay`; ⋮ fires `onrequestmenu`.
  - **Artist variant:** round avatar (`border-radius: var(--radius-full)`, 40px), name-only (single line `use:marquee`), tap fires `onopen`, NO ⋮ button and NO `use:longpress` (D-09).
  - Uses callback props (`onplay`/`onrequestmenu`/`onopen`) — the host owns TrackMenu state.
- `src/lib/components/CompactPager.svelte` (generic `<T>`): takes `items: T[]` + a `row` snippet, chunks items into `ceil(items.length / 4)` columns of 4 stacked rows, renders a horizontal track with `scroll-snap-type: x mandatory`, columns `flex: 0 0 90vw` + `scroll-snap-align: start`, `gap: 12px` (capped to 420px on ≥640px viewports). Net-new spacing all from the 4/8/12 scale.

### Task 2 — Home compact branch + section-title nav + toast migration (D-05/07/10/14, HOME-04) — commit `9a49d3f`
- **Toast migration (D-15):** imported `{ toast }` from `$lib/stores/toast.svelte`, replaced both `home.unplayable` call sites with `toast.show(...)`, removed the local `toastMsg`/`toastTimer` state, the `function toast()` copy, the inline `{#if toastMsg}…` render, the `.toast` CSS, and the now-unused `fly` import. `ToastHost` (mounted in the layout by Plan 01) renders it.
- **Compact branch (D-07/D-10):** added `densityOf(id) = resolveSectionDensity(id, settings.homeSectionDensity, 'compact')` (compact-by-default) and `compactCount = ceil(clampShelfSize(homeShelfSize)/4)*4`. Each section snippet now branches: compact → `<CompactPager>` of `<CompactRow>`; comfortable → the existing `.albumrow`. Reusable `discoveryShelf` (track sections: top-hits/tags/countries) and `libraryShelf` (liked/downloads/history/playlists) snippets carry the branch. Track sections wire `onplay → playStub`/`player.play(fresh)` and `onrequestmenu → tileMenu`/`openTrackMenu`; artist sections (top-artists/fav-artists) use the artist variant with `onopen → goto('/artist/'+encodeURIComponent(name))`.
- **Title-row nav (D-14):** a `titleNav(label, dest)` snippet replaces every static `.subhead` div with a `<button class="subhead-nav">` (full-width, ≥44px, trailing `ChevronRight size={18}` muted via `margin-left:auto`, `aria-label = "{title}, {seeAll}"`, `.subhead` typography preserved). Destinations (§5.2): top-hits/top-artists → `/charts/top`; tags → `/charts/tags/{tag}`; countries → `/charts/countries/{country}`; liked/downloads/history/fav-artists → `/library?tab=…`; per-playlist → `/library?tab=playlists&playlist={id}`. All dynamic segments `encodeURIComponent`-wrapped (T-23-08).
- **Compact cold-load skeleton:** the first-paint skeleton now renders the compact pager column shape (40px art + 62%/40% bars, 4 per column, next column peeking) using the global `.sk` class.

### Task 3 — Per-section density control in /settings/home + i18n keys (D-07, §7.1) — commit `dc34b1b`
- `/settings/home/+page.svelte`: added a compact/comfortable segmented control to each section row in the existing order/hide list, bound to `settings.homeSectionDensity[id]` via `setSectionDensity(id, v)` (persists through the existing `settings.save()` path). Each option button carries `aria-pressed` (active mode) + an `aria-label` (`"{section} · {option}"`); the group has `role="group"` + `aria-label={t('settings.homeSectionDensity')}`. An absent override surfaces as `compact` (matching the home page's compact default).
- i18n: added 6 new keys to all 15 locales (`menu.options`, `home.seeAll`, `charts.topTitle`, `charts.tagTitle`, `charts.countryTitle`, `settings.homeSectionDensity`) — `{tag}`/`{country}` interpolation tokens preserved. `settings.densityCompact`/`settings.densityComfortable` already existed and were reused.

## Verification

- `pnpm check` exits 0 — 4262 files, 0 errors, 0 warnings.
- `pnpm vitest run src/lib/i18n` — 2 files, 29 tests passed (parity: every locale's key set IDENTICAL to en).
- `pnpm vitest run src/lib/services/home-layout.test.ts src/lib/stores/settings.svelte.test.ts` — 50 passed (the consumed Plan-03 layer stays green).
- T-23-08 (open redirect): all title-nav `goto` targets are FIXED `/charts/*` / `/library` paths with `encodeURIComponent`-wrapped dynamic segments (tag/country/playlist id); same-origin only, no external URL.
- T-23-09 (corrupt density DoS): `resolveSectionDensity` returns `'compact'` (the passed globalDefault) on any garbage override, so a poisoned `homeSectionDensity` never blanks the home render (covered by Plan 03 tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] i18n keys added to all 15 locales as part of Task 1 (not deferred to Task 3 alone)**
- **Found during:** Task 1 verification (`pnpm check`).
- **Issue:** Each non-en locale file is typed as `Dict` (`keyof typeof en`), so adding `t('menu.options')` to `CompactRow` (and the 5 other new en keys) made `pnpm check` FAIL on all 14 other locale files ("missing properties … from type 'Dict'") — svelte-check itself enforces key-set parity, not just the vitest test. The components could not type-check without the keys present everywhere.
- **Fix:** Added all 6 new keys to all 15 locale dicts up front (translated for the major locales, sensible localized values elsewhere; `{tag}`/`{country}` tokens kept verbatim). The Task-1 commit holds only the two components; the i18n files landed with Task 3 (where the keys are nominally owned), keeping each commit type-clean against the working tree.
- **Files modified:** all `src/lib/i18n/*.ts`
- **Commit:** `dc34b1b` (i18n) — the working tree had the keys when `9bcc8d9` (components) was committed.

**2. [Rule 3 - Blocking] Installed dependencies in the worktree**
- **Found during:** start of execution (`node_modules` absent).
- **Issue:** Fresh worktree had no `node_modules`; `pnpm check`/`vitest` unavailable.
- **Fix:** `pnpm install --frozen-lockfile` (restores existing lockfile deps — not a new-package add). No lockfile change.
- **Commit:** n/a (node_modules is gitignored).

**3. [Rule 1 - Cleanup] Removed the now-dead `.al-cover.skeleton` rule + `@keyframes sk`**
- **Found during:** Task 2 verification (`pnpm check` warned "Unused CSS selector .al-cover.skeleton").
- **Issue:** The old comfortable cold-load skeleton (the only `.al-cover.skeleton` consumer) was replaced by the compact-pager skeleton, leaving the rule + its keyframe unused.
- **Fix:** Deleted both. No behavior change (the new compact skeleton uses the global `.sk` class).
- **Files modified:** `src/routes/(app)/+page.svelte`
- **Commit:** `9a49d3f`

## Known Stubs

None. All sections render real data through the compact branch; the title-nav destinations point at routes that Plan 05 builds (chart pages) and at the library tab/playlist deep-link params that Plan 05 wires on the library side. The home page side (constructing the correct encoded URLs + navigating) is fully implemented here; the receiving routes are out of this plan's scope (`files_modified` is home + settings + i18n only) and are owned by the wave-2 chart/library plan.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes were introduced. The only new trust boundary (section data → goto URL) is the planned T-23-08 surface and is mitigated (encodeURIComponent + fixed same-origin paths).

## Self-Check: PASSED

- FOUND: src/lib/components/CompactRow.svelte
- FOUND: src/lib/components/CompactPager.svelte
- FOUND: src/routes/(app)/+page.svelte
- FOUND: src/routes/(app)/settings/home/+page.svelte
- FOUND: src/lib/i18n/en.ts (+ all 14 other locales)
- FOUND commit: 9bcc8d9 (Task 1)
- FOUND commit: 9a49d3f (Task 2)
- FOUND commit: dc34b1b (Task 3)
