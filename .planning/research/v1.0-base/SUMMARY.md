# Project Research Summary

**Project:** MusicSquare Mobile
**Domain:** Mobile-first PWA music streaming player (SvelteKit + Cloudflare, multi-source CN audio aggregator)
**Researched:** 2026-06-05
**Confidence:** HIGH overall; one contested point requiring real-device validation (see §Contested Item below)

## Executive Summary

MusicSquare Mobile is a ground-up reskin of a working desktop music player: the proven data and fetch layer (search aggregation, audio-URL resolution, LRC parsing, persistence) is extracted verbatim from the `index.html` monolith and wired into a brand-new SvelteKit mobile shell. The product is a music streaming PWA — a category with well-studied patterns (bottom nav, expandable now-playing, background audio via `navigator.mediaSession`, installable app shell) — so the technology and UX choices are well-documented and low-risk. The unique challenge is the unofficial-source backend: four (soon six) Chinese music proxies with no SLA, time-limited CDN URLs, and the occasional silent contract drift, which makes reliability and graceful degradation the dominant technical concerns rather than framework choices.

The recommended approach is three-tier and deliberately layered. At the edge, a Cloudflare Worker co-located with the SvelteKit app (via `adapter-cloudflare`) proxies **metadata only** (search JSON, detail JSON, LRC) and hides the JOOX token; audio bytes flow browser-to-CDN directly via a plain `<audio src>` element, which is not CORS-gated, preserving the geo/IP context that CDN URLs often require. In the browser, a single module-scoped `AudioEngine` singleton owns the one long-lived `<audio>` element, MediaSession wiring, and Wake Lock; Svelte 5 runes in `.svelte.ts` stores hold all reactive state; and a pluggable `SourceAdapter` registry means adding Kugou or Migu touches only a new file plus a registry entry. The SvelteKit root layout mounts the persistent bottom-nav shell and mini-player outside the routed `<slot>`, so navigation never tears down playback.

The dominant risks are reliability (unofficial proxies die without notice) and iOS audio (see Contested Item below). Both are manageable: `Promise.allSettled` for search fan-out contains source failures, a typed adapter boundary catches contract drift early, and the iOS audio question is resolved empirically with a real-device spike before promising lock-screen behavior to users.

---

## Contested Item: iOS Standalone-PWA Background Audio

**STACK.md says:** WebKit bug #198277 ("audio stops when standalone web app is backgrounded") is unfixed as of Safari 26; background audio in installed PWAs on iOS is unreliable.

**PITFALLS.md says:** Bug #198277 was *resolved in iOS 15.4 (2022)*. Background playback now works in installed PWAs. The *residual* fragility is the lock-screen pause-then-resume path (tapping play on the lock screen after ~30-60 s of pause fails silently until the app is foregrounded); Wake Lock is the wrong tool for this (it keeps the screen on, not audio alive, and was itself broken in installed iOS PWAs until iOS 18.4).

**Resolution for the roadmap:** Both researchers agree on the honest answer — this cannot be settled by documentation alone. **Treat as Contested / needs real-device validation.** The recommended implementation stance is:

1. Use iOS 15.4+ as the baseline; do NOT build silent-audio-loop hacks as the primary mechanism.
2. Ship the single long-lived `<audio>` element + MediaSession action handlers + explicit `playbackState` updates (this is correct regardless of iOS version).
3. Before publishing any "plays with screen locked" claim, run a real-iPhone spike covering: (a) audio continues when screen locks mid-play, (b) lock-screen controls respond immediately, (c) pause -> wait 60 s -> tap lock-screen play succeeds. Document failures as known limitations.
4. Surface per-platform guidance in the UI: detect `navigator.standalone` and show different copy on iOS installed vs Safari-tab paths.
5. Wake Lock is for an optional "keep screen on during lyrics" feature only, not for audio continuity.

---

## Cross-Cutting Consensus

All four research files agree on the following load-bearing decisions; these are settled and must not be revisited:

