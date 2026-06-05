# Stack Research

**Domain:** Mobile-first PWA music/audio streaming web app (SvelteKit + Vite on Cloudflare)
**Researched:** 2026-06-05
**Confidence:** HIGH on framework/build/deploy/state; MEDIUM-HIGH on PWA/audio (verified against WebKit + vite-pwa docs; iOS background-audio caveat is the dominant risk)

> Scope note: the four existing music-source proxy integrations (Netease/QQ/Kuwo/JOOX) and their contracts are REUSED as-is (see `.planning/codebase/INTEGRATIONS.md`). This file recommends the NEW build stack only. The reused fetch logic becomes plain TS modules called from SvelteKit server routes / the client.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Svelte** | `5.x` (current `5.56.x`) | UI framework with runes reactivity | Svelte 5 is the only supported major line. Runes (`$state`, `$derived`, `$effect`) give fine-grained reactivity ideal for a player (current time, queue, now-playing) without a store boilerplate layer. Compiles to small JS — matters on mobile. |
| **SvelteKit** | `2.x` (current `2.63.x`) | App framework: routing, server endpoints, build orchestration | First-class Cloudflare adapter, file-based routing fits bottom-nav tabs, and `+server.ts` routes give you the API proxy *for free* (see below). Peer-requires Svelte 5 / vite-plugin-svelte 7. |
| **Vite** | `8.x` (current `8.0.x`) | Dev server + bundler | Mandated by SvelteKit 2 + vite-plugin-svelte 7 (which peer-requires Vite `^8`). Fast HMR, native ESM, the whole PWA/Workbox toolchain plugs in here. Do not pin Vite 5/6/7 — vite-plugin-svelte 7 requires 8. |
| **@sveltejs/adapter-cloudflare** | `7.x` (current `7.2.x`) | Build SvelteKit for Cloudflare | THE adapter. Builds for **Cloudflare Workers Static Assets** (and is compatible with Pages). Supports all SvelteKit features incl. SSR/server routes. Peer-requires `wrangler ^4`. |
| **Wrangler** | `4.x` (current `4.98.x`) | Cloudflare local dev + deploy CLI | Emulates `platform.env` bindings locally, deploys the app + Worker. Required peer of the adapter. Use a `wrangler.jsonc`/`wrangler.toml` with `compatibility_date` and `nodejs_compat`/`nodejs_als` flag. |
| **TypeScript** | `5.x` (≥ 5.3.3) | Types across app + reused data layer | Strongly recommended when extracting the monolith's fetch logic into modules — the track object has ~25 fields and 4 source-specific shapes; types prevent regressions during extraction. |

### Cloudflare deployment decision (Pages vs Workers, and where the proxy lives)

**Use `adapter-cloudflare` targeting Cloudflare Workers Static Assets. Do NOT build a separate standalone Worker for the music-API proxy — put the proxy in SvelteKit `+server.ts` routes.** (Confidence: HIGH)

