# Project Research Summary

**Project:** MusicSquare Mobile — v1.2 "Resilient Playback & UX Polish"
**Domain:** Mobile-first music PWA (SvelteKit 2 / Svelte 5 runes, Cloudflare Pages/Workers)
**Researched:** 2026-06-10
**Confidence:** HIGH

## Executive Summary

v1.2 is a polish-and-resilience milestone on an already-functional SvelteKit music PWA, not a greenfield build. The most important research finding is that the majority of the "Resilient Playback" engine already ships in `src/lib/stores/player.svelte.ts`: cross-source failover (`runFallback`/`tryFallback`), generation-guarded prefetch (`prefetchNext`), auto-generated up-next (`buildSimilarQueue`/`buildDiversePicks`/`ensureAhead`), and offline-first blob playback all exist today. The v1.2 work is predominantly **wiring, policy, and UI** layered on that engine — the skip-loop guard, the toast contract, the per-context sourcing setting, the sleep timer, cover swipe, and the TrackMenu rework — rather than new subsystems. Net-new runtime dependencies: zero.

Two features are genuinely net-new infrastructure and carry the highest risk: the **offline app-shell service worker** (no SW exists today; the app shell is uncached despite audio blobs being locally playable) and **per-entity SSR OG/slugs** (every route is client-rendered today; social crawlers see generic meta). Both require platform-level changes (SW lifecycle on Cloudflare Pages; `+page.server.ts` load at edge) that are not trivial to test locally. Research recommends the native SvelteKit `src/service-worker.ts` approach (no vite-pwa) and SSR via `adapter-cloudflare`'s default Pages Functions. Both phases should be isolated to the end of the milestone.

The 17-item UX audit (AUD-01..17) surfaces several items v1.2 only partially addresses: queue power-ops (swipe-to-remove, clear queue — AUD-02), row swipe-actions (AUD-01), haptics (AUD-04), and tap-lyric-to-seek (AUD-12) are the biggest not-fully-in-scope gaps. The highest-risk UX interaction is cover-swipe vs sheet-collapse gesture conflict (AUD-15/Pitfall 7): axis arbitration must reuse the existing slop-threshold + pointer-capture-after-movement idiom exactly, or taps on the cover stop working. The overlay `$effect` history invariant (open-flag-only dep, single dismiss path) is the other high-consequence constraint every menu/sheet change must respect.

---

## Key Findings

### Recommended Stack

Net new runtime deps: zero. Every v1.2 capability uses web-platform APIs already available plus SvelteKit primitives already present. `package.json` stays at one runtime dep (`@lucide/svelte`).

**Core technologies (do not change):**
- SvelteKit 2.63.0 / Svelte 5.56.2 (runes) — app framework; `$state` singletons are the right home for sleep timer, online flag, toasts, queueContext
- `@sveltejs/adapter-cloudflare` 7.2.8 — full SSR at edge by default; `+page.server.ts` loads ARE delivered to non-JS crawlers; no adapter changes needed for OG
- `@lucide/svelte` ^1.17.0 — only runtime dep; covers all new icons

**Web-platform additions (all zero-dependency):**
- `setTimeout`/`clearTimeout` — sleep timer
- `src/service-worker.ts` + `$service-worker` + Cache API — app-shell offline (not vite-pwa)
- `navigator.onLine` + events — `online.svelte.ts` leaf store
- Pointer Events + existing `gestures/velocity.ts` — cover swipe (no gesture library)
- `IntersectionObserver` — `coverInView.ts` action (already used in search)
- CSS `overscroll-behavior: contain` — scroll containment (0 uses today; pure CSS)
- `$state<Toast[]>` + `transition:fly` — `toasts.svelte.ts` (no sonner)
- SvelteKit `load` + `<svelte:head>` — per-entity SSR OG (no svelte-meta-tags)

**Explicit do-not-add:** Screen Wake Lock API; `@vite-pwa/sveltekit`/Workbox; any gesture library; toast libraries; second `<audio>` element; `ssr = false`; `prerender = true` everywhere.

### Expected Features

