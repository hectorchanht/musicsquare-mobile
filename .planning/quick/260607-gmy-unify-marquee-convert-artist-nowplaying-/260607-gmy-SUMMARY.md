---
quick_id: 260607-gmy
slug: unify-marquee-convert-artist-nowplaying
date: 2026-06-07
status: complete
commits:
  - db4921c  # unify marquee onto the global .marquee-inner system
---

# Quick Task 260607-gmy — Summary

Two marquee systems coexisted in the codebase:
1. **Global** (home + search via `<span class="marquee-inner">…</span>`): transform-based
   `@keyframes marquee-scroll` in [app.css:44](src/app.css:44), GPU-composited.
2. **Per-file** (artist + NowPlaying): a `:global(.marquee-on)` rule animating `text-indent` via
   a local `@keyframes marquee-bounce`. text-indent reflows every frame → jank.

Unified onto (1) so there is one marquee in the codebase.

## What shipped
- **NowPlaying** ([NowPlaying.svelte:522-523](src/lib/components/NowPlaying.svelte:522)): wrapped
  `.title` + `.artist` text in `<span class="marquee-inner">…</span>` (kept the `{#key uid}` for
  per-track re-measure); deleted the local `@media(.title/.artist:global(.marquee-on))` block +
  `@keyframes marquee-bounce`.
- **Artist page** ([artist/[name]/+page.svelte:240](src/routes/(app)/artist/[name]/+page.svelte:240)):
  markup already used `.marquee-inner` (correct since gsd-260606-rvy); just deleted the dead
  local `:global(.marquee-on)` `text-indent` rule + `@keyframes marquee-bounce` + the stale FIX-C
  comment.

## Verification
- `rg -n "marquee-bounce|@keyframes marquee" src` → only the **global `marquee-scroll`** keyframe
  remains (two `marquee-bounce` hits are now comments in [marquee.ts:3](src/lib/actions/marquee.ts:3)
  + its test header, not CSS).
- `rg -n "use:marquee" src` → **every** consumer has a `<span class="marquee-inner">` child.
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.
- Live (dev): NowPlaying `.title` rendered with inner `.marquee-inner` (whitespace nowrap, display
  inline-block when `.marquee-on`); animation = **marquee-scroll 8s alternate**; overflow test
  (scrollW 921 > clientW 465) confirmed the global rule fires.

## Notes / follow-ups
- The action's leading comment still says "marquee-bounce a label" — harmless prose drift; can be
  swept later. No behavior or CSS impact.
- Per-file `:global()` selectors were both removed (silenced svelte-check's "unused selector"
  warning for those rules); no new warnings.
