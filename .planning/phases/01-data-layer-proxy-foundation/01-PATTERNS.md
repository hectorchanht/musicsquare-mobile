# Phase 1: Data Layer + Proxy Foundation - Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 18 new files (greenfield)
**Analogs found:** 14 / 18 (4 are net-new framework scaffolding with no analog)

> **Greenfield note.** There is NO existing SvelteKit/TypeScript code to analog against. The
> closest analog for every *data-layer* module is the corresponding function/section in
> `index.html` (line numbers below). That file moves to `legacy/index.html` in Phase 1 (D-02) —
> line numbers are stable across the move. The 4 framework files (registry interfaces, `+server.ts`
> shell, `http.ts` retry helper, spike harness) are genuinely new; for those the analog is the
> RESEARCH.md pattern, not the monolith.
>
> **Core insight (from RESEARCH "Don't Hand-Roll"):** This phase is *extraction + typing +
> re-keying identity*, NOT invention. Port the fetchers verbatim where the table says "port
> verbatim"; the only intended logic *change* is the JOOX position-index identity fix (D-10).

---

## File Classification

| New File | Role | Data Flow | Closest Analog (`index.html`) | Match Quality |
|----------|------|-----------|-------------------------------|---------------|
| `src/lib/sources/types.ts` | model (interfaces) | n/a (type defs) | `state`/track shape 1648–1670 + `serializeTrack` keys 1764–1768 | role-match |
| `src/lib/sources/registry.ts` | config (enumeration) | dispatch | `ensureTrackDetails` switch 2506–2513 + `searchAllSources` enabled-loop 2235–2241 | role-match |
| `src/lib/sources/netease.ts` | source-adapter (client) | CRUD (search) + transform (resolve) | `searchNetease` 1986–2038 + `fetchNeteaseDetails` 2268–2308 | exact |
| `src/lib/sources/qq.ts` | source-adapter (client) | CRUD + transform | `searchQQ` 2041–2120 + `fetchQQDetails` 2311–2396 | exact |
| `src/lib/sources/kuwo.ts` | source-adapter (client) | CRUD + transform | `searchKuwo` 2123–2163 + `fetchKuwoDetails` 2398–2422 | exact |
| `src/lib/sources/joox.ts` | source-adapter (client) | CRUD + transform + probe | `searchJoox` 2169–2212 + `fetchJooxDetails`/`probeJooxAudioUrl`/`pickJooxPlayUrl` 2424–2504 | exact |
| `src/lib/services/catalog.ts` | service (aggregator) | event-driven fan-out (`allSettled`) | `searchAllSources` 2216–2263 + `ensureTrackDetails` 2506–2513 + `getInterleavedSearchList` 1691–1707 + `trackMap` dedup 1657/2009/2067/2133/2180 | exact (logic) |
| `src/lib/services/lrc.ts` | utility (pure transform) | transform | `parseLRC` 2517–2533 + `inferQualityFromUrl` 1747–1758 | exact |
| `src/lib/proxy/proxy-types.ts` | model (interfaces) | n/a | RESEARCH Pattern 2 (no monolith analog) | no analog (research) |
| `src/lib/proxy/proxy-registry.ts` | config (enumeration) | dispatch | mirrors `registry.ts`; URLs from INTEGRATIONS | role-match |
| `src/lib/proxy/netease.ts` | proxy-adapter (server) | request-response (URL build) | `searchNetease` URL 1988 + `fetchNeteaseDetails` URLs 2271/2274 | exact (URL strings) |
| `src/lib/proxy/qq.ts` | proxy-adapter (server) | request-response | `searchQQ` URL 2043–2046 + `fetchQQDetails` URL 2323–2327 | exact |
| `src/lib/proxy/kuwo.ts` | proxy-adapter (server) | request-response | `searchKuwo` URL 2124 + `fetchKuwoDetails` URL 2399 | exact |
| `src/lib/proxy/joox.ts` | proxy-adapter (server) | request-response + token inject | `searchJoox` URL 2170 + `fetchJooxDetails` URL 2426; token 2165–2166 | exact (relocate secret) |
| `src/lib/proxy/http.ts` | utility (network) | request-response (retry/timeout/CORS) | `probeJooxAudioUrl` AbortController 2438–2450 (timeout idea only) | partial / research |
| `src/routes/api/[source]/[...path]/+server.ts` | route (proxy entry) | request-response | RESEARCH Pattern 2 (no monolith analog) | no analog (research) |
| `src/routes/spike/+page.svelte` | test harness (component) | event-driven (probe) | `probeJooxAudioUrl` 2434–2464 (probe logic) + RESEARCH "THE EGRESS SPIKE" | partial / research |
| `src/app.d.ts` | config (types) | n/a | RESEARCH `app.d.ts` example (no monolith analog) | no analog (research) |

