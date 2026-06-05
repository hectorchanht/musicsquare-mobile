# Coding Conventions

**Analysis Date:** 2026-06-05

## Language and Runtime

**Vanilla JavaScript only** — no framework, no build step, no npm.
- ES2020+ features used throughout: `async/await`, optional chaining (`?.`), nullish coalescing (`??`), `const`/`let` (no `var`), arrow functions, destructuring, `Array.isArray`, `Map`, template literals, `Promise.all`.
- The entire JS lives inside a single IIFE at the bottom of `index.html` (lines 1493–3318). There are no separate `.js` files in `scripts/` — that directory contains only the Python CI bot.
- No jQuery, no lodash, no external JS libraries whatsoever.
- Python (`scripts/g4f_issue_reply.py`) is used only for the GitHub issue-reply bot, not for the player itself.

## Variable Declarations

**`const` by default, `let` for mutation, never `var`.**

```js
// index.html ~line 1674
const dom = {};
let audioLevel = 0;

const LIBRARY_STORAGE_KEY = 'pikachu-music-library-v1';
const JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw';
const JOOX_BR = 4;
```

Module-level mutable state lives in a single `state` object (see State Management below).

## Naming Conventions

**Functions:** `camelCase`, verb-first descriptive names.

```js
// index.html
function searchNetease(kw, page, num) { ... }
function fetchKuwoDetails(track) { ... }
function ensureTrackDetails(track) { ... }
function renderMiniSearchList() { ... }
function renderPlaylistList() { ... }
function updateLyricsHighlight(time) { ... }
function togglePlayPause() { ... }
function saveLibraryToStorage() { ... }
function loadLibraryFromStorage() { ... }
```

**Variables / parameters:** `camelCase`, short where obvious (`kw`, `idx`, `el`, `cb`, `res`, `j`, `d`), longer where needed (`activeTab`, `requestLimit`, `playlistId`).

**Constants:** `SCREAMING_SNAKE_CASE` for module-level config.

```js
const LIBRARY_STORAGE_KEY = 'pikachu-music-library-v1';
const JOOX_TOKEN = '...';
const JOOX_BR = 4;
```

**HTML IDs:** `kebab-case` (e.g., `search-input`, `playlist-modal`, `track-quality-pill`).

**CSS classes:** `kebab-case` (e.g., `.search-mini-item`, `.ripple-target`, `.btn-fav-active`).

**Data attributes:** `data-kebab-case` (e.g., `data-source`, `data-tab`, `data-lang`, `data-i18n`, `data-mode`).

**Track object fields:** `camelCase` with source-specific prefixes for ambiguous fields (`qqId`, `qqIndex`, `qqSearchKey`, `jooxIndex`, `jooxSongId`, `jooxSongMid`, `jooxQualityText`).

## State Management

All mutable application state lives in a single flat `state` object declared at the top of the IIFE (`index.html` line 1648). It is mutated directly — there is no immutability or reactive layer.

```js
const state = {
  language: 'zh',
  enabledSources: { netease: true, qq: true, kuwo: true, joox: false },
  perSourceLimit: 10,
  searchResults: [],
  trackMap: new Map(),        // uid -> track object, deduplicate across sources
  favorites: [],
  playlists: [],
  currentTrack: null,
  playContext: { type: 'results', index: -1, playlistId: null },
  playMode: 'list',
  isPlaying: false,
  lyricLines: [],
  currentLyricIndex: -1,
  searchInProgress: false,
  noMoreResults: false,
  lyricsAlt: false,
  muted: false
};
```

DOM element references are cached in a flat `dom` object at `setupDOM()` (`index.html` ~line 3054). Always use `dom.elementName` — never query the DOM inside hot-path functions.

## DOM Manipulation

**No innerHTML for dynamic lists** — `document.createElement` + `appendChild` is used for all list rendering.

