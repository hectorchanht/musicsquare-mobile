# Codebase Concerns

**Analysis Date:** 2026-06-05

> All concerns are framed through the lens of the planned mobile-first rebuild. Sections are ordered by impact on that migration: highest risk first.

---

## Migration Risk: Monolith Coupling (UI Entangled with Data Logic)

**Impact: CRITICAL — blocks any reuse of data/logic in a new mobile UI**

The entire application — HTML structure, CSS styling, i18n strings, application state, data-fetching functions, audio control logic, and DOM event wiring — is collapsed into a single `index.html` file (3,320 lines, ~113 KB). There is no module boundary between "backend logic" and "frontend rendering."

**What is tangled together inside `index.html`:**

- API fetch functions (`searchNetease`, `searchQQ`, `searchKuwo`, `searchJoox`, `fetchNeteaseDetails`, `fetchQQDetails`, `fetchKuwoDetails`, `fetchJooxDetails`) exist only inside a large IIFE alongside DOM manipulation code.
- The global `state` object (line 1648) holds both data (`searchResults`, `favorites`, `playlists`, `trackMap`) and UI flags (`isPlaying`, `lyricsAlt`, `muted`, `currentLyricIndex`) with no separation.
- Render functions (`renderMiniSearchList`, `renderPlaylistList`, `renderLyrics`) directly mutate the DOM and are interleaved with business logic calls.
- `playTrack` (line 2599) updates DOM, fires fetches, and controls the `<audio>` element in the same function body.
- The `dom` cache object (line 1674) is a single flat namespace for every element ID in the entire page.

**Fix approach for migration:** Extract the six API modules (`searchNetease`, `searchQQ`, `searchKuwo`, `searchJoox`, plus four `fetch*Details` functions) and the `state` model into standalone ES modules (or a plain JS file). These can be imported by both the old UI and any new mobile framework. The `serializeTrack`/`deserializeTrack`/`getLibrarySnapshot` persistence functions can be extracted similarly.

---

## Migration Risk: Third-Party Unofficial APIs — Reliability, CORS, and Legal

**Impact: CRITICAL — the entire feature set depends on four unofficial proxy APIs that are operated by unknown third parties and could disappear or start blocking requests at any time**

All four music sources route through unofficial third-party proxy services:

| Source | Endpoint | Notes |
|--------|----------|-------|
| Netease | `https://api.qijieya.cn/meting/` | Meting proxy; unofficial; no SLA |
| QQ Music | `https://tang.api.s01s.cn/music_open_api.php` | Informal "tang" API; no SLA |
| Kuwo | `https://kw-api.cenguigui.cn/` | Informal "cenguigui" API; no SLA |
| JOOX | `https://apicx.asia/api/joox_music` | Passes a hardcoded token (see Security section) |

**CORS:** These proxies currently serve CORS headers permissive enough for browser `fetch()`. If any proxy operator changes this policy, all calls from the new mobile web app will fail with no fallback. There is no server-side proxy or CORS relay under this project's control.

**Rate limiting:** No request queuing, throttling, or backoff logic exists anywhere in `index.html`. Parallel `Promise.all` fires all four sources simultaneously on every search (line 2244). If any proxy starts rate-limiting, errors are silently swallowed and the source just returns 0 results.

**API contract fragility:** The QQ Music adapter already carries comment evidence of a past API change ("新接口", line 2041) and dual-format handling (`Array.isArray(json) ? json : json?.data`, line 2055). The Kuwo details call checks for `j.code===200` but has no retry or fallback if the structure shifts. The JOOX adapter has the most complex per-link probing logic (`probeJooxAudioUrl`, line 2434) because the CDN URLs are time-limited or geo-restricted.

**Legal / ToS considerations:** The page footer itself acknowledges: "本站仅作为学习演示，音乐版权归各平台与原作者所有" ("For demo only; copyrights belong to original owners"). All four integrated platforms (Netease Cloud Music, QQ Music, Kuwo, JOOX) prohibit scraping and third-party playback in their Terms of Service. Publishing a mobile app (especially via app stores) using these APIs at scale would substantially increase legal exposure compared to a personal GitHub Pages demo.