**Must have (table stakes for v1.2):**
- Never-stop playback — auto-skip on fail with toast, loop-guard (cap ~5 consecutive failures), prefetch-ahead resolve
- Sleep timer — 5/10/15/30/45/60 min + end-of-track; persistent active indicator in now-playing
- Cover swipe prev/next — horizontal, axis-locked against vertical sheet-collapse
- 2-state repeat (off / repeat-one) — drop repeat-all; continuation = never-stop autoplay
- Per-context up-next sourcing — global default = generated; search never silently queues its result list
- Shape-matched skeletons everywhere, double-click guard, button toasts
- Lyrics fixes — end-of-lyrics spacer, CN highlight ordering, wider bracket robustness

**Should have (differentiators, in v1.2 scope):**
- Remix / "start radio from this track" — TrackMenu action seeding `buildSimilarQueue`
- Per-entity OG + readable slugs — Apple-style `/song/{slug}-{id}`; SSR OG from `+page.server.ts`
- Cover fallback resolver + scroll-into-view via IntersectionObserver
- Homepage compact rows-of-4 density + "see all" nav
- Text-size 50–200% with contextual demo text
- Offline degradation display — online-only shelves degrade gracefully; downloads still playable
- Search scoring tune — short-title boost, artist-frequency boost, <60s preview penalty

**UX audit gaps not fully covered (candidate adds or v1.3):**
- AUD-01: Row swipe-actions (swipe-to-queue/like) — not in scope
- AUD-02: Queue power-ops (swipe-to-remove, clear, save as playlist) — partial only
- AUD-04: Haptic feedback — zero current use; cheap cross-cutting add
- AUD-12: Tap-lyric-to-seek — low effort, high polish; explicitly out of scope
- AUD-05: Nowbar horizontal swipe — cover-swipe specced for now-playing only
- AUD-11: Full accessibility pass (aria-pressed everywhere, full focus-trap) — partial fix only

**Defer to v1.3+:** True gapless/crossfade; second `<audio>` for byte-warming; haptics-everywhere; Last.fm write-side; repeat-all.

### Architecture Approach

Almost every v1.2 feature extends an existing module rather than creating a new subsystem. The genuinely new files are: `sleep-timer.svelte.ts` (leaf store), `online.svelte.ts` (leaf store), `src/service-worker.ts`, two `+page.server.ts` for artist/album (SSR OG), and `slug.ts` + `coverInView.ts` (small pure helpers). Everything else modifies existing files — primarily `player.svelte.ts`, `TrackMenu.svelte`, `NowPlaying.svelte`, `config/defaults.ts`, and `settings.svelte.ts`.

**Major components and v1.2 responsibilities:**
1. `player.svelte.ts` — `consecutiveSkips` loop-guard, auto-skip-on-exhaustion, `queueContext`, repeat 2-state, offline short-circuit, sleep-timer callback hook, `resolvedCover`; every change must honor `playGen` generation discipline
2. `TrackMenu.svelte` — 2-row marquee header, like+close at top-right, remix + sleep actions, resolve-then-act guard keyed by `uid`; overlay `$effect` must remain `open`-only dep
3. `NowPlaying.svelte` — horizontal cover swipe (axis-locked), end-of-lyrics spacer, playing-track cover fallback, repeat icon reduction
4. `config/defaults.ts` + `settings.svelte.ts` — `UPNEXT_DEFAULTS`, per-section density, widened font-scale
5. `src/service-worker.ts` (NEW) — precache `build`+`files`; never cache `/api/*`; version-keyed activate eviction
6. `+page.server.ts` for artist/album (NEW) — minimal entity metadata for server-rendered OG

**Invariants v1.2 must not break:**
- Single `<audio>` element (iOS constraint; no second element)
- `playGen` monotonic guard on every async playback path
- Overlay `$effect` depends on `open` only, with `untrack()` around overlay calls
- Stores never import the player (leaf/no circular deps)
- Services never throw (null-return + degrade)
- SW must not cache `/api/*` or audio CDN responses

### Critical Pitfalls

