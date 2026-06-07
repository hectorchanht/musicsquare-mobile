# Quick Task 260607-hvu — Source candidates research

**Researched:** 2026-06-07
**Constraint frame:** edge-only (Cloudflare Workers free), HTML `<audio>` only (no MSE/HLS/DRM),
no signed-server-state secrets, shipable in one quick task (~200–400 LoC = adapter + proxy).

---

## Upstream source list (musicdl)

From `CharlesPikachu/musicdl/musicdl/modules/sources/` (verified via gh tree listing,
2026-06-07):

**Greater China**
- ~~`netease`~~ (have)
- ~~`qq`~~ (have)
- ~~`kuwo`~~ (have)
- ~~`joox`~~ (have)
- `kugou` — Tencent-rival CN platform, ~1B users
- `migu` — China Mobile-owned, massive Chinese catalog
- `bilibili` — UGC + ACG/Japanese soundtracks
- `bodian` — niche
- `fivesing` (5sing) — Kugou's UGC/cover/instrumental community
- `qianqian` (Baidu Music) — once-popular, declining
- `soda` (Qishui) — ByteDance/Douyin music app
- `streetvoice` — Taiwan indie
- `moov` — HK regional

**Global/international**
- `apple` — DRM, OAuth, no
- `deezer` — premium `arl` cookie REQUIRED for audio, no (we already proxy metadata for covers)
- `jiosaavn` — Indian + global, keyless metadata, audio is DES-encrypted
- `qobuz` — paid, no
- `soundcloud` — possible, see below
- `spotify` — DRM, audio requires SDK, no streaming use
- `suno` — generative, niche
- `tidal` — paid + DRM
- `youtube` / `ytmusic` — deferred per STATE.md (instance failover, s-checksum drift)

**CC-licensed catalogs**
- `fma` — Free Music Archive (defunct then revived)
- `jamendo` — CC catalog, needs free API client_id
- `opengameart` — game music, very niche

**Audiobook / aggregators** — out of scope (`itunes`, `lizhi`, `ximalaya`, plus 15+
unofficial scraper hosts) — these are podcast/audiobook or shoddy aggregator proxies that
have a track record of going dark (musicdl itself rotates through 5 fallback hosts for
kugou alone).

---

## Candidate scoring

