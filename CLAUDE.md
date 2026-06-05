<!-- GSD:project-start source:PROJECT.md -->
## Project

**MusicSquare Mobile**

A mobile-first web music player that searches and streams tracks aggregated from multiple Chinese music platforms (Netease, QQ, Kuwo, JOOX, plus new sources). It is a ground-up reskin of an existing desktop single-page player ([index.html](index.html)): the proven data/fetch layer is reused, while the desktop three-panel UI is replaced with an app-like mobile interface inspired by YouTube Music and Spotify (bottom nav, expandable now-playing, background audio, installable PWA). Built with SvelteKit and deployed on Cloudflare.

**Core Value:** A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.

### Constraints

- **Tech stack**: SvelteKit + Vite — chosen for smooth animations / app-like UX and first-class Cloudflare deployment.
- **Deployment**: Cloudflare (Pages for the app, Workers for the API proxy) — must fit the Cloudflare free/edge model.
- **Compatibility**: Mobile browsers first (iOS Safari + Android Chrome), responsive up to desktop. iOS Safari background-audio/PWA quirks are a known constraint.
- **Dependencies**: Reuse existing music-source request logic and contracts rather than reinventing; upstream API shapes can change without notice.
- **Git**: `origin` pushes as GitHub user `hectorchanht` via SSH host `github-b` (`~/.ssh/hectorchanht`). `upstream` is the original fork.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- HTML5 — entire application lives in `index.html` (3320 lines, ~113 KB)
- CSS3 — inline `<style>` block inside `index.html` (lines 12–1490), no external stylesheet file
- JavaScript (ES2020+) — inline `<script>` block inside `index.html` (lines 1493–3318)
- Python 3.11 — GitHub Actions automation only; `scripts/g4f_issue_reply.py` (issue auto-reply bot, not part of the web app)
## Runtime
- Browser-native: the app is a single static HTML file with zero server-side runtime
- No Node.js, no Deno, no server process
- Served directly via GitHub Pages (static file hosting)
- None — no `package.json`, no `requirements.txt`, no lockfile exists for the web app
- Python side (CI only): pip with `g4f[all]`, `requests`, `openai` installed at CI time (no pinned lockfile)
## Frameworks
- None — vanilla JavaScript, no React, Vue, Angular, Svelte, or any UI framework
- No module bundler (no Vite, Webpack, Rollup, Parcel, esbuild)
- No TypeScript
- No CSS framework (no Tailwind, Bootstrap, etc.)
- Entirely custom CSS with CSS custom properties (`--bg-dark`, `--accent`, etc.) declared in `:root`
- None — no test framework present
- **No build step.** The file you edit is the file that ships. Opening `index.html` in a browser is all that is needed.
- CI pipeline: GitHub Actions (`.github/workflows/g4f-issue-reply.yml`) runs only for issue auto-reply; not a build or deploy pipeline
## Key Dependencies
- Google Fonts — `https://fonts.googleapis.com` — loads `Baloo 2` (wght 400, 600) and `Nunito` (wght 400, 600); referenced in `index.html` lines 9–11
- No other CDN scripts — no jQuery, no hls.js, no lodash, no moment
- All music API integrations are plain `fetch()` calls to third-party proxy APIs (see INTEGRATIONS.md)
- **HTML5 `<audio>` element** — `<audio id="audio" preload="metadata">` at `index.html` line 1373
- Audio `src` is set to a direct URL returned by the music proxy APIs (`dom.audio.src = track.audioUrl`)
- Format support: MP3, AAC, OGG, FLAC (browser-native decode; no hls.js, no MSE/Media Source Extensions, no Web Audio API decode)
- **No HLS/DASH streaming** — all audio URLs are direct file links
- **Simulated audio level visualization:** `audioLevel` is a synthetic value derived from `Math.sin(currentTime)`, not from a real `AnalyserNode` (see `index.html` line 3190–3191). The Web Audio API is NOT used.
## Configuration
- No environment variables for the web app — all API endpoints and tokens are **hardcoded** in `index.html`
- JOOX token `f84ao9lMF_q7husBWRfgUw` is a hardcoded constant (`const JOOX_TOKEN`) at `index.html` line 2165
- JOOX bitrate `const JOOX_BR = 4` hardcoded at `index.html` line 2166
- Language preference stored in `localStorage` key `pikachu-music-lang`
- User library (favorites + playlists) stored in `localStorage` key `pikachu-music-library-v1`
- No build config files (no `tsconfig.json`, no `vite.config.*`, no `webpack.config.*`, no `.babelrc`, no `eslint.config.*`)
## Platform Requirements
- Any text editor + any modern browser
- No Node.js, no Python, no build tools required to run the app locally
- Open `index.html` directly in a browser (file:// protocol) or serve it with any static file server
- GitHub Pages — the repo's `index.html` is served at `https://charlespikachu.github.io/musicsquare/`
- No backend server, no database, no container, no CDN config needed
- Any static hosting (Netlify, Vercel, S3+CloudFront, Cloudflare Pages) works as-is
## Application Architecture Summary
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Language and Runtime
- ES2020+ features used throughout: `async/await`, optional chaining (`?.`), nullish coalescing (`??`), `const`/`let` (no `var`), arrow functions, destructuring, `Array.isArray`, `Map`, template literals, `Promise.all`.
- The entire JS lives inside a single IIFE at the bottom of `index.html` (lines 1493–3318). There are no separate `.js` files in `scripts/` — that directory contains only the Python CI bot.
- No jQuery, no lodash, no external JS libraries whatsoever.
- Python (`scripts/g4f_issue_reply.py`) is used only for the GitHub issue-reply bot, not for the player itself.
## Variable Declarations
## Naming Conventions
## State Management
## DOM Manipulation
## Event Handling
## Async Patterns
## Error Handling
## Comments
## Internationalization (i18n)
## CSS / Design Tokens
## Track Object Shape
## Storage
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## REBUILD SEPARATION GUIDE
- **[BACKEND — REUSE]** Data-fetching, API calls, track metadata, audio URL resolution, lyrics fetching, state management, persistence. These are the functions to extract and reuse in the new mobile app.
- **[UI — REPLACE]** DOM manipulation, HTML rendering, CSS animations, event bindings, canvas particles, ripple effects. Everything that currently drives the desktop three-panel layout will be thrown away and rebuilt.
## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | Classification | Location |
|-----------|----------------|----------------|----------|
| `state` object | Central mutable store — all runtime state | BACKEND — REUSE | `index.html` line 1648 |
| `trackMap` (Map) | Deduplication cache keyed by `uid` | BACKEND — REUSE | `index.html` line 1657 |
| `searchNetease()` | Fetches search results from Netease via qijieya proxy | BACKEND — REUSE | `index.html` line 1986 |
| `searchQQ()` | Fetches search results from QQ via tang API | BACKEND — REUSE | `index.html` line 2041 |
| `searchKuwo()` | Fetches search results from Kuwo via cenguigui proxy | BACKEND — REUSE | `index.html` line 2123 |
| `searchJoox()` | Fetches search results from JOOX via apicx proxy | BACKEND — REUSE | `index.html` line 2169 |
| `searchAllSources()` | Fan-out aggregator: runs all enabled sources in parallel | BACKEND — REUSE | `index.html` line 2216 |
| `fetchNeteaseDetails()` | Resolves audio URL + lyrics for a Netease track | BACKEND — REUSE | `index.html` line 2268 |
| `fetchQQDetails()` | Resolves audio URL + lyrics for a QQ track | BACKEND — REUSE | `index.html` line 2311 |
| `fetchKuwoDetails()` | Resolves audio URL + lyrics for a Kuwo track | BACKEND — REUSE | `index.html` line 2398 |
| `fetchJooxDetails()` | Resolves audio URL + lyrics for a JOOX track, with URL probing | BACKEND — REUSE | `index.html` line 2424 |
| `ensureTrackDetails()` | Lazy-loader: dispatches to the right per-source detail fetcher | BACKEND — REUSE | `index.html` line 2506 |
| `inferQualityFromUrl()` | Determines quality tag (lossless/320k) from audio URL extension | BACKEND — REUSE | `index.html` line 1747 |
| `parseLRC()` | Parses LRC timestamp format into `{time, text}` array | BACKEND — REUSE | `index.html` line 2517 |
| `getInterleavedSearchList()` | Interleaves results from all sources for display ordering | BACKEND — REUSE | `index.html` line 1691 |
| `playTrack()` | Orchestrates: ensureTrackDetails → set audio.src → play | BACKEND — REUSE (core logic); calls UI renders | `index.html` line 2599 |
| `playFromList()` | Resolves list + index → calls `playTrack()` | BACKEND — REUSE | `index.html` line 2685 |
| `playNext()` | Computes next index per playMode (list/single/shuffle) | BACKEND — REUSE | `index.html` line 2703 |
| `getActiveList()` | Returns the currently active track list from state | BACKEND — REUSE | `index.html` line 2668 |
| `isFavorite()` | Checks if track is in favorites | BACKEND — REUSE | `index.html` line 2589 |
| `toggleFavoriteCurrent()` | Adds/removes currentTrack from favorites + persists | BACKEND — REUSE | `index.html` line 2733 |
| `serializeTrack()` | Strips non-persistable fields before saving | BACKEND — REUSE | `index.html` line 1762 |
| `deserializeTrack()` | Restores a track object from JSON | BACKEND — REUSE | `index.html` line 1780 |
| `saveLibraryToStorage()` | Writes favorites + playlists to localStorage | BACKEND — REUSE | `index.html` line 1804 |
| `loadLibraryFromStorage()` | Loads library from localStorage at startup | BACKEND — REUSE | `index.html` line 1820 |
| `getLibrarySnapshot()` | Serializes full library to JSON-safe object | BACKEND — REUSE | `index.html` line 1791 |
| `exportPlaylistData()` | Triggers browser download of JSON library export | BACKEND — REUSE (logic); uses DOM Blob/anchor | `index.html` line 1841 |
| `importPlaylistData()` | Merges imported JSON into state, deduplicates | BACKEND — REUSE | `index.html` line 1879 |
| `mergeImportedTracks()` | Deduplicates tracks during import | BACKEND — REUSE | `index.html` line 1859 |
| `rebuildLibraryTrackMap()` | Re-registers all library tracks in trackMap | BACKEND — REUSE | `index.html` line 1812 |
| `translations{}` | i18n strings for zh/en | BACKEND — REUSE | `index.html` line 1495 |
| `t(key)` | Looks up translation string | BACKEND — REUSE | `index.html` line 1678 |
| `formatTime()` | Formats seconds to `MM:SS` | BACKEND — REUSE | `index.html` line 1685 |
| `renderMiniSearchList()` | Renders search result items as DOM nodes | UI — REPLACE | `index.html` line 2768 |
| `renderPlaylistList()` | Renders playlist/favorites/search as DOM track-item nodes | UI — REPLACE | `index.html` line 2818 |
| `renderLyrics()` | Wipes and rebuilds lyrics DOM from `state.lyricLines` | UI — REPLACE | `index.html` line 2535 |
| `updateLyricsHighlight()` | Scrolls and applies `.active` CSS class to current lyric | UI — REPLACE | `index.html` line 2565 |
| `renderPlaylistOptions()` | Rebuilds `<select>` dropdown for custom playlists | UI — REPLACE | `index.html` line 1957 |
| `updatePlaylistInfoLabel()` | Updates the text label above the playlist | UI — REPLACE | `index.html` line 2807 |
| `updateMainFavButton()` | Toggles fav button active CSS class | UI — REPLACE | `index.html` line 2593 |
| `setPlaymodeUI()` | Toggles `.active` on playmode buttons | UI — REPLACE | `index.html` line 3107 |
| `applyUI()` (inline inside playTrack) | Updates cover, title, artist, source pill, quality pill DOM | UI — REPLACE | `index.html` line 2604 |
| `setupDOM()` | Caches all DOM element references into `dom{}` object | UI — REPLACE | `index.html` line 3054 |
| `setupEvents()` | Attaches all event listeners to DOM elements | UI — REPLACE | `index.html` line 3113 |
| `setupParticles()` | Canvas-based floating particle animation | UI — REPLACE | `index.html` line 2963 |
| `setupRipple()` | Injects ripple animation spans on pointer events | UI — REPLACE | `index.html` line 3027 |
| `setLanguage()` | Updates all `data-i18n` DOM elements for language switch | UI — REPLACE (DOM part); logic is REUSE | `index.html` line 1709 |
| `showToast()` | Shows a floating toast notification via DOM | UI — REPLACE | `index.html` line 1679 |
| `handleDownloadCurrent()` | Opens audio URL in new tab for download | UI — REPLACE (trivial) | `index.html` line 2743 |
| All CSS styles | Layout, glassmorphism, animations, scrollbars, etc. | UI — REPLACE | `index.html` lines 12–1211 |
| HTML structure | Three-panel layout, header, footer, modals | UI — REPLACE | `index.html` lines 1213–1491 |
| `init()` | Entry point: calls setupDOM, loads storage, wires everything | BOTH — will split on rebuild | `index.html` line 3302 |
## Pattern Overview
- Global state via a single `state` object (not reactive — functions must imperatively call renderers after mutations)
- All DOM references cached in `dom{}` object (populated at startup by `setupDOM()`)
- Lazy track detail loading: search returns lightweight stubs; `ensureTrackDetails()` resolves full URL + lyrics on first play
- Backend functions are pure or near-pure (fetch + state mutation with no direct DOM access) — this is the clean extraction seam for the rebuild
- UI functions are tightly coupled: they read `state` directly and write to `dom` directly
## Layers
- Purpose: Fetch search results, resolve playable URLs, parse lyrics, manage persistent library
- Location: JavaScript functions inside `index.html` lines ~1648–2513
- Contains: `state{}`, `trackMap`, search functions, detail fetch functions, `parseLRC`, library persistence functions, `getInterleavedSearchList`, `playNext`, `getActiveList`, `isFavorite`, `toggleFavoriteCurrent`
- Depends on: Third-party proxy APIs (see Integrations), `localStorage`, `fetch()`, native `Audio` element
- Used by: Presentation layer (currently interleaved)
- Purpose: Render track lists, update player controls, display lyrics, show animations
- Location: JavaScript functions inside `index.html` lines ~2535–3317, plus all CSS (lines 12–1211), plus HTML (lines 1213–1491)
- Contains: All `render*()` functions, `setupDOM()`, `setupEvents()`, `setupParticles()`, `setupRipple()`, CSS, HTML structure
- Depends on: `state{}` (reads only), `dom{}` (writes only)
- Used by: User interactions via event listeners
## Data Flow
### Primary Playback Path: Search → Fetch URL → Play
### Track-End Auto-Advance
### Library Persistence
## Key Abstractions
- Purpose: Represents a single song. Two phases: stub (after search) and enriched (after detail fetch)
- Key fields: `uid` (globally unique, e.g., `"netease-12345678"`), `source`, `title`, `artist`, `album`, `cover`, `audioUrl` (null until details loaded), `lrc` (null until fetched), `detailsLoaded: boolean`, `quality`, `qualityLabel`
- Created by: search functions; enriched by detail fetchers
- Serialization: `serializeTrack()` at line 1762 strips `audioUrl`, `lrc`, `lrcUrl` before saving (they are refetched on next play)
- Location: `index.html` lines 1648–1669
- Key fields:
- Purpose: Tracks which list (results/favorites/playlist) and position the player is in, so `playNext()` knows where to advance
- Structure: `{type: 'results'|'favorites'|'playlist', index: number, playlistId: string|null}`
- Purpose: Global deduplication. Before adding any track to `state.searchResults`, functions check `state.trackMap.has(uid)`. Prevents duplicates across search rounds and "load more" calls.
- Key format: `"<source>-<id>"` e.g. `"qq-00ABCD1234"`, `"kuwo-12345678"`, `"joox-ABCDEF"`
## Entry Points
- Location: `index.html` line 3316: `document.addEventListener('DOMContentLoaded', init)`
- `init()` at line 3302: calls `setupDOM()` → `loadLibraryFromStorage()` → `setupParticles()` → `setupRipple()` → `setupEvents()` → `setLanguage()` → renders initial list
- Location: `index.html` lines 3118–3128 (click and Enter handlers)
- Triggers: `searchAllSources(true)`
- Location: `playTrack()` at `index.html:2599`
- Called by: `playFromList()`, auto-play after search (line 2256–2258)
## Playback Lifecycle
```
```
## Playlist / Queue Handling
- There is no separate "queue" concept. The "queue" is whichever list is currently active in `state.playContext.type`:
- `getActiveList()` at line 2668 returns the current list for `playNext()` to advance through
- `getInterleavedSearchList()` at line 1691 round-robins results from netease/qq/kuwo/joox for display ordering (not insertion order)
- Play modes (`state.playMode`):
## UI — Current Coupling to Data Logic
```javascript
```
## Architectural Constraints
- **Threading:** Single-threaded event loop. All fetch calls are `async/await`. No Web Workers.
- **Audio engine:** Native HTML `<audio id="audio">` element at `index.html:1373`. The `src` attribute is set directly to the resolved CDN URL. No MediaSource API, no custom buffering.
- **Global state:** One IIFE-scoped `state` object and `dom` object. No module imports. Everything shares the same closure.
- **CORS:** All API calls are to third-party proxy servers. The proxies handle CORS headers. Direct calls to Netease/QQ/Kuwo/JOOX APIs would be blocked.
- **No build system:** Vanilla JS ES2020+ (uses `async/await`, optional chaining `?.`, nullish coalescing `??`). Must remain browser-native or be transpiled for older targets.
- **localStorage key:** `'pikachu-music-library-v1'` — must not change between old and new app if library continuity is required.
- **`JOOX_TOKEN`:** Hardcoded constant at `index.html:2165` as `'f84ao9lMF_q7husBWRfgUw'`. The JOOX `br` (bitrate tier) defaults to `4` (line 2166), mapped to Atmos/lossless in `pickJooxPlayUrl` priority order.
- **Circular imports:** Not applicable (no modules).
## Anti-Patterns
### Mixed concerns in `playTrack()`
### All renderers called imperatively after every mutation
### `audioLevel` approximation (line 3190–3191)
## Error Handling
- Search functions catch fetch errors silently (log to console, return 0 added tracks) — partial results from other sources still display
- `fetchJooxDetails()` includes a URL probe step (`probeJooxAudioUrl()`) before committing to an audio URL — HEAD then GET range fallback
- `fetchQQDetails()` does NOT set `detailsLoaded = true` on failure (line 2394), allowing retry on next play attempt
- `playTrack()` catch block (line 2658) shows toast and resets player status to idle
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