---

## Pattern Assignments

### `src/lib/sources/types.ts` (model, type defs)

**Analog:** the live `state.track` object literals (every search fn builds one) + the
`serializeTrack` key whitelist (`index.html:1764–1768`), which is the authoritative field set.

**Field whitelist to type** (port from `serializeTrack`, `index.html:1764–1768`):
```javascript
const keys=[
  'uid','source','displayIndex','keyword','songid','songMid','qqId','qqSearchKey','qqIndex',
  'jooxIndex','jooxSongId','jooxSongMid','title','artist','album','cover','pageUrl',
  'quality','qualityLabel','qqQualityText','jooxQualityText','pay'
];
// plus the runtime-only (stripped on serialize) fields: detailsLoaded, audioUrl, lrc, lrcUrl
```
Use the RESEARCH `Track` interface (RESEARCH.md lines 225–256) as the target shape, but **reconcile
two things the research sketch dropped**: the monolith also carries `qqId`, `qqSearchKey`,
`qqIndex`, `jooxSongId`, `jooxSongMid` (per `serializeTrack`). Keep them optional so QQ/JOOX detail
calls still have the fields they read.

**ID re-key (D-10):** monolith uid is `` `${source}-${songid}` `` (`index.html:2008,2066,2132,2179` — note the **hyphen** `netease-123`). Canonical new uid is `` `${source}:${songid}` `` (colon). This is a deliberate format change — every adapter's `search()` must emit colon-form.

**`SourceAdapter` / `SourceId` / `SettledSourceResult` interfaces:** copy verbatim from RESEARCH.md
lines 222–256 and 303–308. No monolith analog — these are the new contract.

---

### `src/lib/sources/netease.ts` (source-adapter, search=CRUD / resolve=transform)

**Analog:** `searchNetease` (`index.html:1986–2038`), `fetchNeteaseDetails` (`index.html:2268–2308`).

**`.search` core pattern** (`index.html:1986–2038`) — note `pickQueryParam` extracts songid from
the audio URL's `?id=`, and **Netease returns `audioUrl` + `lrcUrl` directly at search time**:
```javascript
const url=`https://api.qijieya.cn/meting/?type=search&id=${encodeURIComponent(kw)}&limit=${...}&server=netease`;
function pickQueryParam(rawUrl, key){            // → port as a small helper; extracts ?id=
  try{ return new URL(rawUrl, window.location.href).searchParams.get(key) || ''; }
  catch(e){ const m=String(rawUrl).match(new RegExp('[?&]'+key+'=([^&]+)')); return m?decodeURIComponent(m[1]):''; }
}
const songId = pickQueryParam(it.url, 'id') || `${kw}-${idx+1}`;
const track={ source:'netease', songid:songId, title:it.name||'', artist:it.artist||'',
              cover:it.pic||null, audioUrl:it.url||null, lrcUrl:it.lrc||null, ... };
```
> **Port change:** drop `new URL(rawUrl, window.location.href)` — `window` does not exist server-side
> and the adapter is client-side anyway; pass a base or use the regex branch. `requestLimit = page*num`
> (pagination by limit-multiplication, not a real page param) — preserve.

**`.resolve` core pattern** (`index.html:2268–2308`) — builds `type=url`/`type=lrc` URLs only for
cached tracks, then **content-type sniffs** the LRC (json-wrapped vs plain text):
```javascript
if(track.songid){
  if(!track.audioUrl) track.audioUrl=`...&type=url&id=${enc(track.songid)}`;
  if(!track.lrcUrl)   track.lrcUrl  =`...&type=lrc&id=${enc(track.songid)}`;
}
const contentType=(lr.headers.get('content-type')||'').toLowerCase();
if(contentType.includes('json')){ const lj=await lr.json();
  track.lrc = (typeof lj==='string'?lj:null) || lj?.lrc || lj?.lyric || lj?.data?.lrc || lj?.data?.lyric || ...; }