| Source | Catalog gap | Proxy story | Effort | Auth | Quirks |
|---|---|---|---|---|---|
| **kugou** | LOW (CN-mainstream, overlaps qq/netease heavily) | `songsearch.kugou.com/song_search_v2` reachable from edge but **returned `total:0` for both EN and CN keywords from US IP — geo-biased**. cenguigui v2 only has a kugou **playlist** parser, not a generic search. musicdl uses 5 third-party hosts that rotate. | HIGH | none on song_search; signed on `complexsearch` | Edge-geo blocks results; 5 fallback hosts means high churn |
| **migu** | MED (CN telecom catalog, some exclusives, esp. Mandarin pop & 内地 content) | Official `c.musicapp.migu.cn/v1.0/content/search_all.do` **returns full clean JSON from edge with `User-Agent: Android_migu`**. BUT the resolve path `app.c.nf.migu.cn/.../listenSong.do` returns `"暂不提供试听地址"` (no listen URL) from US edge — **audio is geo-blocked**. | HIGH (drop, audio unplayable) | none | Search works edge, AUDIO BLOCKED from non-CN — useless as a streaming source |
| **bilibili** | HIGH (ACG, Japanese soundtracks, UGC remixes — unique catalog vs our 4) | Official `api.bilibili.com/x/web-interface/search/type` keyless, but `playurl?fnval=16` returns **DASH manifest, not mp3** — needs MSE/Media Source Extensions. | HIGH | cookie (`buvid3`) drift; signed playurl on newer endpoints | DASH only, no progressive mp3 → violates "HTML5 `<audio>` element, no MSE" constraint |
| **jiosaavn** | HIGH (Hindi/Indian + global English not on the 4 CN sources) | `www.jiosaavn.com/api.php` is keyless and **returns full search from edge** (verified — 4682 results for "arijit"). BUT `encrypted_media_url` is **DES-encrypted**; client must implement DES-ECB decrypt + URL templating. saavn.dev (the famous community decryption proxy) **no longer resolves DNS** (2026-06-07). | HIGH | none on metadata; DES key needed for audio | Encryption layer = adapter is no longer 200–400 LoC |
| **5sing (kugou)** | **HIGH (UGC/cover/instrumental/karaoke 伴奏 — no overlap with our 4)** | `search.5sing.kugou.com/home/json?keyword=…` returns full search **from edge** (verified). `mobileapi.5sing.kugou.com/song/getSongUrl?songid=…&songtype=fc/bz/yc` returns direct mp3 link (verified `https://wsaudiobssdlbig.kugou.com/…/*.mp3` 3.7MB lqurl). | **LOW** | none | Audio URL has a timestamp segment (probably 1-2h expiry) — re-resolve at play time (matches our existing `resolve()` lazy pattern); `songtype` (fc=翻唱/bz=伴奏/yc=原创) needs to round-trip through the Track |
| **qianqian (Baidu)** | MED (CN mainstream + some indie) | Official `music.91q.com/v1/search` with md5 sign (secret is hardcoded `0b50b02fd0d73a9c4c8c3a781c30845f` — fine for client/edge). | MED | static md5 secret (hardcoded, public) | Baidu Music brand has been wound down → catalog freshness questionable; geo-IP behavior uncharacterized |
| **soda/qishui (Douyin)** | HIGH (TikTok viral tracks, often before Netease has them) | `api.qishui.com/luna/pc/search/track` — cookie-gated (`uid_tt`/`webid`). | HIGH | dynamic ByteDance cookies | Cookie acquisition flow runs hot, frequent breakage |
| **streetvoice** | MED (Taiwan indie) | `streetvoice.cn/api/v5/song/{id}/hls/file/` → HLS only. | HIGH | csrf token | HLS = MSE = drop |
| **moov** | MED (HK Cantopop catalog) | No public proxy in musicdl; needs Hong Kong device emulation. | HIGH | session | Drop |
| **bodian** | LOW (CN niche) | Public-ish but tiny catalog. | MED | none | Catalog too narrow to justify a sixth source |
| **fivesong/htqyy/gequbao/etc.** (musicdl's 15 thirdparty scrapers) | n/a | All scrape unofficial mirror sites; musicdl rotates 5+ hosts because each goes dark every ~6 months. | drop on stability | varies | Antipattern at our scale |
| **jamendo** | MED (CC indie — wildly different content) | `api.jamendo.com/v3.0/tracks/?client_id=…` keyless after free signup, direct mp3. **Demo client_id `56d30c95` is suspended** as of probe — needs a fresh app registration. | LOW once a key is provisioned | static API key (third-party-issued) | Catalog doesn't intersect Mandopop at all — solves a different problem |
| **fma** (Free Music Archive) | LOW–MED (CC indie) | Site was offline 2018, archived by Pasta API; not a stable upstream. | MED | none | Stability concern |
| **deezer (audio)** | already metadata-only | `arl` premium cookie required for stream URLs (musicdl explicitly asserts it). | drop | premium login cookie | We already use Deezer for **covers only** at `/api/deezer/search` (260606-wv8). Adding stream → would need user `arl` = violates "no signed user secrets" |

---

## Top 2 picks (ranked)

### #1: 5sing (Kugou UGC) — id `fivesing`

**Why.** 5sing fills a catalog gap NONE of netease/qq/kuwo/joox cover well: amateur covers
(翻唱), instrumental backing tracks (伴奏), and original UGC songs. A search for "周杰伦"
on 5sing returns covers and karaoke instrumentals that won't appear in our other 4 sources
at all — this is **additive search supply**, not a duplicate. The upstream lives on
`*.5sing.kugou.com` which is reachable from a non-CN edge (probed 2026-06-07, US IP, no
geo block on either search or audio). Audio is a direct `https://wsaudiobssdlbig.kugou.com/
…/*.mp3` — full progressive mp3, plays in `<audio>` with no MSE.

**Endpoint sketch** (proxy calls these from the edge, two paths under `/api/fivesing/`):

- **Search:** `http://search.5sing.kugou.com/home/json?keyword=<kw>&sort=1&page=<n>&pagesize=20`
  - Returns `{ list: [{ songId, songName, singer, originSinger, type, typeEname (fc/bz/yc),
    ext, songSize, postProduction, … }] }`. No `code` envelope at the top — `list` is the
    contract anchor.
- **Resolve URL:** `http://mobileapi.5sing.kugou.com/song/getSongUrl?songid=<id>&songtype=<fc|bz|yc>`
  - Returns `{ code: 1000, data: { lqurl, hqurl, squrl, lqurl_backup, lqsize, lqext } }`.
    Prefer `squrl` (sq=lossless) → `hqurl` (high) → `lqurl` (low) at resolve time. All three
    can be empty strings (UGC tier varies) — fall back left to right.
- **Lyrics + meta** (optional pass): `http://mobileapi.5sing.kugou.com/song/newget?songid=<id>&songtype=<type>`
  - Returns extended meta: `{ data: { ID, SN, user.NN (nickname), KL (lyric?), KL128, KLM (lyric file url?), GD (download count) … } }`. Lyrics shape is undocumented; SAFE to skip lyrics on v1
    (UGC content frequently lacks LRC anyway — let the `lrc` field stay null, the UI already
    renders `(no lyrics)` for that case).

**Adapter shape** (matches `SourceAdapter` in `src/lib/sources/types.ts`):

```ts
// src/lib/sources/fivesing.ts (sketch)
export const fivesing: SourceAdapter = {
  id: 'fivesing',
  label: '5sing',        // i18n strings: add `t.source.fivesing` for the source pill
  enabledByDefault: false, // ship OFF by default — UGC is noisy supply, opt-in via settings

  async search(keyword, page, signal) {
    const res = await fetch(`/api/fivesing/search?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=20`, { signal });
    const json = await res.json() as { list?: FsItem[] };
    if (!Array.isArray(json.list)) throw new Error('fivesing: contract-drift (expected list[])');
    return json.list.map((it, idx) => ({
      uid: makeUid('fivesing', String(it.songId)),
      source: 'fivesing',
      songid: String(it.songId),
      title: stripEm(it.songName),         // strip <em class="keyword">…</em>
      artist: stripEm(it.singer || it.originSinger || ''),
      album: it.typeName || '',            // 翻唱/伴奏/原创 doubles as "album" label
      cover: null,                          // 5sing has no per-track cover; Last.fm/Deezer cover-backfill will fill it
      audioUrl: null,
      lrc: null, lrcUrl: null, detailsLoaded: false,
      quality: null, qualityLabel: null,
      keyword,
      displayIndex: idx + 1,
      // source-specific extra (add an optional `fivesingSongType` to Track):
      fivesingSongType: it.typeEname,      // 'fc' | 'bz' | 'yc' — must round-trip to resolve()
    }));
  },

  async resolve(track, signal) {
    const t = track.fivesingSongType || 'yc';
    const res = await fetch(`/api/fivesing/url?songid=${encodeURIComponent(track.songid)}&songtype=${encodeURIComponent(t)}`, { signal });
    const j = await res.json() as { code?: number; data?: { squrl?: string; hqurl?: string; lqurl?: string; squrl_backup?: string; hqurl_backup?: string; lqurl_backup?: string } };
    if (!j || j.code !== 1000 || !j.data) throw new Error('fivesing: detail failed');
    const url = j.data.squrl || j.data.hqurl || j.data.lqurl || j.data.squrl_backup || j.data.hqurl_backup || j.data.lqurl_backup || null;
    if (!url) throw new Error('fivesing: no playable url tier returned');
    track.audioUrl = url;
    track.detailsLoaded = true;
    const q = inferQualityFromUrl(url); track.quality = q.tag; track.qualityLabel = q.label;
    return track;
  }
};
```

**Proxy host allow-list:** add `*.5sing.kugou.com` (the search host) and **`*.kugou.com`
broadly** for the audio CDN (`wsaudiobssdlbig.kugou.com`, `wsaudiobssdlbig.cloud.kugou.com`).
The audio host is `wsaudiobssdlbig.kugou.com` — confirm before merging that `safeImageUrl`
patterns in `cover-backfill.ts` aren't accidentally `<img src>`-validating audio hosts.

**Pitfalls:**
- **Audio URL is short-lived** (the `/202606071301/…` timestamp segment looks like a 1–2h
  signed window). Mitigation: `resolve()` is already called lazily before each play in
  `playTrack()` — the existing `detailsLoaded` flag will need to be RESET after a play
  failure so the next attempt re-resolves. Check `services/fallback.ts`; if it already
  clears `detailsLoaded` on `<audio>` error, no change.
- **`songtype` is identity-critical.** `songId` is NOT unique across `fc/bz/yc` — the same
  numeric id can map to a different track in each type. **The uid must include songtype**:
  use `makeUid('fivesing', `${songtype}-${songid}`)` instead of bare songid, or the dedupe
  layer will collide. (Treat this as the fivesing version of JOOX's Pitfall 4 identity
  problem.)
- **UGC quality is uneven.** Many 5sing tracks have `sqsize: 0` and only `lqurl` — be ready
  to land at 128k. `inferQualityFromUrl` already handles this. Don't try to enforce a
  minimum tier in `resolve()`.
- **No `<em>` tags in display strings.** Search results wrap matched substrings in
  `<em class="keyword">…</em>` HTML. Strip it in the adapter, NOT in the proxy (proxy is
  D-09 passthrough).
- **enabledByDefault: false.** UGC is noisier than mainstream sources — ship gated behind
  a settings toggle so existing users don't suddenly see karaoke instrumentals at the top
  of their search. The registry's `prefs` plumbing already supports this.

---

### #2: kugou — id `kugou` (RECOMMEND ONLY IF you accept the geo-edge risk)

**Why.** Kugou is the largest gap in our CN coverage on paper — bigger user base than
QQ/Netease in some demographics, and historically the canonical source for older Mandopop
back-catalog. **But every probe from the US edge today returned `total: 0` from the
official `songsearch.kugou.com/song_search_v2`** — Kugou aggressively region-biases search
results to CN IPs even when the endpoint itself is accessible. From a CN-region Cloudflare
worker (paid tier, region pinning) this would be a clear #1 pick; from the free tier
random-edge model, **expect ~30–60% of searches to return empty lists**. musicdl works
around this with a 5-host fallback ladder (cenguigui, haitangw, 317ak, liuyunidc, jbsou)
— that ladder is exactly the antipattern STATE.md flags for `ytmusic`.

**Honest recommendation:** **drop kugou for this quick task** and revisit if/when we pin
Workers to a CN/HK colo. If the planner still wants to ship it, scope is:

- Proxy hits `songsearch.kugou.com/song_search_v2` for search; `wwwapi.kugou.com/yy/index.php?
  r=play/getdata&hash={hash}&album_id={album}` for resolve. The `hash` comes from search;
  audio host is `*.kugou.com` (same CDN as 5sing).
- Adapter shape parallels kuwo's exactly (kw-api and kugou's wwwapi return nearly
  isomorphic shapes: `{status:1, data:{lists:[…], play_url, …}}`).
