---
phase: quick-260607-0bb
plan: 01
subsystem: home-discovery-covers
tags: [cover-backfill, itunes, deezer, multi-tier, rate-limit, home]
requires:
  - "$lib/services/deezer (deezerSongCover, deezerArtistCover)"
  - "$lib/services/catalog (searchAll) + $lib/services/dedupe (dedupeBest)"
  - "$lib/services/cover-cache (get/set track + artist keys)"
  - "$lib/services/discovery (mapWithConcurrency)"
provides:
  - "itunes-cover.ts — no-auth, CORS-open, AbortSignal-bounded, never-throws iTunes resolver"
  - "cover-backfill.ts — track chain Deezer->iTunes->CN; artist chain Deezer->iTunes; CAP=6; https-only guard"
  - "+page.svelte scheduleBackfill cap = full gathered gradient set (rows.length / artistNames.length)"
affects:
  - "src/routes/(app)/+page.svelte (home discovery tiles)"
tech-stack:
  added: []   # NO new npm dependency (plain fetch + URL + URLSearchParams)
  patterns:
    - "Multi-tier first-solid-wins fall-through with per-tier never-throw wrapper"
    - "https-only guard before cache/render (isSolidCover) — T-0bb-01"
    - "Cap = full gathered set, bounded by in-flight CAP=6 + per-call AbortSignal.timeout + skip-cached"
key-files:
  created:
    - src/lib/services/itunes-cover.ts          # restored verbatim from 6c44889
    - src/lib/services/itunes-cover.test.ts      # restored from 6c44889 (+ TS-error-only fix)
  modified:
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/routes/(app)/+page.svelte
decisions:
  - "iTunes resolver restored VERBATIM from git 6c44889 (it built + passed before wv8 deleted it); re-imported into cover-backfill — no retype."
  - "Track chain Deezer->iTunes->CN, artist chain Deezer->iTunes; stop at first SOLID (non-empty https) cover; each tier never-throws (a throw falls through to the next tier, whole call never rejects)."
  - "No Last.fm network backfill tier: the Last.fm item.image pre-check is already synchronous in tileCover() — a Last.fm-imaged tile never reaches this resolver. Stop at CN (no album.getInfo last-resort)."
  - "CAP 3->6 in-flight; DEFAULT_MAX 24->400; home passes max = rows.length / artistNames.length so EVERY gathered gradient tile is attempted (the fixed-24/12 stranded-tail was the grounded root cause)."
  - "https-only guard (isSolidCover): only a non-empty 'https:' URL is cached/notified; http/data/blank = miss (T-0bb-01). Covers render as <img src> only (never CSS url())."
metrics:
  duration: ~9 min
  tasks_completed: 2 of 3 (Task 3 = blocking human-verify, deferred-to-human)
  files_changed: 5
  tests: 408 passed (40 files) — was 383 at wv8 baseline; +iTunes 19 +cover-backfill net
  completed: 2026-06-07
---

# Quick Task 260607-0bb: Strengthen Cover Backfill Chain (Deezer→iTunes→CN) Summary

Fixed the persistent "most home tiles are color blocks" symptom (4th attempt) by (1) restoring the
iTunes resolver wv8 deleted and re-adding it as a middle tier, and (2) lifting the per-page caps so
EVERY rendered gradient tile is attempted instead of only the first 24 tracks / 12 artists. The track
chain is now **Deezer → iTunes → CN** and the artist chain **Deezer → iTunes**, each tier
never-throws and stops at the first solid https cover, all bounded by an in-flight CAP=6 pool +
per-call timeout + skip-cached so a warm visit costs ~0 requests.

## What Changed

### Task 1 — Restore the iTunes resolver (+test) from git 6c44889 — commit `f850ac2`
- `git show 6c44889:src/lib/services/itunes-cover.ts` and `...itunes-cover.test.ts` recovered
  VERBATIM (no retype). Exports: `buildItunesSearchUrl`, `upgradeArtwork`, `itunesSongCover`,
  `itunesArtistCover` — no-auth, CORS-open direct fetch to `itunes.apple.com/search`,
  `AbortSignal.timeout(6000)` + caller-signal short-circuit, never-throws → null on any miss.
