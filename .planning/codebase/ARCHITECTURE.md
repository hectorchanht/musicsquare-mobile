<!-- refreshed: 2026-06-05 -->
# Architecture

**Analysis Date:** 2026-06-05

---

## REBUILD SEPARATION GUIDE

This document explicitly labels every function and system as one of:

- **[BACKEND — REUSE]** Data-fetching, API calls, track metadata, audio URL resolution, lyrics fetching, state management, persistence. These are the functions to extract and reuse in the new mobile app.
- **[UI — REPLACE]** DOM manipulation, HTML rendering, CSS animations, event bindings, canvas particles, ripple effects. Everything that currently drives the desktop three-panel layout will be thrown away and rebuilt.

---

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / GitHub Pages                    │
│                          index.html (3320 lines)                 │
├──────────────────┬──────────────────────┬───────────────────────┤
│   Search Panel   │    Player Panel       │  Playlist Panel       │
│  (left column)   │  (center column)      │  (right column)       │
│  [UI — REPLACE]  │  [UI — REPLACE]       │  [UI — REPLACE]       │
└────────┬─────────┴────────┬─────────────┴──────────┬────────────┘
         │                  │                          │
         ▼                  ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    state{} + trackMap (Map)                      │
│            In-memory singleton. [BACKEND — REUSE]               │
│                  index.html lines 1648–1669                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              External Third-Party Music APIs                     │
│  Netease: api.qijieya.cn/meting/   [BACKEND — REUSE]           │
│  QQ:      tang.api.s01s.cn/        [BACKEND — REUSE]           │
│  Kuwo:    kw-api.cenguigui.cn/     [BACKEND — REUSE]           │
│  JOOX:    apicx.asia/api/joox_music [BACKEND — REUSE]          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              localStorage (pikachu-music-library-v1)            │
│              Favorites + Custom playlists.                       │
│              [BACKEND — REUSE] (format is stable JSON)          │
└─────────────────────────────────────────────────────────────────┘
```

---

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

---

## Pattern Overview

**Overall:** Single-file monolith. All CSS, HTML, and JavaScript live in one `index.html` (~3320 lines). There is no build system, no module system, and no framework. Everything executes inside one IIFE (immediately invoked function expression) starting at line 1494.

**Key Characteristics:**
- Global state via a single `state` object (not reactive — functions must imperatively call renderers after mutations)
- All DOM references cached in `dom{}` object (populated at startup by `setupDOM()`)
- Lazy track detail loading: search returns lightweight stubs; `ensureTrackDetails()` resolves full URL + lyrics on first play
- Backend functions are pure or near-pure (fetch + state mutation with no direct DOM access) — this is the clean extraction seam for the rebuild
- UI functions are tightly coupled: they read `state` directly and write to `dom` directly

---

## Layers

**Data / Backend Layer [BACKEND — REUSE]:**
- Purpose: Fetch search results, resolve playable URLs, parse lyrics, manage persistent library
- Location: JavaScript functions inside `index.html` lines ~1648–2513
- Contains: `state{}`, `trackMap`, search functions, detail fetch functions, `parseLRC`, library persistence functions, `getInterleavedSearchList`, `playNext`, `getActiveList`, `isFavorite`, `toggleFavoriteCurrent`
- Depends on: Third-party proxy APIs (see Integrations), `localStorage`, `fetch()`, native `Audio` element
- Used by: Presentation layer (currently interleaved)

**Presentation / UI Layer [UI — REPLACE]:**
- Purpose: Render track lists, update player controls, display lyrics, show animations
- Location: JavaScript functions inside `index.html` lines ~2535–3317, plus all CSS (lines 12–1211), plus HTML (lines 1213–1491)
- Contains: All `render*()` functions, `setupDOM()`, `setupEvents()`, `setupParticles()`, `setupRipple()`, CSS, HTML structure
- Depends on: `state{}` (reads only), `dom{}` (writes only)
- Used by: User interactions via event listeners

---

## Data Flow

### Primary Playback Path: Search → Fetch URL → Play

1. User types in `#search-input` and presses Enter → `setupEvents()` handler at `index.html:3122` sets `state.searchKeyword`
2. `searchAllSources(reset=true)` at `index.html:2216` fans out to `searchNetease()`, `searchQQ()`, `searchKuwo()`, `searchJoox()` in parallel via `Promise.all()`
3. Each search function calls its third-party API, creates lightweight track stub objects with `detailsLoaded: false`, and pushes them into `state.searchResults` and `state.trackMap`
4. On completion, `renderMiniSearchList()` and `renderPlaylistList()` rebuild the DOM list views
5. If no track is playing, `playFromList('results', 0)` auto-plays the first result
6. User clicks a track → `playFromList(type, index)` at `index.html:2685` resolves the list + index, then calls `playTrack(track, context)` at `index.html:2599`
7. `playTrack()` immediately applies available metadata to UI (`applyUI()`), then calls `ensureTrackDetails(track)` at `index.html:2506`
8. `ensureTrackDetails()` dispatches to the per-source detail fetcher (e.g., `fetchKuwoDetails()` at `index.html:2398`), which calls the detail API and populates `track.audioUrl`, `track.lrc`, `track.quality`
9. On return: `dom.audio.src = track.audioUrl` then `dom.audio.play()` — native browser `<audio>` element handles actual streaming
10. `audio.timeupdate` event (line 3180) fires ~4/sec → `updateLyricsHighlight(cur)` scrolls and highlights the current lyric line

