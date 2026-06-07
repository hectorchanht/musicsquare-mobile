---
quick_id: 260607-hvu
slug: album-actions-wiring-verify-cross-source
date: 2026-06-07
status: complete
commits:
  - 9975ce2  # Part A + B: album-actions fixes + fallback verification
  - 9311228  # Part C: 5sing (Kugou UGC) as the 5th song source
---

# Quick Task 260607-hvu — Album-actions + fallback verify + 5sing

Decisions locked via CONTEXT.md / AskUserQuestion:
- **Like-all**: idempotent (like missing ones; if all already liked → unlike all).
- **Sources to add**: researcher recommended **5sing only**; Jamendo deferred (needs free
  API-key registration). Ship `enabledByDefault: false`.

## Part A — Album action bar (album/[name]/+page.svelte)
Three corrections — buttons WERE wired but felt "not functional":

1. **Download now saves real files to disk** (was only adding to library Downloads tab).
   Mirrors the per-track TrackMenu doDownload path: re-resolve at downloadQuality →
   fetch → blob → anchor.click() → revokeObjectURL — for EVERY track. Track is also
   added to the library Downloads list as before. Saves are staggered 250ms apart so
   the browser doesn't squash simultaneous saves at the per-origin download cap. On a
   track-level fetch failure (CORS / expired URL) we skip the file save but keep the
   library reference (re-streamable). Final toast = count of saved files.

2. **Like-all is now idempotent + toggle-when-full**: any unliked → like the missing
   ones (today). EVERY track already liked → unlike them all (undo affordance).

3. **Visible feedback during the ~10s resolveAll fan-out**: like + add-to-playlist
   now flash the existing "preparing..." toast immediately on click (download already
   did). Without this, the actions appeared inert for 8-10s while `resolveStub` fanned
   out concurrent-capped at 4.

## Part B — Cross-source fallback (SRC-FB-01 from gte) — verified up
Walked the wiring:
- `<audio> 'error'` event → `runFallback(failed)` ([player.svelte.ts:175-188](src/lib/stores/player.svelte.ts:175))
- `play()` no-audioUrl branch → `runFallback(resolved)` ([player.svelte.ts:417-426](src/lib/stores/player.svelte.ts:417))
- `runFallback` → `tryFallback` (services/fallback.ts) → `searchAll → dedupeBest →
  ensureTrackDetails` over remaining enabled sources, preferred-source first.
- Generation guard (`playGen`) + `AbortController` watchdog still aborts stale retries
  when a newer `play()` supersedes.

Ran a live trace: played a track, synthesized an `<audio>` `error` event, observed
`runFallback` set `loading=true`, clear `player.error`, run ~2s, and a fresh netease
audio URL (`api.qijieya.cn/meting/?server=netease&type=url&id=21`) took over in
`audio.src` — title unchanged. **No code change needed.**

## Part C — 5sing (Kugou UGC) as the 5th song source
Researcher (musicsquare + musicdl + edge probes 2026-06-07) recommended 5sing as the
only candidate hitting all four hard constraints (edge-reachable, direct progressive
mp3, no signed-state auth, fits in one quick task) AND filling a real catalog gap
(amateur covers / karaoke instrumentals / original UGC — content the 4 mainstream CN
sources structurally lack).

Implementation (~250 LoC across 5 files):
- **types.ts**: widen `SourceId` to include `'fivesing'`; add `fivesingSongType?:
  'fc' | 'bz' | 'yc'` to Track extras (identity-critical).
- **sources/fivesing.ts**: `SourceAdapter` with `search` + `resolve`. Strips
  `<em class="keyword">…</em>` HTML. `inferQualityFromUrl` for the quality tag.
  Defensive recovery in `resolve()`: if a saved-library track is missing
  `fivesingSongType` (older serializations), peel the type off the songid prefix.
  `enabledByDefault: false`.
- **routes/api/fivesing/search/+server.ts**: edge proxy → `http://search.5sing.kugou.com/home/json`
  (http not https — upstream cert mismatched, verified via curl). own-origin
  `corsHeaders` + `AbortSignal.timeout` + `fetchWithRetry` + OPTIONS 204. Pagination
  clamped to [1, 50].
- **routes/api/fivesing/url/+server.ts**: edge proxy → `http://mobileapi.5sing.kugou.com/song/getSongUrl`.
  songtype validated at the edge (`ALLOWED_TYPES` Set) so a hostile querystring can't
  reach upstream.
- **sources/registry.ts** + test: enumerate fivesing.
- **proxy/proxy-registry.ts**: `PROXIES` becomes `Partial<Record<SourceId,…>>` because
  fivesing uses DEDICATED routes, not the legacy `/api/[source]/[...path]` catch-all.
  Catch-all 404s an absent id (defense in depth).
- **services/dedupe.ts**: `SOURCE_RANK.fivesing = 0` — UGC must NEVER win a tie
  against a mainstream source.
- **app.css**: `--src-fivesing: #ff5959` for the source pill.

Two identity-critical pitfalls handled:
1. `songId` is NOT unique across `fc/bz/yc` — the same numeric id maps to DIFFERENT
   tracks per type. So uid folds songtype: `fivesing:<type>-<id>`.
2. Audio URLs carry a ~1-2h timestamp segment. `resolve()` is called lazily before
   each play; the cross-source fallback handles expiry the same way it handles
   region-blocks (Part B above).

### Verification (live preview)
- `/api/fivesing/search?keyword=稻香&pagesize=5` → 10 results matching curl probe
  (songId 15504842, typeEname fc, songName "稻香").
- `/api/fivesing/url?songid=15504842&songtype=fc` → code 1000, real mp3 URL
  `https://wsaudiobssdlbig.kugou.com/.../bss/extname/wsaudio/...` (HQ + LQ tiers).
- Adapter end-to-end via `searchAll('稻香', 1, { fivesing: true })`:
  10 tracks, first: `uid: 'fivesing:fc-15504842'`, `songid: 'fc-15504842'` (prefix
  folded ✓), `title: '稻香'` (`<em>` stripped ✓), `artist: '兔裹煎蛋卷'`, `album: '翻唱'`
  (typeName as label ✓), `fivesingSongType: 'fc'`, `detailsLoaded: false` (lazy ✓).
- `check 0/0`, `pnpm test` 414/414, `pnpm build` OK.

### Notes / follow-ups
- 5sing is **opt-in** — to surface it in the search fan-out the user enables it via
  the existing per-source prefs plumbing. A dedicated **Settings → Sources** toggle UI
  is a follow-on task (`getEnabledAdapters({ fivesing: true })` already does the work;
  just needs a `settings.enabledSources` field + UI).
- **Jamendo** (CC indie, ~150 LoC, requires free API-key registration) is the next
  obvious follow-on if a Western indie catalog is wanted; researcher noted it solves
  a different problem (discovery of free indie tracks, not "user searched X and got
  more results") so it's a follow-on, not a same-task add.
- The upstream uses http (TLS cert mismatched). Cloudflare Workers allow outbound http
  fine; clients still see own-origin https. No mixed-content surface.