- Restored test passes unmodified at runtime: **19/19** (`pnpm vitest run itunes-cover.test.ts`).

### Task 2 — Multi-tier chains + lifted caps — commit `28e084d`
- `cover-backfill.ts`:
  - Imported `{ itunesSongCover, itunesArtistCover }` from `$lib/services/itunes-cover`.
  - `resolveOne` (track): **Deezer → iTunes → CN** (searchAll + dedupeBest), stop at first solid.
  - `resolveOneArtist` (artist): **Deezer → iTunes**, stop at first solid.
  - Per-tier never-throw `tier()` wrapper: a throw in one tier returns null and falls through to the
    next tier (the outer try/catch is a backstop); the whole call never rejects.
  - `isSolidCover()` https-only guard: only a non-empty `https:` URL is cached/notified
    (T-0bb-01); http/data/blank is a miss and falls through.
  - `CAP` 3 → 6; `DEFAULT_MAX` 24 → 400 (home passes an explicit cap, so this only un-throttles an
    unsupplied caller). Skip-cached + de-dupe preserved → warm visit ~0 requests.
- `+page.svelte` `scheduleBackfill`: `max: 24` → `max: rows.length`, `max: 12` →
  `max: artistNames.length`. `rows`/`artistNames` already gather only the gradient tiles, so the cap
  now covers the entire gathered set (~270 track + ~18 artist tiles in the default config).
  `tileCover` render order UNCHANGED (Last.fm image → CAA(mbid) → cached(Deezer/iTunes/CN) →
  gradient) — only the cached tier is now fed by the stronger backfill.

## Preserved Contracts
- Lazy/post-paint (void-fired, never awaited before paint); never-throws → gradient.
- `<img src>` only (never CSS `url()`); `onerror` → hide → gradient; `coverVer++` reactivity.
- Skip-cached + de-dupe; per-call `AbortSignal.timeout` lives inside each resolver (none added).
- Self-DoS bound: CAP=6 in-flight + per-call timeout + skip-cached; iTunes/CN fire ONLY on a Deezer
  miss (Deezer is tier-1 + edge-cached, ≤~50 req/5s) → deep-chain calls are a minority.
- NO new npm dependency, NO secret, NO new env var.

## Automated Verification (all green)
- `pnpm vitest run src/lib/services/itunes-cover.test.ts` → **19/19 passed** (restored resolver).
- `pnpm vitest run src/lib/services/cover-backfill.test.ts` → **20/20 passed** — pins the
  Deezer→iTunes→CN track order, the Deezer→iTunes artist order, per-tier never-throw,
  https-guard miss-fallthrough, skip-cached, and the `max` cap.
- `pnpm check` → **0 errors, 0 warnings**.
- `pnpm vitest run` (full suite) → **408 passed (40 files)** (wv8 baseline was 383; iTunes restore
  + new chain cases account for the delta).
- `pnpm build` → built OK; Cloudflare worker entry emitted (`.svelte-kit/cloudflare/_worker.js`).

## Deviations from Plan

**1. [Rule 3 - Blocking] iTunes test type errors under svelte-check**
- **Found during:** Task 2 (`pnpm check`).
- **Issue:** The verbatim-restored `itunes-cover.test.ts` raised 4 `svelte-check` TS errors at
  `fetchMock.mock.calls[0][0] as string` — the mock `vi.fn(async () => ...)` takes no params, so
  vitest inferred the recorded-call arg tuple as `[]`, making `calls[0][0]` an out-of-range access.
- **Fix:** Typed the two fetch mocks `vi.fn(async (_input: string) => ...)` and dropped the now-
  redundant `as string` casts. Type-only change — runtime behavior identical (the restored test
  still passes 19/19). The plan's Task 1 action explicitly permits editing the recovered files "if
  a TS/lint error appears."
