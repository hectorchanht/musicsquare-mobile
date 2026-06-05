---
quick_id: 260606-5ug
subsystem: now-playing / up-next queue
tags: [lastfm, proxy, queue, reorder, similar-artists, player-store]
requires:
  - $lib/services/catalog (searchAll, SearchResult)
  - $lib/services/dedupe (dedupeBest)
  - $lib/stores/settings.svelte (preferredSource)
  - $lib/proxy/http (corsHeaders, fetchWithRetry)
provides:
  - GET/OPTIONS /api/similar (Last.fm artist.getSimilar proxy, key never on client)
  - $lib/services/similar (getSimilarArtists, buildSimilarQueue)
  - player.reorderQueue + manual/auto origin tracking + regen-on-fresh-play
  - NowPlaying grip-drag reorder UI + fresh-play wiring + current-track length
affects:
  - src/lib/stores/player.svelte.ts (play signature gains opts.fresh)
  - src/lib/components/NowPlaying.svelte (queue tab markup)
tech-stack:
  added: [Last.fm Web API (artist.getsimilar)]
  patterns: [server-side secret injection (JOOX_TOKEN parity), graceful fallback, custom pointer-drag reorder]
key-files:
  created:
    - src/routes/api/similar/+server.ts
    - src/routes/api/similar/similar-endpoint.test.ts
    - src/lib/services/similar.ts
    - src/lib/services/similar.test.ts
  modified:
    - src/app.d.ts
    - src/lib/proxy/proxy-types.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/components/NowPlaying.svelte
    - .dev.vars (appended documented LASTFM_KEY= line; gitignored, not committed)
decisions:
  - "LASTFM_KEY is OPTIONAL — absent key returns 200 { artists: [] } (NOT an error like JOOX) so same-artist fallback works end-to-end with no key configured."
  - "Manual origin tracked via a plain Set<string> on the player, not a field on Track — Track objects stay clean."
  - "Reorder is custom pointer/touch drag on a far-right GripVertical grip, queue-tab only; the moved track is pinned manual."
  - "Current-track length only (elapsed/total around the progress bar); no per-row durations, no Track.duration field."
metrics:
  duration: ~9 min
  completed: 2026-06-06
  tasks: 4
  files: 8
---

# Quick Task 260606-5ug: Smarter up-next (similar-vibe gen + reorder + length) Summary

Up-Next now regenerates from Last.fm-similar artists on a fresh user-initiated play (with graceful same-artist fallback when no key is configured), survives a far-right grip-drag reorder that pins tracks as manual, and shows the current track's elapsed/total length — all without leaking the Last.fm key or adding a `duration` field to `Track`.

## What was built

### Task 1 — Last.fm key plumbing + similar proxy endpoint (commit `145745b`)
- Added OPTIONAL `LASTFM_KEY?` to `Env` (proxy-types.ts) and `App.Platform.env` (app.d.ts), mirroring the JOOX_TOKEN comment/threat style (T-5ug-01).
- New dedicated route `src/routes/api/similar/+server.ts` (NOT the `[source]` catch-all): `GET` reads `platform.env.LASTFM_KEY`, calls Last.fm `artist.getsimilar` via `fetchWithRetry` + `AbortSignal.timeout(8000)`, returns `{ artists: string[] }` (deduped, capped at clamped `limit`, default 8). `OPTIONS` returns 204. CORS scoped to own origin via `corsHeaders` (never `*`).
- Absent key / upstream error / malformed JSON → 200 `{ artists: [] }` (supported fallback, unlike JOOX which throws). Never logs the key or upstream URL.
- `similar-endpoint.test.ts` mirrors `proxy.test.ts`: asserts the key reaches the upstream URL, is absent from the response body AND headers, missing-env returns `{ artists: [] }` WITHOUT fetching (no `api_key=undefined`), and malformed JSON returns `{ artists: [] }`.
- Documented `LASTFM_KEY=` in `.dev.vars` (appended a commented line; gitignored — never read/echoed, not committed).

### Task 2 — similar.ts service (TDD: RED `f04d46a`, GREEN `df7e2a6`)
- `getSimilarArtists(artist)`: `fetch('/api/similar?artist=...&limit=8')`, returns `artists ?? []`, `[]` on any failure.
- `buildSimilarQueue(track, excludeUids)`: Last.fm path runs `Promise.allSettled(searchAll(name, 1))` over up to 8 similar artists, takes each `interleaved[0]`, `dedupeBest(tops, preferredSource)`, filters out the seed uid + excludeUids. FALLBACK: when no similar artists, `searchAll(track.artist, 1)` → dedupe → exclude → `slice(0, 20)` (Related-tab behavior). Best-effort (erroring/empty searches skipped), modeled on `buildDiversePicks`.
- 6 unit tests with inline fixtures (no network): Last.fm path dedupe + seed/excludeUids exclusion, seed-as-top-result dropped, empty-artists fallback, fetch-throws fallback, getSimilarArtists error path.

