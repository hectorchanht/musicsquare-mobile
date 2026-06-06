---
phase: 08-last-fm-read-foundation-metadata-enrichment
plan: 01
subsystem: lastfm-enrichment
tags: [lastfm, enrichment, edge-proxy, now-playing, match-key, i18n]
requires:
  - "src/routes/api/similar/+server.ts (edge-proxy template)"
  - "src/lib/proxy/http.ts (fetchWithRetry, corsHeaders)"
  - "src/lib/proxy/proxy-types.ts (Env.LASTFM_KEY — already declared)"
  - "src/lib/services/dedupe.ts (norm() chain mirrored)"
provides:
  - "/api/lastfm/info edge read proxy (track/artist/album.getInfo, key edge-only, absent-key 200 clean-empty, placeholder-filtered)"
  - "matchKey(artist, title) reusable {artist}+{title} normalization primitive (Phase 13 reuses)"
  - "Track optional enrich fields (tags?, bio?, bioUrl?, lastfmArt?)"
  - "services/lastfm.ts client enrichment service (enrichTrack/enrichArtist/enrichAlbum, never throws)"
  - "TagChips.svelte display-only chip row (Phase-9-ready tappable)"
  - "NowPlaying tag chips + preloaded hi-res cover swap"
  - "Phase-8 i18n keys in en/zh-Hant/zh-Hans (consumed by Plans 02/03)"
affects:
  - "src/lib/sources/types.ts (Track interface — additive optional fields)"
  - "src/lib/components/NowPlaying.svelte (enrich $effect + cover swap + TagChips)"
  - "src/lib/i18n/{en,zh-Hant,zh-Hans}.ts (5 new keys)"
tech-stack:
  added: []
  patterns:
    - "Edge secret confinement mirroring /api/similar (platform?.env, absent-key 200, scoped CORS, fetchWithRetry+AbortSignal.timeout, no-leak)"
    - "Pure node-testable logic module (match-key.ts — no runes/$app, like dedupe.ts/history-logic.ts)"
    - "Additive async enrichment OFF the playback critical path (void-fired, never awaited, never throws)"
    - "Preload-before-swap cover guard (new Image().onload) — no flash, never regress a real cover"
key-files:
  created:
    - "src/routes/api/lastfm/info/+server.ts"
    - "src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts"
    - "src/lib/services/match-key.ts"
    - "src/lib/services/match-key.test.ts"
    - "src/lib/services/lastfm.ts"
    - "src/lib/services/lastfm.test.ts"
    - "src/lib/components/TagChips.svelte"
  modified:
    - "src/lib/sources/types.ts"
    - "src/lib/components/NowPlaying.svelte"
    - "src/lib/i18n/en.ts"
    - "src/lib/i18n/zh-Hant.ts"
    - "src/lib/i18n/zh-Hans.ts"
decisions:
  - "Decision fork 1 → DEDICATED /api/lastfm/info route (Candidate B): mirrors /api/similar exactly, absent-key-200 for free, avoids widening SourceId (which would break SOURCES Record<SourceId> until Phase 10)."
  - "Decision fork 2 → OPTIONAL fields on Track (not a side cache): no serializeTrack whitelist on the library path; enrich fields persist JSON-safe with no migration; deliberately NOT added to HistoryEntry/toEntry (re-enrich on replay)."
  - "matchKey is artist-first (normalize(artist)|normalize(title)) per Pitfall 9; dedupe.ts keeps its legacy title|artist order and is left UNTOUCHED — no delegation (orders differ on purpose)."
  - "Cover art candidate sourced ONLY from album.getInfo (D-04 guardrail 1, most reliable); swap decision (strictly-larger ≥300px + preload) lives in the NowPlaying consumer, not the service."
metrics:
  duration_min: 7
  tasks_completed: 3
  files_created: 7
  files_modified: 5
  tests_total: 112
  completed: 2026-06-06
---

# Phase 8 Plan 01: Last.fm Read Foundation & First Enrichment Slice Summary

Edge `/api/lastfm/info` read proxy (LASTFM_KEY edge-only, absent-key graceful) + the reusable `matchKey` primitive + optional `Track` enrich fields + a never-throwing client `services/lastfm.ts` + now-playing top-tag chips and a preloaded higher-res album-cover swap — one thin end-to-end slice delivered with zero new dependencies.

## What Was Built

