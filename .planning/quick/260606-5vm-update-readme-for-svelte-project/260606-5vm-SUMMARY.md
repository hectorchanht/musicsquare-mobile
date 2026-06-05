---
quick: 260606-5vm
slug: update-readme-for-svelte-project
status: complete
date: 2026-06-06
---

# Quick Task 260606-5vm — Summary

Replaced the stale upstream musicsquare README with an accurate **openmusic** SvelteKit README. Doc-only (no build/deploy).

## Shipped
- `README.md` rewritten: title + one-liner + live URL; tech stack (Svelte 5/SvelteKit 2/Vite 8/TS strict/adapter-cloudflare/lucide/Vitest, pnpm — versions verified against package.json); architecture (metadata proxy + browser-direct audio, source-adapter registry, presentation-layer services, runes stores, translate endpoint, (app) route group + /spike); feature list; getting-started scripts (`pnpm dev/build/preview/check/test` — matched to actual package.json scripts, `pnpm test` = vitest --run, 58 tests); project-layout tree; scope/honesty notes (unofficial proxies, browser-direct audio, GSD `.planning/` roadmap); license + upstream credit. Top banner reuses `static/og.svg`.

## Verification
- Facts cross-checked against package.json (scripts + pinned deps) and the live `src/` structure. No code changed → no check/build/test needed; existing 58 tests unaffected.