- **Proxy METADATA only through SvelteKit `+server.ts`.** Search, detail, and LRC responses flow through `/api/<source>/...` (same-origin, CORS-free, JOOX token hidden in `platform.env`). Never proxy audio bytes through the Worker.
- **Stream audio browser-to-CDN directly.** A plain `<audio src="...">` is not CORS-gated for playback. This preserves the geo/IP context that time-limited CDN URLs require and keeps the Worker within free-tier CPU and subrequest limits.
- **Never cache audio in the service worker.** The SW caches the app shell only. Audio routes must be excluded from all Workbox runtime-caching rules. The 206/Range-request trap breaks seeking when a SW intercepts audio.
- **Single module-scoped global `<audio>` element.** Owned by `AudioEngine` singleton in `audioEngine.svelte.ts`. Never recreated per route or per track. Reuse the existing element by swapping `.src`. The iOS autoplay-gesture unlock is tied to the element, not to `.play()`.
- **Svelte 5 runes in `.svelte.ts` for all shared state.** Export `$state` objects (not bare primitives) from `player.svelte.ts`, `queue.svelte.ts`, `search.svelte.ts`, `library.svelte.ts`. Replaces the monolith's imperative `render*()` calls.
- **Source-adapter registry pattern.** `SourceAdapter` (client) and `ProxyAdapter` (Worker) interfaces with one file per source. Adding Kugou/Migu = new file + registry import. Zero changes to aggregation or dispatch code.

---

## Key Findings

### Recommended Stack

The stack is narrow and well-justified. SvelteKit 2 + Svelte 5 + Vite 8 is the only supported combination (vite-plugin-svelte 7 requires Vite >= 8; Svelte 5 runes are the current idiom for shared reactive state). Cloudflare deployment uses `@sveltejs/adapter-cloudflare` (v7) which targets Workers Static Assets — the modern path that collapses the PROJECT.md "Pages + separate Worker" plan into one deploy artifact where `+server.ts` routes are the proxy. PWA tooling is `@vite-pwa/sveltekit` (v1.1.0) with Workbox `generateSW`. Persistence starts with localStorage parity and migrates to `idb` (v8) for library growth. No audio library (howler.js is explicitly rejected — unneeded abstraction, degrades iOS MediaSession behavior). Animation uses Svelte built-ins (`crossfade`, `Spring`/`Tween` classes) with `svelte-gestures` (v5, verify Svelte 5 support) for touch.

See `.planning/research/STACK.md` for full version table and alternatives considered.

**Core technologies:**
- **Svelte 5 / SvelteKit 2 / Vite 8**: UI framework + app shell — only supported combination; runes ideal for player state
- **@sveltejs/adapter-cloudflare v7**: Cloudflare Workers Static Assets deploy — collapses app + proxy into one artifact
- **Wrangler v4**: local dev + deploy CLI — required peer of the adapter
- **@vite-pwa/sveltekit v1.1.0 + Workbox**: PWA manifest + app-shell service worker — purpose-built for SvelteKit's output layout
- **HTML5 `<audio>` element (no library)**: playback engine — direct URL consumption, best iOS MediaSession compatibility
- **idb v8**: IndexedDB wrapper for library persistence — async, quota-safe, ~1 KB overhead
- **Svelte 5 runes in `.svelte.ts`**: shared reactive state — replaces imperative render calls with automatic reactivity

### Expected Features

The data layer already delivers ~60% of the feature set. The rebuild's work is the mobile UI shell, the audio singleton pattern, MediaSession wiring, and the explicit queue model.

See `.planning/research/FEATURES.md` for full prioritization matrix and competitor analysis.

**Must have (table stakes) — v1:**
- Persistent mini-player docked above bottom nav (NEW wrapper around existing state)
- Expandable full-screen now-playing with swipe-down dismiss (NEW — defining interaction)
- Bottom-tab navigation: Home / Search / Library (NEW shell; replaces desktop panels)
- Background playback + MediaSession lock-screen controls + metadata (NEW; validate on iOS)
- Installable PWA with app-shell caching (NEW; audio stays online-only)
- Reactive global playback store + single root-level `<audio>` element (NEW architecture; enables all else)
- Search across sources + tap-to-play (EXISTS — thin wrapper)
- Transport: play/pause/next/prev, seek, play modes (EXISTS — thin wrapper)
- Synced lyrics view (EXISTS data; NEW scrolling UI)
- Library: favorites + playlists + import/export (EXISTS — thin wrapper)
- Loading / buffering / error states with differentiated messages (NEW UX over existing logic)
- Responsive layout + zh/en i18n (EXISTS i18n; NEW responsive shell)

**Should have (differentiators) — v1.x:**
- Explicit queue / Up-Next view with remove + jump-to (NEW; biggest backend gap — requires queue model refactor)
- Drag-to-reorder queue + swipe-to-add-to-queue gestures (NEW; depends on queue model)
- Swipe-to-change-track gesture on now-playing (NEW; polish)
- Sleep timer (NEW; cheap, high satisfaction)
- Recently played / search history on Home tab (NEW; prevents empty Home)
- Custom PWA install coachmark (Android prompt + iOS Share instructions) (NEW)
- Per-source / quality badges on results (EXISTS data; surface in UI)

