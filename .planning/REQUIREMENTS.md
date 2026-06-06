# Requirements: MusicSquare Mobile

**Defined:** 2026-06-05
**Core Value:** A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.

## v1 Requirements

Initial release. Reuses the existing data layer; replaces the desktop UI with a mobile-first PWA.

### Data Layer & Proxy

- [ ] **DATA-01**: Reusable data logic (per-source search/detail fetchers, state model, persistence, LRC parsing) is extracted from `index.html` into typed modules the new app imports
- [ ] **DATA-02**: A SvelteKit `+server.ts` proxy route fronts all music-source **metadata** calls (search / detail / lyrics), owning CORS, bounded retry, and hiding the JOOX token via `platform.env`
- [ ] **DATA-03**: Search fans out across all enabled sources with per-source isolation (`Promise.allSettled`) so one failing source never breaks the result set
- [ ] **DATA-04**: A pluggable source-adapter registry lets a new source be added by adding files only (client adapter + proxy adapter + registry import), touching no shared code

### Playback

- [ ] **PLAY-01**: A single app-scoped `<audio>` element and reactive playback store survive route navigation (playback never stops on nav)
- [ ] **PLAY-02**: User can play/pause, skip next/previous, and seek within the current track
- [ ] **PLAY-03**: User can switch play mode (list / single-repeat / shuffle)
- [ ] **PLAY-04**: Audio streams browser → source CDN directly (not through the proxy); a dead/expired stream URL fails gracefully with a user-visible message
- [ ] **PLAY-05**: Playback continues when the screen locks or app backgrounds, with lock-screen / notification controls + metadata via `navigator.mediaSession` (Android guaranteed; iOS validated on real device)
- [ ] **PLAY-06**: Explicit queue / Up-Next model with a view, remove, and jump-to (replaces list-based advance)

### Mobile UI

- [ ] **UI-01**: Bottom-tab navigation (Home / Search / Library)
- [ ] **UI-02**: Persistent mini-player bar that expands to a full-screen now-playing view (tap up / swipe-down to dismiss)
- [ ] **UI-03**: User can search and tap a result to play it
- [ ] **UI-04**: Full-screen now-playing shows artwork, transport, progress/seek, and a source/quality badge
- [ ] **UI-05**: Synced line-level lyrics view with active-line highlight and auto-scroll
- [ ] **UI-06**: Loading / buffering / error states and toasts make source failures visible and graceful
- [ ] **UI-07**: Responsive mobile-first layout that scales up to desktop
- [ ] **UI-08**: zh / en language toggle preserved from the existing app
- [ ] **UI-09**: Touch gestures — swipe-down to dismiss now-playing, swipe to change track, drag to reorder the queue

### Library

- [ ] **LIB-01**: User can favorite / unfavorite the current track
- [ ] **LIB-02**: User can create playlists and add / remove tracks
- [ ] **LIB-03**: Library persists locally across sessions (localStorage, with an IndexedDB migration path)
- [ ] **LIB-04**: User can import / export their library as JSON

### Sources

- [ ] **SRC-01**: The 4 existing sources (Netease, QQ, Kuwo, JOOX) work end-to-end through the new data layer + proxy
- [ ] **SRC-02**: Kugou added as a source via the adapter registry
- [ ] **SRC-03**: Migu added as a source via the adapter registry

### PWA

- [ ] **PWA-01**: App is installable to the home screen
- [ ] **PWA-02**: Service worker precaches the app shell (UI loads offline); never caches audio or `/api`; shows a clear "offline — playback needs a connection" state

## v1.1 Requirements — Last.fm Integration

Milestone v1.1 (Last.fm Integration). Optional/additive — local-first still works signed-out. All Last.fm key + shared-secret use stays server-side only (JOOX_TOKEN parity). Phases continue at 8.

### Last.fm Metadata Enrichment

- [x] **ENRICH-01**: Playing or viewing a track enriches it with Last.fm metadata (track/artist/album.getInfo) — top tags, artist bio snippet, and higher-resolution cover art — layered on without overwriting good per-source data
- [x] **ENRICH-02**: Last.fm placeholder / grey-star images (hash `2a96cbd8b46e442fc41c2b86b821562f`) and empty image entries are detected and discarded, falling back to the existing per-source cover
- [x] **ENRICH-03**: All Last.fm read calls route through a server-side edge proxy (LASTFM_KEY injected on the edge, never in the client bundle); a missing key degrades gracefully and enrichment never blocks or delays playback