### Track-End Auto-Advance

1. `audio.ended` event fires at `index.html:3205`
2. `playNext('next')` at `index.html:2703` reads `state.playMode` (list / single / shuffle)
3. Computes next index → calls `playFromList()` → back to step 6 above

### Library Persistence

1. On every favorites or playlist mutation → `saveLibraryToStorage()` at `index.html:1804` → `JSON.stringify(getLibrarySnapshot())` → `localStorage.setItem('pikachu-music-library-v1', ...)`
2. On startup: `loadLibraryFromStorage()` at `index.html:1820` → `deserializeTrack()` per saved track → repopulates `state.favorites`, `state.playlists`, `state.trackMap`

---

## Key Abstractions

**Track Object:**
- Purpose: Represents a single song. Two phases: stub (after search) and enriched (after detail fetch)
- Key fields: `uid` (globally unique, e.g., `"netease-12345678"`), `source`, `title`, `artist`, `album`, `cover`, `audioUrl` (null until details loaded), `lrc` (null until fetched), `detailsLoaded: boolean`, `quality`, `qualityLabel`
- Created by: search functions; enriched by detail fetchers
- Serialization: `serializeTrack()` at line 1762 strips `audioUrl`, `lrc`, `lrcUrl` before saving (they are refetched on next play)

**state object (central store):**
- Location: `index.html` lines 1648–1669
- Key fields:
  - `searchResults: []` — all search result tracks in insertion order
  - `trackMap: Map<uid, track>` — deduplication and lookup cache
  - `favorites: []` — persisted favorite tracks
  - `playlists: []` — array of `{id, name, tracks[]}` objects
  - `currentTrack` — the track currently loaded in the audio engine
  - `playContext: {type, index, playlistId}` — which list and index is active
  - `playMode: 'list' | 'single' | 'shuffle'`
  - `isPlaying: boolean`
  - `lyricLines: [{time, text}]` — parsed from current track's LRC
  - `currentLyricIndex: number`

**playContext:**
- Purpose: Tracks which list (results/favorites/playlist) and position the player is in, so `playNext()` knows where to advance
- Structure: `{type: 'results'|'favorites'|'playlist', index: number, playlistId: string|null}`

**trackMap:**
- Purpose: Global deduplication. Before adding any track to `state.searchResults`, functions check `state.trackMap.has(uid)`. Prevents duplicates across search rounds and "load more" calls.
- Key format: `"<source>-<id>"` e.g. `"qq-00ABCD1234"`, `"kuwo-12345678"`, `"joox-ABCDEF"`

---

## Entry Points