**Defer to v2+:**
- Source fallback on play failure (cross-source matching) — high value, high effort; no shared IDs across sources
- Tap-lyric-line-to-seek — small delight, low priority
- New sources beyond Kugou/Migu — orthogonal; adapter pattern makes it easy whenever

**Anti-features (never build):**
- Offline audio download / track caching — legal exposure, storage cost, expiring CDN URLs make it technically near-impossible
- User accounts / cloud sync — contradicts local-first design; JSON import/export covers portability
- Audio-reactive visualizer via real FFT — cross-origin audio cannot be analyzed; keep decorative motion
- Crossfade / equalizer — require Web Audio routing which is blocked for cross-origin media elements

### Architecture Approach

Three tiers with hard boundaries: (1) Cloudflare Worker owns CORS, secrets, caching, retry, and metadata normalization for upstream proxies; (2) Browser service layer (pure TS) owns search aggregation, audio engine, and persistence; (3) SvelteKit UI layer (Svelte 5 components + runes stores) reads stores and calls actions only — never touches `<audio>` or upstream URLs directly. The service worker sits at the browser edge caching only the app shell. The root layout mounts the persistent shell (bottom nav + mini-player) outside the routed slot so navigation never interrupts playback.

See `.planning/research/ARCHITECTURE.md` for full data-flow diagrams, component table, and build order.

**Major components:**
1. **Cloudflare Worker / SvelteKit `+server.ts` routes** — CORS proxy for metadata; hides JOOX token; edge-caches search and detail responses; never proxies audio bytes
2. **`AudioEngine` singleton (`audioEngine.svelte.ts`)** — owns the one `<audio>` element; wires MediaSession + Wake Lock; emits events that update stores; survives route changes
3. **Source-adapter registry (`lib/sources/`)** — `SourceAdapter` interface + one file per source; `catalog.ts` iterates the registry for aggregated search and lazy detail resolution
4. **Runes stores (`lib/stores/*.svelte.ts`)** — `playerStore`, `queueStore`, `searchStore`, `libraryStore`; replace imperative `render*()` calls with automatic reactive subscriptions
5. **SvelteKit root layout (`+layout.svelte`)** — persistent shell: bottom nav + mini-player outside `<slot>`; NowPlaying as an overlay driven by `uiStore.nowPlayingOpen`
6. **Service worker (`src/service-worker.ts`)** — precaches app shell only; bypasses `/api/*` and all audio CDN requests

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for full prevention strategies, warning signs, recovery steps, and phase mapping.

1. **Caching audio in the service worker (206/Range trap)** — Never let the SW intercept audio URLs. Configure explicit Workbox denylist for audio routes. Verify by installing the PWA and confirming seeking works and Cache Storage holds no audio bytes.

2. **Recreating the `<audio>` element per track or per route (iOS silent auto-advance)** — The iOS autoplay-gesture unlock is bound to the element instance. Singleton engine, swap `.src` only, never recreate. This must be correct before any UI is built on top.

3. **Buffering audio through the Cloudflare Worker (`arrayBuffer()` on audio response)** — Return `new Response(upstream.body, { headers })` only; forward client `Range` headers; propagate `206 + Content-Range` unchanged. Buffering burns the 10ms free-tier CPU budget on any large file.

4. **Worker egress geo-mismatch breaking CDN URLs** — Audio CDN URLs are often geo/IP-bound to the browser's region. Proxy metadata only; let `<audio>` stream direct from CDN. Spike this against all four sources (especially JOOX) before committing architecture.

5. **Silent unofficial-API failures masked as empty results** — Use `Promise.allSettled` for search fan-out; validate response shape at each adapter boundary; distinguish "source down" from "paywalled" from "network offline" in the UI. Pin adapter contracts with fixture-based tests so shape changes fail CI rather than silently breaking users.

6. **iOS background audio / lock-screen resume (contested — see §Contested Item)** — Implement MediaSession correctly regardless; spike on real device before promising lock-screen behavior.

7. **JOOX detail fetched by position index, not stable ID** — Capture the full `(songmid, keyword, index)` tuple at search time; re-validate after detail fetch; fail loudly on mismatch rather than playing the wrong song.

---

## Implications for Roadmap