- Quirk: `wwwapi.kugou.com/yy/index.php?r=play/getdata` sometimes returns `play_backup_url`
  but not `play_url` from non-CN — match the `pickJooxPlayUrl` fallback ladder pattern.

If the planner picks kugou anyway, **bound the risk by setting `enabledByDefault: false`
and labeling the source pill "酷狗 (beta)"** so an empty-search day looks like an opt-in
limitation, not a regression of the whole app.

---

## Sources NOT recommended

| Source | One-line reason |
|---|---|
| **migu** | Search works edge, audio (`listenSong.do`) returns `"暂不提供试听地址"` (no listen URL) — geo-blocked. Would ship a source that searches but never plays. |
| **bilibili** | `playurl?fnval=16` returns DASH manifests, not progressive mp3 — violates the no-MSE constraint baked into the index.html legacy and the SvelteKit port. |
| **jiosaavn** | Catalog is great (Indian + Western), keyless metadata works edge, BUT `encrypted_media_url` is DES-encrypted client-side. The public decryption proxy `saavn.dev` no longer resolves DNS (2026-06-07). Implementing DES blows the LoC budget. |
| **deezer (audio)** | Needs `arl` premium login cookie. We already use Deezer for **covers** at `/api/deezer/search` — adding streaming would require user-provided premium credentials. Hard no. |
| **spotify / apple music / tidal / qobuz** | DRM. Audio requires native SDK. Metadata-only is possible but adds nothing over Deezer/Last.fm which we already have. |
| **soda (qishui / Douyin)** | ByteDance dynamic cookies (`webid`, `uid_tt`). Cookie acquisition flow is short-lived and runs the wrong way through corporate WAFs — frequent breakage in musicdl issues. |
| **streetvoice** | HLS-only. Drop. |
| **qianqian (Baidu)** | Brand is wound down, catalog stale, geo behavior uncharacterized. Marginal upside vs effort. |
| **bodian / moov / fma / opengameart** | Either niche-niche (catalog overlap < 1% with what users search) or upstream stability concern (FMA). |
| **jamendo** | CC-licensed indie — solves a different problem (you'd ship it for "discovery of free indie tracks", not for "user searched 周杰伦 and got more results"). Free API key needs registration. Worth a follow-on task, not this one. |
| **ytmusic** | Already deferred to v2 per STATE.md. |

---

## Pitfalls / cross-cutting

For ANY new source the planner adds, regardless of which:

- **Track identity via `makeUid`.** `src/lib/sources/types.ts` enforces `${source}:${songid}`.
  If the upstream has compound identity (5sing: songId + songtype; bilibili would be: bvid
  + cid), **fold the compound key into songid** at search time — never extend the uid
  format. `dedupeBest` in the catalog layer joins on `uid`, and on a key like artist + title
  for cross-source duplicate detection; whatever compound key you choose is invisible to
  it as long as `makeUid(id, songid)` stays the contract.

- **Cross-source dedupe (`dedupeBest`).** The artist-first-match key in `services/catalog.ts`
  uses normalized `${artist}|${title}`. For a UGC source like 5sing, the artist field is the
  COVER ARTIST (e.g. `AlanHelium`), not the original singer (`周杰伦`). That's correct
  behavior — the cover is a different recording, dedupe should NOT collapse it onto the
  netease/qq result. Confirm with one manual test that "周杰伦 - 最长的电影" returns BOTH
  the original (qq/netease) and the 5sing instrumental.

- **Short-lived resolve URLs.** 5sing's mp3 URL has a `/<YYYYMMDDhhmm>/<hash>/…` segment;
  kugou is identical. The legacy `playTrack()` (legacy:2599) and the SvelteKit player
  already re-call `resolve()` whenever `detailsLoaded === false`. **Make sure the catch
  block on `<audio>` `error` events clears `detailsLoaded` for the affected track** so the
  next play attempt re-resolves — this is the same pattern the existing
  `services/fallback.ts` (added by 260607-gte) is meant to handle. Audit it.

- **Edge-runtime gotchas.**
  - `caches.default` is undefined in `vite dev`; guard with `typeof caches !== 'undefined'`
    exactly like `src/routes/api/deezer/search/+server.ts:49` does.
  - `AbortSignal.timeout(ms)` (no hand-rolled `setTimeout` + AbortController) is the
    pattern — see the RESEARCH "Don't Hand-Roll" note that joox.ts cites.
  - CORS must be scoped to the own origin via `corsHeaders(origin)` from `$lib/proxy/http`,
    NEVER `Access-Control-Allow-Origin: *` — that's a hard threat-model rule (T-01-02 / T-wv8-02).
  - `platform?.env` is the verified bindings path — but neither 5sing nor kugou needs any
    secret, so the proxy `buildUrl` can take `_env: Env | undefined` like `kuwoProxy` does.

- **Proxy host allow-list for safe-image URL.** Adding a source whose covers live on a new
  CDN means updating `safeImageUrl` in `src/routes/api/deezer/search/+server.ts:70` AND
  the cover-backfill chain. 5sing has no per-track cover (only the user avatar) so this
  doesn't bite for #1; kugou audio is `*.kugou.com` (already a brand match for the kuwo
  CDN we tolerate).

