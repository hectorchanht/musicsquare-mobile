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
- [x] 01-02-PLAN.md — QQ + Kuwo client/proxy adapters (dual-format guard, level=zp lossless) (wave 2)
- [x] 01-03-PLAN.md — JOOX adapter: position-index identity fix + token in platform.env + DATA-02 bundle-grep + proxy integration test (wave 2)
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

---

## Milestone v1.1: Last.fm Integration

Connects the standalone aggregator to Last.fm across four cross-cutting capability areas — passive metadata enrichment, auth-free editorial discovery, a new Last.fm-searchable playback source, and an optional signed-in layer (auth + scrobble + loved-tracks sync). The build order is deliberately read-only-first: prove the edge Last.fm proxy and the match-key normalization primitive with enrichment (Phase 8), ship discovery and tap-to-play (Phases 9–10) with zero auth surface, then introduce the highest-risk signed-call infrastructure once (Phase 11) and layer the two write features (scrobble, loved-sync) on top (Phases 12–13). Sign-in is optional/additive throughout — every signed-out path keeps the local-first app fully working. All `LASTFM_KEY` / `LASTFM_SECRET` use and the user session key stay server-side only (JOOX_TOKEN parity).

**Numbering:** Continues from the v1.0 milestone — v1.0 ended at Phase 7, so v1.1 runs Phases 8–13.

### Phases (v1.1)

- [ ] **Phase 8: Last.fm Read Foundation & Metadata Enrichment** - Edge Last.fm read proxy (`LASTFM_KEY` injected on the edge) + lazy, additive metadata enrichment (tags, bio, hi-res art) with placeholder-art filtering; establishes the reusable match-key normalization primitive
- [ ] **Phase 9: Discovery / Hot-Picks Tab** - Auth-free Explore tab — global charts, vibe/mood tag browsing, and country/region top-lists — edge-cached to respect rate limits
- [ ] **Phase 10: Last.fm-searchable Source** - A new "Last.fm" source whose discovered tracks resolve to playable audio via the existing CN-source resolver (best-match scoring); discovery becomes tap-to-play
- [ ] **Phase 11: Signed-call Infrastructure & Auth** - `api_sig` signer on the edge (UTF-8/CJK-correct), Last.fm Web Auth sign-in/out, session key in an httpOnly cookie; gates all write features
- [ ] **Phase 12: Scrobbling (online-only)** - When signed in, now-playing + exactly-once scrobble at the Last.fm threshold; a no-op and non-blocking when signed out
- [ ] **Phase 13: Loved-Tracks Sync** - When signed in, favorite/unfavorite mirrors to Last.fm love/unlove and sign-in additively merges Last.fm loved tracks into local favorites (non-destructive)

### Phase Details (v1.1)

### Phase 8: Last.fm Read Foundation & Metadata Enrichment