```js
// index.html ~line 2772 — canonical pattern for building a list item
const item = document.createElement('div');
item.className = 'search-mini-item ripple-target';
const tt = document.createElement('div');
tt.className = 'mini-title';
tt.textContent = track.title || 'Unknown';   // textContent, never innerHTML for user data
item.appendChild(tt);
wrap.appendChild(item);
```

**`innerHTML = ''`** is used only to clear a container before re-rendering (`wrap.innerHTML = ''`).

**ID lookup helper:** a local `$` alias is defined for `document.getElementById`.

```js
function $(id) { return document.getElementById(id); }
```

**Class toggling:** `classList.toggle(name, bool)` and `classList.add` / `classList.remove` are preferred over manual `className` concatenation.

**`data-i18n` pattern for static strings:** HTML elements that show translated text carry `data-i18n="keyName"`. `setLanguage()` loops over all `[data-i18n]` elements and sets their `textContent`. Dynamic strings (built at runtime) are passed through `t(key)` directly.

## Event Handling

**All event listeners are attached programmatically in `setupEvents()`** (`index.html` ~line 3113) — no inline `onclick` attributes on static HTML elements.

```js
// index.html ~line 3113 — canonical wiring pattern
dom.searchBtn.addEventListener('click', () => {
  state.searchKeyword = dom.searchInput.value.trim();
  searchAllSources(true);
});

dom.audio.addEventListener('timeupdate', () => {
  // ...updates progress bar and lyrics highlight...
});
```

**Delegation via `.closest()`** is used for the global ripple effect and for lists where items are dynamically created:

```js
// index.html ~line 3028
document.addEventListener('pointerdown', e => {
  const target = e.target.closest('.ripple-target, .btn, .track-item, .search-mini-item');
  if (!target) return;
  // ...
});
```

**`ev.stopPropagation()`** is called on per-item button clicks inside list items to prevent the row-level click from also firing.

**Modal backdrop click-to-close pattern:**

```js
dom.playlistModal.addEventListener('click', e => {
  if (e.target === dom.playlistModal) closePlaylistModal();
});
```

## Async Patterns

**`async/await` + `try/catch` for all fetch calls.** Errors are caught at the function level and surfaced via `console.error` and/or `showToast`.

```js
// index.html ~line 2001
try {
  const res = await fetch(url);
  const json = await res.json();
  // ... process ...
} catch (e) {
  console.error('netease(qijieya meting)', e);
}
```

**Parallel fetch with `Promise.all`** is used in `searchAllSources()`:

```js
// index.html ~line 2244
const res = await Promise.all(tasks);
added = res.reduce((a, b) => a + (b || 0), 0);
```

**Fetch-then-render pattern:** fetch → mutate `state` → call render functions. Render functions always read from `state`, never from local variables.

**`ensureTrackDetails(track)`** is the lazy-load gateway: it is called before playback to hydrate a track object with `audioUrl` and `lrc` if not already present.

## Error Handling

**Strategy:** log to console, show a brief toast to the user. Never throw to the top level.

```js
// Typical pattern
try {
  // ...
} catch (e) {
  console.error('context label', e);
  showToast(t('toastPlayError'));
}
```

**Storage errors** are caught silently with `console.warn`:

```js
try {
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(getLibrarySnapshot()));
} catch (e) {
  console.warn('save library failed', e);
}
```

**Failed fetch does not set `detailsLoaded = true`** (intentional — allows retry on next play attempt). Only `fetchQQDetails` documents this explicitly in a comment (`index.html` ~line 2394).

## Comments

**Section headers** use `// ===== Section Name =====` separators (all in Chinese). These are the primary structural navigation markers inside the script:

