# External Integrations

**Analysis Date:** 2026-06-05

---

## Overview

The app integrates **four music sources**: Netease (网易云), QQ Music (QQ音乐), Kuwo (酷我), and JOOX. None of the source APIs are called directly — all calls go through **third-party public proxy APIs** that handle CORS and authentication on behalf of the client. There is no backend server owned by this project.

The `<meta name="referrer" content="no-referrer" />` tag at `index.html` line 6 suppresses the `Referer` header on all requests, which is a common technique to avoid referer-based blocking by CDN audio links.

---

## Music Source 1: Netease Cloud Music (网易云音乐)

**Proxy API:** `api.qijieya.cn` (Meting-based proxy)

**What it provides:** Search results (title, artist, cover art, direct audio URL, LRC lyrics URL) — all returned in a single search call.

### Search

```
GET https://api.qijieya.cn/meting/?type=search&id={keyword}&limit={n}&server=netease
```

- Called from: `searchNetease()`, `index.html` line 1988
- `id` = URL-encoded search keyword
- `limit` = `page * perSourceLimit` (pagination handled by multiplying limit, not a real page param)
- Returns: JSON array of objects with fields `name`, `artist`, `url` (audio), `pic` (cover), `lrc` (lyrics URL)
- Netease audio URL is returned directly in search results (unlike QQ/Kuwo which need a detail call)
- Song ID is extracted from the `url` query param `?id=` using `pickQueryParam()`

### Audio URL (fallback / cached tracks)

```
GET https://api.qijieya.cn/meting/?server=netease&type=url&id={songid}
```

- Called from: `fetchNeteaseDetails()`, `index.html` line 2271
- Used only when a cached track (from localStorage) has a `songid` but no `audioUrl`

### Lyrics (LRC)

```
GET https://api.qijieya.cn/meting/?server=netease&type=lrc&id={songid}
```

- Called from: `fetchNeteaseDetails()`, `index.html` line 2274
- Returns: plain LRC text or JSON wrapping LRC (both formats handled with content-type sniffing, lines 2288–2302)

**State fields populated:**
```
track.songid       — Netease song ID (from URL ?id= param)
track.audioUrl     — Direct audio stream URL
track.lrcUrl       — LRC lyrics URL (fetched separately on play)
track.lrc          — Resolved LRC text string
track.cover        — Cover image URL (it.pic)
track.title        — Song title (it.name)
track.artist       — Artist name (it.artist)
```

**Pagination:** `perSourcePage.netease` incremented on "Load More"; limit multiplied by page number (`index.html` lines 1987, 2951–2952).

---

## Music Source 2: QQ Music (QQ音乐)

**Proxy API:** `tang.api.s01s.cn` ("Tang" QQ Music API)

**What it provides:** Search (title, artist, song_mid, pay status) + detail (audio URLs at multiple quality tiers, cover, lyrics).

### Search

```
GET https://tang.api.s01s.cn/music_open_api.php?msg={keyword}&type=json
```

- Called from: `searchQQ()`, `index.html` line 2043
- Returns: JSON array (or `{data:[...]}` wrapper) of objects with `song_mid`, `song_title`, `singer_name`, `pay`
- No audio URL returned at search time — detail call required before playback

### Detail (audio URL + lyrics + cover)

```
GET https://tang.api.s01s.cn/music_open_api.php?msg={keyword}&type=json&mid={song_mid}
```

- Called from: `fetchQQDetails()`, `index.html` line 2323
- `msg` = original search keyword, `mid` = `song_mid` from search result
- Returns: single track object with multiple quality-tiered URLs

**Audio quality selection (in priority order, `pickBestPlayUrl()`, lines 2330–2345):**

| Field | Quality tag | Label |
|---|---|---|
| `song_play_url_sq` | `lossless` | `LOSSLESS` (SQ) |
| `song_play_url_pq` | `lossless` | `LOSSLESS` (PQ) |
| `song_play_url_accom` | `hq` | `HQ` (Accompaniment) |
| `song_play_url_hq` | `hq` | `HQ` |
| `song_play_url_standard` | `standard` | `STD` |
| `song_play_url_fq` | `low` | `LOW` |
| `song_play_url` | null | null (fallback) |