**Fix approach for migration:** Own a thin proxy layer (e.g. a Cloudflare Worker or small Node/Python service) that sits between the mobile app and these upstream APIs. This decouples the client from upstream URL changes, allows rate-limit handling, and avoids direct browser-to-third-party CORS dependency.

---

## Migration Risk: No Background Audio Handling

**Impact: HIGH — a mobile music player that pauses when the screen locks is unusable**

Neither the Web Media Session API (`navigator.mediaSession`) nor the Wake Lock API (`navigator.wakeLock`) is referenced anywhere in `index.html`. On mobile browsers:

- Audio will pause when the screen locks or the user switches apps (iOS Safari behavior).
- The lock screen / notification shade will show no playback controls.
- The OS cannot display track title, artist, or album art in the system player UI.

The `<audio>` element (`index.html` line 1373) has no `mediaSession` metadata attached. The `playTrack` function (line 2599) never sets `navigator.mediaSession.metadata` or `navigator.mediaSession.setActionHandler`.

**Fix approach for migration:** In the new mobile UI, wrap every `playTrack` call with `mediaSession` metadata updates and register action handlers for `play`, `pause`, `previoustrack`, `nexttrack`. This is pure additive code and does not require restructuring data logic.

---

## Migration Risk: No Build System, No Package Management, No Tests

**Impact: HIGH — any restructuring for mobile is done without a safety net and with no standard tooling**

- There is no `package.json`, no `node_modules`, no lockfile of any kind.
- There is no bundler (webpack, Vite, esbuild, Rollup) and no transpiler (Babel, TypeScript).
- There are zero test files — no unit tests, no integration tests, no snapshot tests. The `scripts/` directory contains only `g4f_issue_reply.py` (a GitHub Actions bot, unrelated to music logic).
- The `.gitignore` is the standard Python template (no JS entries at all), indicating the project was never set up as a JS project with tooling.
- Code quality tooling (ESLint, Prettier, Biome) is absent.

**Consequence for migration:** Extracting the data logic into modules and refactoring the rendering carries zero automated regression protection. Every change must be manually tested across all four music sources.

**Fix approach for migration:** Introduce a minimal `package.json` and a test runner (Vitest is a zero-config option) before any refactor. Write tests for `serializeTrack`, `deserializeTrack`, `parseLRC`, `inferQualityFromUrl`, and each `search*` function against recorded API fixtures.

---

## Migration Risk: Desktop-Only Layout Architecture

**Impact: HIGH — the three-column panel layout is fundamentally incompatible with mobile-first design**

The primary layout (line 207) is a CSS Grid with three columns constrained to `minmax(260px, 0.8fr)`, `minmax(360px, 1.58fr)`, `minmax(260px, 0.82fr)`. The minimum total width is approximately 880 px. On a real 390 px mobile screen this does not fit.

Responsive overrides exist at `max-width: 860px` (line 1192) that collapse to a single-column stacked layout, but this is an afterthought overlay on a desktop grid, not a mobile-first design. Known issues with this approach:

- `html, body { overflow: hidden }` (line 39) is set globally to disable page scroll. This technique works on desktop where each panel scrolls internally but can cause the entire page to freeze on iOS Safari where `overflow: hidden` on `<body>` behaves differently.
- Each panel has independently scrollable regions (`overflow-y: auto`). On iOS Safari these require `-webkit-overflow-scrolling: touch` (or equivalent) to scroll smoothly — not present.
- The `.app` container uses `height: calc(100vh - 104px)` with hardcoded pixel offsets (lines 63–81). On mobile, `100vh` does not account for the browser chrome (address bar, home indicator safe area), causing content to be clipped.
- No `env(safe-area-inset-*)` usage anywhere — bottom-bar, notch, and home indicator areas on iPhone are not respected.
- Hover states (`.search-mini-item:hover`, `.track-item:hover`, lines 439, 936) are defined but no touch equivalents (`:active`, `touch-action`) are set, making the interaction feel unresponsive on mobile.
- The particle canvas `mousemove` listener (line 2987) is mouse-only; there is no `touchmove` equivalent.
- Keyboard shortcuts (Space, arrow keys, N, P, F, L, M, /) are the only non-mouse interaction model. These are not accessible on mobile virtual keyboards.
- The progress bar seek is click-only (line 3210). No drag/touch handling is implemented.

