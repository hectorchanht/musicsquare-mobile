---
quick_id: 260607-jau
slug: soundcloud-source-if-shippable-deezer-me
date: 2026-06-07
status: complete
commits:
  - 141d21d
---

# Quick Task 260607-jau — Deezer metadata extension (SoundCloud skipped per AskUserQuestion)

User asked for SoundCloud + Deezer metadata. Surfaced SC's two hard blockers via
AskUserQuestion:
- Most newer SC uploads are HLS-only → can't play in `<audio>` + no-MSE.
- SC free-tier `client_id` registration is closed (need Pro account).

User locked: **Skip SC**; ship Deezer-metadata only. When/if user registers a real SC app
client_id later, progressive-only is still the audio constraint but at least auth becomes
sustainable.

## Deezer metadata extension (one commit, `141d21d`)

### 1. `/api/deezer/search` extended
- New `?limit` param (clamped `[1,25]`). `limit=1` (default) stays byte-compat with
  existing cover/backfill callers — only `{ cover, artistPicture }` returned.
- `limit>1` additionally populates `results: DeezerHit[]`, each carrying
  `{ id, title, artist, album, cover, preview }`.
- 30-second previews validated via new `safePreviewUrl` (https + `*.dzcdn.net` only,
  matches `safeImageUrl` posture).
- Cache (24h) preserves `results` on hits; no changes to existing cache key shape.

### 2. New `/api/deezer/related` route
- Two upstream calls: `search/artist?q=<name>&limit=1` → first hit's id →
  `artist/{id}/related?limit=N` → top-N names.
- Output `{ artists: string[] }` — exact same shape as `/api/similar`, so the client
  plugs into the existing fan-out without rewriting.
- Own-origin CORS, OPTIONS 204, 24h edge cache, no secret. Never throws.

### 3. `services/deezer.ts` client helpers
- `deezerSearchTopN(term, limit, signal): DeezerHit[]` — for dedupe + metadata uses.
- `deezerRelatedArtists(artist, limit, signal): string[]` — related-artist names.
- Both use the existing `combinedSignal` + `FETCH_TIMEOUT_MS = 6000` discipline.
- Both never throw.

### 4. `services/similar.ts` fallback chain
- Last.fm `/api/similar` stays primary.
- On empty (no `LASTFM_KEY`, Last.fm dry, errored), the chain now falls through to
  `deezerRelatedArtists` **before** the existing same-artist fallback.
- Net effect: a deployment WITHOUT `LASTFM_KEY` now gets real recommendations from Deezer
  instead of only same-artist results.

## Verification (live preview)
- `/api/deezer/search?q=stargazing` → `{ cover, artistPicture }`, **no `results` key**
  (backcompat ✓).
- `/api/deezer/search?q=stargazing&limit=5` → **5 hits**; first = Kygo "Stargazing" with
  cover + 30s preview populated.
- `/api/deezer/related?artist=Daft%20Punk&limit=5` → `[Justice, Cassius, Etienne de
  Crécy, Mr. Oizo, Yuksek]`.
- `getSimilarArtists('Daft Punk')` → 8 artists (Last.fm primary; Deezer fallback ready
  for the no-key state).
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.

## Notes / follow-ups
- The `DeezerHit` shape is exposed but no UI consumes it yet — building blocks ready for
  a future task to add a Deezer-driven "More like this" shelf or to use Deezer hits as a
  dedupe signal across CN sources.
- SoundCloud remains formally available to ship later. If a real client_id is registered,
  the progressive-only filter + a `/api/soundcloud/search` proxy would mirror the Jamendo
  pattern. ~200 LoC.
