# Codebase Structure

**Analysis Date:** 2026-06-05

---

## Directory Layout

```
musicsquare-mobile/              # Repository root
├── index.html                   # ENTIRE APPLICATION — 3320 lines
│                                # Contains: all CSS, all HTML, all JavaScript
│
├── pikachu.gif                  # Mascot animation shown in header
│
├── docs/
│   └── logo.png                 # README logo image only
│
├── scripts/
│   └── g4f_issue_reply.py       # GitHub Actions bot — auto-replies to issues with AI
│                                # NOT part of the music player
│
├── .planning/
│   ├── HANDOFF.json             # GSD orchestrator state
│   └── codebase/               # THIS directory — architecture docs
│       ├── ARCHITECTURE.md
│       └── STRUCTURE.md
│
├── .github/
│   ├── FUNDING.yml              # GitHub Sponsors config
│   ├── ISSUE_TEMPLATE/          # Issue templates (bug, feature, docs, etc.) in zh + en
│   └── workflows/
│       └── g4f-issue-reply.yml  # CI workflow that runs g4f_issue_reply.py
│
├── .gitignore
├── LICENSE
└── README.md                    # Project overview (English)
```

---

## Directory Purposes

**Root (`/`):**
- Contains only `index.html`, `pikachu.gif`, `README.md`, `LICENSE`, `.gitignore`
- `index.html` is the entire deployable app. GitHub Pages serves it directly — no build step.

**`docs/`:**
- Purpose: Static assets for documentation and README display only
- Contains: `logo.png` only
- Not served as application assets

**`scripts/`:**
- Purpose: Repository tooling, not player code
- Contains: `g4f_issue_reply.py` — a GitHub Actions helper that uses GPT (via g4f and OpenAI-compatible APIs) to auto-reply to GitHub issues
- This file has zero relationship to the music player

**`.github/`:**
- Purpose: GitHub platform configuration
- `ISSUE_TEMPLATE/`: Bug/feature/question templates in both Chinese and English
- `workflows/g4f-issue-reply.yml`: Triggers `scripts/g4f_issue_reply.py` when issues are opened

**`.planning/`:**
- Purpose: GSD planning system state and codebase maps
- `HANDOFF.json`: Auto-written by GSD between phases
- `codebase/`: Written by `/gsd:map-codebase` — consumed by `/gsd:plan-phase` and `/gsd:execute-phase`

---

## Key File Locations

**The Entire Application:**
- `index.html` (3320 lines) — everything is here

**Within `index.html` by region:**

| Region | Lines | Content |
|--------|-------|---------|
| `<head>` + CSS | 1–1211 | Google Fonts link, all CSS variables, component styles, animations, media queries |
| HTML structure | 1212–1491 | Three-panel layout, header, footer, two modals, toast div |
| IIFE open + i18n | 1493–1646 | `(function(){` wrapper, `translations{}` object |
| `state` object | 1648–1669 | Central application state |
| Utility helpers | 1672–1758 | `$()`, `t()`, `showToast()`, `formatTime()`, `getInterleavedSearchList()`, quality helpers |
| Library persistence | 1760–1981 | `serializeTrack()`, `deserializeTrack()`, `saveLibraryToStorage()`, `loadLibraryFromStorage()`, export/import, `renderPlaylistOptions()` |
| Search functions | 1983–2263 | `searchNetease()`, `searchQQ()`, `searchKuwo()`, `searchJoox()`, `searchAllSources()` |
| Detail fetchers | 2265–2513 | `fetchNeteaseDetails()`, `fetchQQDetails()`, `fetchKuwoDetails()`, `fetchJooxDetails()`, `ensureTrackDetails()` |
| Lyrics engine | 2515–2585 | `parseLRC()`, `renderLyrics()`, `updateLyricsHighlight()` |
| Playback logic | 2587–2959 | `isFavorite()`, `playTrack()`, `getActiveList()`, `playFromList()`, `playNext()`, `togglePlayPause()`, `toggleFavoriteCurrent()`, `addCurrentToPlaylist()`, `requestMoreResults()` |
| Render functions | 2766–2959 | `renderMiniSearchList()`, `renderPlaylistList()`, `updatePlaylistInfoLabel()`, modal open/close/create |
| Visual effects | 2961–3050 | `setupParticles()` (canvas), `setupRipple()` |
| DOM + event wiring | 3052–3298 | `setupDOM()`, `setupEvents()`, `setPlaymodeUI()` |
| Init + bootstrap | 3300–3317 | `init()`, `DOMContentLoaded` listener |