---

## Security: Hardcoded API Token in Source

**Impact: MEDIUM — token is public in the repository and in every browser's DevTools**

The JOOX API token is hardcoded as a plain string literal in `index.html`:

```
Line 2165: const JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw';
```

This token appears verbatim in all search calls (line 2170) and detail calls (line 2426) to `https://apicx.asia/api/joox_music`. Since `index.html` is served publicly (GitHub Pages), the token is visible to anyone. If the third-party API operator ties rate limits or access rights to this token, any user of the site can observe and reuse it.

**Fix approach for migration:** Move token to a server-side proxy env var. Until then, the token is already exposed; rotation alone is insufficient without owning the proxy layer.

---

## Performance Bottlenecks

**Particle canvas O(N²) line drawing:**

The background particle system at line 3008 runs an `O(N²)` loop (90 particles × 90 particles = 8,100 distance calculations per frame at 60fps = ~486,000 distance checks/second). On a budget Android device this will peg the CPU, drain battery, and cause audio stutter. The `audioLevel` variable it reads (line 3191) is a sine-wave approximation based on `currentTime`, not a real audio analyser — the visual effect is cosmetic and not synchronized to actual audio content.

**Fix approach for migration:** Disable or significantly reduce the particle system on mobile (use `matchMedia('(pointer: coarse)')` to detect touch devices). If kept, replace with a WebGL-based approach or reduce N to 20–30 particles.

**Repeated full DOM rebuilds on every render:**

`renderMiniSearchList` and `renderPlaylistList` (lines 2768, 2818) call `wrap.innerHTML = ''` and recreate every DOM node from scratch on every state change. With 30–40 results this is slow on low-end devices and causes visible flicker. There is no virtual list, no diffing, and no `DocumentFragment` batching.

**Fix approach for migration:** In the new mobile UI, use a framework-managed list (React/Vue/Svelte) or a virtual scroll library (e.g. `@tanstack/virtual`) for the track lists.

**JOOX detail: sequential HTTP probing per quality tier:**

`pickJooxPlayUrl` (line 2466) tries each quality tier sequentially with HEAD then GET requests before resolving. In the worst case (Atmos → FLAC → Hi-Res → Master → OGG → MP3) this is 10+ sequential HTTP round-trips before a URL is selected, each with a 3-second timeout (line 3439). Total worst-case wait: ~30 seconds before audio starts.

---

## Fragile Areas

**Track identity via `uid` string:**

Track identity across search, favorites, and playlists relies on strings like `netease-${songId}`, `qq-${mid}`, `kuwo-${rid}`, `joox-${songMid}` (lines 2008, 2066, 2132, 2179). If an upstream API changes how it identifies songs (e.g. a numeric ID becomes a hash), all saved favorites and playlists silently break on next load — `deserializeTrack` would return null for any UID it cannot reconstruct.

**Joox detail by position index, not stable ID:**

`fetchJooxDetails` (line 2424) fetches the `n`-th result for the same keyword rather than a stable song ID. If search results reorder between the initial search and when the user clicks play, the wrong track plays. The `jooxIndex` field is a 1-based position counter, not a stable identifier.

**`localStorage` as the only persistence layer:**

Favorites and playlists are stored via `localStorage.setItem(LIBRARY_STORAGE_KEY, ...)` (line 1806). This is:
- Browser/device-local — no sync across devices.
- Wiped by "Clear Site Data" / Private Browsing / incognito mode.
- Limited to ~5 MB. A user with large playlists (100+ tracks with metadata) may silently lose saves when the quota is exceeded; the catch block (line 1807) only `console.warn`.
- Not suitable as the persistence model for a real mobile app.

**Audio URL expiry:**

All four platforms return time-limited CDN URLs for audio streams. The current code sets `dom.audio.src = track.audioUrl` and considers `detailsLoaded = true` (lines 2653, 2391). If a cached track in a playlist was loaded 30+ minutes ago, the CDN URL will be expired when the user plays it next. There is no URL-expiry detection or refresh logic.

