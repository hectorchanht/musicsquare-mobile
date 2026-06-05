# Roadmap: MusicSquare Mobile

## Overview

MusicSquare Mobile is a ground-up reskin of a working desktop music player: the proven data/fetch layer is extracted from the `index.html` monolith and wired into a brand-new SvelteKit mobile PWA. The roadmap is deliberately bottom-up and follows the hard dependency chain established in research: extract the reusable data layer and prove the Cloudflare Worker proxy boundary first (de-risking the geo-egress unknown with an early spike), then build the single-element audio engine and reactive stores headless, then persistence, then the mobile UI shell that consumes those stores, then wrap the working app in a PWA, then resolve the contested iOS background-audio behavior on a real device, and finally prove the source-adapter abstraction (Kugou/Migu) and ship the explicit queue model with its drag/swipe gestures. Each phase delivers a coherent, verifiable capability and never builds UI on top of an audio engine whose iOS behavior is unproven.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Data Layer + Proxy Foundation** - Extract reusable data logic into typed modules; SvelteKit `+server.ts` metadata proxy with adapter registry; 4 existing sources end-to-end through the new boundary
- [ ] **Phase 2: Audio Engine + Playback Core** - Single app-scoped `<audio>` singleton + reactive stores; play/pause/seek/next/prev, play modes, browser-direct streaming with graceful failure (headless)
- [ ] **Phase 3: Persistence + Library** - Favorites + playlists preserved with localStorage parity and an IndexedDB migration path; JSON import/export
- [ ] **Phase 4: Mobile UI Shell** - Bottom-nav shell, persistent mini-player, expandable now-playing overlay, synced lyrics, error/loading UX, responsive layout, zh/en toggle
- [ ] **Phase 5: PWA + Service Worker** - Installable PWA with app-shell precache; audio + `/api` bypass; offline state
- [ ] **Phase 6: Background Audio + MediaSession** - Lock-screen / notification controls + metadata; real-device iOS validation of the contested background-audio path
- [ ] **Phase 7: New Sources + Queue Model + Gestures** - Kugou + Migu via the adapter registry; explicit Up-Next queue model; drag-to-reorder and swipe-to-change-track gestures

## Phase Details

### Phase 1: Data Layer + Proxy Foundation
**Goal**: The proven search/detail/LRC logic lives in typed modules behind a `SourceAdapter`/`ProxyAdapter` registry, and all four existing sources work end-to-end through a same-origin SvelteKit `+server.ts` metadata proxy with the JOOX token hidden server-side.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, SRC-01
**Success Criteria** (what must be TRUE):
  1. A search keyword fans out across Netease, QQ, Kuwo, and JOOX through `/api/*` and returns interleaved results, with one deliberately-killed source leaving the rest intact (`Promise.allSettled` isolation)
  2. The JOOX token is absent from the client bundle and network requests; it is read only from `platform.env` in the Worker
  3. Adding a hypothetical source requires only a new client adapter file + a new proxy adapter file + one registry import — no edits to aggregation/dispatch code
  4. A track's audio URL + lyrics resolve lazily on demand through the proxy, and JOOX returns the *selected* track after the result set is reordered/paginated (index-identity validated)
  5. A spike has confirmed whether each source's audio CDN URL plays browser-direct from a deployed edge, and the metadata-proxy-vs-browser-direct-audio decision is locked