- **Edge read proxy (`/api/lastfm/info`, ENRICH-03):** A dedicated SvelteKit route mirroring `/api/similar`. Reads `platform?.env.LASTFM_KEY`; absent key returns a 200 all-empty clean shape with NO upstream fetch. `method` is restricted to an allow-list (`track.getinfo`/`artist.getinfo`/`album.getinfo`); anything else returns the empty shape with no fetch. Client params are `encodeURIComponent`'d passthrough; the key is injected on the edge into the upstream URL, never logged, never in the response body/headers. `fetchWithRetry` + `AbortSignal.timeout(8000)`. Reshapes to `{ tags, bio, bioUrl, image, listeners, playcount }`: top-5 tags, HTML-stripped first-sentences bio with the `<a href>` attribution URL, and a `pickImage()` that walks the `image[]` array for the largest non-empty `#text` while discarding the grey-star hash `2a96cbd8b46e442fc41c2b86b821562f`. Last.fm `error`/malformed JSON → empty. `OPTIONS` → 204 with scoped `corsHeaders`.
- **`matchKey(artist, title)` primitive:** Standalone pure helper (string args, not a Track) reusing the exact `dedupe.ts` `norm()` regex chain, returning `normalize(artist)|normalize(title)` (artist-first). Documented as the single source of truth that Phase 13 loved-sync reconciliation consumes; CJK Trad/Simp folding explicitly deferred to Phase 13. `dedupe.ts` left untouched.
- **`Track` enrich fields:** Optional `tags?`, `bio?`, `bioUrl?`, `lastfmArt?` appended to the source-extras block (additive, never overwrites source data). NOT added to `HistoryEntry`/`toEntry`.
- **`services/lastfm.ts` client service:** `enrichTrack` (`Promise.allSettled` over track→tags, artist→bio/bioUrl, album→lastfmArt), `enrichArtist`, `enrichAlbum`. All resolve to a clean `EnrichResult` and NEVER throw (all-empty on any failure or absent-key empty shape). Tags capped at 5. Album art from `album.getInfo` only (D-04 guardrail 1). Never references `platform`. Imports `matchKey` as the Phase-13 alignment anchor.
- **`TagChips.svelte` + NowPlaying integration:** Display-only ≤5 chips styled from `app.css` tokens; renders nothing when empty; optional `onTagClick` upgrades chips to tappable buttons (Phase-9-ready) with identical styling. NowPlaying's uid-keyed `$effect` void-fires `enrichTrack` off the critical path (race-guarded), renders `<TagChips>` immediately after `.meta`, and runs a `new Image()` preload before swapping `swappedCover` (swap only when source cover missing OR image ≥300px; falls back to source cover when `lastfmArt` is null — ENRICH-02, no regression).
- **i18n:** `nowplaying.lastfmTags`, `lastfm.readMore`, `lastfm.about`, `lastfm.listeners`, `lastfm.playcount` added to all three locales in one pass (Plans 02/03 only consume).

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Edge proxy + match-key (TDD) | 288b0e0 (test/RED), 49cb11a (feat/GREEN) |
| 2 | Track fields + client service (TDD) | 5864394 (test/RED), d663dec (feat/GREEN) |
| 3 | TagChips + NowPlaying + i18n | 537b696 (feat) |

## Verification

- `pnpm check` — 0 errors, 0 warnings (3991 files). Track enrich fields compile; library + history still typecheck (enrich fields correctly absent from HistoryEntry).
- `pnpm test` — 112/112 passing (16 files), including:
  - **No-leak** (T-08-01): FAKE_KEY present in captured upstream URL with the `周杰伦` fixture encoded, ABSENT from response body AND `[...res.headers.entries()]`.
  - **Absent-key** (T-08-02): 200 all-empty shape AND `fetch` NOT called (no `api_key=undefined`).
  - **error-6 / malformed JSON**: 200 all-empty shape.
  - **Method allow-list** (T-08-03): out-of-list method → empty, no fetch.
  - **Placeholder filter** (T-08-06): grey-star hash → `image: null`.
  - **OPTIONS** (T-08-05): 204 with scoped `Access-Control-Allow-Origin` (never `*`).
  - **matchKey**: CJK `周杰伦`/`稻香` fixture, artist-first order, bracket/feat folding, no Trad/Simp folding.
  - **enrichTrack/Artist/Album**: merged clean shape, never throws on fetch-throw or absent-key empty, allSettled partial success, album.getInfo art.
- **Human-check (deferred — requires `wrangler dev` build with LASTFM_KEY):** tag chips visible on a Last.fm-matched track; cover swaps only when strictly better + preloaded; non-Last.fm track and absent-key build both play + display normally. This is the plan's `<human-check>` and cannot be run headless; the automated checks fully cover the no-leak/absent-key/placeholder/error paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `enrichArtist`/`enrichAlbum` failure shape included extra keys**
- **Found during:** Task 2 GREEN (one of 8 tests failed)
- **Issue:** The happy path always set `listeners: null, playcount: null`, so a total-failure result did not deep-equal the bare all-empty `EnrichResult` the test asserts (the contract is: failure → bare empty shape; album extras only when present).
- **Fix:** Extracted a `toResult(info)` helper that includes `listeners`/`playcount` only when non-null. Failure/miss now returns exactly `{ tags: [], bio: null, bioUrl: null, lastfmArt: null }`.
- **Files modified:** `src/lib/services/lastfm.ts`
- **Commit:** d663dec

### Plan command note (non-deviation)

The plan's verify commands (`pnpm test -- --run …`) double the `--run` flag because the `test` script already contains `--run`; the equivalent `pnpm test <filter>` was used (filters pass through to vitest unchanged). No behavior change.

## Known Stubs

None. All wired to live data: NowPlaying's `enrich?.tags` is fed by the live `enrichTrack` call; `lastfmArt` flows through the preload guard. The `onTagClick` prop on TagChips is an intentional Phase-9 extension point (documented, defaults to non-interactive display) — not a stub.

## Threat Flags

None. All new surface (the `/api/lastfm/info` endpoint, the enrichment fetches) is enumerated in the plan's `<threat_model>` (T-08-01..06) and the mitigations are implemented + tested. No new package installs (T-08-SC accept holds).

## Self-Check: PASSED

All 5 listed created/key files exist on disk; all 5 task commit hashes (288b0e0, 49cb11a, 5864394, d663dec, 537b696) are present in git history.
