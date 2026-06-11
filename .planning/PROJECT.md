# MusicSquare Mobile

## What This Is

A mobile-first web music player that searches and streams tracks aggregated from multiple Chinese music platforms (Netease, QQ, Kuwo, JOOX, plus new sources). It is a ground-up reskin of an existing desktop single-page player ([index.html](index.html)): the proven data/fetch layer is reused, while the desktop three-panel UI is replaced with an app-like mobile interface inspired by YouTube Music and Spotify (bottom nav, expandable now-playing, background audio, installable PWA). Built with SvelteKit and deployed on Cloudflare.

## Core Value

A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.

## Current Milestone: v1.2 Resilient Playback & UX Polish

**Goal:** Music never stops — multi-source failover with skip-and-toast, gapless next-track prefetch, and auto-generated up-next — plus offline playback of downloaded tracks and a broad UX polish pass across lyrics, menu modal, covers, search, homepage, and sharing.

**Target features:**
- Playback resilience: all-source retry on failure → toast + auto-skip; never-stop guarantee (except sleep timer / sudden offline); prefetch next track for gapless flow; auto-generate up-next when queue exhausts; repeat reduced to 2 states (off / repeat-one)
- Queue sourcing: per-context up-next setting (liked / search / downloads / etc.) — "same list" vs "genre-generated", global default = generated, defaults in config file
- Lyrics fixes: touch/hold suspends auto-scroll; end-of-lyrics spacer so last lines center; CN translation-line highlight ordering bug; bracket-hiding robustness (wider bracket support; stop dropping original lines)
- Menu modal rework: buttons render instantly with background data resolve; 2-row header (title/artist, marquee), like at top-right beside close; remix action (seed genre-generated queue from track); sleep timer (industry-standard durations + end-of-track); long-press focus-state bug
- Now playing: cover swipe prev/next; half-open sheet scroll containment; tap cover closes subnav; top loading running-line
- Search: scoring tune (short-title boost, artist-frequency boost, heavy <60s 試聽 penalty); cover fallback for results; empty-query autofocus (state-preservation safe)
- Covers: fallback resolver for the playing track; resolve-on-scroll-into-view with name-keyed cache
- Homepage: compact rows-of-4 display mode per section (setting); option icon + long-press → menu; section-title arrow → grid chart page / library tab
- Sharing/SEO: per-entity OG metadata (song/album/artist); short recognizable slugs; better SEO on every page
- Offline: downloaded songs playable offline; simplest-possible handling for online-only data when offline
- Deezer info enrichment: artist/album metadata via Deezer (carryover from v1.1)
- Polish: skeletons replace all loading text (shape-matched); button toast + double-click guard; text-size range 50–200% with contextual "example xxx" demo text; artist page hides trackless albums; accent setting verified wired; UX audit vs YT Music/Spotify feeds findings into requirements

**Boundaries:** OS media-card stays standard controls only (web MediaSession has a fixed action set — no like/shuffle buttons possible for PWAs). Last.fm auth/scrobble/loved-sync deferred again → v1.3. Theme (light/dark) already shipped in v1.1 follow-ups.

## Requirements

### Validated

<!-- Existing capabilities inherited from the current desktop app (index.html). These work today and the rebuild must preserve them by reusing the data layer. -->

