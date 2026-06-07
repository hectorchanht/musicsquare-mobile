---
quick_id: 260607-ixw
slug: add-jamendo-western-cc-indie-as-6th-song
date: 2026-06-07
status: complete
commits:
  - 533d989  # Jamendo source + edge proxy + registry + wrangler var
---

# Quick Task 260607-ixw — Jamendo (Western CC-indie) as 6th source

User shipped Jamendo credentials this task. Ships `enabledByDefault: false`; users opt in via
the Settings → Playback "Advanced — Sources" accordion (ii6).

## Implementation
- **types.ts**: widen `SourceId` to include `'jamendo'`.
- **sources/jamendo.ts**: `SourceAdapter` with `search` + `resolve`. Jamendo's search response
  already carries the direct mp3 URL in `audio`, so `resolve()` is normally a no-op — it just
  stamps `detailsLoaded` + the quality tag inferred from the URL extension.
- **routes/api/jamendo/search/+server.ts**: edge proxy →
  `https://api.jamendo.com/v3.0/tracks/?client_id=…&search=…&audioformat=mp32&limit=N&offset=M`.
  Own-origin `corsHeaders`, `AbortSignal.timeout`, `fetchWithRetry`. `limit ∈ [1,50]`,
  `offset ∈ [0,10000]`.
- **proxy-types.ts**: `Env` adds OPTIONAL `JAMENDO_CLIENT_ID`. Absent → proxy returns
  `{ headers: { code: 0 }, results: [] }` (graceful; mirrors LASTFM_KEY absent-state).
- **wrangler.jsonc**: `vars.JAMENDO_CLIENT_ID: '1df0a42f'`. The Jamendo client_id is **public
  by design** (sent on every API URL; identical posture to a Last.fm `api_key`). Public ids
  belong in `vars`; **private secrets stay out — use `wrangler pages secret put …`**.
- **Jamendo client_secret**: **NOT** carried in this repo. It is only needed for OAuth
  flows (user-authorization to favourite-on-jamendo / upload) we don't implement. Documented
  in adapter + proxy + Env JSDoc.
- **registry.ts + .test.ts**: enumerate jamendo; `EXPECTED_KEYS` bumped to 6.
- **services/dedupe.ts**: `SOURCE_RANK.jamendo = -1` (below fivesing's 0) — defense in depth
  so a Jamendo entry NEVER wins a tie against a mainstream source on the rare normalization
  collision. By design a Jamendo "X" is a DIFFERENT recording from a Netease "X", so dedupe
  shouldn't collapse them anyway.
- **app.css**: `--src-jamendo: #ff7700` for the source pill.

## Verification (live preview)
- Direct proxy: `/api/jamendo/search?search=guitar&limit=3` → 200, `headers.code=0`, 3
  results, first track has `audio` + `image` populated.
- Adapter via `searchAll('guitar', 1, { jamendo: true })` → **20 tracks**, first
  `uid='jamendo:1270090'`, `audioUrl='https://prod-1.storage.jamendo.com/?trackid=1270090…'`
  (real progressive mp3 — plays in HTML5 `<audio>`, no MSE).
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.

## "What else music source can we add?"

Recap of hvu's source research, refreshed against today's state (5sing shipped in hvu,
Jamendo just shipped here). 6 sources total now: netease, qq, kuwo, joox, fivesing, jamendo.

### Already shipped
- **netease, qq, kuwo, joox** — CN mainstream, on by default.
- **fivesing** (Kugou UGC) — covers / 伴奏 / 原创. opt-in.
- **jamendo** — Western CC-indie. opt-in.

### Realistic remaining candidates (in priority order)

1. **Deezer — METADATA only** (already partially used for cover art at `/api/deezer/search`
   since wv8). Could be extended for full metadata search + recommendations. **Audio is
   blocked** (`arl` premium cookie required); we'd only ship the discovery/metadata side. Low
   LoC since the proxy already exists. **Caveat**: dedupe-heavy with Last.fm (we already use
   Last.fm for charts/tags).

2. **SoundCloud** — Western UGC + indie. Public API needs a client_id (free tier deprecated;
   need a Pro account to register a new one) and HLS-only for newer uploads. **Risk**: HLS
   = MSE, breaks our no-MSE constraint. **Score**: blocked unless we're willing to
   write/embed a tiny HLS shim (hls.js, +28KB).

3. **Migu** (China Mobile) — researcher probed it; **search works edge, audio is geo-
   blocked** (returns `"暂不提供试听地址"` from non-CN IPs). Would ship a source that searches
   but never plays. **Skip** until a CN-region Worker is in scope.

4. **Kugou** (mainstream, not 5sing) — researcher probed; **search returns `total:0` from
   non-CN edges** due to geo-bias. Same blocker as Migu. **Skip**.

5. **Bilibili** — ACG / Japanese soundtracks / UGC remixes. `playurl` returns **DASH
   manifests** (MSE required). **Skip** under the no-MSE constraint.

6. **JioSaavn** — Indian + global. Metadata edge-reachable; **audio is DES-encrypted
   client-side** and the public decryption proxy (saavn.dev) no longer resolves DNS. **Skip**
   unless we implement DES-ECB (200+ LoC of crypto).

7. **YouTube Music** — still **deferred to v2** per STATE.md blockers (instance failover,
   `s`-checksum drift, 50 req/5 min cap). Needs its own feasibility spike.

8. **FMA** (Free Music Archive) — defunct in 2018, revived; stability concern.

9. **Apple Music / Spotify / Tidal / Qobuz** — DRM, native SDKs, no streaming use.

### Realistic shippable next picks

- **Deezer metadata** (cheap follow-on; would help dedupe + cover backfill more aggressively).
  Estimated effort: ~100 LoC reusing the existing proxy.
- **SoundCloud** (if MSE budget were unlocked) — biggest catalog gain of the remaining
  options.

Everything else is either DRM-locked, geo-blocked from non-CN edges, behind crypto, or
stability-suspect. Recommend: focus on app polish + the existing 6 sources rather than
add more for-its-own-sake.

## Notes / follow-ups
- The Jamendo client_secret pasted by the user is intentionally **NOT** in this repo (would
  be a leak even though it doesn't unlock anything we use). Discarded.
- A future task could add OAuth (favourite-on-jamendo / per-user feeds) — that's when the
  secret would matter. Today we only consume the public catalog search.
