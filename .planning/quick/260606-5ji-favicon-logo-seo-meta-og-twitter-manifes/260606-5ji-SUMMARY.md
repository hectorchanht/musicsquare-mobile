---
quick: 260606-5ji
slug: favicon-logo-seo-meta-og-twitter-manifest-sitemap
status: complete
date: 2026-06-06
---

# Quick Task 260606-5ji — Summary

Brand mark + full SEO/social/PWA-metadata pass on the deployed openmusic app. Phase-1 data layer + 58 tests untouched. Live at openmusic.pages.dev.

## Logo + favicon
- Hand-authored SVG mark (variant-C violet gradient rounded tile + a white **"open" groove ring** with a gap wrapping a **play triangle** — "open" + "music"). Crisp at 16px.
- `static/favicon.svg` (the mark) + `static/icon-maskable.svg` (full-bleed, maskable/apple-touch safe).
- `src/lib/components/Logo.svelte` (inline, size prop, unique gradient id) — used in the Home top-nav brand (replaces the old Music2 dot) so in-app logo == favicon.
- app.html: `<link rel=icon>` (svg), `apple-touch-icon`, `manifest`, `theme-color #0b0b0f`, `color-scheme dark`, apple-web-app meta, `viewport-fit=cover`.

## SEO metadata (root +layout `<svelte:head>`)
- Default `<title>` "openmusic — stream music from every source" + meta description; canonical from the request path.
- Open Graph (type/site_name/title/description/url/image 1200×630) + Twitter (summary_large_image, title/description/image). og:image/twitter:image → `/og.svg`.

## Share card + crawl files
- `static/og.svg` — 1200×630 branded card (dark bg, violet glow, logo + wordmark + tagline + source list). Code comment notes SVG OG isn't universally rendered by crawlers (Slack/iMessage prefer PNG); PNG export is the production follow-up (no render toolchain here).
- `static/manifest.webmanifest` (name/short_name/description/standalone/start_url/theme/bg + svg + maskable icons — metadata only; the service-worker PWA is the planned Phase 5).
- `static/robots.txt` + Sitemap line; `static/sitemap.xml` (/, /search, /library, /settings).

## Verification
- `pnpm check` 0/0 (3954 files); `pnpm build` ok; `pnpm vitest run` 58/58.
- Deployed → https://openmusic.pages.dev. `/favicon.svg`, `/og.svg`, `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/icon-maskable.svg` all 200; home `<head>` contains og:/twitter:/description/canonical/manifest.

## Notes
- SVG OG image caveat documented (PNG export is the production-correct follow-up).
- Old unused `src/lib/assets/favicon.svg` left in place (harmless); root layout now uses the static favicon.
