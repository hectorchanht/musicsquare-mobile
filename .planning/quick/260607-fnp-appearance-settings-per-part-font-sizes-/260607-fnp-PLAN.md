---
quick_id: 260607-fnp
slug: appearance-settings-per-part-font-sizes
date: 2026-06-07
status: planned
---

# Quick Task 260607-fnp — Appearance settings + Data/Translation polish

Locked decisions (AskUserQuestion): font controls = **% sliders per part**; parts = **Title /
Artist / Lyrics** (app-wide); covers = **cover-size scale + grid-columns** (keep per-shelf slider).
Placement: new **/settings/appearance** page holds the new visual knobs; `/settings/home` keeps
layout/content. Mechanism: CSS custom properties on `<html>` (set in `settings.applyTheme`), with
`:root` defaults in `app.css` = 1× / 3 cols so SSR + returning users see no change.

## Task 1 — Appearance settings store + global vars + font threading
**Files:** `settings.svelte.ts`, `app.css`, `names.svelte.ts`, + all title/artist/lyrics render sites.
- settings: add `fontScaleTitle/Artist/Lyrics` (percent int, default 100, clamp 70–160 step 5),
  `coverScale` (percent, default 100, clamp 70–150), `homeGridCols` (default 3, clamp 2–5),
  `bioLang` (`'auto' | LyricsLang`, default `'auto'`). Non-destructive load() + save().
- applyTheme: `--fs-title/--fs-artist/--fs-lyrics` = scale/100; `--cover-scale` = scale/100;
  `--home-grid-cols` = cols. `app.css :root`: defaults `1 / 1 / 1 / 1 / 3`.
- Thread the vars into every title/artist/lyrics `font-size` as `calc(<orig> * var(--fs-*, 1))`:
  home (`.t-title/.al-name`→title, `.t-artist/.al-count`→artist), search (`.r-title/.r-artist`),
  NowPlaying (`.title/.artist`, queue `.r-title/.r-artist`, `.lyrics p`→lyrics, `.lyrics .tr` keep
  em), TrackMenu (`.menu-head`→title), artist/album/library (`.r-title`→title, `.r-sub`→artist;
  album `.artist`→artist). Default var (1) = today's size.
- names: `dnBio` honors `bioLang` (`auto`→appLang, `off`→untranslated, else the chosen lang).
  Add `clearCache()` that drops in-memory maps + every `openmusic:name-tr:*` localStorage key.

## Task 2 — Home cover size + grid columns
**File:** `src/routes/(app)/+page.svelte`
- `.album`/`.al-cover` width/height + `.section.compact` 96px variants → `calc(... * var(--cover-scale,1))`.
- `.grid` columns → `repeat(var(--home-grid-cols, 3), 1fr)`; drop the compact hard-coded
  `repeat(4)` override so the user's column choice wins (keep its gap).

## Task 3 — New /settings/appearance page + index group + i18n
**Files:** new `src/routes/(app)/settings/appearance/+page.svelte`, settings index, 15 i18n dicts.
- Sliders: Title / Artist / Lyrics font size (% with live value), Cover size (%), Grid columns
  (2–5). Each writes settings + `save()` (live via applyTheme). A "Reset appearance" affordance
  optional (Data tab owns reset).
- Add an "Appearance" group row to `/settings` index (icon e.g. `Type`/`SlidersHorizontal`).
- i18n keys (en + 14 locales): group title/desc, each slider label + unit, columns label.

## Task 4 — Richer Data tab
**File:** `src/routes/(app)/settings/data/+page.svelte` (+ i18n)
- Add buttons: clear name-translation cache (`names.clearCache()`), clear cover cache
  (`CACHE_KEY` from cover-cache.ts), clear search history (`SEARCH_HISTORY_KEY`), reset
  appearance settings to defaults. Keep existing clear picks / clear library. i18n for each.

## Task 5 — Translation page restructure + Bio picker (corrects 260607-f4y)
**File:** `src/routes/(app)/settings/translation/+page.svelte` (+ i18n)
- Reorder: **(1) Lyrics translate mode** (renamed from "Translate mode", clearer copy: only
  affects lyrics — Replace vs Show original + translation), **(2) Lyrics translation** (lyrics
  picker pulled out of the parts loop, on top), then Artist, Title, **Bio info**, App language.
- Add visual dividers between sections.
- **Bio info = a real per-part picker again** (revert f4y's read-only note): options = Auto
  (device/app language, DEFAULT) + Off + language list, bound to `settings.bioLang`. Title shows
  "Bio info" (no "Last.fm"). i18n: `settings.bioAuto` (+ updated note) across 15 locales.

## Must-haves
- Per-part Title/Artist/Lyrics font size sliders change text size app-wide, live; defaults = today.
- Home cover-size scale + grid-columns work; per-shelf slider untouched; defaults = today.
- New Appearance settings page reachable from the settings index.
- Data tab can clear name-tr cache / cover cache / search history + reset appearance.
- Translation page: Lyrics-mode first, Lyrics second, dividers, "Lyrics translate mode" rename.
- Bio info has a working language picker defaulting to Auto (app/device language); dnBio honors it.
- `pnpm check` 0/0, tests pass, build OK; live preview spot-check.