- **i18n strings.** Add to `src/lib/i18n/` (wherever translations live):
  - `source.fivesing.label` → "5sing" (Latin name, both zh and en — it's a brand name)
  - source pill tooltip / settings-toggle label: "5sing (UGC covers & 伴奏)" in zh,
    "5sing (covers & karaoke)" in en
  - settings copy: explain it's gated/opt-in so the catalog-mix surprise is owned.

- **`fivesingSongType` field on `Track`.** The `Track` interface in `types.ts` has a "source-
  specific extras" block (lines 38–49) for QQ/JOOX. Add `fivesingSongType?: 'fc' | 'bz' | 'yc'`
  there — that field is read by `resolve()` and must survive `serializeTrack`/`deserializeTrack`
  (otherwise saved-library tracks lose the ability to re-resolve). Audit those two helpers in
  the same touchpoint.

---

## TL;DR for the planner

**Ship 5sing.** It's the only candidate that hits all four hard constraints (edge-reachable,
direct mp3, no signed-state auth, fits in one quick task) AND fills a real catalog gap
(UGC/covers/instrumentals — content the other 4 sources structurally lack). Ship it
`enabledByDefault: false` behind a settings toggle.

**Skip everything else this round.** Kugou is the runner-up but the geo-edge probe says it'd
ship as a half-broken source. Migu/Bilibili/JioSaavn each have a specific blocker (geo-audio /
DASH / DES encryption) that breaks the "no MSE, no headless, no heavy crypto" constraint.

If the planner has appetite for a SECOND source in the same task, **revisit Jamendo** —
register a free Jamendo API key (3-min signup), ship `enabledByDefault: false`, and you've
added Western CC-indie supply that doesn't compete with the 4 CN sources at all. The
adapter is essentially: `api.jamendo.com/v3.0/tracks?search=…&audioformat=mp32&client_id=ENV`
→ direct mp3, no quirks. ~150 LoC.
