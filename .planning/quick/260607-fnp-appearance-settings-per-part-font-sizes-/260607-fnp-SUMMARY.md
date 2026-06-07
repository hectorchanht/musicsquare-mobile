---
quick_id: 260607-fnp
slug: appearance-settings-per-part-font-sizes
date: 2026-06-07
status: complete
commits:
  - 5f758d8  # Part 1 — appearance settings + app-wide font/cover threading + page
  - ac17685  # Part 2 — Data tab cache clears + reset appearance
  - 6c4c4d9  # Parts 3 & 4 — translation restructure + Bio picker
---

# Quick Task 260607-fnp — Summary

Decisions locked via AskUserQuestion: font controls = **% sliders per part**; parts = **Title /
Artist / Lyrics**; covers = **cover-size scale + grid columns** (keep per-shelf slider). Placement:
new **/settings/appearance** page; `/settings/home` unchanged.

## Part 1 — Per-part appearance sizing (app-wide)
- **Mechanism:** CSS custom properties on `<html>` set in `settings.applyTheme()`
  (`--fs-title/--fs-artist/--fs-lyrics` = scale/100, `--cover-scale`, `--home-grid-cols`), with
  `app.css :root` defaults `1 / 1 / 1 / 1 / 3` → SSR + returning users unchanged (non-destructive).
- **Store:** new `fontScaleTitle/Artist/Lyrics` (70–160), `coverScale` (70–150), `homeGridCols`
  (2–5), all clamped on load; `resetAppearance()`. Persisted in `openmusic:settings:v1`.
- **Threaded** the scale vars into every title/artist/lyrics `font-size`: home (`.t-title/.al-name`
  + `.t-artist/.al-count`), search, NowPlaying (`.title/.artist`, queue rows, `.lyrics p`),
  TrackMenu, artist, album, library. Home `.album/.al-cover` size + fallback `.grid` columns honor
  `--cover-scale` / `--home-grid-cols`.
- **UI:** new `/settings/appearance` page (5 sliders + live % readouts + text previews); added an
  **Appearance** row to the settings index (2nd, after General).

## Part 2 — Richer Data tab
- New actions: clear name-translation cache (`names.clearCache()` — wipes in-memory + every
  `openmusic:name-tr:*` key), clear cover cache (new `clearCoverCache()` export), clear search
  history (`SEARCH_HISTORY_KEY`), reset appearance sizes. Existing clear-picks/library kept.

## Part 3 — Translation page restructure
- Order is now **Lyrics translate mode → Lyrics translation → Artist → Song title → Bio info →
  App language**, with `<hr>` dividers between sections. "Translate mode" renamed
  **"Lyrics translate mode"** with clearer lyrics-only copy (Replace vs Show-below).

## Part 4 — Bio info picker (corrects 260607-f4y)
- Reverted f4y's read-only note: Bio info is a real per-part picker again. New store field
  `bioLang: 'auto' | LyricsLang` (default `'auto'`); options = **Auto (app/device language,
  default)** + Off + language list; `names.dnBio` honors it (`auto`→appLang, `off`→untranslated,
  else the chosen language). Title shows "Bio info" (no "Last.fm").

## i18n
- 20 new keys added to all **15** locales (Dict type requires completeness; the 3 parity locales
  en/zh-Hant/zh-Hans hand-translated, the other 12 translated via script). Updated translate-mode
  + bio note copy in the 3 parity locales.

## Verification
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.
- Live (dev server): Appearance page shows 5 sliders (defaults 100/100/100/100/3). Setting Title→160%
  set `--fs-title=1.6` on `<html>`, persisted 160, and a real home tile label scaled 12→**19.2px**;
  covers stayed 130px (cover-scale 1). Data tab shows all 6 actions; **Reset appearance** restored
  `--fs-title=1` / persisted 100. Translation page order + 5 dividers confirmed; **Bio picker present
  with "Auto (app language)" selected by default**; no "Last.fm" text anywhere.

## Notes / follow-ups
- i18n fallback: `lookupKey` already falls back to `en`, but the `Dict` TYPE requires every locale
  to carry every key — hence all 15 were filled (not just the 3 parity locales).
- `--cover-scale` / `--home-grid-cols` affect the **home** surfaces (shelf tiles + the no-Last.fm
  fallback grid); the horizontal shelves' tile *count* remains the existing per-shelf slider.
- Disclosed: app.css also carries a pre-existing `--color-border` tweak, and TrackMenu/album carry
  small pre-existing WIP hunks (go-to-album commented; album action reorder) that predate this task
  and rode along in those files. package.json / HANDOFF.json / sketches theme left uncommitted.
- Marquee drift observed (not addressed): home uses the new global transform-based `.marquee-inner`
  (app.css) while artist + NowPlaying still use the older local `text-indent` `marquee-bounce`.
- Env: ran all tooling under nvm Node 22; patched local `.claude/launch.json` (last task) so the
  preview launches vite via Node 22 directly (bypasses the broken system-corepack `pnpm`).