**Application Bootstrap:**
- Location: `index.html` line 3316: `document.addEventListener('DOMContentLoaded', init)`
- `init()` at line 3302: calls `setupDOM()` → `loadLibraryFromStorage()` → `setupParticles()` → `setupRipple()` → `setupEvents()` → `setLanguage()` → renders initial list

**User-Triggered Searches:**
- Location: `index.html` lines 3118–3128 (click and Enter handlers)
- Triggers: `searchAllSources(true)`

**Playback Start:**
- Location: `playTrack()` at `index.html:2599`
- Called by: `playFromList()`, auto-play after search (line 2256–2258)

---

## Playback Lifecycle

```
User Action / auto-advance
        │
        ▼
playFromList(type, index, plId?)
        │ resolves list + index
        ▼
playTrack(track, context)
        │
        ├─ applyUI() — update title/cover/source pill immediately (optimistic)
        ├─ parseLRC(track.lrc) if already available → renderLyrics()
        ├─ updateMainFavButton()
        │
        ▼
ensureTrackDetails(track)          ← THE KEY SEAM
        │
        ├─ fetchNeteaseDetails(track)  or
        ├─ fetchQQDetails(track)       or
        ├─ fetchKuwoDetails(track)     or
        └─ fetchJooxDetails(track)
                │
                └─ Populates: track.audioUrl, track.lrc, track.quality
        │
        ▼
applyUI() again (now with full data)
parseLRC(track.lrc) → renderLyrics()
dom.audio.src = track.audioUrl
dom.audio.play()
        │
        ▼
audio events:
  'play'      → state.isPlaying=true, update play button
  'timeupdate' → update progress bar, update audioLevel, updateLyricsHighlight()
  'pause'     → state.isPlaying=false, audioLevel=0
  'ended'     → playNext('next')
```

---

## Playlist / Queue Handling

- There is no separate "queue" concept. The "queue" is whichever list is currently active in `state.playContext.type`:
  - `'results'` → `getInterleavedSearchList()` (interleaved across sources)
  - `'favorites'` → `state.favorites`
  - `'playlist'` → `state.playlists.find(p => p.id === state.playContext.playlistId).tracks`
- `getActiveList()` at line 2668 returns the current list for `playNext()` to advance through
- `getInterleavedSearchList()` at line 1691 round-robins results from netease/qq/kuwo/joox for display ordering (not insertion order)
- Play modes (`state.playMode`):
  - `'list'` — advances linearly, wraps at end
  - `'single'` — resets `currentTime` to 0 and replays
  - `'shuffle'` — picks a random index (guaranteed different from current)

---

## UI — Current Coupling to Data Logic

The main coupling problem for the rebuild is in `playTrack()` (line 2599):

```javascript
// Inside playTrack() — this function mixes backend and UI concerns:
async function playTrack(track, context) {
  state.currentTrack = track;           // [BACKEND]
  state.playContext = context;          // [BACKEND]

  const applyUI = () => {               // [UI — REPLACE entire inner function]
    dom.trackTitle.textContent = ...;
    dom.trackArtist.textContent = ...;
    dom.coverImg.src = track.cover;
    // etc.
  };

  dom.playerStatus.textContent = ...;   // [UI — REPLACE]
  applyUI();                            // [UI — REPLACE]

  state.lyricLines = parseLRC(...);     // [BACKEND]
  renderLyrics();                       // [UI — REPLACE]
  updateMainFavButton();                // [UI — REPLACE]

  await ensureTrackDetails(track);      // [BACKEND — the seam]
  applyUI();                            // [UI — REPLACE]
  state.lyricLines = parseLRC(...);     // [BACKEND]
  renderLyrics();                       // [UI — REPLACE]

  dom.audio.src = track.audioUrl;       // [BACKEND — audio element is shared]
  await dom.audio.play();               // [BACKEND — audio element is shared]
  state.isPlaying = true;               // [BACKEND]
  dom.playBtn.textContent = '⏸';       // [UI — REPLACE]
  dom.playerStatus.textContent = ...;   // [UI — REPLACE]
}
```

