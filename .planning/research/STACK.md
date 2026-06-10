# Stack Research — v1.2 Resilient Playback & UX Polish

> **Scope note:** This is a SUBSEQUENT-milestone (v1.2) research file. The base-app stack
> (SvelteKit 2 / Svelte 5 runes, Vite, adapter-cloudflare, audio engine, MediaSession, blob
> downloads, Last.fm/Deezer services) already ships and is NOT re-researched. This file covers
> ONLY what the NEW v1.2 features need.

**Domain:** Mobile-first music PWA — v1.2 features (SvelteKit 2 / Svelte 5 runes on Cloudflare Pages/Workers)
**Researched:** 2026-06-10
**Confidence:** HIGH

## TL;DR for the roadmap

**Net new runtime dependencies for v1.2: ZERO.** Every v1.2 feature is buildable with web-platform
APIs already available in the target browsers plus SvelteKit's built-in primitives. The current
`package.json` (1 runtime dep: `@lucide/svelte`) should stay that lean.

The single biggest realization from reading the codebase: **most of the "Resilient Playback" engine
already ships.** `src/lib/stores/player.svelte.ts` already implements cross-source failover
(`runFallback` / `tryFallback`), gapless next-track **prefetch** (`prefetchNext` — resolve-ahead, not
byte-warming), auto-generated up-next (`regenerate` + `buildSimilarQueue`, `ensureAhead` +
`buildDiversePicks`), a generation guard against skip-loops/stale resolves (`playGen`), offline-first
blob playback, tri-state repeat, and MediaSession transport. v1.2 is mostly **wiring + policy + UI**,
not new tech (e.g. repeat reduces 3→2 states; failover toast is a UI hook on an existing path).

So this file's job is to (a) confirm the zero-dep path for the genuinely-new surfaces (sleep timer,
per-entity SEO/OG, offline service worker, remaining gestures, toasts/guards, lazy cover resolve), and
(b) actively warn against the libraries it would be tempting — but wrong — to add.

## Recommended Stack

### Core Technologies (already in the repo — DO NOT change)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| SvelteKit | 2.63.0 | App framework + routing + SSR | Already chosen; SSR-at-edge is exactly what per-entity OG metadata needs (verified below). No version bump required for v1.2. |
| Svelte | 5.56.2 (runes) | Reactive UI | Runes mode is forced in `svelte.config.js`. `$state` singletons (player/settings/library stores) are the right home for new state (sleep timer, up-next config, toasts, network flag). |
| `@sveltejs/adapter-cloudflare` | 7.2.8 | Cloudflare Pages/Workers build | **Confirmed: full SSR by default** at the edge (Cloudflare Pages Functions). Dynamically-rendered pages with `<svelte:head>` OG tags ARE delivered to social/bot crawlers — no extra adapter config needed. |
| Vite | 8.0.16 | Build/dev | No change. |
| `@lucide/svelte` | ^1.17.0 | Icons | The ONLY runtime dep, and the only one v1.2 needs (sleep-timer / remix / etc. icons come from here). |

### Web Platform APIs (the actual "stack additions" — all zero-dependency)