```
// ===================== 各平台搜索 =====================
// ===================== 聚合搜索 =====================
// ===================== 各平台详情 =====================
// ===================== 歌词处理 =====================
// ===================== 收藏 / 播放 =====================
// ===================== 搜索结果 / 播放列表渲染 =====================
// ===================== 歌单弹窗 =====================
// ===================== 搜索加载更多 =====================
// ===================== 背景粒子 & 水波纹 =====================
// ===================== DOM / 事件绑定 =====================
// ===================== 初始化 =====================
```

**Inline comments** explaining non-obvious logic appear in Chinese. English comments appear occasionally, especially for logic ported from or matching external API docs.

**UI strings** (labels, toasts, placeholders) are **bilingual** via the `translations` object — keys in English, values in Chinese (`zh`) and English (`en`). Default language is `zh`. The i18n function is `t(key)` (`index.html` line 1678).

**JOOX API fields** use Chinese property names exactly as the API returns them (`it['歌曲名称']`, `it['歌手']`, `it['专辑']`, `d['播放链接']`, etc.) — do not rename these.

## Internationalization (i18n)

Translation keys use `camelCase` with a category prefix (`toast*`, `source*`, `modal*`, `player*`, `shortcut*`). When adding new user-visible strings:

1. Add both `zh` and `en` values to the `translations` object (`index.html` line 1495).
2. In static HTML, use `data-i18n="key"` on the element.
3. In dynamic JS, call `t('key')` at the point of use.

Never hardcode a Chinese string outside the `translations` object (except JOOX API property names which are external).

## CSS / Design Tokens

CSS custom properties are defined on `:root` in the `<style>` block (`index.html` lines 13–26):

```css
--bg-dark, --panel-glass, --panel-glass-soft, --accent, --accent-strong,
--accent-pink, --accent-blue, --accent-green, --accent-red,
--text-main, --text-sub, --border-subtle
```

**Dark theme only.** No light mode. Background: `#02030a`. Accent: `#f5c84c` (gold/yellow).

Responsive breakpoints defined: `max-width: 1280px` and `max-width: 900px` — both still desktop-oriented (3-column grid). No mobile-first breakpoints exist yet.

The `.ripple-target` class (plus `.btn`, `.track-item`, `.search-mini-item`) opts elements into the touch ripple animation managed by `setupRipple()`.

## Track Object Shape

All track objects share this canonical shape (source of truth is `serializeTrack`, `index.html` ~line 1762):

```js
{
  uid,            // "{source}-{id}" — global dedupe key (e.g., "netease-123", "qq-abc456")
  source,         // 'netease' | 'qq' | 'kuwo' | 'joox'
  displayIndex,   // 1-based position in search results from that source
  keyword,        // search keyword used to fetch this track
  songid,         // platform-native song ID (string)
  title, artist, album,
  cover,          // URL or null
  audioUrl,       // URL or null (null until details fetched)
  lrc,            // LRC string or null
  lrcUrl,         // URL to fetch LRC from, or null
  detailsLoaded,  // boolean — false until ensureTrackDetails() succeeds
  quality,        // 'lossless' | '320k' | 'hq' | 'standard' | etc. | null
  qualityLabel,   // display string: 'LOSSLESS' | '320K' | 'HQ' | null
  pay             // QQ pay status string or null

  // Source-specific extras:
  // QQ: qqId, songMid, qqSearchKey, qqIndex, qqQualityText, pageUrl
  // JOOX: jooxIndex, jooxSongId, jooxSongMid, jooxQualityText
}
```

`state.trackMap` (a `Map`) is the single source of truth for track objects; `state.searchResults`, `state.favorites`, and `pl.tracks` hold references into this map.

## Storage

`localStorage` under the key `'pikachu-music-library-v1'` (JSON). `'pikachu-music-lang'` stores the language preference.

`serializeTrack` / `deserializeTrack` strip ephemeral fields (`audioUrl`, `lrc`, `lrcUrl`, `detailsLoaded`) before writing. Always use these functions when persisting or loading tracks — do not access `localStorage` directly from feature code.

---

*Convention analysis: 2026-06-05*