- ✓ Search across 4 music sources (Netease, QQ, Kuwo, JOOX) with parallel fan-out and interleaved results — existing (`searchAllSources`, `index.html:2216`)
- ✓ Resolve audio stream URL + lyrics per track, lazily on play — existing (`ensureTrackDetails`, `index.html:2506`)
- ✓ Audio playback via HTML5 `<audio>`: play/pause, next/prev, play modes (list / single / shuffle) — existing (`playTrack`/`playNext`, `index.html:2599`)
- ✓ Synced LRC lyrics display — existing (`parseLRC`, `index.html:2517`)
- ✓ Favorites + user playlists with localStorage persistence — existing (`index.html:1804`)
- ✓ Import / export library as JSON — existing (`importPlaylistData`/`exportPlaylistData`, `index.html:1841`)
- ✓ Bilingual UI (Chinese / English) i18n — existing (`translations`, `index.html:1495`); expanded to 15 locales in v1.1 follow-ups
- ✓ Mobile-first SvelteKit UI: bottom nav, persistent nowbar mini-player, expandable now-playing sheet — v1.0 rebuild
- ✓ Data layer extracted into typed modules behind source/proxy adapter registries; Cloudflare same-origin `/api/*` proxy (JOOX token server-side) — v1.0 Phase 1
- ✓ Last.fm read-side: metadata enrichment, discovery/hot-picks shelves (charts/tags/geo), Last.fm-searchable source — v1.1 Phases 8–10
- ✓ Deezer-chart cover sourcing + cover backfill chain (Deezer → iTunes → CN) — v1.1 follow-ups
- ✓ Track downloads with separate download-quality setting; offline-first playback for downloaded tracks — v1.1 follow-ups (reverses the old "no downloads" exclusion)
- ✓ Search & data responsiveness: skeletons, search-state restore, TTL query cache, progressive results — Phase 14
- ✓ Now-playing shared-element expand/collapse + swipe gestures — Phase 15
- ✓ Never-stop playback: all-source failover → skip/batched toasts; 5-failure loop-guard with sticky Retry toast; offline gate + downloads up-next switch; 15s stall watchdog; prefetch-on-ended; 2-state repeat (off / repeat-one) — Validated in Phase 16: Playback Resilience Core
- ✓ Cover-chain: a cover fetched at play time propagates to all same-song library entries + cover-cache, live — Phase 16 follow-up fix
- ✓ Per-context up-next sourcing (same-list vs generated, global default = generated) with `queueContext` threading; queue management (swipe-to-remove + clear with regeneration exclusion); auto-expand fixed to fresh plays only — Validated in Phase 17: Up-Next Sourcing & Settings Plumbing
- ✓ Deezer artist/album info enrichment via own-origin edge proxies with field-precedence merge beside Last.fm — Validated in Phase 17
- ✓ Text-size sliders widened to 50–200% with live demo text from current track; accent setting hover state wired via derived `--color-primary-hover` — Validated in Phase 17
- ✓ Sleep timer (5/10/15/30/45/60 min or end-of-track) from the track menu — global timer sheet, nowbar + now-playing active indicator with live countdown, cancel/change; volume-fade-then-pause on writable platforms, instant-pause on iOS; expiry never triggers failover/skip/loop-guard — Validated in Phase 18: Sleep Timer (device-only fade/lock-screen behaviors tracked in 18-HUMAN-UAT.md)
- ✓ Track menu rework: always-visible action buttons with background resolve-then-act (pure gate helper, in-flight dedupe, graceful failure / no stuck spinner), 2-row marquee header with top-right like/close, Remix (seed → force-generated genre up-next preserving manual pins), and a long-press focus/tap-highlight fix (global tap-highlight reset + `@media (hover: hover)` guards + blur-on-longpress across all 6 trigger sites) — Validated in Phase 19: Track Menu Rework (device-only contracts — marquee re-measure, resolve-then-act visual flow, iOS/Android stuck-highlight — pending a `/gsd:verify-work 19` device pass)

### Active

<!-- v1.2 scope. Hypotheses until shipped + validated. -->

- [ ] Lyrics: touch-suspended auto-scroll, end spacer, CN highlight-ordering fix, robust bracket hiding
- [ ] Now-playing: cover swipe prev/next, half-open scroll containment, tap-cover closes subnav, top running-line loader
- [ ] Search scoring tune + result cover fallback + empty-query autofocus
- [ ] Cover fallback resolver (playing track + scroll-into-view) with name-keyed cache
- [ ] Homepage compact rows-of-4 mode (per-section setting) + section grid pages / library-tab redirects
- [ ] Sharing/SEO: per-entity OG metadata, short slugs, per-page SEO
- [ ] Offline app usability for downloaded tracks; simple offline display for online-only data
- [ ] Polish: shape-matched skeletons everywhere, button toast + double-click guard, hide trackless albums, UX audit vs YT Music/Spotify

### Out of Scope

- Native iOS/Android apps — PWA delivers the app-like experience without app-store overhead and ToS exposure
- First-party account system (own email/password, own user DB) — REVERSED in v1.1 *only* via Last.fm: sign-in is delegated to Last.fm (optional), which provides cloud-synced likes/scrobbles/history. We still build no proprietary account store; local-first remains the signed-out default. Last.fm auth/write-side (sign-in, scrobble, loved-sync) deferred to **v1.3**.
- Official *paid streaming* APIs (Spotify / Apple Music) — licensing + auth complexity. NOTE: a YouTube-style source for resolving playable audio of Last.fm-discovered tracks IS in scope for v1.1 (uses the same unofficial-proxy posture as existing sources); Last.fm itself is metadata/social only, not a stream provider.
- ~~Audio downloads / offline track caching~~ — **REVERSED in v1.1 follow-ups / formalized in v1.2**: downloads + offline-first playback shipped; v1.2 makes offline usability a first-class requirement. Owner accepts the legal/storage posture (personal/demo project).
- Like/shuffle buttons on the OS media card (lock screen / media hub) — web MediaSession API exposes a fixed action set; custom actions aren't rendered by Chrome/Android/macOS/iOS for PWAs. Standard prev/play/next/seek only; like + shuffle live in-app.
- Keeping the old desktop `index.html` UI maintained in parallel — it is the reference/source to extract from, not a maintained surface