Research (especially ARCHITECTURE.md §Suggested Build Order) strongly recommends a bottom-up phase structure: data layer first, audio engine second, UI third, PWA polish fourth. This avoids the trap of building UI on an audio engine that breaks on iOS navigation, or deploying a service worker before the audio bypass is proven safe.

### Phase 1: Data Layer Extraction + Proxy Skeleton
**Rationale:** Everything else depends on having the source-adapter registry, Worker proxy boundary, and Track contract in place. This is also the lowest-risk phase — it is extracting proven logic, not writing new logic. Pitfall 4 (geo mismatch) must be spiked here before the architecture is locked.
**Delivers:** Working `SourceAdapter` + `ProxyAdapter` interfaces; `/api/*` routing with CORS and Cloudflare Cache; one end-to-end source (Netease) proven through the new boundary; `catalog.ts` search aggregation with `allSettled`; JOOX token moved to Worker env.
**Addresses:** Multi-source aggregation (EXISTS), JOOX token security, adapter registry foundation for Kugou/Migu.
**Avoids:** Pitfalls 3 (Worker buffering), 4 (geo mismatch spike), 6 (silent failures — `allSettled` + shape validation), 7 (JOOX index identity).
**Research flag:** NEEDS research-phase — Worker egress geo behavior against JOOX/QQ audio CDNs is the critical unknown that shapes the whole audio data flow.

### Phase 2: Remaining Sources + Audio Engine Core
**Rationale:** Port QQ, Kuwo, JOOX adapters (proven logic, low risk) and build the `AudioEngine` singleton + runes stores. This is "tap a track, hear audio" headless — no UI yet. Getting the single-element + iOS unlock model right here before UI is built on top is the key insight from PITFALLS.md.
**Delivers:** All four existing sources working through the new proxy; `AudioEngine` singleton with play/pause/seek/auto-advance; `playerStore` + `queueStore`; `ensureTrackDetails` wiring; LRC parse.
**Addresses:** Background playback foundation, auto-advance across tracks, URL expiry re-resolution, next-track prefetch.
**Avoids:** Pitfall 5 (per-track `<audio>` element / iOS silent advance) — foundational here.
**Research flag:** Standard patterns for source porting. NEEDS validation for iOS single-element + gesture-unlock behavior — schedule real-device test as an explicit acceptance criterion.

### Phase 3: Persistence + Library
**Rationale:** Depends on the Track shape (Phase 1) and stores (Phase 2); can overlap with Phase 4. Ensures favorites/playlists are preserved before UI is built on top, avoiding a rebuild that loses existing user data.
**Delivers:** `persist` service with localStorage parity (existing `pikachu-music-library-v1` key preserved); `libraryStore` hydration; import/export wiring; IndexedDB (`idb`) migration path ready.
**Addresses:** Favorites + playlists (EXISTS), import/export (EXISTS), library persistence across refreshes.
**Avoids:** Risk of UID scheme changes breaking saved tracks; keep `uid = {source}-{id}` stable.
**Research flag:** Standard patterns (localStorage to IndexedDB migration is well-documented).

### Phase 4: SvelteKit Mobile UI Shell
**Rationale:** First phase a human can use the app. Depends on stores (Phase 2) and persistence (Phase 3). Bottom-nav + mini-player + now-playing overlay define the "native feel" core value. NowPlaying as an overlay (not a route) is critical for audio continuity on navigation.
**Delivers:** Root layout with bottom nav (Home/Search/Library) + persistent mini-player; expandable NowPlaying overlay with swipe-down dismiss and shared-element cover transition; Search route; Library route; Playlist route; synced lyrics view; play-mode toggle; favorite toggle; loading/error states with differentiated messages; zh/en i18n; responsive layout.
**Addresses:** Bottom-tab nav (NEW), persistent mini-player (NEW), expandable now-playing (NEW), synced lyrics (NEW view), error UX (NEW).
**Avoids:** NowPlaying-as-route pitfall; safe-area / `dvh` layout issues (notch + home indicator); hover-only affordances carried from desktop.
**Research flag:** Standard SvelteKit + Svelte 5 patterns. `svelte-gestures` Svelte 5 compatibility should be confirmed at build time.