- **Files modified:** `src/lib/services/itunes-cover.test.ts`
- **Commit:** `28e084d` (committed alongside Task 2 since it is what makes `pnpm check` clean).

**2. [Test-assertion correction] `expect.anything()` → `undefined` for the optional signal arg**
- During TDD GREEN, two new assertions used `expect.anything()` for the iTunes resolvers' optional
  `signal` argument. With no caller signal supplied, the resolver correctly receives `undefined`,
  which `expect.anything()` does NOT match. Corrected to `toHaveBeenCalledWith(artist, title,
  undefined)` — this asserts the real contract (the caller's signal is threaded through verbatim).

## Known Stubs
None — no hardcoded empty values, no placeholder UI, no unwired data sources introduced.

## Threat Flags
None — no new network endpoint, auth path, file-access pattern, or schema change beyond the plan's
`<threat_model>` (T-0bb-01..04, all already dispositioned). iTunes is a restored, previously-shipped
keyless boundary; the https-only guard (T-0bb-01) is implemented as `isSolidCover`.

## Task 3 — DEFERRED-TO-HUMAN (blocking human-verify)

Task 3 is a `checkpoint:human-verify` with `gate="blocking-human"`. The executor cannot perform a
visual/runtime check, and this gate is explicitly NOT auto-approvable (the prior 3 attempts passed
tests yet the symptom persisted — tests-green is NOT acceptance). All automated verification above is
green. A human must confirm the runtime outcome:

1. Run the app against a REAL Last.fm key so the home shows actual Last.fm charts/tags/country
   shelves (not the no-key `buildDiversePicks` fallback):
   - `pnpm dev` with `LASTFM_KEY` set locally, OR open the deployed home at
     https://openmusic.pages.dev/
2. CLEAR the cover cache first to observe a genuine COLD backfill: in DevTools console run
   `localStorage.removeItem('openmusic:cover-cache:v1')` then hard-reload.
3. On the HOME tab, scroll through EVERY shelf: 精選推薦/top-hits, 熱門歌手/top-artists, and each
   tag shelf AND each country shelf.
4. Confirm the LARGE MAJORITY of TRACK tiles across ALL shelves (not just the first ~24) show a real
   album cover within a few seconds — gradients should be the exception, not the rule.
5. Confirm the LARGE MAJORITY of TOP-ARTIST avatars (round tiles) show a real artist picture.
6. Confirm a cover MISS still degrades gracefully — a still-gradient tile shows the gradient, never
   a broken-image icon.
7. Re-load (WARM cache): tiles appear instantly and the Network tab shows ~0 new
   `/api/deezer/search`, `itunes.apple.com`, or CN search requests (skip-cached working).
8. (Optional) On the cold load, `/api/deezer/search` fires for most tiles; `itunes.apple.com` / CN
   searches fire only for the Deezer-miss minority (chain rarely runs deep).

**Resume signal:** Type "approved" once MOST track tiles AND MOST artist avatars show real covers on
a cold load and a warm reload issues ~0 requests; or describe which shelves still show mostly blocks
(and roughly what fraction) so the chain/cap can be revised.

## Commits
- `f850ac2` — feat(quick-260607-0bb): restore iTunes cover resolver (+test) from 6c44889
- `28e084d` — feat(quick-260607-0bb): multi-tier cover chains + lift backfill caps

## Self-Check: PASSED
- All created/modified files exist on disk (itunes-cover.ts/.test.ts, cover-backfill.ts/.test.ts,
  +page.svelte, SUMMARY.md).
- Both commits found in git log (`f850ac2`, `28e084d`).
- iTunes resolver imported into cover-backfill.ts (line 66:
  `import { itunesSongCover, itunesArtistCover } from '$lib/services/itunes-cover'`).
- Home caps lifted: `max: rows.length` + `max: artistNames.length` present; `const CAP = 6`.