1. **Infinite auto-skip loop — P-FAILOVER:** `consecutiveSkips` counter on `player.svelte.ts`; cap at ~5; stop + one sticky toast; reset on a successful `audio playing` event or user gesture; gate whole chain on `navigator.onLine === false`.
2. **iOS Safari rejects `play()` after async `src` swap — P-FAILOVER/P-PREFETCH:** Keep single `<audio>`; treat rejected `play()` promise as failure into the loop-guard counter (not silent `.catch(() => {})`); prefetch URL while current track plays to minimize the activation gap.
3. **Overlay `$effect` over-dep churns history stack — P-MENU:** `$effect` dep = `open` only; `untrack()` around overlay calls; `{#if open && track}` for visibility; one dismiss path; any new sub-sheet follows the `pickerOpen` precedent.
4. **SW caches `/api/*` or stale app shell — P-SW:** Network-only for all `/api/*`; cache only `$service-worker.build`+`files` keyed by `version`; on `activate` delete every cache !== current version; include `skipWaiting()` + `clients.claim()` kill-switch.
5. **Client-only OG invisible to crawlers — P-SEO:** Move entity OG to `+page.server.ts` load → `data` → `<svelte:head>` server-rendered in initial HTML; CJK slugs encode once, decode once; keep canonical `uid` in path as stable resolver.
6. **Act-on-unresolved-stub corrupts library — P-MENU:** Gate Like/Download/Share/Add-to-Queue on `track.detailsLoaded && track.uid`; await the in-flight resolve then act, or disable those rows in skeleton state.
7. **Cover-swipe vs sheet-collapse gesture collision — P-GESTURE:** Never `setPointerCapture` on `pointerdown`; commit axis in `pointermove` after slop; horizontal-dominant → cover swipe; vertical-dominant → parent collapse wins; movement below slop must reach `onclick` (tap contract).

---

## Implications for Roadmap

### Phase A: Playback Resilience Core
**Rationale:** Dependency root — `queueContext`, repeat 2-state, skip-loop guard, offline short-circuit, and auto-skip-on-exhaustion must stabilize before anything builds on the player.
**Delivers:** Player that never infinite-loops; correct 2-state repeat; per-origin queue context field
**Files:** `player.svelte.ts` (primary), `fallback.ts` (minor), `NowPlaying.svelte` (repeat icon)
**Research flag:** LOW — extension of documented existing `player.svelte.ts` logic

### Phase B: Up-Next Sourcing + Settings Plumbing
**Rationale:** Depends on A's `queueContext`. Batches all `config/defaults.ts` changes together.
**Delivers:** Global up-next default = generated; per-section density; widened font scale; remix menu action
**Pitfalls:** recommendation loop (recently-played ring buffer, pick beyond top-1), queue mutation race (honor `manualUids`)
**Research flag:** LOW

### Phase C: Sleep Timer
**Delivers:** Sleep timer with absolute-timestamp deadline; player pause hook; end-of-track mode; active indicator
**Pitfalls:** background tab throttle drift
**Research flag:** LOW

### Phase D: TrackMenu Rework
**Rationale:** Depends on sleep timer (C) and remix (B). Most constraint-dense UI change in the milestone.
**Delivers:** 2-row marquee header, like+close at top-right, remix, sleep-timer UI, longpress focus fix
**Pitfalls:** act-on-stub, `$effect` open-only dep, goto/dismiss race, marquee re-measure, double-action dedupe
**Research flag:** LOW-MEDIUM

### Phase E: Cover Pipeline Polish
**Delivers:** Cover fallback for playing track (NowPlaying + Nowbar + MediaSession); scroll-into-view lazy resolve
**Pitfalls:** name-key cache collision — key by `uid` first
**Research flag:** LOW

### Phase F: Lyrics Polish
**Delivers:** End-of-lyrics spacer; wider bracket robustness; verified CN highlight ordering; confirmed touch-suspend
**Research flag:** LOW — pure logic with existing test file (`lrc.test.ts`)

### Phase G: Offline App-Shell
**Rationale:** Net-new infra isolated at end. Ship `online.svelte.ts` + offline route guards first (no SW dependency); SW second.
**Delivers:** App shell loadable offline; downloaded tracks playable on installed PWA with no network; friendly degradation
**Research flag:** HIGH — needs `plan-phase --research-phase N`. SW lifecycle on Cloudflare Pages; iOS Safari PWA+SW+background-audio; cache-versioning on deploy; verify under `wrangler pages dev`.

