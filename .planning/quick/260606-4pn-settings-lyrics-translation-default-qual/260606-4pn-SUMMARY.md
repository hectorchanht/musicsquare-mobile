---
quick: 260606-4pn
slug: settings-lyrics-translation-default-quality-source-extras
status: complete
date: 2026-06-06
---

# Quick Task 260606-4pn — Summary

Settings overhaul + live lyrics translation on the deployed openmusic app. Phase-1 music data layer + 58 tests untouched. Live at openmusic.pages.dev.

## Shipped

- **Settings store** (`src/lib/stores/settings.svelte.ts`, standalone runes singleton, `openmusic:settings:v1`, SSR-guarded): lyricsLang, translateMode, defaultQuality, defaultSource, accent, reduceMotion, autoExpandOnPlay. `applyTheme()` sets `--color-primary` + `data-reduce-motion` live. Loaded in `(app)/+layout` onMount.
- **Settings page** rebuilt with real controls: lyrics-translation language chips (Off / 繁體 / 简体 / English / 日本語 / 한국어), translate-mode segmented (Show below / Replace, disabled when Off), default-quality segmented (Auto/Lossless/320k/128k, honest best-effort note), default-source chips (Auto/NetEase/QQ/Kuwo/JOOX), accent-color swatches, Reduce-motion + Auto-expand toggles, plus existing clear-picks / clear-library / about. All persist on change.
- **Lyrics translation** — NEW `/api/translate` (`+server.ts`, POST {lines,to}; unofficial Google translate, batched, 1:1-aligned-or-fallback, 8s timeout, same-origin) + `src/lib/services/translate.ts` client (in-memory + localStorage cache). NowPlaying Lyrics tab translates the current track to the chosen language: **Replace** (translated only) or **Show below** (original + muted translation), keeps active-line highlight + smart auto-scroll, "translating…" hint, cached per track+lang.
- **Wiring:** accent + reduce-motion apply live to `<html>` (app.css adds `:root[data-reduce-motion] * { transition/animation: none }`); `defaultSource` threads through `dedupeBest(tracks, preferred)` (extended) for home picks, search, artist, album, related, and the queue (preferred source wins quality ties); `autoExpandOnPlay` flips `player.expanded` in `play()`. No circular imports (settings store imports nothing from player/picks).

## Verification
- `pnpm check` 0 errors / 0 warnings (3950 files). `pnpm build` ok. `pnpm vitest run` 58/58 (music data layer untouched).
- Deployed → https://openmusic.pages.dev. `/api/translate` POST returns real translations (verified `Hello world` → `你好世界`). `/`, `/settings`, `/library`, `/spike` all 200.

## Notes
- Translation is an unofficial free endpoint — best-effort, no key, cached; falls back to originals on failure or line-count mismatch.
- defaultQuality is a soft/best-effort bias (adapters don't all expose bitrate) — stored + labeled honestly.
- New translate route is an isolated feature endpoint; catalog/adapters/proxy + tests unchanged.