### Discovery / Hot Picks

- [ ] **DISCO-01**: User can browse global leaderboards — top tracks and top artists (chart.getTopTracks / chart.getTopArtists)
- [ ] **DISCO-02**: User can browse by vibe / mood / genre tag — pick a tag and see its top tracks, artists, and albums (tag.getTopTracks / getTopArtists / getTopAlbums)
- [ ] **DISCO-03**: User can browse country / region charts (geo.getTopTracks / getTopArtists) for a curated set of countries
- [ ] **DISCO-04**: Discovery is a tab in the existing bottom-nav shell, fully usable signed-out, with Last.fm responses edge-cached to respect rate limits

### Last.fm-searchable Source

- [ ] **LFSRC-01**: A new "Last.fm" source is registered in both the client source registry and the edge proxy registry, addable without touching shared code (parity with the existing adapter pattern)
- [ ] **LFSRC-02**: A Last.fm-discovered track ({artist, title}) resolves to playable audio via the existing CN-source resolver (searchAll + dedupeBest); resolution failures degrade gracefully so discovery items are tap-to-play and a miss never breaks the app
- [ ] **LFSRC-03**: Audio resolution picks the best match (normalized artist+title scoring; penalize cover/karaoke/live; duration sanity check) rather than the first result

### Last.fm Authentication

- [ ] **LFAUTH-01**: User can sign in to Last.fm via the official Web Auth flow (authorize on last.fm, return to the app) and sign out
- [ ] **LFAUTH-02**: The Last.fm session key is stored server-side in an httpOnly + Secure + SameSite cookie; the session key and shared secret never reach the client bundle or any response body
- [ ] **LFAUTH-03**: All signed Last.fm calls compute `api_sig` on the edge with correct UTF-8 handling, verified against Chinese artist/track names
- [ ] **LFAUTH-04**: When signed in the app shows the Last.fm username; when signed out the app remains fully usable (local-first preserved)

### Scrobbling

- [ ] **SCROB-01**: When signed in, the app sends now-playing (track.updateNowPlaying) at play start
- [ ] **SCROB-02**: When signed in, a play is scrobbled exactly once (track.scrobble) when it crosses the Last.fm threshold (track > 30s and played ≥ 50% or ≥ 4 min), using a play-start UTC timestamp; seek/replay does not double-scrobble
- [ ] **SCROB-03**: Scrobbling is a no-op when signed out and never blocks or delays playback (online-only; offline queue deferred)

### Loved-Tracks Sync

- [ ] **LOVE-01**: When signed in, favoriting / unfavoriting a track also loves / unloves it on Last.fm (track.love / track.unlove), best-effort and non-blocking
- [ ] **LOVE-02**: On sign-in, the user's Last.fm loved tracks are merged into local favorites (additive union via normalized artist+title match) — never destructive (no auto-unlove of local favorites)

## v2 Requirements

Acknowledged, deferred — not in the current roadmap.

### Last.fm (deferred from v1.1)

- **LFSRC-FB-01**: GD Studio `ytmusic` source as a YouTube-Music audio resolver for better Western-catalog coverage (third-party, no SLA, study-only ToS) — needs a feasibility spike before adoption
- **DISCO-P-01**: Personal top-lists — your top artists / tracks / albums with a period switcher (user.getTopArtists / getTopTracks / getTopAlbums) — requires sign-in
- **HIST-01**: Listening-history surface (user.getRecentTracks), including the now-playing item with no date
- **SCROB-Q-01**: Offline scrobble queue with batched flush (≤ 50 per request, per-item timestamps, 14-day expiry)
- **LIBIMP-01**: Full Last.fm library import (library.getArtists)
- **TAG-01**: Personal track tagging UI (track.getTags + write)

### Resilience

- **SRC-FB-01**: Source fallback on play failure (cross-source song matching — "couldn't play from QQ → trying Netease")

### Delight