### Phase H: SEO / Slugs
**Rationale:** Highest deploy risk; changes rendering mode for entity routes. Sequence last; validate on Cloudflare environment.
**Delivers:** Per-entity OG for artist/album in initial server HTML; readable share slugs; rich unfurls
**Research flag:** HIGH — needs `plan-phase --research-phase N`. `+page.server.ts` at edge; `og:image` strategy; CJK slug encoding; scraper testing.

### Phase Ordering Rationale
- A is the dependency root: `queueContext` feeds B; stable `ended`-handler feeds C; skip-loop guard must not conflict with C's sleep-timer suppress-`next()`.
- B–D form a tight dependency chain (context → settings → menu); batching minimizes player churn.
- E–F are independent polish sequenced after structural player work settles to avoid merge conflicts on `NowPlaying.svelte`.
- G–H are isolated by design: net-new infra with Cloudflare-specific behavior, higher blast radius, mandatory wrangler-environment validation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct reads of `player.svelte.ts`, `package.json`, `svelte.config.js`; adapter-cloudflare SSR via official docs; native SW vs vite-pwa via vite-pwa issue #400 |
| Features | MEDIUM-HIGH | Sleep-timer durations verified against Spotify Newsroom; UX audit grounded against actual component code on 2026-06-10 |
| Architecture | HIGH | All integration points from direct code reads; build order from actual dependency graph; invariants quoted from in-code documentation |
| Pitfalls | HIGH | iOS autoplay/src-swap from WebKit blog + MDN; background-tab timer throttling from Chrome 88 notes; overlay/history pitfalls from direct reads |

**Overall confidence:** HIGH

### Gaps to Address
- **Phase G SW specifics:** How `$service-worker`'s `build`/`files`/`version` interact with Cloudflare's edge-cached static assets — needs `wrangler pages dev` verification.
- **Phase H `og:image` strategy:** Entity cover URL (unstable CDN) vs composed OG card vs static fallback — decide at plan-phase.
- **AUD-12 tap-lyric-to-seek:** Trivially low effort but explicitly out of v1.2 scope. Requirements should confirm in/out — if in, belongs in lyrics phase.
- **AUD-01/02 queue power-ops:** High severity in audit, not fully in scope. Requirements should decide pull-in vs defer to v1.3.
- **AUD-04 haptics:** Zero current uses; cheap cross-cutting add. Requirements should confirm include/defer.

---

## Sources

### Primary (HIGH confidence)
- `src/lib/stores/player.svelte.ts` (full read) — failover/prefetch/regenerate/skip-guard/offline-blob/repeat
- `src/lib/components/{NowPlaying,TrackMenu}.svelte` — overlay invariant, gesture machines, lyrics touch-suspend
- `src/lib/stores/overlays.svelte.ts` — history-depth invariant, `navigateAway`, `popping`
- `src/lib/services/{fallback,similar,picks,cover-cache,cover-backfill,share,score-match,lrc}.ts` — service layer
- `src/lib/actions/{dragClose,longpress}.ts`, `gestures/velocity.ts` — pointer-capture + slop-threshold pattern
- `src/lib/config/defaults.ts`, `package.json`, `svelte.config.js`, `src/app.html` — confirms no SW, no per-page OG
- WebKit "New Policies for iOS" + MDN Autoplay guide — iOS `play()` rejection
- Chrome 88 timer throttling release notes — background-tab `setTimeout` clamping
- https://svelte.dev/docs/kit/service-workers — `$service-worker` native SW
- https://svelte.dev/docs/kit/adapter-cloudflare — SSR at edge by default

### Secondary (MEDIUM confidence)
- https://github.com/sveltejs/kit/issues/10232 — OG on dynamic routes SPA failure mode
- https://github.com/vite-pwa/vite-plugin-pwa/issues/400 — `/`-precache footgun on SvelteKit
- Spotify Newsroom — sleep timer durations (verified)
- Spotify Support — Autoplay similar content behavior
- Apple Developer — Apple Music link format (readable slug + numeric id)
- Android Developers — Haptics design principles

---
*Research completed: 2026-06-10*
*Ready for roadmap: yes*