Additional detail fields: `album_pic` (cover), `singer_pic`, `song_lyric` / `lyric` (LRC text inline), `song_h5_url`, `album_name`, `vip`, `kbps_sq/hq/standard/fq`.

**State fields populated:**
```
track.qqId / track.songMid — QQ song_mid (primary key)
track.qqIndex              — 1-based position in search results
track.qqSearchKey          — Keyword used for search (needed for detail call)
track.audioUrl             — Chosen quality tier URL
track.lrc                  — LRC text (inline from detail response)
track.cover                — Album or singer pic URL
track.qqQualityText        — Human-readable quality label (e.g. "SQ 999")
track.pay                  — Pay status string from search (e.g. "付费")
```

---

## Music Source 3: Kuwo Music (酷我音乐)

**Proxy API:** `kw-api.cenguigui.cn`

**What it provides:** Search (title, artist, album, cover, song rid) + detail (audio URL at `zp` lossless level + inline LRC lyrics).

### Search

```
GET https://kw-api.cenguigui.cn/?name={keyword}&page=1&limit={n}
```

- Called from: `searchKuwo()`, `index.html` line 2124
- Returns: `{code: 200, data: [{rid, name, artist, album, pic}, ...]}` 
- No audio URL returned at search time

### Detail (audio URL + lyrics)

```
GET https://kw-api.cenguigui.cn/?id={rid}&type=song&level=zp&format=json
```

- Called from: `fetchKuwoDetails()`, `index.html` line 2399
- `level=zp` requests lossless quality ("臻品" tier)
- Returns: `{code: 200, data: {name, artist, album, pic, url, lyric}}`
- `url` is a direct audio file link (FLAC for lossless, MP3 otherwise)
- `lyric` is an inline LRC text string

**State fields populated:**
```
track.songid      — Kuwo rid (numeric song ID)
track.audioUrl    — Direct audio stream URL (FLAC or MP3)
track.lrc         — LRC lyrics text (inline)
track.cover       — Cover image URL
```

**Quality detection:** `inferQualityFromUrl()` checks file extension (`.flac` → LOSSLESS, otherwise → 320K).

---

## Music Source 4: JOOX

**Proxy API:** `apicx.asia/api/joox_music`

**What it provides:** Search + detail with multiple audio quality tiers and inline LRC lyrics. Requires a hardcoded bearer-style token.

**Hardcoded credentials (in `index.html`):**
```javascript
const JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw';  // line 2165
const JOOX_BR = 4;                               // line 2166 (bitrate tier selector)
```

### Search

```
GET https://apicx.asia/api/joox_music?msg={keyword}&token={JOOX_TOKEN}&br={JOOX_BR}
```

- Called from: `searchJoox()`, `index.html` line 2170
- Returns: `{code: 200, data: {songs: [{songmid, 歌曲ID, 歌曲名称, 歌手, 专辑, 歌词内容}, ...]}}`
- Note: response uses Chinese-language field names (e.g. `歌曲名称`, `歌手`)
- Lyrics (`歌词内容`) are returned inline at search time (unlike other sources)
- No audio URL at search time

### Detail (audio URLs by quality tier)

```
GET https://apicx.asia/api/joox_music?msg={keyword}&n={jooxIndex}&token={JOOX_TOKEN}&br={JOOX_BR}
```

- Called from: `fetchJooxDetails()`, `index.html` line 2426
- `n` = 1-based index of the song in the original search result (`track.jooxIndex`)
- Returns: `{code: 200, data: {播放链接: {质量名: url, ...}, 歌曲名称, 歌手, 专辑, 歌词内容, songmid, 歌曲ID}}`

**Audio quality selection — `pickJooxPlayUrl()` (lines 2466–2479):**