---

## Naming Conventions

**Files:**
- Lowercase with hyphens: `index.html`, `pikachu.gif`, `g4f_issue_reply.py` (Python uses underscores)
- No separate JS/CSS files — everything is inlined in `index.html`

**CSS Classes:**
- BEM-like lowercase-with-hyphens: `.search-mini-item`, `.track-meta-title`, `.playmode-btn`
- State modifiers as bare class names: `.active`, `.playing`, `.show`, `.btn-fav-active`
- Source color identifiers: `.source-dot.netease`, `.source-dot.qq`, `.source-dot.kuwo`, `.source-dot.joox`

**JavaScript:**
- Functions: camelCase, verb-noun pattern — `playTrack()`, `renderLyrics()`, `fetchKuwoDetails()`, `searchAllSources()`, `ensureTrackDetails()`
- State fields: camelCase — `searchResults`, `currentTrack`, `playContext`, `lyricLines`
- Constants: UPPER_SNAKE_CASE — `LIBRARY_STORAGE_KEY`, `JOOX_TOKEN`, `JOOX_BR`
- DOM cache object: `dom` — all DOM refs stored as `dom.playBtn`, `dom.audio`, etc.

**i18n Keys:**
- camelCase verb or noun: `toastAddedFavorite`, `searchStatusSearching`, `playerStatusIdle`, `tabResults`

**Track UIDs:**
- Format: `"<source>-<id>"` — `"netease-12345678"`, `"qq-00ABCD1234EF"`, `"kuwo-7890123"`, `"joox-SONGMIDABC"`

---

## Where to Add New Code

The codebase is currently 100% monolithic. The planned rebuild will create a new repo/project structure. Below is guidance for changes within the current repo and for the rebuild extraction.

**Extracting backend logic (for rebuild):**
- Copy all functions from the "BACKEND — REUSE" list in ARCHITECTURE.md out of `index.html` into separate `.js` modules
- Extraction order: `state.js` → utility helpers → search functions → detail fetchers → playback orchestration → persistence
- The `state` object should become the store module; search/detail functions become service modules

**Adding a new music source (current codebase):**
- Add source identifier to `state.enabledSources` object (line 1650)
- Add `perSourceCurrentLimit` and `perSourcePage` entry
- Add source chip checkbox to HTML at around line 1258
- Add CSS dot color for new source (around line 388)
- Add i18n key `sourceXxx` to both `zh` and `en` translation objects
- Write `searchXxx(kw, limit)` function following the pattern of `searchKuwo()` at line 2123
- Write `fetchXxxDetails(track)` function following the pattern of `fetchKuwoDetails()` at line 2398
- Register in `searchAllSources()` task array at line 2235
- Register in `ensureTrackDetails()` dispatch at line 2509

**Adding a new playlist feature:**
- State: add fields to `state.playlists[n]` object structure
- Persistence: update `serializeTrack()` keys list at line 1764 if new track fields need saving
- Persistence: update `getLibrarySnapshot()` at line 1791 if new top-level state needs saving
- UI: update `renderPlaylistList()` at line 2818

**Adding keyboard shortcuts:**
- Register in the `keydown` handler at `index.html:3263`
- Add shortcut card to the HTML modal at around line 1451
- Add i18n keys for both zh and en

---

## Monolith vs Modular

**Fully monolithic (single file):**
- `index.html` — CSS + HTML + JS in one file, no imports, no modules

**Standalone / separate (not part of player):**
- `scripts/g4f_issue_reply.py` — separate Python tool for GitHub automation
- `.github/` — platform configuration

**No build system exists.** There is no `package.json`, `node_modules`, Webpack, Vite, Rollup, Babel, or TypeScript. The app runs directly as a static file from GitHub Pages with zero compilation.

---

## Special Directories

**`docs/`:**
- Purpose: README image assets
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning system — contains this file
- Generated: Partially (HANDOFF.json is auto-written by GSD tooling; `codebase/` docs are written by `/gsd:map-codebase`)
- Committed: Depends on team preference; safe to commit

**`.github/`:**
- Purpose: GitHub platform configuration (issue templates, CI workflows)
- Generated: No
- Committed: Yes

---

## Deployment

- Platform: GitHub Pages
- Entry: `index.html` at repo root
- No build step. Push to `main` branch → GitHub Pages serves `index.html` directly.
- Live URL referenced in README: `https://charlespikachu.github.io/musicsquare/`

---

*Structure analysis: 2026-06-05*
