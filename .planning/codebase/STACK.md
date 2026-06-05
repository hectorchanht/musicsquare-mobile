# Technology Stack

**Analysis Date:** 2026-06-05

## Languages

**Primary:**
- HTML5 — entire application lives in `index.html` (3320 lines, ~113 KB)
- CSS3 — inline `<style>` block inside `index.html` (lines 12–1490), no external stylesheet file
- JavaScript (ES2020+) — inline `<script>` block inside `index.html` (lines 1493–3318)

**Secondary:**
- Python 3.11 — GitHub Actions automation only; `scripts/g4f_issue_reply.py` (issue auto-reply bot, not part of the web app)

## Runtime

**Environment:**
- Browser-native: the app is a single static HTML file with zero server-side runtime
- No Node.js, no Deno, no server process
- Served directly via GitHub Pages (static file hosting)

**Package Manager:**
- None — no `package.json`, no `requirements.txt`, no lockfile exists for the web app
- Python side (CI only): pip with `g4f[all]`, `requests`, `openai` installed at CI time (no pinned lockfile)

## Frameworks

**Core:**
- None — vanilla JavaScript, no React, Vue, Angular, Svelte, or any UI framework
- No module bundler (no Vite, Webpack, Rollup, Parcel, esbuild)
- No TypeScript

**CSS:**
- No CSS framework (no Tailwind, Bootstrap, etc.)
- Entirely custom CSS with CSS custom properties (`--bg-dark`, `--accent`, etc.) declared in `:root`

**Testing:**
- None — no test framework present

**Build/Dev:**
- **No build step.** The file you edit is the file that ships. Opening `index.html` in a browser is all that is needed.
- CI pipeline: GitHub Actions (`.github/workflows/g4f-issue-reply.yml`) runs only for issue auto-reply; not a build or deploy pipeline

## Key Dependencies

**CDN-loaded (runtime, browser):**
- Google Fonts — `https://fonts.googleapis.com` — loads `Baloo 2` (wght 400, 600) and `Nunito` (wght 400, 600); referenced in `index.html` lines 9–11
- No other CDN scripts — no jQuery, no hls.js, no lodash, no moment

**Hardcoded in source (no npm install):**
- All music API integrations are plain `fetch()` calls to third-party proxy APIs (see INTEGRATIONS.md)

**Audio Playback Technology:**
- **HTML5 `<audio>` element** — `<audio id="audio" preload="metadata">` at `index.html` line 1373
- Audio `src` is set to a direct URL returned by the music proxy APIs (`dom.audio.src = track.audioUrl`)
- Format support: MP3, AAC, OGG, FLAC (browser-native decode; no hls.js, no MSE/Media Source Extensions, no Web Audio API decode)
- **No HLS/DASH streaming** — all audio URLs are direct file links
- **Simulated audio level visualization:** `audioLevel` is a synthetic value derived from `Math.sin(currentTime)`, not from a real `AnalyserNode` (see `index.html` line 3190–3191). The Web Audio API is NOT used.

## Configuration

**Environment:**
- No environment variables for the web app — all API endpoints and tokens are **hardcoded** in `index.html`
- JOOX token `f84ao9lMF_q7husBWRfgUw` is a hardcoded constant (`const JOOX_TOKEN`) at `index.html` line 2165
- JOOX bitrate `const JOOX_BR = 4` hardcoded at `index.html` line 2166
- Language preference stored in `localStorage` key `pikachu-music-lang`
- User library (favorites + playlists) stored in `localStorage` key `pikachu-music-library-v1`

**Build:**
- No build config files (no `tsconfig.json`, no `vite.config.*`, no `webpack.config.*`, no `.babelrc`, no `eslint.config.*`)

## Platform Requirements

**Development:**
- Any text editor + any modern browser
- No Node.js, no Python, no build tools required to run the app locally
- Open `index.html` directly in a browser (file:// protocol) or serve it with any static file server

**Production:**
- GitHub Pages — the repo's `index.html` is served at `https://charlespikachu.github.io/musicsquare/`
- No backend server, no database, no container, no CDN config needed
- Any static hosting (Netlify, Vercel, S3+CloudFront, Cloudflare Pages) works as-is

## Application Architecture Summary

The entire app is a single IIFE (Immediately Invoked Function Expression) wrapping all state and logic:

```
index.html
├── <style> block        — All CSS (lines 12–1490)
├── <body> HTML markup   — All DOM structure (lines 1192–1492)
└── <script> IIFE block  — All JavaScript (lines 1493–3318)
    ├── translations{}   — i18n strings (zh + en)
    ├── state{}          — Central mutable state object (single source of truth)
    ├── Storage layer    — localStorage read/write (LIBRARY_STORAGE_KEY)
    ├── Search functions — searchNetease, searchQQ, searchKuwo, searchJoox
    ├── Detail functions — fetchNeteaseDetails, fetchQQDetails, fetchKuwoDetails, fetchJooxDetails
    ├── Player logic     — playTrack, playNext, togglePlayPause
    ├── LRC parser       — parseLRC, updateLyricsHighlight
    ├── Render functions — renderMiniSearchList, renderPlaylistList, renderLyrics
    ├── Particle canvas  — setupParticles (Canvas 2D API, 90 particles)
    ├── Ripple effects   — setupRipple (CSS animation via DOM injection)
    ├── DOM bindings     — setupDOM, setupEvents
    └── init()           — Entry point, called on DOMContentLoaded
```

---

*Stack analysis: 2026-06-05*