**Goal**: A user who plays or views any track sees it enriched with Last.fm data — top tags, an artist-bio snippet, and higher-resolution cover art — layered on without ever degrading good per-source data or delaying playback; and the milestone's shared edge Last.fm read proxy + match-key normalization primitive exist for later phases to reuse.
**Mode:** mvp
**Depends on**: Nothing new (rides the existing `/api/[source]/[...path]` passthrough + `Env.LASTFM_KEY`; first phase of v1.1)
**Requirements**: ENRICH-01, ENRICH-02, ENRICH-03
**Success Criteria** (what must be TRUE):

  1. Playing or opening the detail/now-playing view of a track shows Last.fm top tags, an artist-bio snippet, and (when better) a higher-resolution cover — merged onto, never replacing, existing good per-source title/artist/album/cover data
  2. Last.fm placeholder / grey-star art (hash `2a96cbd8b46e442fc41c2b86b821562f`) and empty image entries are detected and discarded, so a track that had real cover art never regresses to a broken/placeholder image
  3. A track with no Last.fm match (error 6) still displays and plays exactly as before — enrichment is silent best-effort, never a hard failure, and never blocks or delays the moment audio starts
  4. With `LASTFM_KEY` absent (e.g. plain `vite dev`), the app behaves identically minus enrichment — no errors, no broken UI — proving graceful degradation
  5. The same normalized `{artist}+{title}` match-key used to align Last.fm data with local tracks is available as a reusable primitive (consumed later by Phase 13's loved-sync reconciliation)

**Plans**: 3 plans (2 waves)
Plans:
**Wave 1**

- [ ] 08-01-PLAN.md — Edge /api/lastfm/info read proxy + match-key primitive + Track enrich fields + enrichment service + now-playing tag chips & higher-res cover swap (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 08-02-PLAN.md — Artist page: Last.fm bio snippet + tags + better hero image, always-present attribution link (wave 2)
- [ ] 08-03-PLAN.md — Album page: higher-res Last.fm cover + listeners/playcount info (wave 2)

**Research flag**: Standard patterns — mirrors the existing `/api/similar` edge route; placeholder filter and merge rules fully specified in research. No `--research-phase` needed.
**Security note**: Owns the enrichment-overwrite / placeholder-art pitfalls (PITFALLS Pitfall 8) — enrichment stays additive, async, and off the playback critical path. Also owns first-endpoint `platform?.env` plumbing (absent-key graceful state) and lays the UTF-8 foundation reused by Phase 11.

### Phase 9: Discovery / Hot-Picks Tab

**Goal**: A signed-out user can open an Explore tab in the existing bottom-nav shell and browse Last.fm-powered discovery — global leaderboards, vibe/mood/genre tags, and country/region charts — with responses edge-cached so repeated browsing never trips Last.fm rate limits.
**Mode:** mvp
**Depends on**: Phase 8 (Last.fm read proxy + source registration)
**Requirements**: DISCO-01, DISCO-02, DISCO-03, DISCO-04
**Success Criteria** (what must be TRUE):

  1. User can browse global leaderboards — top tracks and top artists — from the Explore tab
  2. User can pick a vibe / mood / genre tag and see that tag's top tracks, artists, and albums
  3. User can browse country / region charts for a curated set of countries
  4. Explore is a tab in the existing bottom-nav shell and is fully usable while signed out; opening and re-opening it repeatedly stays fast and does not produce rate-limit (code 29) failures, because discovery responses are edge-cached

**Plans**: TBD
**UI hint**: yes
**Research flag**: Standard SvelteKit `+page.ts` SSR `load` + Cloudflare Cache API TTL caching. No `--research-phase` needed.
**Security note**: Discovery is public, key-only data — mark it `Cache-Control: public` with sensible TTLs; reserve `private, no-store` for any user-keyed data (none in this phase). Cap fan-out concurrency (3–5 in flight) and reuse `fetchWithRetry` to stay under rate limits (PITFALLS Pitfall 11).

### Phase 10: Last.fm-searchable Source (re-search resolver)

**Goal**: A user can tap any Last.fm-discovered track (from enrichment or the Explore tab) and have it play — the new "Last.fm" source resolves `{artist, title}` to the best-matching playable audio from the existing CN sources, and a resolution miss degrades gracefully instead of breaking the app.
**Mode:** mvp
**Depends on**: Phase 8 (`'lastfm'` SourceId + read proxy), existing catalog/dedupe stack (Phase 1 of v1.0); independent of auth
**Requirements**: LFSRC-01, LFSRC-02, LFSRC-03
**Success Criteria** (what must be TRUE):

  1. Tapping a Last.fm-discovered track plays audio resolved through the existing CN-source resolver (searchAll + dedupeBest), with the queue keeping the original Last.fm identity
  2. Resolution picks the best `{artist, title}` match by normalized scoring — penalizing cover/karaoke/live variants and applying a duration sanity check — rather than blindly taking the first result
  3. When no playable variant is found, the track surfaces a clear "no playable source" state (same posture as a dead CDN URL) and the failure never breaks search, the queue, or other sources
  4. The new "Last.fm" source is registered in both the client source registry and the edge proxy registry by adding files only — no edits to shared aggregation/dispatch code (adapter-pattern parity)

**Plans**: TBD
**Research flag**: Re-search resolver path (the v1.1 scope) needs no extra research. NOTE: GD Studio `ytmusic` is OUT of v1.1 (deferred — LFSRC-FB-01). If it is ever pulled in, it warrants its own `--research-phase` feasibility spike (`s`-checksum host/version drift, 50 req/5 min cap, instance failover, Western-catalog match rate).
**Security note**: Isolate the resolver behind `Promise.allSettled` + `AbortSignal.timeout` so a slow/empty resolve can never stall the shared fan-out or break the working 4-source experience; score matches to avoid wrong-song playback (PITFALLS Pitfall 7 / threat T-lfm-04, scoped to the deferred ytmusic path).

### Phase 11: Signed-call Infrastructure & Auth

**Goal**: A user can optionally sign in to Last.fm via the official Web Auth flow and sign out; while signed in the app shows their username, and while signed out the app stays fully usable. The shared secret and the infinite-lifetime session key never leave the edge — this phase builds the one correct `api_sig` signer and the httpOnly-cookie session that gate every write feature.
**Mode:** mvp
**Depends on**: Phase 8 (edge proxy posture + UTF-8 foundation); prerequisite for Phases 12 and 13
**Requirements**: LFAUTH-01, LFAUTH-02, LFAUTH-03, LFAUTH-04
**Success Criteria** (what must be TRUE):

  1. User can sign in via the official Last.fm Web Auth flow (authorize on last.fm, return to the app) and sign out again; sign-in state is restored on return via a boot "who am I" check
  2. When signed in the app shows the Last.fm username; when signed out the app remains fully usable with local favorites/playlists intact (local-first preserved)
  3. A signed Last.fm call for a Chinese artist/track name (e.g. `周杰伦` / `稻香`) succeeds — `api_sig` is computed on the edge with correct UTF-8 encoding, `format`/`callback` excluded from the signature, and ASCII key sort — proving CJK correctness, not just English
  4. The session key is stored only in an httpOnly + Secure + SameSite cookie; a grep of the client bundle and an inspection of every response body + header show no `LASTFM_SECRET`, no `sk`, and no `api_sig`

**Plans**: TBD
**UI hint**: yes
**Research flag**: `api_sig` algorithm is fully specified at HIGH confidence; httpOnly-cookie + SameSite CSRF defense is standard web security. No `--research-phase` needed. A `周杰伦`/`稻香` CJK signing fixture test is a mandatory deliverable (run in the workerd/`wrangler dev` runtime, not jsdom/Node).
**Security note**: Owns threats T-lfm-01 (secret/session-key leakage), T-lfm-02 (sk storage — httpOnly cookie, never localStorage), and T-lfm-03 (CSRF — SameSite cookie + origin check, POST-only writes), plus the `api_sig` UTF-8/CJK correctness (PITFALLS Pitfalls 1–4). This is the milestone's highest-risk security surface, deliberately sequenced after the read-only phases.

### Phase 12: Scrobbling (online-only)

**Goal**: A signed-in user's listening is reflected on their Last.fm profile — now-playing appears at play start and a play is scrobbled exactly once when it crosses the Last.fm threshold — while a signed-out user experiences zero change and playback is never blocked or delayed.
**Mode:** mvp
**Depends on**: Phase 11 (auth store + signed-call infrastructure + sk cookie)
**Requirements**: SCROB-01, SCROB-02, SCROB-03
**Success Criteria** (what must be TRUE):

  1. When signed in, starting a track sends now-playing (track.updateNowPlaying) to Last.fm at play start
  2. When signed in, one listen produces exactly one scrobble — fired once when the track crosses the threshold (> 30s long and played ≥ 50% or ≥ 4 min) using a play-start UTC timestamp — and seeking back or replaying does not double-scrobble
  3. When signed out, scrobbling is a complete no-op; in either state a scrobble/now-playing failure never blocks, delays, or breaks playback (online-only — offline queue deferred to v2)

**Plans**: TBD
**Research flag**: Scrobble rules verified against official docs at HIGH confidence; player hook points already identified in research. No `--research-phase` needed.
**Security note**: Per-play `scrobbleState` guard (one scrobble per play instance; `playStartedAt` captured once at play start) and a `if (!authed) return` gate on every call (PITFALLS Pitfall 5). Writes go through the Phase 11 signed POST route (CSRF-protected). Offline batch queue and its ≤50/ASCII-array-sort edge cases are explicitly deferred (PITFALLS Pitfall 6).

### Phase 13: Loved-Tracks Sync

**Goal**: A signed-in user's hearts feel connected to Last.fm — favoriting/unfavoriting a track also loves/unloves it on Last.fm (best-effort, non-blocking), and signing in additively merges their Last.fm loved tracks into local favorites without ever destroying a local favorite.
**Mode:** mvp
**Depends on**: Phase 11 (auth + signed POST route); uses Phase 8's match-key normalization primitive for reconciliation
**Requirements**: LOVE-01, LOVE-02
**Success Criteria** (what must be TRUE):

  1. When signed in, favoriting a track loves it on Last.fm and unfavoriting unloves it (track.love / track.unlove), best-effort and non-blocking — a sync failure leaves the local favorite correct and never blocks the UI
  2. On sign-in, the user's Last.fm loved tracks are merged into local favorites as an additive union (matched by the normalized artist+title key), and no local favorite is ever auto-removed or auto-unloved
  3. When signed out, favoriting/unfavoriting is the existing purely-local toggle with no Last.fm calls

**Plans**: TBD
**Research flag**: Reconciliation logic is fully specified in ARCHITECTURE.md. Consider `--research-phase` ONLY if CJK normalization edge cases (Traditional/Simplified folding, CJK punctuation variants, "ghost" loved stubs with no playable source) prove complex during planning.
**Security note**: Inherits Phase 11's CSRF defense on the love POST route. Reconciliation is strictly additive/non-destructive (local action wins for local UI; pulled loves only add) per the local-first boundary (PITFALLS Pitfall 9). Match-key reuse from Phase 8 is the identity bridge between local `uid` and Last.fm `{artist, track}`.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 (v1.0) → 8 → 9 → 10 → 11 → 12 → 13 (v1.1)

v1.1 dependency chain: 8 → (9, 10) read-only & auth-free first; 11 (auth) before 12 & 13; Phase 8's match-key primitive feeds Phase 13's reconciliation.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Layer + Proxy Foundation | 3/4 | In Progress|  |
| 2. Audio Engine + Playback Core | 0/TBD | Not started | - |
| 3. Persistence + Library | 0/TBD | Not started | - |
| 4. Mobile UI Shell | 0/TBD | Not started | - |
| 5. PWA + Service Worker | 0/TBD | Not started | - |
| 6. Background Audio + MediaSession | 0/TBD | Not started | - |
| 7. New Sources + Queue Model + Gestures | 0/TBD | Not started | - |
| 8. Last.fm Read Foundation & Metadata Enrichment | 0/3 | Planned | - |
| 9. Discovery / Hot-Picks Tab | 0/TBD | Not started | - |
| 10. Last.fm-searchable Source | 0/TBD | Not started | - |
| 11. Signed-call Infrastructure & Auth | 0/TBD | Not started | - |
| 12. Scrobbling (online-only) | 0/TBD | Not started | - |
| 13. Loved-Tracks Sync | 0/TBD | Not started | - |