**Plans**: 4 plans (3 waves)
Plans:
- [x] 01-01-PLAN.md — Walking Skeleton: scaffold SvelteKit + Cloudflare, both registries, Netease end-to-end through /api/*, /spike harness shell, LRC util (wave 1)
- [ ] 01-02-PLAN.md — QQ + Kuwo client/proxy adapters (dual-format guard, level=zp lossless) (wave 2)
- [ ] 01-03-PLAN.md — JOOX adapter: position-index identity fix + token in platform.env + DATA-02 bundle-grep + proxy integration test (wave 2)
- [ ] 01-04-PLAN.md — allSettled fan-out + interleave/dedup + ensureTrackDetails dispatch; deploy openmusic + run egress-spike decision gate (wave 3, checkpoint)
**Research flag**: NEEDS deeper research — Worker egress geo-behavior against JOOX/QQ audio CDNs. Run the egress spike before locking the audio data-flow architecture (`/gsd:plan-phase --research-phase 1`).

### Phase 2: Audio Engine + Playback Core
**Goal**: A user (driving it headlessly via stores) can tap a track and hear it play, control transport, switch play modes, and auto-advance — on a single long-lived `<audio>` element that survives navigation and streams browser-direct from the CDN.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PLAY-01, PLAY-02, PLAY-03, PLAY-04
**Success Criteria** (what must be TRUE):
  1. Playback continues uninterrupted across route navigation — the single module-scoped `<audio>` element is never recreated, only its `.src` swapped
  2. User can play/pause, skip next/previous, and seek within the current track; auto-advance to the next track plays without an iOS gesture error (inherits the element's unlock)
  3. User can switch play mode (list / single-repeat / shuffle) and the next-track selection honors it
  4. Audio streams browser → source CDN directly (never through the proxy); a dead/expired stream URL re-resolves once and, if still failing, surfaces a visible error rather than silent stop
**Plans**: TBD
**Research flag**: Standard patterns for source porting / `AudioEngine` singleton. The iOS single-element gesture-unlock behavior should be smoke-tested here; full lock-screen validation is Phase 6.

### Phase 3: Persistence + Library
**Goal**: A user's favorites and playlists are preserved across sessions exactly as the old app stored them, with a clean path to IndexedDB and full JSON portability.
**Mode:** mvp
**Depends on**: Phase 1 (Track shape), Phase 2 (stores)
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04
**Success Criteria** (what must be TRUE):
  1. User can favorite / unfavorite the current track and the change survives a full page reload
  2. User can create a playlist and add / remove tracks from it
  3. The library persists locally (existing `pikachu-music-library-v1` localStorage shape preserved; `uid = {source}-{id}` stable) with an `idb` migration path ready and versioned persistence
  4. User can export their library as JSON and re-import it to restore favorites + playlists
**Plans**: TBD
**Research flag**: Standard patterns (localStorage → IndexedDB migration with `idb` is well-documented).

### Phase 4: Mobile UI Shell
**Goal**: A human can open the app on a phone, search a song, tap it, watch a persistent mini-player appear, expand it to a full-screen now-playing view with synced lyrics, and navigate between Home / Search / Library without ever interrupting playback.
**Mode:** mvp
**Depends on**: Phase 2 (stores), Phase 3 (library)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08
**Success Criteria** (what must be TRUE):
  1. Bottom-tab navigation (Home / Search / Library) is always present, and a persistent mini-player bar docks above it while a track is loaded
  2. Tapping the mini-player expands a full-screen now-playing overlay (artwork, transport, progress/seek, source/quality badge); swipe-down dismisses it back to the bar — and audio never stops during either transition
  3. User can search and tap a result to play it, with synced line-level lyrics that highlight the active line and auto-scroll
  4. Loading / buffering / error states and toasts differentiate "source unavailable" vs "paywalled" vs "offline" vs "no results" rather than a single generic error
  5. The layout is responsive mobile-first (respecting notch + home-indicator safe areas) and the zh / en language toggle from the existing app works
**Plans**: TBD
**UI hint**: yes

### Phase 5: PWA + Service Worker
**Goal**: A user can install MusicSquare to their home screen, launch it offline to a working app shell, and be clearly told that playback needs a connection — with seeking still working and zero audio bytes ever cached.
**Mode:** mvp
**Depends on**: Phase 4 (a deployable app exists to install)
**Requirements**: PWA-01, PWA-02
**Success Criteria** (what must be TRUE):
  1. The app is installable to the home screen (manifest + icons valid; Android `beforeinstallprompt` custom prompt; iOS Add-to-Home-Screen guidance)
  2. The service worker precaches the app shell so the UI loads with no network; `/api/*` and all audio CDN requests are explicitly bypassed (network-only)
  3. After install, playing and seeking a track still works (no 206/Range regression) and DevTools → Cache Storage contains no audio bytes
  4. When offline, the app shows a clear "offline — playback needs a connection" state; a new deploy triggers an "update available, tap to refresh" prompt
**Plans**: TBD
**UI hint**: yes

### Phase 6: Background Audio + MediaSession
**Goal**: A user can lock their phone (or background the app) and keep listening, with working lock-screen / notification controls and metadata — and the contested iOS background-audio behavior is resolved empirically rather than assumed.
**Mode:** mvp
**Depends on**: Phase 2 (AudioEngine), Phase 5 (installed PWA)
**Requirements**: PLAY-05
**Success Criteria** (what must be TRUE):
  1. Audio continues playing when the screen locks or the app backgrounds (Android guaranteed; iOS behavior documented per version)
  2. Lock-screen / notification controls (play / pause / next / prev / seekto) drive the same single `<audio>` element and `queueStore`, with `playbackState` and `setPositionState` updated on every change, and 96×96 + 512×512 artwork shown
  3. A real-device iOS test matrix has been run covering screen-lock-mid-play, immediate lock-screen control response, and the pause→wait-60s→resume-from-lock path; any residual failure is documented as a known limitation
  4. iOS `navigator.standalone` is detected and platform-appropriate copy is shown; Wake Lock is used only for an optional "keep screen on" mode, never as the audio-continuity mechanism
**Plans**: TBD
**Research flag**: NEEDS real-device validation — iOS background audio / lock-screen resume is the project's one contested item. Plan the device spike as an explicit story, not an end-of-phase check (`/gsd:plan-phase --research-phase 6`).
**UI hint**: yes

### Phase 7: New Sources + Queue Model + Gestures
**Goal**: The source-adapter abstraction is proven by adding Kugou and Migu touching only their own files, and the app gains an explicit Up-Next queue with the touch gestures (drag-to-reorder, swipe-to-change-track) that make it feel native.
**Mode:** mvp
**Depends on**: Phase 1 (adapter registry), Phase 2 (playback core), Phase 4 (UI shell)
**Requirements**: SRC-02, SRC-03, PLAY-06, UI-09
**Success Criteria** (what must be TRUE):
  1. Kugou and Migu return playable results and lyrics through the registry, and adding each touched zero shared aggregation/dispatch files (the abstraction acceptance test)
  2. An explicit queue / Up-Next model (decoupled from `playContext`) drives `playNext()`; the user can view the queue, remove a track, and jump-to a track, and existing list/single/shuffle advance still works
  3. User can drag to reorder the queue and swipe to change track on now-playing; swipe-down-to-dismiss (from Phase 4) continues to work
**Plans**: TBD
**Research flag**: Standard adapter pattern for new sources. The queue-model refactor (`playNext`, shuffle, play-mode all touch `queueStore`) needs careful dependency tracking to avoid breaking the Phase 2 auto-advance behavior. Confirm `svelte-gestures` Svelte 5 support at build time; Pointer Events + `Spring` is the documented fallback.
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Layer + Proxy Foundation | 1/4 | In Progress|  |
| 2. Audio Engine + Playback Core | 0/TBD | Not started | - |
| 3. Persistence + Library | 0/TBD | Not started | - |
| 4. Mobile UI Shell | 0/TBD | Not started | - |
| 5. PWA + Service Worker | 0/TBD | Not started | - |
| 6. Background Audio + MediaSession | 0/TBD | Not started | - |
| 7. New Sources + Queue Model + Gestures | 0/TBD | Not started | - |
