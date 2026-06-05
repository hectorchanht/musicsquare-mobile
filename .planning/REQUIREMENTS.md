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

## v2 Requirements

Acknowledged, deferred — not in the current roadmap.

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
| User accounts / cloud sync of library | Contradicts local-first design; backend/auth/PII/server cost. Import/export covers portability. |
| Native iOS / Android apps | App-store ToS exposure for an unofficial aggregator + double maintenance. PWA delivers app-like UX. |
| Crossfade / gapless playback | A single `<audio>` element can't crossfade; dual-element + Web Audio against expiring/flaky URLs not worth it. |
| Official Spotify / Apple Music / YouTube Music APIs | Licensing + auth complexity; aggregates the same unofficial sources as today. |
| Audio-reactive visualizer / EQ | Cross-origin non-CORS media blocks Web Audio analysis (existing app already fakes it). |

## Traceability

Populated during roadmap creation (roadmapper maps each requirement to exactly one phase).

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | — | Pending |
| DATA-02 | — | Pending |
| DATA-03 | — | Pending |
| DATA-04 | — | Pending |
| PLAY-01 | — | Pending |
| PLAY-02 | — | Pending |
| PLAY-03 | — | Pending |
| PLAY-04 | — | Pending |
| PLAY-05 | — | Pending |
| PLAY-06 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |
| UI-05 | — | Pending |
| UI-06 | — | Pending |
| UI-07 | — | Pending |
| UI-08 | — | Pending |
| UI-09 | — | Pending |
| LIB-01 | — | Pending |
| LIB-02 | — | Pending |
| LIB-03 | — | Pending |
| LIB-04 | — | Pending |
| SRC-01 | — | Pending |
| SRC-02 | — | Pending |
| SRC-03 | — | Pending |
| PWA-01 | — | Pending |
| PWA-02 | — | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 0 (roadmapper populates)
- Unmapped: 28 ⚠️

---
*Requirements defined: 2026-06-05*
*Last updated: 2026-06-05 after initial definition*