else { track.lrc=await lr.text(); }
```
**Quality:** `inferQualityFromUrl(track.audioUrl)` (shared util). **Error handling:** search wraps
in try/catch and returns 0-added on failure (`console.error('netease...')`, 2036) — in the new
adapter, **throw** so `allSettled` records a typed per-source error instead of swallowing.

---

### `src/lib/sources/qq.ts` (source-adapter, search=CRUD / resolve=transform)

**Analog:** `searchQQ` (`index.html:2041–2120`), `fetchQQDetails` incl. `pickBestPlayUrl`
(`index.html:2311–2396`).

**`.search` — PRESERVE the dual-format guard (Pitfall 5)** (`index.html:2055`):
```javascript
// 兼容：既支持直接数组，也支持 { data: [...] } 包装  — PORT VERBATIM
const data = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
if (!Array.isArray(data) || data.length === 0) return 0;   // → throw 'contract-drift' in new adapter
```
Key by `song_mid`; capture `pay` AND store it in both `qqQualityText` and `pay`
(`index.html:2107–2108`). `qqSearchKey` and `qqIndex` (1-based) must be carried — detail needs both.

**`.resolve` — quality tier priority (`pickBestPlayUrl`, `index.html:2330–2345`)** sq > pq > accom >
hq > standard > fq > fallback:
```javascript
if (d.song_play_url_sq)       return {url:d.song_play_url_sq, tag:'lossless', label:'LOSSLESS', text:`SQ ${d.kbps_sq||''}`.trim()};
if (d.song_play_url_pq)       return {url:d.song_play_url_pq, tag:'lossless', label:'LOSSLESS', text:`PQ ${d.kbps_pq||''}`.trim()};
if (d.song_play_url_accom)    return {url:d.song_play_url_accom, tag:'hq', label:'HQ', ...};
if (d.song_play_url_hq)       return {url:d.song_play_url_hq, tag:'hq', label:'HQ', ...};
if (d.song_play_url_standard) return {url:d.song_play_url_standard, tag:'standard', label:'STD', ...};
if (d.song_play_url_fq)       return {url:d.song_play_url_fq, tag:'low', label:'LOW', ...};
if (d.song_play_url)          return {url:d.song_play_url, tag:null, label:null, text:null};
```
Detail URL needs `msg`(keyword) + `mid` (`index.html:2323–2327`); `msg` falls back to
`title+' '+artist` (2313–2315). Lyrics are **inline** (`d.song_lyric || d.lyric`, 2369).

**Error handling — DO NOT set `detailsLoaded` on failure** (`index.html:2392–2395`, allows retry):
```javascript
if (!d || typeof d !== 'object' || !d.song_mid) throw new Error('qq detail error (invalid response)');
// ... on catch: log, but leave detailsLoaded false so next play retries
```

---

### `src/lib/sources/kuwo.ts` (source-adapter, search=CRUD / resolve=transform)

**Analog:** `searchKuwo` (`index.html:2123–2163`), `fetchKuwoDetails` (`index.html:2398–2422`).

**`.search` response shape** (`index.html:2129`): `{code:200, data:[{rid,name,artist,album,pic}]}`;
uid = `` `kuwo:${it.rid}` `` (colon, D-10); `songid = it.rid`.

**`.resolve` core pattern** (`index.html:2398–2422`) — `level=zp` lossless, inline `lyric`,
**throws on `code!==200`** (the one detail fetcher that already throws — good model):
```javascript
const api=`https://kw-api.cenguigui.cn/?id=${enc(track.songid)}&type=song&level=zp&format=json`;
const j=await res.json();
if(!j || j.code!==200 || !j.data) throw new Error('kuwo kw-api detail failed');
const d=j.data;
Object.assign(track,{ title:d.name||..., artist:d.artist||..., album:d.album||...,
  cover:d.pic||..., audioUrl:d.url||..., lrc:d.lyric||track.lrc||null, lrcUrl:null, detailsLoaded:true });