### Phase 5: PWA + Service Worker
**Rationale:** Depends on a deployable app (Phase 4). PWA install and service worker must be done in the correct order: app shell precache first, audio bypass verified second, update-prompt flow third.
**Delivers:** `web.manifest` + icons; `@vite-pwa/sveltekit` configured with Workbox `generateSW`; app-shell precache; explicit audio/`/api/*` bypass rules; SW update prompt ("Update available, tap to refresh"); iOS Add-to-Home-Screen coachmark; Android `beforeinstallprompt` custom prompt.
**Addresses:** Installable PWA (NEW), app-shell offline, stale-cache update path.
**Avoids:** Pitfall 2 (SW caching audio / 206 trap) — this is the primary verification milestone for this phase. Install + seek + confirm no audio bytes in Cache Storage.
**Research flag:** Standard Workbox patterns. The audio bypass configuration is the one non-obvious step; PITFALLS.md covers it explicitly.

### Phase 6: Background Audio Polish + MediaSession + Real-Device Validation
**Rationale:** Depends on Phase 2 (AudioEngine) and Phase 5 (PWA installed). This is the highest-uncertainty phase (iOS contested item). Scheduling it after the core app is working means the spike has a real product to test against.
**Delivers:** Full MediaSession action handlers (play/pause/next/prev/seekto) wired to `AudioEngine`/`queueStore`; `setPositionState` for lock-screen scrubber; artwork at 96x96 and 512x512; `playbackState` updates on every state change; Wake Lock for optional "keep screen on" mode only; iOS `navigator.standalone` detection with platform-appropriate UX copy; real-device iOS test matrix results documented.
**Addresses:** Background playback + lock-screen controls (NEW, P1).
**Avoids:** Pitfall 1 (iOS background audio — the contested item is resolved here empirically); Wake Lock misuse as audio-continuity mechanism.
**Research flag:** NEEDS real-device validation — this phase should include an explicit spike story: verify pause-lock-60s-resume on target iOS version list before marking done.

### Phase 7: New Sources + Queue Model
**Rationale:** Proves the source-adapter abstraction (Kugou, Migu) and introduces the one true backend gap (explicit queue model). These can overlap; they are separate deliverables.
**Delivers:** Kugou adapter (client + Worker); Migu adapter; explicit `queueStore` refactor decoupled from `playContext`; Up-Next view (list + remove + jump-to); `playNext()` consuming the queue; drag-to-reorder and swipe-to-add-to-queue gestures.
**Addresses:** Kugou/Migu sources (Active), explicit queue (NEW — P2 after core stable).
**Avoids:** Queue model introduced before core playback is stable; source additions touching shared aggregation code (acceptance test: adding a source touches zero shared files).
**Research flag:** Standard adapter pattern for new sources. Queue model refactor needs careful dependency tracking (playNext, shuffle, playMode all touch queueStore).

### Phase Ordering Rationale

- Phases 1-2 are the de-risking core: extract proven logic, prove the proxy boundary, and get the single audio element right before any UI depends on it.
- Phases 3-4 can partially overlap once the Track shape and store interfaces are stable.
- Phase 5 (PWA) must follow Phase 4 (a deployable app exists to install).
- Phase 6 (iOS validation) is placed after Phase 5 because the contested behavior only manifests in the installed PWA, not in a Safari tab during development.
- Phase 7 (new sources + queue) is last because it proves the abstraction and extends the product rather than enabling the core value.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):
- **Phase 1:** Worker egress geo-behavior against JOOX/QQ audio CDNs — spike required before architecture is locked. The audio-proxy-vs-browser-direct decision is load-bearing.
- **Phase 6:** iOS background audio / lock-screen resume — real-device spike on target iOS versions is the only way to resolve the contested STACK.md vs PITFALLS.md disagreement.

Phases with well-established patterns (skip extra research):
- **Phase 2:** Source porting is extraction of proven logic; `AudioEngine` singleton pattern is well-documented.
- **Phase 3:** localStorage to IndexedDB migration with `idb` is standard.
- **Phase 4:** SvelteKit routing + Svelte 5 runes + Svelte transitions are well-documented; NowPlaying overlay pattern is standard.
- **Phase 5:** Workbox `generateSW` + app-shell precache is standard; the audio-bypass rule is the one gotcha (documented in PITFALLS.md).
- **Phase 7:** Adapter pattern is defined in Phase 1; adding a source is mechanical.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry on 2026-06-05; peer-dep chain confirmed; Cloudflare adapter guidance from official docs |
| Features | HIGH | UX patterns verified against web.dev, MDN, and current competitor behavior; existing capabilities confirmed from codebase analysis |
| Architecture | HIGH | Three-tier pattern verified against SvelteKit + Cloudflare docs; MediaSession data flow from MDN/web.dev; source-adapter pattern is a direct generalization of existing code |
| Pitfalls | HIGH (platform realities) / MEDIUM (unofficial-API drift specifics) | Platform pitfalls sourced from WebKit bugs, Cloudflare official limits, jake archibald / philna range-request research; API drift inferred from codebase evidence |