| Capability (v1.2 feature) | Web API / built-in | Status in target browsers | Notes / integration point |
|---------------------------|--------------------|---------------------------|---------------------------|
| **Sleep timer (duration + end-of-track)** | `setTimeout` / `clearTimeout` | Universal | Add a `sleepTimer` slice to `player.svelte.ts` (or a tiny `sleep-timer.svelte.ts` store). Duration mode = `setTimeout(() => player pause+clear, ms)`. "End of track" mode = a one-shot `stopAfterCurrent` flag the existing `ended` handler checks **before** `repeatMode`/`next()`. Persist nothing (timers reset on reload). NO library. |
| **Per-entity SEO / OG meta tags** | SvelteKit `load` (`+page.ts`) + `<svelte:head>` | SSR on by default | Move per-route metadata into a `load` function so it's **server-rendered** (crawlers don't run JS). Set `<title>`, `og:title/description/image`, `twitter:card` from `data`. THIS IS THE GAP: today there are zero `load` files and no per-page OG. See ARCHITECTURE/PITFALLS. |
| **Short recognizable slugs** | SvelteKit param routes + a slugify helper | n/a | `album/[name]` and `artist/[name]` routes already exist. For songs add `/s/[slug]`. Slug = `slugify(title-artist)` + short id; resolve server-side in `load`. Pure string helper, ~15 lines. NO `slugify` package. |
| **Offline app shell + downloaded-track playback offline** | SvelteKit **native `src/service-worker.js`** + `$service-worker` module + Cache API | Universal | SvelteKit auto-registers `src/service-worker.js` and exposes `build`/`files`/`version`. Precache the app shell (`build` + static `files`) on `install`; network-first-with-cache-fallback for navigations. Downloaded **audio** is already in IndexedDB via `blob-store.ts`, and the player already plays from blobs offline (`play()`/`restore()` offline-first branches) — the SW only needs to make the **shell + JS** load offline. **NO `vite-plugin-pwa`.** |
| **Online-only data degradation when offline** | `navigator.onLine` + `online`/`offline` events | Universal | A tiny `network.svelte.ts` `$state` flag; UI shows skeleton/empty states for online-only shelves (discovery/charts) and disables network actions. NO library. |
| **Cover swipe prev/next; sheet drag; up-next reorder** | Pointer Events (`onpointerdown/move/up`) + `setPointerCapture` + existing `gestures/velocity.ts` | Universal | **Already the established pattern.** `NowPlaying.svelte` + `actions/dragClose.ts` + `actions/dragReorder.ts` + `actions/dragScroll.ts` + `gestures/velocity.ts` do live finger-following drags with capture, slop thresholds, and flick velocity — entirely dependency-free. New cover-swipe follows the same idiom (it already calls `player.prev()/next()`). NO gesture library. |
| **Lyrics-panel touch suspends auto-scroll** | Pointer/scroll events + a "user is touching" flag | Universal | The pattern (`pressedPointers` Set + window-level `pointerup`/`pointercancel` capture listeners) already exists in `NowPlaying.svelte`. Suspend the lyrics auto-scroll while pressed; resume after release + idle window. NO library. |
| **Scroll containment in layered sheets** | CSS `overscroll-behavior: contain` | Universal | Pure CSS on the scrollable sheet body — stops scroll chaining to the page behind a half-open sheet. **Currently unused anywhere** (grep: 0 hits) — quick correctness win. NO JS. |
| **Toast notifications** | Svelte 5 `$state` store + CSS/Svelte transitions | n/a | A `toasts.svelte.ts` `$state<Toast[]>` array + a `<Toaster>` root component using `transition:fly`/`fade`. The failover path already wants "toast + auto-skip"; the polish item wants "button toast". NO `svelte-sonner` / `svelte-french-toast`. |
| **Double-click / double-tap guard** | A `pending`/disabled flag + timestamp, mirroring `actions/longpress.ts` | n/a | Guard = ignore a second activation within ~400ms, or disable the button while an async action is `pending`. Implement as a tiny `use:guardedClick` action. NO library. |
| **IntersectionObserver cover lazy-resolve + name-keyed cache** | `IntersectionObserver` + existing `cover-cache.ts` / `match-key.ts` | Universal | `IntersectionObserver` is already used in `search/+page.svelte`. Generalize into a `use:inView` action that triggers `cover-art.ts` resolve on intersect, keyed via the existing `match-key.ts` + cached in `cover-cache.ts`. NO library. |
| **Background audio on lock screen** | `<audio>` + MediaSession (already wired) | Already shipping | No change. (See "What NOT to Use" re: Wake Lock — wrong tool, NOT needed.) |
| **Share** | existing `share.ts` (base64url token) + optional `navigator.share` | `navigator.share` good on mobile | `share.ts` already builds `/?play=<token>`. v1.2 can add feature-detected `navigator.share()` (fallback: clipboard). The SEO/OG `/s/[slug]` work is the bigger, separate piece. NO library. |

### Development Tools (already in the repo — no additions)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest | 4.1.3 | Tests run under a node project (`vite.config.ts`). New pure logic (sleep-timer math, slugify, network flag, toast queue) is node-testable — keep that discipline. |
| `svelte-check` / TypeScript | ^4.4.6 / ~5.9 | Type-check pipeline (`pnpm check`). |
| Wrangler | 4.98.0 | Local Cloudflare preview (`pnpm preview`) — use it to verify the service worker + SSR'd OG tags behave on the real Pages runtime, not just `vite dev` (SW registration differs between the two). |
| `@cloudflare/workers-types` | 4.20260605.1 | Edge types for `App.Platform.env` (JOOX/Last.fm secrets). |

