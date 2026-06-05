---
quick: 260605-wq1
slug: implement-sketch-001-variant-c-home-shell
status: complete
date: 2026-06-05
---

# Quick Task 260605-wq1 — Summary

Implemented the sketch-001 **variant C** ("MusicSquare-branded") home shell as the real app and deployed it to `openmusic.pages.dev`, wired to the live Phase 1 data layer.

## Shipped

- **Theme** — `src/app.css`: dark + violet (`#7c5cff`) variant-C tokens, per-source badge colors, global resets.
- **Player store** — `src/lib/stores/player.svelte.ts`: Svelte 5 runes singleton; single `<audio>` (browser-direct, `referrerpolicy=no-referrer`); `play(track)` calls `ensureTrackDetails` then sets `.src`; `toggle()`; loading/error/playing state.
- **App shell** — `src/routes/(app)/+layout.svelte`: persistent glassy now-playing bar + bottom tab nav (Home/Search/Library) + the single `<audio>`, scoped to the `(app)` route group so `/spike` stays bare. Root `+layout.svelte` now imports `app.css`.
- **Home** — `src/routes/(app)/+page.svelte`: brand top nav + full-width search pill (→ `/search`), 3×3 grid of 9 songs from `catalog.searchAll` (random seed keyword from a pool, `↻ Shuffle` reloads), per-tile cover (gradient fallback) + source badge + quality, tap → `player.play`. Skeleton loading + error/"sources failing" states.
- **Search** — `src/routes/(app)/search/+page.svelte`: input → `searchAll` → interleaved cross-source result list, per-source-failure notice, tap to play.
- Removed the placeholder `src/routes/+page.svelte` (conflicted with `(app)/+page.svelte` for `/`).

## Verification

- `pnpm check` → 0 errors, 0 warnings (252 files).
- `pnpm build` (adapter-cloudflare) → success.
- `pnpm vitest run` → 58/58 pass (data layer untouched).
- Deployed: `wrangler pages deploy` → **https://openmusic.pages.dev** (account f1868a07…; JOOX secret already set). Live smoke: `/` 200 (serves the MusicSquare shell), `/search` 200, `/spike` 200 (still bare).

## Constraints honored

- Did NOT touch the data layer / proxy / adapters — reused `Track`, registry, `catalog.searchAll`/`ensureTrackDetails`.
- No new deps; Svelte 5 runes + built-in CSS only.

## Notes / scope

- Off the planned phase order: this is Phase-4-shaped UI pulled forward as a demo. Playback is intentionally **basic** (single `<audio>`, no MediaSession/queue) — the full audio engine is Phase 6, the real Mobile UI Shell is Phase 4. When those phases run, this shell becomes the starting point to formalize.
- Phase 1 egress-spike checkpoint remains open (the deployed home now also serves as a real-world test of browser-direct playback — tapping a tile that plays confirms the data-flow per source).