**Overall confidence:** HIGH, with one explicit contested item (iOS standalone-PWA background audio) that requires empirical resolution.

### Gaps to Address

- **iOS standalone-PWA background audio reality (Phase 6):** The contested STACK.md vs PITFALLS.md disagreement cannot be resolved by documentation. A real-device spike on multiple iOS versions (iOS 15.4, 16, 17, 18, ideally 18.4+) covering play-while-locked AND pause-wait-resume-from-lock is the mandatory gate before this feature is called done. Plan this as an explicit story in Phase 6, not a "we'll test it at the end."

- **Worker egress geo-behavior against audio CDNs (Phase 1):** Whether JOOX and QQ audio CDN URLs work when fetched from a Cloudflare edge IP (vs the browser's IP) is unconfirmed. The architecture recommendation (proxy metadata only, browser-direct audio) is sound, but must be spiked against all four existing sources before Phase 1 closes. If any source's CDN hard-requires Worker egress, the fallback design (Worker resolves URL; browser fetches audio; SW bypasses) is the answer.

- **`svelte-gestures` Svelte 5 compatibility (Phase 4):** Version 5.2.2 is current but Svelte 5 support should be confirmed at build time. If unsupported, implement touch gestures with Pointer Events + `Spring` (documented fallback in STACK.md).

- **JOOX `jooxIndex` stability under pagination/re-search (Phase 2):** The existing code fetches JOOX detail by 1-based position in the original search result set. The adapter refactor must pin and re-validate the `(songmid, keyword, index)` tuple, and prefer stable ID-based lookup if the proxy supports it. This is a known fragile area (CONCERNS.md) that must be explicitly addressed in the JOOX adapter.

- **Queue model scope (Phase 7):** Introducing an explicit `queueStore` (decoupled from `playContext`) requires refactoring `playNext`, shuffle, and play-mode logic. The scope of this refactor should be planned carefully to avoid breaking the working auto-advance behavior established in Phase 2.

---

## Sources

### Primary (HIGH confidence)
- SvelteKit official docs (`svelte.dev/docs/kit`) — adapter-cloudflare, `+server.ts` proxy pattern, `platform.env`, service-worker module, `$state` runes
- npm registry (2026-06-05 snapshot) — pinned versions for all dependencies
- MDN (Media Session API, Screen Wake Lock API, Autoplay guide) — API shape, artwork sizing, gesture-unlock model
- web.dev (Media Session, PWA installability, SW range requests) — MediaSession data flow, 206 trap documentation
- Cloudflare Workers docs — Cache API, platform limits (CPU/memory/subrequests), egress policies
- WebKit Bug #198277 (resolved iOS 15.4) and WebKit Bug #254545 (Wake Lock fixed iOS 18.4) — background audio and Wake Lock history
- `.planning/codebase/` (ARCHITECTURE.md, INTEGRATIONS.md, CONCERNS.md, PROJECT.md) — authoritative for existing capabilities, track contract, fragile areas

### Secondary (MEDIUM confidence)
- dbushell.com — iOS PWA Media Session reality (artwork sizing, iOS 16.4/18 improvements)
- Apple Developer Forums thread 762582 — lock-screen pause-then-resume failure reports
- webkit.org/blog/16993 (Safari 26 WWDC25) — no standalone background-audio fix announced; media additions are MediaRecorder/WebCodecs/MSE
- whatpwacando.today/audio — PWA audio capability demos
- MagicBell PWA iOS limitations guide — storage limits (~50 MB, 7-day eviction), install behaviors
- MobiLoud PWA iOS 2026 — EU iOS 17.4 regression, iOS 26 behavior changes
- 9to5Google / Android Police — YouTube Music 2026 now-playing redesign patterns
- XDA / HowToGeek — Spotify queue and gesture UX patterns
- Cloudflare Community — Worker CPU-limit buffering reports
- Mainmatter / Joy of Code — Svelte 5 global state patterns and caveats
- jakearchibald.com and philna.sh — SW range-request / 206 trap research

### Tertiary (LOW confidence)
- cogley.jp — Cloudflare Pages to Workers migration (2026, single source; used only to corroborate the official adapter docs recommendation)

---
*Research completed: 2026-06-05*
*Ready for roadmap: yes*