- **LYR-01**: Tap a lyric line to seek to that timestamp
- **TIMER-01**: Sleep timer
- **HOME-01**: Recently played / search history on the Home tab
- **COACH-01**: Custom PWA install coachmark (Android prompt + iOS Share instructions)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Offline audio download / track caching | Source URLs are short-lived expiring CDN links (technically near-impossible) + legal exposure + storage cost. Stream-only; cache app shell only. |
| First-party account system (own email/password + user DB) | Backend/auth/PII/server cost. NOTE (v1.1): optional **Last.fm** sign-in IS now in scope — accounts/cloud-sync are delegated to Last.fm, not built in-house; local-first remains the signed-out default. |
| Native iOS / Android apps | App-store ToS exposure for an unofficial aggregator + double maintenance. PWA delivers app-like UX. |
| Crossfade / gapless playback | A single `<audio>` element can't crossfade; dual-element + Web Audio against expiring/flaky URLs not worth it. |
| Official *paid streaming* APIs (Spotify / Apple Music) | Licensing + auth complexity. NOTE (v1.1): a YouTube-style source for resolving audio of Last.fm-discovered tracks IS in scope (GD Studio `ytmusic` deferred to a spike); Last.fm itself is metadata/social only, not a stream provider. |
| Audio-reactive visualizer / EQ | Cross-origin non-CORS media blocks Web Audio analysis (existing app already fakes it). |

## Traceability

Each v1 requirement maps to exactly one phase. See `.planning/ROADMAP.md` for phase detail.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| PLAY-01 | Phase 2 | Pending |
| PLAY-02 | Phase 2 | Pending |
| PLAY-03 | Phase 2 | Pending |
| PLAY-04 | Phase 2 | Pending |
| PLAY-05 | Phase 6 | Pending |
| PLAY-06 | Phase 7 | Pending |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 4 | Pending |
| UI-03 | Phase 4 | Pending |
| UI-04 | Phase 4 | Pending |
| UI-05 | Phase 4 | Pending |
| UI-06 | Phase 4 | Pending |
| UI-07 | Phase 4 | Pending |
| UI-08 | Phase 4 | Pending |
| UI-09 | Phase 7 | Pending |
| LIB-01 | Phase 3 | Pending |
| LIB-02 | Phase 3 | Pending |
| LIB-03 | Phase 3 | Pending |
| LIB-04 | Phase 3 | Pending |
| SRC-01 | Phase 1 | Pending |
| SRC-02 | Phase 7 | Pending |
| SRC-03 | Phase 7 | Pending |
| PWA-01 | Phase 5 | Pending |
| PWA-02 | Phase 5 | Pending |

**Coverage (v1.0):**
- v1 requirements: 28 total
- Mapped to phases: 28 ✓
- Unmapped: 0 ✓

**Per-phase counts (v1.0):** Phase 1: 5 (DATA-01..04, SRC-01) · Phase 2: 4 (PLAY-01..04) · Phase 3: 4 (LIB-01..04) · Phase 4: 8 (UI-01..08) · Phase 5: 2 (PWA-01..02) · Phase 6: 1 (PLAY-05) · Phase 7: 4 (SRC-02, SRC-03, PLAY-06, UI-09)

### Traceability (v1.1 — Last.fm Integration)

Each v1.1 requirement maps to exactly one phase (8–13). See `.planning/ROADMAP.md` ## Milestone v1.1 for phase detail.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENRICH-01 | Phase 8 | Complete |
| ENRICH-02 | Phase 8 | Complete |
| ENRICH-03 | Phase 8 | Complete |
| DISCO-01 | Phase 9 | Pending |
| DISCO-02 | Phase 9 | Pending |
| DISCO-03 | Phase 9 | Pending |
| DISCO-04 | Phase 9 | Pending |
| LFSRC-01 | Phase 10 | Pending |
| LFSRC-02 | Phase 10 | Pending |
| LFSRC-03 | Phase 10 | Pending |
| LFAUTH-01 | Phase 11 | Pending |
| LFAUTH-02 | Phase 11 | Pending |
| LFAUTH-03 | Phase 11 | Pending |
| LFAUTH-04 | Phase 11 | Pending |
| SCROB-01 | Phase 12 | Pending |
| SCROB-02 | Phase 12 | Pending |
| SCROB-03 | Phase 12 | Pending |
| LOVE-01 | Phase 13 | Pending |
| LOVE-02 | Phase 13 | Pending |

**Coverage (v1.1):**
- v1.1 requirements: 19 total
- Mapped to phases: 19 ✓
- Unmapped: 0 ✓

**Per-phase counts (v1.1):** Phase 8: 3 (ENRICH-01..03) · Phase 9: 4 (DISCO-01..04) · Phase 10: 3 (LFSRC-01..03) · Phase 11: 4 (LFAUTH-01..04) · Phase 12: 3 (SCROB-01..03) · Phase 13: 2 (LOVE-01..02)

---
*Requirements defined: 2026-06-05*
*Last updated: 2026-06-06 after defining milestone v1.1 (Last.fm Integration) requirements*