### Task 3 — player store origin tracking + regen + reorder (commit `23dc664`)
- `private manualUids = new Set<string>()` (plain Set — Track stays clean).
- `playNext()` / `addToQueue()` add the uid to `manualUids`.
- `play(track, opts?: { fresh?: boolean })`: when `fresh`, after audio starts it calls `regenerate(resolved)` which rebuilds the auto portion as `dedupeBest([seed, ...manualEntries, ...buildSimilarQueue(seed, exclude)])` — ordering current → manual → generated, manual + current preserved, best-effort (queue left as-is on failure). `next()`/`prev()`/`ended` call the non-fresh path → never regenerate; auto-grow (`ensureAhead`) still runs.
- `reorderQueue(from, to)`: clamped move, reassigns a new array for reactivity, pins the moved track into `manualUids`.

### Task 4 — NowPlaying.svelte UI (commit `be967a3`)
- Imported `GripVertical`. Queue-tab `<li>` rows restructured: `.q-row` play button (now `player.play(t, { fresh: true })`) + a sibling far-right `.grip-handle` button.
- Custom pointer/touch drag on the grip (`setPointerCapture`, `touch-action: none`): tracks source index, measures each `<li>` rect via `rowIndexAt(clientY)` for the target, lifts the dragged row with `translateY`, and on pointerup calls `player.reorderQueue(from, to)`. Grips appear ONLY on the queue tab (lyrics/related untouched).
- Related-row taps also use `{ fresh: true }` (starting a new song regenerates).
- Verified the existing `.times` block renders `fmtTime(player.currentTime)` / `player.duration > 0 ? fmtTime(player.duration) : '--:--'` (current-track length, feature 3) — kept as-is; added grip/drag CSS only.

## Deviations from Plan

None — plan executed exactly as written. No deviation rules triggered. No new dependencies (`@lucide/svelte` and Vitest already present, per threat T-5ug-SC).

Minor implementation note (not a deviation): in `play()`, `ensureAhead()` previously ran before the `!audioUrl` early-return; it now runs after audio starts (in the non-fresh branch). A track with no playable audio no longer auto-grows the queue — strictly more correct, no behavior the plan relied on.

## Verification

- `pnpm check` → 3959 files, **0 errors, 0 warnings**.
- `pnpm test` → **67/67 pass** (58 pre-existing + 3 new endpoint + 6 new similar-service).
- Key-leak: `similar-endpoint.test.ts` proves `LASTFM_KEY` is absent from response body + headers.
- Fallback: `buildSimilarQueue` returns same-artist tracks when `/api/similar` yields `{ artists: [] }` or fetch throws (asserted).
- Reorder: `player.reorderQueue` pins the moved uid into `manualUids` (preserved across the next fresh-play regen).

## Known Stubs

None. The Last.fm `{ artists: [] }` empty state is an intentional supported fallback (same-artist search), not a stub — the feature is fully functional with no key.

## Threat Flags

None. New surface (`/api/similar`) is covered by the plan's threat register (T-5ug-01..03) and the no-leak test.

## Self-Check: PASSED

- Files: `src/routes/api/similar/+server.ts`, `src/routes/api/similar/similar-endpoint.test.ts`, `src/lib/services/similar.ts`, `src/lib/services/similar.test.ts` — all FOUND.
- Commits `145745b`, `f04d46a`, `df7e2a6`, `23dc664`, `be967a3` — all FOUND.
- `LASTFM_KEY` typed in both `src/app.d.ts` and `src/lib/proxy/proxy-types.ts`.

## Commits

- `145745b` feat(quick-260606-5ug): Last.fm similar-artists proxy endpoint + key plumbing
- `f04d46a` test(quick-260606-5ug): add failing tests for similar service (TDD RED)
- `df7e2a6` feat(quick-260606-5ug): similar.ts service (TDD GREEN)
- `23dc664` feat(quick-260606-5ug): player manual/auto origin + regen-on-fresh-play + reorderQueue
- `be967a3` feat(quick-260606-5ug): NowPlaying grip-drag reorder + fresh-play wiring + length
