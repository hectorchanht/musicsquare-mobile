# Phase 24: Offline App-Shell & Sharing/SEO - Discussion Log

> **Audit trail only.** Not consumed by planning/research/execution agents.
> Decisions live in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-06-13
**Phase:** 24-offline-app-shell-sharing-seo
**Mode:** discuss (default)
**Areas discussed:** SSR strategy, Share-link shape, OG image source, Offline UX

## Scout findings that shaped the questions
- Root `src/routes/+layout.ts` is `ssr = false` + `prerender = false` → full CSR SPA; `PageOg.svelte` tags only render after hydration, so crawlers currently see none. This is the central SHARE/SEO tension.
- Dual-adapter build (`svelte.config.js`): default Cloudflare, `BUILD_TARGET=static` → adapter-static SPA for Capacitor. SSR must not break the static build.
- Already present: `share.ts` (base64url v2 payload + `buildOg`), `PageOg.svelte`, album/artist `+page.ts` building `og`, `blob-store.ts`, `downloads-queue.ts`, `static/manifest.webmanifest`. No `service-worker.ts`, no `+page.server.ts`.

## Questions & Selections

### SSR strategy
- Options: Per-route SSR subtree (rec) / Dedicated /s/[slug] landing / Flip whole app to SSR
- **Selected:** Per-route SSR subtree → D-01/D-02/D-03

### Share-link shape
- Options: slug-id ascii slug (rec) / URL-encoded CJK slug / Short id only
- **Selected:** slug-id, ascii slug → D-04/D-05/D-06

### OG image source
- Options: Cover URL + static fallback (rec) / Edge-composed card / Always static branded
- **Selected:** Cover URL + static fallback → D-07; edge-composed card deferred → D-08

### Offline UX
- Options: Per-surface inline + promote Downloads (rec) / Global redirect to Downloads / Banner only
- **Selected:** Per-surface inline + promote Downloads → D-09/D-10

## Deferred ideas
- Edge-composed OG cards (D-08).
- Background offline sync / pre-download of up-next.

## Notes
- Both halves flagged HIGH research; CONTEXT defers SW internals (precache, version-keying, iOS PWA quirks) and slugify-library choice to `/gsd:plan-phase --research-phase 24`.