Priority order probed via HEAD/GET range requests:
```
'Atmos全景声' → lossless / LOSSLESS
'无损FLAC'    → lossless / LOSSLESS
'Hi-Res无损'  → lossless / LOSSLESS
'母带无损'    → lossless / LOSSLESS
'OGG 320'     → 320k / 320K
'MP3 320'     → 320k / 320K
'AAC 192'     → 192k / 192K
'OGG 192'     → 192k / 192K
'MP3 128'     → 128k / 128K
'AAC 96'      → 96k / 96K
'AAC 48'      → 48k / 48K
```

Each candidate URL is probed with HEAD (then GET range `bytes=0-0` as fallback) with a 3-second timeout via `probeJooxAudioUrl()` (lines 2434–2464). The first URL that responds successfully is used.

**State fields populated:**
```
track.jooxIndex       — 1-based search position (used for detail re-fetch)
track.songMid         — JOOX songmid
track.songid          — 歌曲ID
track.audioUrl        — Chosen quality tier URL (probed live)
track.lrc             — LRC text (inline, from both search and detail responses)
track.jooxQualityText — Human-readable quality name (e.g. "Atmos全景声")
```

---

## CORS Strategy

All four music source integrations rely entirely on **third-party public proxy APIs** that serve responses with permissive CORS headers. The browser's `fetch()` API calls these proxies directly from the client side. There is no CORS proxy owned by this project.

The `<meta name="referrer" content="no-referrer">` tag suppresses the browser's `Referer` header on all requests, preventing music CDN links from blocking playback based on referer checking.

**No `mode: 'cors'` or `credentials` options are set** — all `fetch()` calls use default settings.

---

## Data Storage

**localStorage (browser):**

| Key | Contents | Where |
|---|---|---|
| `pikachu-music-library-v1` | JSON snapshot: `{version, savedAt, favorites[], playlists[]}`. Each track is serialized without `audioUrl`/`lrc` (these are re-fetched on play). | `saveLibraryToStorage()` / `loadLibraryFromStorage()`, `index.html` lines 1804–1838 |
| `pikachu-music-lang` | Language setting: `'zh'` or `'en'` | `setLanguage()`, `index.html` line 1712 |

**No IndexedDB, no cookies, no server-side session storage.**

**Playlist import/export:** JSON file download/upload via `Blob`, `URL.createObjectURL()`, `FileReader`. Schema matches the `LIBRARY_STORAGE_KEY` format. Functions: `exportPlaylistData()` line 1841, `handleImportPlaylistFile()` line 1925.

---

## CDN Dependencies

| Resource | URL | Purpose |
|---|---|---|
| Google Fonts (preconnect) | `https://fonts.googleapis.com` | Font DNS warmup |
| Google Fonts (preconnect) | `https://fonts.gstatic.com` | Font file DNS warmup |
| Google Fonts (stylesheet) | `https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600&family=Nunito:wght@400;600` | Load Baloo 2 + Nunito fonts |

No JavaScript libraries are loaded from CDN. All logic is inline.

---

## GitHub Actions / CI

**Workflow:** `.github/workflows/g4f-issue-reply.yml`

**Purpose:** Auto-reply to newly opened GitHub issues using LLM (not related to the music player).

**Script:** `scripts/g4f_issue_reply.py`

**LLM provider chain (`MultiProviderIssueReplyBot`):**
1. OpenAI-compatible API (configured via `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL` secrets/vars)
2. Ecylt Free GPT API (`https://api.ecylt.top/v1/free_gpt/chat_json.php`, configurable via `ECYLT_FREE_GPT_URL`)
3. g4f (gpt4free local library) with model list: `gpt-4.1-nano`, `deepseek-r1`, `llama-4-scout`, `mistral-small-3.1-24b`, etc.