**`innerHTML` used for lyric title:**

`renderLyrics` (line 2540) uses `document.createElement` safely for lyrics lines but sets `titleLine.textContent` for the title. However, `playTrack` → `applyUI` sets `dom.trackTitle.textContent` (line 2605) correctly. No XSS via `innerHTML` is currently present in the lyric path, but the render functions construct extensive DOM via imperative `createElement` chains without any sanitization layer — one future change to use template literals with track data could introduce XSS.

---

## Missing Critical Features (for Mobile Rebuild)

**No offline / Service Worker:**

There is no `manifest.json`, no service worker registration, and no caching strategy. The app requires a live internet connection to function. On mobile, network transitions (WiFi → cellular) will drop active streams with no recovery.

**No audio queue pre-fetching:**

When a track finishes and `playNext` fires (line 3205), the next track's detail fetch (which may take 5–30 seconds for JOOX) happens synchronously. There is no look-ahead pre-loading of the next track's URL.

**No error differentiation for users:**

All fetch failures collapse to `showToast(t('toastPlayError'))` (line 2660) or `showToast(t('toastSearchError'))` (line 2248). Users cannot distinguish "API is down" from "song is pay-walled" from "network error." The QQ Music source returns a `pay` field (line 2107) but there is no special UI treatment for paywalled tracks other than display of `qqQualityText`.

**No drag-to-seek on progress bar:**

Progress bar interaction (line 3210) is a single `click` event listener. Touch drag scrubbing is not implemented.

---

## Dependencies at Risk

**Four unofficial third-party proxies (no operator SLA):**

| Proxy | Risk |
|-------|------|
| `api.qijieya.cn` | Individual operator; no SLA; could go offline or start charging |
| `tang.api.s01s.cn` | Individual operator; API already changed once (evidence in code comments) |
| `kw-api.cenguigui.cn` | Individual operator; no SLA |
| `apicx.asia` | Individual operator; JOOX token may be revoked |

Any one of these going offline eliminates a full music source with no fallback. If `qijieya.cn` (Netease) goes down, the most-used source is lost.

**Google Fonts CDN:**

`index.html` lines 9–11 load "Baloo 2" and "Nunito" from `fonts.googleapis.com`. If this CDN is blocked (e.g. in mainland China where the target audience is), the fonts fail to load silently. No local font fallback is specified beyond the system-ui stack.

**`g4f` Python package (CI bot only, not runtime):**

`scripts/g4f_issue_reply.py` is installed via `pip install -U "g4f[all]"` on every workflow run (`.github/workflows/g4f-issue-reply.yml` line 32) with no pinned version. A breaking `g4f` release could silently disable the issue-reply bot, but this does not affect the music player itself.

---

## Test Coverage Gaps

**Untested area: all API integration functions**
- Functions: `searchNetease`, `searchQQ`, `searchKuwo`, `searchJoox`, `fetchNeteaseDetails`, `fetchQQDetails`, `fetchKuwoDetails`, `fetchJooxDetails`
- Files: `index.html` lines 1986–2513
- Risk: API contract changes go undetected until users report broken playback. Currently the only "test" is manual browser interaction.
- Priority: High

**Untested area: serialization / deserialization round-trip**
- Functions: `serializeTrack`, `deserializeTrack`, `getLibrarySnapshot`, `mergeImportedTracks`
- Files: `index.html` lines 1762–1958
- Risk: A format change silently corrupts saved playlists for all existing users.
- Priority: High

**Untested area: LRC parser**
- Function: `parseLRC`
- Files: `index.html` lines 2517–2533
- Risk: Edge cases (multi-timestamp lines, fractional seconds > 3 digits, blank lines) may produce incorrect lyric timing or silent failures.
- Priority: Medium

**Untested area: `inferQualityFromUrl` and legacy quality mappers**
- Functions: `inferQualityFromUrl`, `neteaseQualityToTag`, `kuwoQualityToTag`
- Files: `index.html` lines 1731–1758
- Risk: Wrong quality labels displayed; the "legacy" functions are marked `// 暂时保留（不再使用）` but are still callable. Dead code removal needs verification.
- Priority: Low

---

*Concerns audit: 2026-06-05*