## Installation

```bash
# Core: nothing to install — every v1.2 capability uses web-platform APIs +
# SvelteKit/Svelte primitives already present.

# Supporting: none.

# Dev dependencies: none.
```

If a future maintainer insists on a helper, the ONLY remotely defensible optional add is a metadata
helper for SEO ergonomics — and even that is discouraged (see below):

```bash
# OPTIONAL, NOT RECOMMENDED — see "What NOT to Use".
# pnpm add svelte-meta-tags
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Native `src/service-worker.js` + Cache API | `@vite-pwa/sveltekit` (Workbox) | Only if you later want runtime-cache *strategy config*, auto-update prompts, or a generated manifest you can't hand-maintain. For "shell loads offline + downloaded tracks play (already in IDB)" it is overkill — Workbox precaching duplicates what `$service-worker`'s `build`/`files` already give you, and adds a build-time dependency + a documented non-precached-`/`-URL footgun on SvelteKit (vite-pwa #400). Stay native. |
| `<svelte:head>` + `load` for OG | `svelte-meta-tags` | Only if many routes need many tags and you want a typed component. For ~4 entity types (song/album/artist + home) a 10-line `<svelte:head>` block per route is clearer and dep-free. |
| `IntersectionObserver` `use:inView` action | `svelte-intersection-observer` | Never for this project — the raw API is ~10 lines and already in use in search. |
| Pointer Events + `velocity.ts` | `@use-gesture/vanilla`, `hammerjs`, `swiper` | Never — established custom-action pattern (`dragClose`, `dragReorder`, `dragScroll`, `chipReorder`, `longpress`) already covers drag/flick/reorder with capture + velocity. A gesture lib would fight the existing pointer-capture/slop logic. |
| `$state` toast store + Svelte transitions | `svelte-sonner`, `svelte-french-toast` | Only if you want stacked/animated toast presets out of the box and don't mind a dep. Not worth it for the 1–2 toast types v1.2 needs (failover-skip, action confirmations). |
| `setTimeout` sleep timer | `rxjs`/timer libs | Never — a single `setTimeout` + the existing `ended` handler is the whole feature. |
| Hand-rolled slugify | `slugify`, `@sindresorhus/slugify` | Only if you need full Unicode transliteration of CJK titles to ASCII. Given titles are often CJK, "keep recognizable + short id" beats lossy transliteration anyway. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Screen Wake Lock API** for the sleep timer / background audio | Wake Lock keeps the **screen ON** — the *opposite* of a sleep timer, and irrelevant to background audio (audio + MediaSession already keep playback alive when the screen locks). It would only drain battery, and it had an installed-PWA bug on iOS until 18.4. | A plain `setTimeout` sleep timer; the existing `<audio>` + MediaSession for lock-screen playback. |
| `@vite-pwa/sveltekit` / Workbox | Adds a build-time dependency + config surface to do what SvelteKit's native `$service-worker` (`build`/`files`/`version`) already does for app-shell precaching; the audio cache is already in IndexedDB. Documented SvelteKit `/`-precache footgun (vite-pwa #400). | Native `src/service-worker.js`. |
| Any gesture/swipe library (Hammer.js, Swiper, use-gesture) | Duplicates and conflicts with the project's mature pointer-capture + `velocity.ts` flick pattern; pulls in legacy touch-event assumptions. | Pointer Events + existing `gestures/velocity.ts` + `actions/drag*` idiom. |
| Toast libraries (sonner/french-toast) | One more dep for a ~30-line `$state` array + a `transition:fly` component; the project's whole ethos is near-zero deps. | `toasts.svelte.ts` `$state` store. |
| `ssr = false` / pure SPA mode to "simplify" | Would BREAK per-entity OG/SEO — crawlers don't execute JS, so client-only `<svelte:head>` updates never reach them. This is exactly the failure mode in SvelteKit OG issue #10232. | Keep SSR on (default); render OG tags from a `load` function so they're in the server HTML. |
| `prerender = true` everywhere for SEO | Entity pages (song/album/artist) are dynamic and effectively unbounded — you can't enumerate `entries()` for arbitrary songs, so prerendering would force a crawl of an infinite set. | SSR-on-demand at the edge (adapter-cloudflare default). Optionally prerender only the static shell routes (home/about). |
| A `localStorage`-persisted sleep timer | A wall-clock timer can't meaningfully survive a reload, and "stop in 30 min" across a refresh is surprising. | In-memory `setTimeout`; reset on reload. |
| Embedding a stream URL in share/OG links | Stream URLs expire (the player already re-resolves them on play). | Share token carries a stub (`share.ts` already does this); omit `og:audio` or point it at the app, not a CDN URL. |

## Stack Patterns by Variant

**For the offline service worker:**
- **Network-first** for HTML navigations (fresh data online, cached shell offline); **cache-first** for `build`/`files` immutable assets — exactly the SvelteKit docs reference SW.
- Do **NOT** cache `/api/*` proxy responses in the SW (upstream-volatile + already TTL-cached in `ttl-cache.ts`); let them go network-only and fail gracefully via the `navigator.onLine` flag.
- Bump cache via `$service-worker`'s `version` (deploy-keyed) so old caches purge on `activate`.
- Verify on `wrangler pages dev` (`pnpm preview`), not just `vite dev` — SW registration/scope differs on the real Pages runtime.

**For per-entity SEO/OG:**
- Put metadata in `+page.ts` `load` (runs server-side for first paint) returning `{ title, description, image }`; render in `<svelte:head>` from `data`. Keep client-side enrichment (translations / cover backfill) as a progressive upgrade *after* the server-rendered baseline.
- For the share target, a dedicated `/s/[slug]` route whose `load` decodes the slug/stub gives bots a real HTML page with correct OG tags (today's `/?play=token` query param is invisible to crawlers).

**For the sleep timer:**
- Two modes per PROJECT.md: fixed durations (industry-standard 5/10/15/30/45/60 min) AND "end of current track."
- Duration → `setTimeout` that pauses + clears + toasts.
- End-of-track → set `player.stopAfterCurrent = true`; the existing `ended` handler checks it before `repeatMode`/`next()`.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| SvelteKit 2.63.0 | Svelte 5.56.2 | Current repo pairing; runes mode forced. No bump needed for v1.2. |
| `adapter-cloudflare` 7.2.8 | SvelteKit 2.x | SSR-at-edge default supports all v1.2 SEO needs; `_routes.json` auto-generated (override only to trim function invocations). |
| Native `$service-worker` | SvelteKit 2.x + adapter-cloudflare | SW is bundled + auto-registered; works alongside Cloudflare Pages static assets. Verify under `wrangler pages dev`. |
| `IntersectionObserver` / Pointer Events / `overscroll-behavior` / `navigator.onLine` | iOS Safari 16.4+ / Android Chrome | All baseline-available in the stated mobile targets. |

## Sources

- `src/lib/stores/player.svelte.ts` (read in full) — confirms failover/prefetch/regenerate/skip-guard/offline-blob/tri-state-repeat already implemented. HIGH.
- `src/lib/services/share.ts`, `src/app.html`, `static/manifest.webmanifest`, `static/{robots.txt,sitemap.xml}` (read) — share-token exists, PWA manifest exists, NO service worker, NO per-page OG, NO `load` functions. HIGH.
- `src/lib/actions/dragClose.ts`, `src/lib/gestures/velocity.ts`, grep of `pointer*` / `IntersectionObserver` / `overscroll` (read) — confirms zero-dep gesture pattern; `overscroll-behavior` currently unused. HIGH.
- Context7 `/sveltejs/kit` — service workers (`$service-worker` module + native SW example) + page options (SSR/prerender/`entries`). HIGH.
- https://svelte.dev/docs/kit/adapter-cloudflare (WebFetch) — adapter-cloudflare = full SSR at edge by default; dynamic `<svelte:head>` reaches crawlers; no special config needed. HIGH.
- https://github.com/sveltejs/kit/issues/10232 — documented OG-on-dynamic-routes failure mode (the SPA/client-only-head trap). MEDIUM.
- https://github.com/vite-pwa/vite-plugin-pwa/issues/400 + https://vite-pwa-org.netlify.app/frameworks/sveltekit + https://svelte.dev/docs/kit/service-workers — vite-pwa vs native SW; `/`-precache footgun. MEDIUM.
- https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API + https://caniuse.com/wake-lock — Wake Lock keeps screen ON (wrong for sleep timer), iOS PWA bug fixed 18.4. HIGH.

---
*Stack research for: mobile music PWA v1.2 (SvelteKit + Cloudflare)*
*Researched: 2026-06-10*
