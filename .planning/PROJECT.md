# MusicSquare Mobile

## What This Is

A mobile-first web music player that searches and streams tracks aggregated from multiple Chinese music platforms (Netease, QQ, Kuwo, JOOX, plus new sources). It is a ground-up reskin of an existing desktop single-page player ([index.html](index.html)): the proven data/fetch layer is reused, while the desktop three-panel UI is replaced with an app-like mobile interface inspired by YouTube Music and Spotify (bottom nav, expandable now-playing, background audio, installable PWA). Built with SvelteKit and deployed on Cloudflare.

## Core Value

A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.

## Current Milestone: v1.1 Last.fm Integration

**Goal:** Connect the standalone aggregator to Last.fm — richer track/artist/album metadata, an optional sign-in that syncs likes/scrobbles/history back to last.fm, discovery tabs built from Last.fm charts/tags, and a new Last.fm-searchable playback source.

**Target features:**
- Last.fm metadata enrichment layered onto existing multi-source tracks (track/artist/album.getInfo, top tags, bios, higher-res cover art)
- Optional Last.fm user authentication — signed auth flow (md5 api_sig with LASTFM_SECRET, auth.getSession), session key + username stored, restorable on return
- Two-way sync: loved tracks (track.love/unlove), scrobbles (track.scrobble), recent-tracks history (user.getRecentTracks)
- Discovery / hot-picks tabs: latest hits, charts/leaderboards (chart + geo.getTopTracks), vibe/mood tags (tag.getTopTracks/Artists), top albums/tracks/artists
- New Last.fm-searchable source (YouTube-style) that resolves playable audio for Last.fm-discovered tracks via the existing source/proxy adapter registry

**Boundaries:** Last.fm sign-in is optional/additive — local-first (favorites/playlists in localStorage) keeps working signed-out. All Last.fm key + shared-secret use stays server-side only (JOOX_TOKEN parity).

## Requirements

### Validated

<!-- Existing capabilities inherited from the current desktop app (index.html). These work today and the rebuild must preserve them by reusing the data layer. -->

- ✓ Search across 4 music sources (Netease, QQ, Kuwo, JOOX) with parallel fan-out and interleaved results — existing (`searchAllSources`, `index.html:2216`)
- ✓ Resolve audio stream URL + lyrics per track, lazily on play — existing (`ensureTrackDetails`, `index.html:2506`)
- ✓ Audio playback via HTML5 `<audio>`: play/pause, next/prev, play modes (list / single / shuffle) — existing (`playTrack`/`playNext`, `index.html:2599`)
- ✓ Synced LRC lyrics display — existing (`parseLRC`, `index.html:2517`)
- ✓ Favorites + user playlists with localStorage persistence — existing (`index.html:1804`)
- ✓ Import / export library as JSON — existing (`importPlaylistData`/`exportPlaylistData`, `index.html:1841`)
- ✓ Bilingual UI (Chinese / English) i18n — existing (`translations`, `index.html:1495`)

### Active

<!-- The rebuild. Hypotheses until shipped + validated. -->

- [ ] New mobile-first UI in SvelteKit replacing the desktop three-panel layout (responsive, scales up to desktop)
- [ ] Bottom tab navigation + persistent mini-player that expands to a full-screen now-playing view (YouTube Music / Spotify pattern)
- [ ] Background audio: keeps playing on screen-lock with lock-screen / notification controls and metadata (`navigator.mediaSession` + Wake Lock)
- [ ] Installable PWA with service-worker app-shell caching (streamed audio stays online-only)
- [ ] Touch gestures: swipe to change track, swipe-down to dismiss now-playing, drag to reorder queue
- [ ] Cloudflare Worker proxy sitting in front of all music APIs (owns CORS, rate-limit/retry, hides the JOOX token)
- [ ] Extract the reusable data layer (search/detail fetchers, state model, persistence) out of the monolith into clean modules
- [ ] Add Kugou and Migu as new sources; add other sources on a best-effort basis where a reliable proxy exists
- [ ] Preserve favorites/playlists, lyrics, play modes, and bilingual i18n in the new UI
- [ ] Deploy to Cloudflare (Pages/Workers)

### Out of Scope

- Native iOS/Android apps — PWA delivers the app-like experience without app-store overhead and ToS exposure
- First-party account system (own email/password, own user DB) — REVERSED in v1.1 *only* via Last.fm: sign-in is delegated to Last.fm (optional), which provides cloud-synced likes/scrobbles/history. We still build no proprietary account store; local-first remains the signed-out default.
- Official *paid streaming* APIs (Spotify / Apple Music) — licensing + auth complexity. NOTE: a YouTube-style source for resolving playable audio of Last.fm-discovered tracks IS in scope for v1.1 (uses the same unofficial-proxy posture as existing sources); Last.fm itself is metadata/social only, not a stream provider.
- Audio downloads / offline track caching — streaming only; legal exposure and storage cost
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
*Last updated: 2026-06-06 after starting milestone v1.1 (Last.fm Integration)*