Rationale:
- `adapter-cloudflare` deploys your SvelteKit server (hooks + `+server.ts` endpoints) as a Cloudflare Worker, with the client/prerendered assets served as Static Assets from the same deployment. A music-API proxy is just a server route:
  ```ts
  // src/routes/api/[...path]/+server.ts
  export const GET = ({ params, url, platform }) =>
    fetch(`https://api.qijieya.cn/${params.path}${url.search}`);
  ```
  This single route already solves the project's three stated proxy goals: owns CORS (same-origin from the browser's perspective), is the central place for rate-limit/retry/caching, and hides the JOOX token (read from `platform.env.JOOX_TOKEN`, never shipped to the client).
- A separate Worker would mean a second deploy artifact, a second domain (more CORS, not less), and duplicated config — for zero benefit here. Only split into a standalone Worker if the proxy needs to scale/deploy independently of the UI, which this project explicitly does not.
- **Pages vs Workers:** Cloudflare now steers new projects to **Workers Static Assets** (Pages is in maintenance/"recommend Workers" mode). `adapter-cloudflare` is the same adapter for both, so you keep the option open. Recommend Workers Static Assets via `wrangler deploy`; Pages-via-Git also works with the same adapter if you prefer push-to-deploy with zero Wrangler config. PROJECT.md says "Pages for the app, Workers for the API proxy" — the current best practice collapses that to one Workers deployment where the proxy is a server route. Flag this as a roadmap simplification.

Bindings (token, optional KV/cache) are reached via `event.platform.env` in server routes; type them in `src/app.d.ts` via `@cloudflare/workers-types`.

### Audio playback

| Approach | Decision | Why |
|----------|----------|-----|
| **HTML5 `<audio>` element** | **USE** | The reused data layer already produces direct, browser-decodable URLs (MP3/AAC/OGG/FLAC) — exactly what `<audio>` consumes. The existing desktop app uses `<audio>` and it works. No HLS/DASH/MSE in the pipeline, so the heavy machinery is unneeded. Drive one long-lived `Audio` instance from a runes module. |
| **howler.js 2.2.4** | **AVOID** | Adds a Web Audio layer and abstraction the app does not need; its sprite/spatial features are irrelevant. Critically, routing playback through Web Audio (vs a plain media element) can *worsen* iOS lock-screen/Media-Session behavior and complicates Media Session wiring. Last release 2.2.4 is aging. |
| **Web Audio API / AnalyserNode** | **AVOID for transport; OPTIONAL for visualizer** | The desktop app fakes the level meter with `Math.sin()` — keep faking it, or wire a real `AnalyserNode` *only* for the visualizer. Do NOT make Web Audio the playback path. |

### PWA tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **@vite-pwa/sveltekit** | `1.x` (current `1.1.0`) | PWA integration for SvelteKit (manifest + service worker) | Purpose-built for SvelteKit's `.svelte-kit/output` layout; wraps `vite-plugin-pwa`. Generates the manifest, registers/updates the SW, exposes `virtual:pwa-*` helpers for an in-app "update available" prompt. Peer-requires `@sveltejs/kit ^2`. |
| **vite-plugin-pwa** | `1.3.0` | Underlying PWA plugin (Workbox wrapper) | Pulled in transitively; peer-supports Vite `^8`. Use **`generateSW`** strategy with a Workbox `runtimeCaching` config. |
| **workbox-window** | `7.4.1` | Client-side SW registration/update events | Powers the update-prompt flow. |

Service-worker policy (matches PROJECT.md "streamed audio stays online-only"):
- Precache the **app shell** (HTML/CSS/JS, fonts, icons) only.
- `NetworkFirst`/`StaleWhileRevalidate` for the same-origin `/api/*` proxy responses (search results, lyrics) so the UI is snappy and partially works offline.
- **NEVER cache audio stream URLs** — they are third-party, large, expiring, and out of scope (no offline downloads). Add a Workbox `denylist`/no-cache rule for audio hosts.
- Disable SvelteKit's built-in SW (`kit.serviceWorker.register: false`) so vite-pwa owns the SW.

### Media Session + Wake Lock

| API | Use | Notes |
|-----|-----|-------|
| **Media Session API** (`navigator.mediaSession`) | **USE** | Set `metadata` (title/artist/album/artwork) and `setActionHandler` for play/pause/next/prev/seek. Provide **96×96 and 512×512 artwork** (iOS uses the small one on the compact player, large for fullscreen; iOS 18+ uses 512 properly). Update `playbackState` and `setPositionState` to keep lock-screen scrubber synced. No npm dep — it's a Web API; wrap it in a small TS module. |
| **Screen Wake Lock API** (`navigator.wakeLock`) | **USE, with fallback** | Request `'screen'` wake lock while playing if the user keeps the screen on; re-acquire on `visibilitychange`. Supported in Android Chrome and Safari 16.4+. Feature-detect and degrade silently. Note: a screen wake lock keeps the *screen* on — it is not what makes audio survive a *locked* screen (that's the media element + Media Session). |

#### iOS Safari constraint (CRITICAL — drives UX, not a library choice)

- **Audio playing in a normal Safari tab continues with the screen locked and shows Media Session lock-screen controls.** This is the reliable path.
- **Installed standalone PWAs on iOS have a long history of *disabling* background audio** (WebKit bug 198277 and related): audio stops when the standalone app is backgrounded/locked, and the `ended` event may not fire with the screen off. As of Safari 26 (WWDC25) there is *no announced fix* for standalone background audio; the announced media work is MediaRecorder/WebCodecs/MSE, not PWA background playback.
- iOS storage for SW caches is tight (~50 MB) with ~7-day eviction if unused — fine because we only cache the app shell, not audio.
- **Roadmap implication:** treat "installable PWA" and "reliable background audio on iOS" as partially *in tension*. Recommendation: ship the PWA (manifest, installable, app-shell SW) for Android + the in-Safari experience, **detect `navigator.standalone` on iOS and surface guidance / lean on the Safari-tab playback path**, and gate any "it keeps playing when locked" promise on platform. Do not assume installed-PWA background audio on iOS works. This is the single most important caveat for the audio-playback phase.

### State management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Svelte 5 runes in `.svelte.ts` modules** | (built-in) | Global/shared player + library state | 2026 best practice: put shared reactive state in a `.svelte.ts` file using `$state`/`$derived` and export it. Replaces the old store boilerplate for cross-component state (player state, queue, favorites, language). Export an **object** (proxied/reactive) or **getter functions**, never a bare primitive (primitives lose reactivity across module boundaries). |
| **Svelte stores (`writable`)** | (built-in) | Only where a store contract is required | Keep for interop with libraries expecting a store, or `$page`-style derived streams. For this app's own state, prefer runes. |

No Redux/Zustand/Pinia/XState equivalent is needed — runes cover it.

### Animation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Built-in `svelte/transition` + `svelte/motion`** | (built-in) | Mini-player↔full-screen expand, list transitions, springy scrubber/queue | Covers ~all needs with zero deps: `crossfade` for shared-element-style mini→full now-playing morph, `fly`/`slide`/`fade` for sheets and tabs, and the **`Spring`/`Tween` classes** in `svelte/motion` (the rune-era replacement for the deprecated `spring()`/`tweened()` functions) for physics-y values like the seek bar and swipe-to-dismiss. |
| **svelte-gestures** `5.x` | touch gestures | swipe-to-change-track, swipe-down-to-dismiss, drag-to-reorder | Svelte-action-based gesture lib; lighter than rolling raw `pointerdown` math. Verify it targets Svelte 5 before adopting; otherwise implement gestures with Pointer Events + `Spring`. (Confidence: MEDIUM — confirm Svelte 5 support at build time.) |
| **Motion / "Svelte Motion" (Framer-Motion-compatible)** `12.x` | OPTIONAL | only if you need shared-layout/exit/gesture animations beyond built-ins | Drop-in Framer-Motion-style API for Svelte 5. Reach for it only if `crossfade` + `Spring` prove insufficient for the now-playing morph. Default to built-ins to keep the bundle small. |

### Local persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **localStorage** | (built-in) | Language pref, small flags, migrate existing `pikachu-music-*` keys | The existing library blob is small JSON; localStorage keeps parity with current behavior and is dead-simple. Keep using it for settings. |
| **IndexedDB via `idb` 8.0.3** | `8.0.3` | Favorites + playlists library, search/lyrics cache | Recommended target for the library as it grows (many playlists/tracks): async (won't block the main thread / audio), much higher quota than localStorage's ~5 MB, structured. `idb` is the tiny (~1 KB) promise wrapper that makes raw IndexedDB usable. Pairs cleanly with the existing import/export JSON schema. |

Guidance: start by migrating the existing localStorage library, but design the persistence module behind an interface and back it with IndexedDB (`idb`) so growth and offline-readable metadata are not capped at 5 MB. Audio is never persisted.

## Installation

```bash
# Scaffold (creates Svelte 5 + SvelteKit 2 + Vite 8 project)
npx sv create musicsquare-mobile   # choose: SvelteKit, TypeScript, adapter later

# Core deploy adapter + CLI
npm install -D @sveltejs/adapter-cloudflare wrangler @cloudflare/workers-types

# PWA
npm install -D @vite-pwa/sveltekit @vite-pwa/assets-generator

# Supporting libs
npm install idb
npm install svelte-gestures        # verify Svelte 5 support first

# Optional (only if built-in animation is insufficient)
# npm install motion
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `adapter-cloudflare` (Workers Static Assets) | `adapter-cloudflare` (Pages via Git) | If you want push-to-deploy with no Wrangler/CI config and don't need Workers-specific bindings beyond env vars. Same adapter, same code. |
| Proxy as SvelteKit `+server.ts` route | Separate standalone Cloudflare Worker | Only if the proxy must deploy/scale/version independently of the UI, or be shared by other clients. Not the case here. |
| HTML5 `<audio>` | howler.js | If you needed audio sprites, precise gapless crossfade, or spatial audio — none apply. |
| Svelte 5 runes (`.svelte.ts`) | Svelte stores | When a third-party API requires the store contract; or for `$`-prefixed template auto-subscription ergonomics in legacy patterns. |
| Built-in `svelte/transition` + `Spring`/`Tween` | Motion (Svelte Motion) / GSAP | When you need shared-layout transitions, complex exit animations, or timeline orchestration the built-ins can't express. |
| IndexedDB via `idb` | localStorage only | If the library truly stays tiny and you value zero abstraction over quota/async benefits. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@sveltejs/adapter-cloudflare-workers` | Deprecated (old Workers Sites infra), does not support all SvelteKit features | `@sveltejs/adapter-cloudflare` |
| Vite 5/6/7 | vite-plugin-svelte 7 (SvelteKit 2 + Svelte 5) peer-requires Vite `^8`; older Vite causes peer-dep conflicts | Vite 8 |
| Svelte 4 / `export let` / legacy stores-for-everything | Pre-runes; smaller ecosystem support going forward; reactivity is coarser | Svelte 5 + runes |
| howler.js | Unneeded Web Audio abstraction; can degrade iOS lock-screen/Media-Session behavior; aging | Plain `<audio>` + Media Session |
| Routing audio through Web Audio API for transport | Hurts iOS background/lock-screen playback and Media Session integration | `<audio>` element as the player; `AnalyserNode` only for an optional visualizer |
| Caching audio in the service worker | Third-party, large, expiring URLs; out of scope (no offline downloads); blows past iOS ~50 MB quota | Cache app shell + `/api/*` metadata only; audio stays network-only |
| Separate Worker just for CORS | Adds a second domain → *more* CORS, more config, no benefit | Same-origin `+server.ts` proxy |
| Assuming installed iOS PWA = reliable background audio | WebKit historically disables standalone background audio (bug 198277); no Safari 26 fix announced | Lean on Safari-tab playback on iOS; feature-detect `navigator.standalone`; don't promise lock-screen playback on installed iOS PWA |
| `bun`-only scaffolds / exotic runtimes for the Worker | Cloudflare Workers run on V8 isolates with `nodejs_compat`; keep to standard SvelteKit | SvelteKit + `adapter-cloudflare` defaults |

## Stack Patterns by Variant

**If targeting Android Chrome (primary "app-like" experience):**
- Full PWA install + background audio + Media Session + Wake Lock all work.
- This is where the "Spotify feel" promise is fully deliverable.

**If targeting iOS Safari:**
- Ship installable PWA + Media Session, but rely on the **Safari-tab** playback path for screen-locked audio; detect `navigator.standalone` and adjust UX/expectations.
- Keep SW cache to app shell only (≤50 MB, 7-day eviction).

**If the proxy later needs independent scaling or sharing:**
- Promote the `+server.ts` proxy to a standalone Worker with its own `wrangler.jsonc`; keep the same fetch/retry module so logic isn't rewritten.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@sveltejs/kit@2` | `svelte@^5`, `@sveltejs/vite-plugin-svelte@^7`, `vite@^5/6/7/8` | But vite-plugin-svelte 7 forces Vite 8 — use Vite 8. |
| `@sveltejs/vite-plugin-svelte@7` | `svelte@^5.46.4`, `vite@^8` | Hard Vite 8 / Svelte 5.46+ floor. |
| `@sveltejs/adapter-cloudflare@7` | `@sveltejs/kit@^2`, `wrangler@^4` | Keep Wrangler on v4. |
| `@vite-pwa/sveltekit@1` | `@sveltejs/kit@^2`, `@vite-pwa/assets-generator@^1` | Wraps `vite-plugin-pwa@1.3`. |
| `vite-plugin-pwa@1.3` | `vite@^8`, `workbox-build@^7.4`, `workbox-window@^7.4` | Workbox 7.4 toolchain. |
| `idb@8` | any modern browser w/ IndexedDB | Zero runtime peers. |

## Sources

- `/websites/svelte_dev_kit` (Context7) — adapter-cloudflare config, `+server.ts` external-API proxy pattern, `platform.env` bindings, `app.d.ts` typing — HIGH
- https://svelte.dev/docs/kit/adapter-cloudflare — adapter-cloudflare vs deprecated adapter-cloudflare-workers; Workers Static Assets vs Pages — HIGH
- https://vite-pwa-org.netlify.app/frameworks/sveltekit.html — @vite-pwa/sveltekit setup, Workbox generateSW/injectManifest, disable SvelteKit SW — HIGH
- npm registry (`npm view`) on 2026-06-05 — pinned versions: svelte 5.56.2, @sveltejs/kit 2.63.0, vite 8.0.16, @sveltejs/adapter-cloudflare 7.2.8, @sveltejs/vite-plugin-svelte 7.1.2, wrangler 4.98.0, @vite-pwa/sveltekit 1.1.0, vite-plugin-pwa 1.3.0, workbox-window 7.4.1, idb 8.0.3, howler 2.2.4, motion 12.40.0, svelte-gestures 5.2.2 — HIGH
- https://svelte.dev/docs/svelte/$state + Mainmatter "Global state in Svelte 5" + svelte.dev stores docs — runes-in-`.svelte.ts` shared-state pattern, primitive-reactivity caveat — HIGH
- https://svelte.dev/docs/svelte/svelte-motion + motion.svelte.page — `Spring`/`Tween` classes, crossfade, Svelte-Motion as optional Framer-Motion-compatible lib — HIGH
- https://webkit.org/blog/16993/news-from-wwdc25-...safari-26-beta/ — Safari 26: "open as web app" for any site; media additions (MediaRecorder/WebCodecs/MSE); no standalone-PWA background-audio fix announced — MEDIUM-HIGH
- https://bugs.webkit.org/show_bug.cgi?id=198277 — standalone web app audio stops when backgrounded (the core iOS caveat) — MEDIUM (long-standing bug, status nuanced)
- https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide + https://whatpwacando.today/audio/ — iOS PWA storage (~50 MB / 7-day), Media Session UI controls, standalone vs tab differences — MEDIUM
- MDN (Media Session API, Screen Wake Lock API) — API shape, Wake Lock Safari 16.4+ support, artwork sizing — MEDIUM-HIGH

---
*Stack research for: mobile-first PWA music streaming app on SvelteKit + Cloudflare*
*Researched: 2026-06-05*