**Required secrets:** `GITHUB_TOKEN` (auto-provided), `OPENAI_COMPATIBLE_API_KEY` (optional)
**Required vars:** `G4F_MODELS`, `ECYLT_FREE_GPT_ENABLED`, `ECYLT_FREE_GPT_URL`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL`

---

## Integration Summary Table

| Source | Search Proxy | Detail Proxy | Auth | Search returns audio? | Lyrics source |
|---|---|---|---|---|---|
| Netease | `api.qijieya.cn/meting` | Same | None | Yes (direct URL) | Separate LRC URL fetch |
| QQ Music | `tang.api.s01s.cn` | Same (+ `mid` param) | None | No | Inline in detail response |
| Kuwo | `kw-api.cenguigui.cn` | Same (+ `id` param) | None | No | Inline in detail response |
| JOOX | `apicx.asia/api/joox_music` | Same (+ `n` param) | Hardcoded `token` | No | Inline in both responses |

---

## Key Functions for Mobile Rebuild (Reuse Reference)

All integration logic lives in `index.html` within the single `<script>` block:

| Function | Lines | Purpose |
|---|---|---|
| `searchNetease(kw, page, num)` | 1986–2038 | Netease search |
| `searchQQ(kw, limit)` | 2040–2120 | QQ search |
| `searchKuwo(kw, limit)` | 2122–2163 | Kuwo search |
| `searchJoox(kw, limit)` | 2168–2212 | JOOX search |
| `searchAllSources(reset)` | 2216–2263 | Aggregates all enabled sources via `Promise.all` |
| `fetchNeteaseDetails(track)` | 2268–2308 | Resolves audio URL + LRC for Netease |
| `fetchQQDetails(track)` | 2310–2396 | Resolves audio URL + LRC for QQ |
| `fetchKuwoDetails(track)` | 2398–2422 | Resolves audio URL + LRC for Kuwo |
| `fetchJooxDetails(track)` | 2424–2504 | Resolves audio URL (probed) + LRC for JOOX |
| `ensureTrackDetails(track)` | 2506–2513 | Router: dispatches to correct `fetchXxxDetails` |
| `inferQualityFromUrl(url)` | 1747–1758 | Derives quality tag from audio URL file extension |
| `parseLRC(txt)` | 2517–2532 | Parses LRC format to `[{time, text}]` array |
| `serializeTrack(track)` | 1762–1778 | Strips non-serializable fields for localStorage |
| `deserializeTrack(raw)` | 1780–1789 | Restores track from localStorage (clears audioUrl/lrc) |

**Track object shape** (canonical fields used across all sources):
```javascript
{
  uid,             // "{source}-{id}" e.g. "netease-123456"
  source,          // 'netease' | 'qq' | 'kuwo' | 'joox'
  displayIndex,    // 1-based position in search results
  keyword,         // Search keyword used to find this track
  songid,          // Source-specific song ID
  songMid,         // QQ/JOOX: song_mid
  qqId,            // QQ: song_mid alias
  qqSearchKey,     // QQ: original search keyword (needed for detail API)
  qqIndex,         // QQ: 1-based position in QQ search (used for detail)
  jooxIndex,       // JOOX: 1-based position (used for detail re-fetch by n=)
  jooxSongId,      // JOOX: 歌曲ID
  jooxSongMid,     // JOOX: songmid
  title,           // Song title
  artist,          // Artist name
  album,           // Album name
  cover,           // Cover image URL (null if unavailable)
  audioUrl,        // Direct audio stream URL (null until detail loaded)
  lrc,             // LRC text string (null until lyrics loaded)
  lrcUrl,          // LRC fetch URL (Netease only)
  detailsLoaded,   // boolean — true after fetchXxxDetails() completes
  quality,         // 'lossless' | '320k' | 'hq' | 'standard' | 'low' | null
  qualityLabel,    // Display string: 'LOSSLESS' | '320K' | 'HQ' | 'STD' etc.
  qqQualityText,   // QQ quality description (e.g. "SQ 999")
  jooxQualityText, // JOOX quality name (e.g. "Atmos全景声")
  pay,             // Pay status (QQ only: "付费" etc.)
  pageUrl          // QQ: song H5 page URL
}
```

---

*Integration audit: 2026-06-05*