// quality via inferQualityFromUrl(track.audioUrl)  (.flac → LOSSLESS else 320K)
```

---

### `src/lib/sources/joox.ts` (source-adapter, search=CRUD / resolve=transform+probe) — THE IDENTITY FIX

**Analog:** `searchJoox` (`index.html:2169–2212`), `fetchJooxDetails` incl. `probeJooxAudioUrl` +
`pickJooxPlayUrl` (`index.html:2424–2504`).

**`.search`** (`index.html:2169–2212`) — Chinese field names; **lrc inline at search** (`歌词内容`);
uid = `` `joox:${songMid || 歌曲ID}` `` (colon, D-10):
```javascript
const songMid=it.songmid || '';
const songId=it['歌曲ID'] || songMid || (idx+1);
const uid=`joox-${songMid || songId}`;   // → colon form: `joox:${songMid||songId}`
const track={ source:'joox', jooxIndex:idx+1, songid:songId, songMid:songMid,
  title:it['歌曲名称']||'', artist:it['歌手']||'', album:it['专辑']||'', lrc:it['歌词内容']||null, ... };
```

**`.resolve` — POSITION-INDEX TRAP (Pitfall 4 / success criterion #4).** Monolith blindly trusts
`n=jooxIndex` (`index.html:2425–2426`) and never re-validates:
```javascript
const n=track.jooxIndex || track.displayIndex || 1;          // ← THE TRAP: blind position index
const url=`https://apicx.asia/api/joox_music?msg=${enc(track.keyword)}&n=${enc(n)}&token=${...}&br=${...}`;
```
> **REQUIRED FIX (do NOT port verbatim):** the upstream API still requires `n=`, so keep sending it,
> **but after the detail returns, re-validate** `d.songmid` (and/or `d['歌曲ID']`/`d['歌曲名称']`)
> against the track's captured `songMid`/`songid`/`title`. On mismatch, **fail loudly** (throw) rather
> than play the wrong song. Never re-derive `jooxIndex` from a fresh search before resolving.
> (See RESEARCH Pitfall 4, lines 398–403; Open Question #2 — probe whether `mid` works for detail; prefer it if so.)

**`probeJooxAudioUrl` — port verbatim, but modernize the timeout** (`index.html:2434–2464`):
```javascript
async function request(method, extraOptions){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),3000);          // → AbortSignal.timeout(3000)
  try{ const res=await fetch(u,Object.assign({method,cache:'no-store',redirect:'follow',signal:controller.signal},extraOptions||{}));
       return res && (res.ok || res.status===206 || (res.status>=200 && res.status<400)); }
  finally{ clearTimeout(timer); }
}
try{ if(await request('HEAD')) return true; }catch(e){}          // HEAD first
try{ return await request('GET',{headers:{Range:'bytes=0-0'}}); }catch(e){ return false; }   // ranged GET fallback
```
> **Spike caveat (RESEARCH 436–449):** the probe result depends on WHO runs it (browser IP vs edge IP).
> Recommendation: probe **browser-side** in the resolved adapter so it sees the same IP/region that
> will play the audio — do NOT probe in the server ProxyAdapter.

**`pickJooxPlayUrl` quality order — port verbatim** (`index.html:2466–2479`):
```javascript
const order=['Atmos全景声','无损FLAC','Hi-Res无损','母带无损','OGG 320','MP3 320','AAC 192','OGG 192','MP3 128','AAC 96','AAC 48'];
// 母带|无损|flac|hi-res|atmos → lossless/LOSSLESS ; trailing digits → `${n}k`/`${n}K`
```

---

### `src/lib/services/catalog.ts` (service, fan-out aggregator) — `Promise.all` → `allSettled`

**Analog:** `searchAllSources` (`index.html:2216–2263`), `ensureTrackDetails` (2506–2513),
`getInterleavedSearchList` (1691–1707), `trackMap` dedup (1657 + per-source `state.trackMap.has(uid)`).

**Fan-out — the ONE intentional behavior change (DATA-03).** Monolith uses `Promise.all` over a
hard-coded `if(s==='netease')...` ladder (`index.html:2235–2245`):
```javascript
for(const s of enabled){                       // ← string-matched ladder; replace with getEnabledAdapters()
  if(s==='netease')tasks.push(searchNetease(...));
  if(s==='qq')tasks.push(searchQQ(...));  ...
}
const res=await Promise.all(tasks);            // ← REPLACE with Promise.allSettled (DATA-03)
```
Port to RESEARCH Pattern 3 (`catalog.searchAll`, RESEARCH 310–324): iterate `getEnabledAdapters()`,
`Promise.allSettled`, partition into `SettledSourceResult[]`. **Drop all DOM/render calls**
(`dom.searchStatus`, `renderMiniSearchList`, `playFromList` — those are Phase 4).

**Dedup — `trackMap` keyed by uid** (`index.html:1657` + `state.trackMap.has(uid)` guards). New:
dedup the flattened `allSettled` tracks via a `Map<uid,Track>` keyed by `` `${source}:${songid}` ``.

**Interleave — port `getInterleavedSearchList`** (`index.html:1691–1707`) round-robin
netease→qq→kuwo→joox by `displayIndex`; **generalize the hard-coded `order` array to iterate the
registry order** (so a new source needs no edit here — DATA-04):
```javascript
const grouped={netease:[],qq:[],kuwo:[],joox:[]};   // → group by SourceId from registry
const order=['netease','qq','kuwo','joox'];          // → Object.keys(SOURCES)
// while(added) round-robin pull arr[idx[s]++]
```

**`ensureTrackDetails` — switch → registry** (`index.html:2506–2513`):
```javascript
if(track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) return;   // ← keep this guard
if(track.source==='netease') await fetchNeteaseDetails(track);                       // ← switch ladder
else if(track.source==='kuwo') await fetchKuwoDetails(track);  ...                   //   → SOURCES[track.source].resolve(track, signal)
```
Note the readiness guard (2507) checks `audioUrl` AND `(lrc || !lrcUrl)` — preserve that exact
condition so Netease (which has a separate `lrcUrl`) still re-resolves lyrics.

---

### `src/lib/services/lrc.ts` (utility, pure transform) — PORT VERBATIM

**Analog:** `parseLRC` (`index.html:2517–2533`), `inferQualityFromUrl` (`index.html:1747–1758`).

**`parseLRC` — port verbatim** (`index.html:2517–2533`), just add types `(txt: string): {time:number;text:string}[]`:
```javascript
const reg=/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/;
const min=parseInt(m[1],10)||0; const sec=parseInt(m[2],10)||0;
const ms=m[3]?parseInt(m[3].padEnd(3,'0'),10):0;
const time=min*60+sec+ms/1000;
const text=line.replace(reg,'').trim();
if(text)out.push({time,text});
out.sort((a,b)=>a.time-b.time);
```

**`inferQualityFromUrl` — port verbatim** (`index.html:1747–1758`):
```javascript
const losslessExts = ['flac','wav','ape','alac','aiff'];
if (losslessExts.includes(ext)) return {tag:'lossless', label:'LOSSLESS'};
return {tag:'320k', label:'320K'};   // everything else
```
> Leave the legacy `neteaseQualityToTag`/`kuwoQualityToTag` (1731–1744) behind — they're marked
> "暂时保留不再使用" (kept but unused) in the monolith; do not port.

---

### Proxy adapters — `src/lib/proxy/{netease,qq,kuwo,joox}.ts` (proxy-adapter, request-response)

**Analog:** the URL-building lines inside each search/detail fn. The ProxyAdapter's only job (D-09
passthrough) is `buildUrl(path, searchParams, env)` → the real upstream URL; the client adapter does
the normalization. Per-source upstream URLs (verbatim from `index.html`):

| Proxy file | search URL | detail URL | Source line |
|------------|-----------|-----------|-------------|
| `netease.ts` | `api.qijieya.cn/meting/?type=search&id={kw}&limit={n}&server=netease` | `...&type=url&id={songid}` / `...&type=lrc&id={songid}` | 1988 / 2271 / 2274 |
| `qq.ts` | `tang.api.s01s.cn/music_open_api.php?msg={kw}&type=json` | `...&type=json&mid={song_mid}` | 2043–2046 / 2323–2327 |
| `kuwo.ts` | `kw-api.cenguigui.cn/?name={kw}&page=1&limit={n}` | `kw-api.cenguigui.cn/?id={rid}&type=song&level=zp&format=json` | 2124 / 2399 |
| `joox.ts` | `apicx.asia/api/joox_music?msg={kw}&token={JOOX_TOKEN}&br={JOOX_BR}` | `...&msg={kw}&n={jooxIndex}&token={JOOX_TOKEN}&br={JOOX_BR}` | 2170 / 2426 |

**`joox.ts` is the ONLY proxy that touches `env`** — relocate the secret (success criterion #2).
Monolith hardcodes it (`index.html:2165–2166`):
```javascript
const JOOX_TOKEN = 'f84ao9lMF_q7husBWRfgUw';   // → platform.env.JOOX_TOKEN (server-only)
const JOOX_BR = 4;                              // → non-secret env var or const in proxy/joox.ts
```
The token must be **injected into the upstream URL on the edge** and never appear in any `/api/*`
request the browser makes (RESEARCH Pattern 2, lines 269–295). `JOOX_BR=4` is non-secret tuning —
keep it server-side too.

---

### `src/lib/proxy/proxy-registry.ts` + `proxy-types.ts` (config + model)

**Analog:** mirrors `registry.ts` (the source registry). `ProxyAdapter`/`Env` interfaces: copy from
RESEARCH Pattern 2 (no monolith analog). `PROXIES: Record<SourceId, ProxyAdapter>` mirrors `SOURCES`
by id — adding a source means one line in each registry (DATA-04 acceptance test).

---

### `src/routes/api/[source]/[...path]/+server.ts` (route, request-response) — NO MONOLITH ANALOG

**Analog:** RESEARCH Pattern 2 (lines 269–295) — there is no proxy in the monolith (the browser
called upstreams directly). Copy the verified pattern verbatim:
```typescript
export const GET: RequestHandler = async ({ params, url, platform, request }) => {
  const proxy = PROXIES[params.source as keyof typeof PROXIES];
  if (!proxy) return new Response('unknown source', { status: 404 });   // validate source (V5)
  const env = platform?.env;                                            // { JOOX_TOKEN }  — verified path
  const upstream = proxy.buildUrl(params.path, url.searchParams, env);  // joox injects token here
  const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
  return new Response(res.body, {                                       // D-09 passthrough: body unchanged
    status: res.status,
    headers: { ...corsHeaders(request.headers.get('origin')), 'content-type': res.headers.get('content-type') ?? 'application/json' }
  });
};
```
> CORS scoped to own origin (never `ACAO: *` — Anti-Patterns 341 / Security 631). Validate
> `params.source` against the registry → 404 unknown (V5).

---

### `src/lib/proxy/http.ts` (utility, network helper) — PARTIAL ANALOG

**Analog:** the only timeout/abort precedent is `probeJooxAudioUrl`'s `AbortController`+`setTimeout`
(`index.html:2438–2450`) — but RESEARCH says **don't hand-roll it**: use `AbortSignal.timeout(ms)`
(RESEARCH "Don't Hand-Roll" line 351). Build `fetchWithRetry(url, init, retries)` with bounded retry
on 429/5xx (RESEARCH Pattern 2 line 287) + a `corsHeaders(origin)` helper scoped to own origin.

---

### `src/routes/spike/+page.svelte` (test harness) — PARTIAL ANALOG

**Analog:** the probe logic from `probeJooxAudioUrl` (`index.html:2434–2464`) generalized to all four
sources, driven by the spike spec (RESEARCH "THE EGRESS SPIKE", lines 466–507). Per source: search →
resolve top result's `audioUrl` via `/api/*` → run the 3 measurements (browser-direct `<audio>` play
with `referrerpolicy=no-referrer`; ranged `fetch` CORS probe; `206`/Range support). Output the
decision matrix. This is a deployed manual harness (cannot be automated headlessly).

---

### `src/app.d.ts` (config, types) — NO MONOLITH ANALOG

**Analog:** RESEARCH `app.d.ts` example (lines 453–463). `App.Platform.env: { JOOX_TOKEN: string }`.

---

## Shared Patterns

### Track identity / dedup (D-10) — `source:songid`
**Source:** `trackMap` (`index.html:1657`) + uid construction in every search fn
(`index.html:2008,2066,2132,2179`).
**Apply to:** all 4 client adapters (emit colon-form uid) + `catalog.ts` dedup Map.
```javascript
// monolith (hyphen):  uid = `netease-${songId}` / `qq-${mid}` / `kuwo-${it.rid}` / `joox-${songMid||songId}`
// canonical (colon):  uid = `${source}:${songid}`   ← D-10; stable across reorder/paginate
```
JOOX/QQ extras (`jooxIndex`, `qqIndex`, `displayIndex`) are for **ordering only — never identity**
(Pitfall 4). `displayIndex` feeds interleave; the stable uid feeds detail resolution.

### Quality resolution — `inferQualityFromUrl`
**Source:** `index.html:1747–1758`.
**Apply to:** netease/kuwo/qq/joox `.resolve` after `audioUrl` is set (each calls it as the fallback
when the source didn't provide an explicit tier label). Lives in `lrc.ts` (or a `quality.ts` util).

### Error handling — per-source isolation
**Source:** monolith pattern: search fns try/catch + `console.error` + return 0
(`index.html:2036,2115–2117,2159–2161,2208–2210`); detail fns vary (kuwo/joox throw 2402/2429;
qq deliberately does NOT set `detailsLoaded` on failure 2392–2395).
**Apply to:** all adapters. **Change for the new layer:** adapters should **throw** on
failure/contract-drift so `catalog.searchAll`'s `Promise.allSettled` records a typed
`SettledSourceResult{status:'error', error}` (DATA-03) — replacing the monolith's swallow-and-return-0.
Preserve QQ's "no `detailsLoaded` on failure → retry next play" semantics in `qq.ts .resolve`.

### Referrer suppression (carry-over for Phase 2 audio)
**Source:** `<meta name="referrer" content="no-referrer">` (`index.html:6`) — suppresses `Referer`
so referer-gated CDNs don't 403.
**Apply to:** Phase 1 spike harness uses `referrerpolicy="no-referrer"` on the `<audio>` element
(RESEARCH 387). Not a Phase-1 data-layer file, but the spike depends on it.

---

## No Analog Found

Net-new framework files — the planner should follow RESEARCH.md patterns, not the monolith:

| File | Role | Data Flow | Reason / Pattern Source |
|------|------|-----------|--------------------------|
| `src/lib/sources/types.ts` (interfaces only) | model | n/a | `SourceAdapter`/`SettledSourceResult` are new contracts (RESEARCH 222–256, 303–308); only the `Track` *fields* have a monolith analog |
| `src/lib/proxy/proxy-types.ts` | model | n/a | `ProxyAdapter`/`Env` are new — RESEARCH Pattern 2 |
| `src/routes/api/[source]/[...path]/+server.ts` | route | request-response | No proxy existed (browser called upstreams direct); RESEARCH Pattern 2 lines 269–295 |
| `src/app.d.ts` | config | n/a | `platform.env` typing — RESEARCH lines 453–463 |
| `src/lib/proxy/http.ts` | utility | request-response | Retry/CORS helper is new; `AbortSignal.timeout` per RESEARCH 351 (only the abort-on-timeout *idea* has a monolith precedent at 2438) |

---

## Metadata

**Analog search scope:** `index.html` (single-file monolith, 3320 lines) — the only existing code.
Lines read: 1648–1778 (state/trackMap/interleave/quality/serialize), 1986–2265 (4 searches +
`searchAllSources`), 2266–2535 (4 detail fetchers + `ensureTrackDetails` + `parseLRC`). Plus
`.planning/codebase/INTEGRATIONS.md` (per-source contracts) and `.planning/codebase/ARCHITECTURE.md`
(REUSE/REPLACE inventory).
**Files scanned:** 1 source file + 4 planning docs.
**Pattern extraction date:** 2026-06-05
