---
quick_id: 260607-gmy
slug: unify-marquee-convert-artist-nowplaying
date: 2026-06-07
status: planned
---

# Quick Task 260607-gmy — Unify marquee implementations

Home, search, etc. use the **global transform-based** `.marquee-inner` in [app.css:44](src/app.css:44):
  `.marquee-on .marquee-inner { display:inline-block; animation: marquee-scroll … alternate; }`
Artist + NowPlaying carried a parallel **text-indent** `marquee-bounce` keyframe + `:global(.marquee-on)`
rule per file. text-indent reflows every frame (jank), transform composites. Drop the per-file rules so
there's one marquee system.

## Task 1 — Artist page: delete dead local marquee CSS
**File:** [src/routes/(app)/artist/[name]/+page.svelte:240-254](src/routes/(app)/artist/[name]/+page.svelte:240)
- Markup already uses `<span class="marquee-inner">…</span>` inside `.al-name/.al-count` (correct).
- Delete the local `:global(.marquee-on)` `text-indent` rule + `@keyframes marquee-bounce` + the
  preceding `/* FIX-C: marquee-bounce … */` comment. The global rule now drives both.
- Keep `.al-name/.al-count` `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.

## Task 2 — NowPlaying: migrate markup + delete dead local marquee CSS
**File:** [src/lib/components/NowPlaying.svelte:520](src/lib/components/NowPlaying.svelte:520)
- Wrap title + artist text in `<span class="marquee-inner">…</span>` (mirrors home/artist), keeping
  `{#key player.current?.uid}` so per-track re-measure still happens.
- Delete the local `@media (prefers-reduced-motion: no-preference) { .title/.artist:global(.marquee-on)
  { animation: marquee-bounce … } }` block + `@keyframes marquee-bounce`. The global app.css drives both
  (incl. reduced-motion → no animation).
- Keep the existing `.title { …nowrap; overflow:hidden; text-overflow:ellipsis }` and `.artist {
  display:inline-block; max-width:100%; …nowrap; overflow:hidden; text-overflow:ellipsis }` — those
  are still required for the clip box.

## Verification
- `pnpm check` 0/0, tests pass, build OK.
- `rg -n "marquee-bounce|@keyframes marquee" src` → ZERO matches (only the global `marquee-scroll` remains).
- `rg -n "use:marquee" src` → every site has a `<span class="marquee-inner">` child inside the clip.
- Live: home/artist/NowPlaying marquees scroll (transform-based, single source of truth).

## Must-haves
- Only ONE marquee animation keyframe in the codebase (`marquee-scroll` in app.css).
- Artist + NowPlaying use `.marquee-inner` inside the clip.
- No regression: title/artist still single-line + ellipsis when text fits.