**Recommended extraction pattern for rebuild:** Split `playTrack()` into:
1. `resolveTrack(track)` — calls `ensureTrackDetails`, returns enriched track. Pure backend, no DOM.
2. A React/native UI layer subscribes to `state.currentTrack` changes and re-renders.

---

## Architectural Constraints

- **Threading:** Single-threaded event loop. All fetch calls are `async/await`. No Web Workers.
- **Audio engine:** Native HTML `<audio id="audio">` element at `index.html:1373`. The `src` attribute is set directly to the resolved CDN URL. No MediaSource API, no custom buffering.
- **Global state:** One IIFE-scoped `state` object and `dom` object. No module imports. Everything shares the same closure.
- **CORS:** All API calls are to third-party proxy servers. The proxies handle CORS headers. Direct calls to Netease/QQ/Kuwo/JOOX APIs would be blocked.
- **No build system:** Vanilla JS ES2020+ (uses `async/await`, optional chaining `?.`, nullish coalescing `??`). Must remain browser-native or be transpiled for older targets.
- **localStorage key:** `'pikachu-music-library-v1'` — must not change between old and new app if library continuity is required.
- **`JOOX_TOKEN`:** Hardcoded constant at `index.html:2165` as `'f84ao9lMF_q7husBWRfgUw'`. The JOOX `br` (bitrate tier) defaults to `4` (line 2166), mapped to Atmos/lossless in `pickJooxPlayUrl` priority order.
- **Circular imports:** Not applicable (no modules).

---

## Anti-Patterns

### Mixed concerns in `playTrack()`

**What happens:** `playTrack()` (line 2599) sets state, calls fetch, AND directly mutates DOM elements — all in one function.
**Why it's wrong:** Cannot test the backend logic without a DOM. Cannot swap the UI without refactoring the fetch orchestration.
**Do this instead:** Extract `resolveAndPlay(track)` as a pure backend function that resolves details and sets `dom.audio.src`. Fire a state-change event or callback that the UI layer subscribes to.

### All renderers called imperatively after every mutation

**What happens:** After any state mutation (e.g., toggle favorite, search complete), code manually calls `renderPlaylistList()`, `renderMiniSearchList()`, `updateMainFavButton()` etc. in sequence.
**Why it's wrong:** Missed renderer calls cause stale UI. Hard to track which renders are needed after each action.
**Do this instead:** In the rebuilt app, use a reactive UI framework (React, Vue, Solid) — render functions become derived views, not imperative calls.

### `audioLevel` approximation (line 3190–3191)

**What happens:** `audioLevel` is computed as `Math.abs(Math.sin(currentTime * 2.3))` — a fake audio level based on time, not actual waveform data.
**Why it's wrong:** Has no relationship to actual audio amplitude. The particle animation reacts to a mathematical sine wave, not the music.
**Do this instead:** Use the Web Audio API `AnalyserNode` to get real frequency data if audio-reactive visuals are needed in the rebuild.

---

## Error Handling

**Strategy:** Try/catch around all fetch calls, with console.error logging. Errors surface to user via `showToast()`.

**Patterns:**
- Search functions catch fetch errors silently (log to console, return 0 added tracks) — partial results from other sources still display
- `fetchJooxDetails()` includes a URL probe step (`probeJooxAudioUrl()`) before committing to an audio URL — HEAD then GET range fallback
- `fetchQQDetails()` does NOT set `detailsLoaded = true` on failure (line 2394), allowing retry on next play attempt
- `playTrack()` catch block (line 2658) shows toast and resets player status to idle

---

## Cross-Cutting Concerns

**Logging:** `console.error()` and `console.warn()` throughout. No structured logging.
**Validation:** Ad hoc. Track objects are not validated against a schema; fields are checked with `|| ''` and `|| null` defaults inline.
**Authentication:** None for the app itself. JOOX token (`JOOX_TOKEN`) is a hardcoded string constant, not user-supplied.
**i18n:** `translations{}` object at line 1495 with `zh` and `en` keys. `t(key)` helper at line 1678 looks up with fallback to `zh`. Language persisted to `localStorage` key `'pikachu-music-lang'`.

---

*Architecture analysis: 2026-06-05*