## Context

- **Origin:** Fork of `CharlesPikachu/musicsquare` (kept as `upstream` remote). Current code is one ~113 KB `index.html` (HTML + CSS + a single vanilla-JS IIFE) served as a static file on GitHub Pages. No build, no deps, no tests. Full analysis in `.planning/codebase/`.
- **The "backend" is reusable, the UI is not:** the codebase map tags every function REUSE (data/fetch/state/persistence) vs REPLACE (DOM/CSS/desktop layout). The rebuild keeps the former, discards the latter. See [.planning/codebase/ARCHITECTURE.md](.planning/codebase/ARCHITECTURE.md).
- **Data sources are unofficial third-party proxies** (`api.qijieya.cn`, `tang.api.s01s.cn`, `kw-api.cenguigui.cn`, `apicx.asia`) with no SLA — reliability and CORS are the top technical risk. See [.planning/codebase/INTEGRATIONS.md](.planning/codebase/INTEGRATIONS.md) and [.planning/codebase/CONCERNS.md](.planning/codebase/CONCERNS.md).
- **Legal posture:** demo/educational; copyrights belong to original platforms. Owner accepts this as a personal/demo project (footer already states this); not a commercial release.

## Constraints

- **Tech stack**: SvelteKit + Vite — chosen for smooth animations / app-like UX and first-class Cloudflare deployment.
- **Deployment**: Cloudflare (Pages for the app, Workers for the API proxy) — must fit the Cloudflare free/edge model.
- **Compatibility**: Mobile browsers first (iOS Safari + Android Chrome), responsive up to desktop. iOS Safari background-audio/PWA quirks are a known constraint.
- **Dependencies**: Reuse existing music-source request logic and contracts rather than reinventing; upstream API shapes can change without notice.
- **Git**: `origin` pushes as GitHub user `hectorchanht` via SSH host `github-b` (`~/.ssh/hectorchanht`). `upstream` is the original fork.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SvelteKit + Vite (not vanilla, not React) | Smooth animations enhance the app-like feel; clean Cloudflare deploy | — Pending |
| Cloudflare Worker proxy in front of music APIs | Removes browser↔third-party CORS dependency; central place for rate-limit/retry; hides JOOX token | — Pending |
| Full PWA + background audio in v1 (mediaSession, wake lock, service worker) | Core to a usable mobile music player ("Spotify feel"); a player that dies on lock is unusable | — Pending |
| Extract reusable data layer into modules before/while building UI | Monolith couples data with DOM; modules let new UI consume proven fetch logic | — Pending |
| Add Kugou + Migu, others best-effort | Lowest-effort high-value CN sources via meting-style proxies; avoid over-committing to fragile ones | — Pending |
| Replace desktop UI (responsive mobile-first), don't maintain both | "Mobile first"; maintaining two UIs doubles cost | — Pending |
| v1.1: integrate Last.fm (optional auth + metadata + discovery + new source) | Delegate accounts/cloud-sync to Last.fm instead of building our own; unlock richer metadata + charts/tags discovery for free | — Pending |
| Last.fm key + shared secret stay server-side (edge) only | Shared secret signs auth/scrobble calls; exposing it = account-takeover risk. Mirrors JOOX_TOKEN handling (threat T-01-04) | — Pending |
| v1.2: never-stop playback policy (failover → skip → auto-generate), with loop-guard | Core music-app expectation; silent stops are the worst UX failure. Guard prevents infinite skip loop when offline/all sources down | — Pending |
| v1.2: per-context up-next sourcing setting, global default = genre-generated | Resolves same-list vs generated contradiction with max flexibility; search never silently appends its result list by default | — Pending |
| v1.2: OS media card keeps standard controls only (no like/shuffle) | Web MediaSession has a fixed action set; custom buttons impossible for PWAs on all target platforms | — Pending |
| v1.2: repeat reduced to off / repeat-one | Repeat-all redundant once queue auto-generates; simpler mental model | — Pending |
| Last.fm auth/write-side deferred to v1.3 (second deferral) | v1.2 prioritizes playback resilience + polish; auth is additive and independent | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-11 after Phase 19 complete (Track Menu Rework)*
