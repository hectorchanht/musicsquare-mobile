---
phase: quick-260606-nza
plan: 01
subsystem: ui
tags: [svelte5, runes, lastfm, discovery, cover-art-archive, musicbrainz, optimistic-ui, player]

# Dependency graph
requires:
  - phase: 09 (Discovery / Hot-Picks Tab)
    provides: discovery shelves, resolveStub resolve-on-tap, /api/lastfm/discovery reshape, player store
provides:
  - "player.playStub: optimistic resolve-on-tap with pendingTrack overlay, same-song dedupe, and generation-guard supersede"
  - "Optimistic now-bar: locks tapped {artist,title,cover} instantly with an indeterminate loading sliver before resolve"
  - "Cover Art Archive tile covers: mbid surfaced through the discovery reshape + client-built CAA URLs with graceful gradient fallback"
affects: [discovery, home, album, player, future cover-art work, deferred MusicBrainz fallback]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generation-guard (pendingGen) in the player store mirroring the home page's refreshGen idiom — newer tap supersedes a stale resolve"
    - "Optimistic UI overlay (pendingTrack) rendered before async resolution; real Track swaps in on success"
    - "Client-built external image URL (CAA) loaded as an <img src> attribute (not CSS url()) so no safeImageUrl allow-list widening is needed; onerror degrades to the gradient"

key-files:
  created:
    - src/lib/services/cover-art.ts
    - src/lib/services/cover-art.test.ts
    - src/lib/stores/player.svelte.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/+layout.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/api/lastfm/discovery/+server.ts
    - src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts
    - src/lib/services/lastfm.ts
    - vite.config.ts

key-decisions:
  - "Toast gating uses player.pendingTrack as the supersede signal: tr===null && pendingTrack==null → genuine miss (toast); a supersede leaves pendingTrack on the newer song (no toast)"
  - "Real covers render as a lazy <img> layered over the gradient span (not a background-image), so a 404/no-art degrades to the gradient via onerror with no broken-image icon"
  - "vite.config.ts node project now includes *.svelte.test.ts — runes compile under the sveltekit plugin and no jsdom client project exists (Rule 3)"

patterns-established:
  - "Pending/loading-guarded play path: store owns pendingTrack + dedupe + generation guard; pages just delegate and own their own toast"
  - "CAA cover builder is pure URL construction (no fetch); the browser <img loading=lazy> performs the request per visible tile (no fan-out, off the critical path)"

requirements-completed: [FIX-A, FIX-B]

# Metrics
duration: 7min
completed: 2026-06-06
---

# Phase quick-260606-nza Plan 01: Home/Discovery Optimistic Tap-to-Play + CAA Tile Covers Summary

**Discovery taps now lock the tapped song into the now-bar instantly with a loading indicator (dedupe + generation-guard supersede), and tiles show real Cover Art Archive covers via client-built mbid→CAA URLs with a graceful gradient fallback.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-06T09:25:00Z (approx)
- **Completed:** 2026-06-06T09:32:00Z (approx)
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- **FIX-A — Optimistic tap-to-play.** `player.playStub(artist, title, cover?)` synchronously locks a `pendingTrack` overlay + `loading` into the now-bar before awaiting the ~5-10s `resolveStub`. A same-song double-tap is deduped (no second resolve); a different-song tap bumps an internal generation counter so a stale resolve is discarded (never plays). On success it hands off to `play()` and clears the overlay; on a miss it clears the overlay and returns null so the page toasts.
- **Optimistic now-bar render.** `(app)/+layout.svelte` now shows the bar on `(current || pendingTrack)`, renders the pending stub's title/artist/cover via `names.dn`, animates an indeterminate sliver (`.np-prog.indet`) while resolving, and shows a spinner stand-in for play/pause until a real track is set. Reduce-motion aware. Root layout untouched.
- **FIX-B — Real CAA covers.** The `/api/lastfm/discovery` reshape surfaces each item's MusicBrainz `mbid` (empty → null). A new `caaReleaseGroupCover(mbid)` builds `release-group/{mbid}/front-250` client-side. The three track shelves + the artist shelf render `item.image ?? CAA(mbid)` as a lazy `<img>` layered over the gradient; on 404/no-mbid the gradient shows through (no broken image).
- **Tests.** New `player.svelte.test.ts` (7) covers sync-lock, dedupe-once, supersede-discards, success, miss, reject-safety, retry-after-miss. New `cover-art.test.ts` (7) covers the URL builder + null cases. Extended discovery endpoint test asserts mbid surfacing (real kept, empty/absent → null) with the no-leak invariant intact. `pnpm check` clean; `pnpm test` green at 186/186.

## Task Commits

Each task was committed atomically (code only; docs commit owned by the orchestrator):

1. **Task 1: Player store — pendingTrack + optimistic resolve flow (dedupe + generation guard)** — `9a4f698` (feat)
2. **Task 2: Wire optimistic now-bar — home + album tap, mini-bar loading render** — `f33e73b` (feat)
3. **Task 3: Cover Art Archive tile covers — surface mbid + client CAA URL builder + graceful fallback** — `4b7a03d` (feat)

_TDD tasks (1 + 3) bundled the test with the implementation in a single commit; both were verified green before committing._

## Files Created/Modified

- `src/lib/stores/player.svelte.ts` — added `PendingTrack` type, `pendingTrack` $state, private `pendingKey`/`pendingGen`, and the `playStub` method; clears pending state at the top of `play()`.
- `src/lib/stores/player.svelte.test.ts` (created) — 7 unit tests for playStub using mocked `resolveStub` + deferred promises for deterministic generation timing.
- `src/routes/(app)/+page.svelte` — home `playStub` delegates to `player.playStub` (passes `item.image`); toast gated on a genuine miss; tiles layer a CAA/Last.fm `<img>` over the gradient; added `tileCover`/`hideOnError` helpers + `.al-cover-img` CSS; dropped unused `resolveStub` import.
- `src/routes/(app)/album/[name]/+page.svelte` — album `playStub` delegates to `player.playStub`; same miss-only toast gating; dropped unused `resolveStub` import.
- `src/routes/(app)/+layout.svelte` — now-bar gated on `(current || pendingTrack)`, renders the pending overlay + indeterminate sliver + spinner stand-in; added the keyframes/classes.
- `src/lib/services/cover-art.ts` (created) — `caaReleaseGroupCover(mbid)` URL builder.
- `src/lib/services/cover-art.test.ts` (created) — 7 builder tests.
- `src/routes/api/lastfm/discovery/+server.ts` — `mbid` added to the item interfaces, the LfmTrack/LfmNamed sub-shapes, and both reshapers (empty → null). `safeImageUrl` untouched.
- `src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts` — mbid fixtures + assertions (real surfaced, empty/absent → null); existing `toEqual`s updated to include `mbid`.
- `src/lib/services/lastfm.ts` — `mbid` added to `DiscoveryTrack`/`DiscoveryArtist` (flows through the `<T>` passthrough).
- `vite.config.ts` — node test project now includes `*.svelte.test.ts` (see Deviations).

## Decisions Made

- **Supersede signal = `player.pendingTrack`.** The plan flagged this for the executor to verify and swap if cleaner. Verified against Task 1's behavior: on supersede `playStub` returns null but leaves `pendingTrack` on the newer song; on a miss it clears `pendingTrack`. So `tr === null && player.pendingTrack == null` cleanly distinguishes miss (toast) from supersede (no toast). Kept as specified.
- **Covers as `<img>`, not CSS background.** Layering a lazy `<img>` over the gradient span is the cleanest graceful path: `onerror` hides the img and the gradient shows. This also keeps CAA URLs out of any CSS `url()`, so no `safeImageUrl` allow-list change is needed (T-nza-02).
- **No new i18n keys.** Reused the existing `common.loading` across all three locales, as the plan permitted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Enabled `*.svelte.test.ts` to run under the node Vitest project**
- **Found during:** Task 1 (player test setup)
- **Issue:** The plan's named test artifact `src/lib/stores/player.svelte.test.ts` and its verify command (`vitest --run src/lib/stores/player.svelte.test.ts`) would report "No test files found" (exit 1) because `vite.config.ts`'s only project (`server`) explicitly **excluded** `src/**/*.svelte.{test,spec}.{js,ts}`. No jsdom/client project exists.
- **Fix:** Removed the blanket exclude so the node project includes `*.svelte.test.ts`. Verified the runes-backed player store compiles + runs headless under node (the sveltekit Vite plugin transforms `$state`). Zero pre-existing `.svelte.test` files existed, so no collateral.
- **Files modified:** `vite.config.ts`
- **Verification:** `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts` → 7 passed; full suite 186/186; `pnpm check` clean.
- **Committed in:** `9a4f698` (Task 1 commit)

**2. [Rule 1 - Bug] Removed now-unused `resolveStub` imports**
- **Found during:** Task 2 (home + album delegation)
- **Issue:** After delegating to `player.playStub`, the page-local `resolveStub` import became unused — `svelte-check` (TS strict) would flag it.
- **Fix:** Dropped the unused import from both `(app)/+page.svelte` and `(app)/album/[name]/+page.svelte`.
- **Files modified:** `src/routes/(app)/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`
- **Verification:** `pnpm check` clean (0 errors/0 warnings).
- **Committed in:** `f33e73b` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both necessary to satisfy the plan's own acceptance criteria (named test artifact must run; check must be clean). No scope creep — no behavior beyond the plan was added.

## Issues Encountered

- The player store uses Svelte 5 runes; confirmed via a throwaway probe that the node Vitest project compiles `$state` through the sveltekit plugin, so the playStub logic could be unit-tested headless without a jsdom client project. `play()` (which touches the real `<audio>`/Media Session) is stubbed in the test so the success handoff is observable.

## Threat Flags

None — no new security surface beyond the plan's threat model. `mbid` is a public MusicBrainz id (T-nza-01, accept); CAA URLs are `<img src>` attributes (not CSS `url()`) with the mbid `encodeURIComponent`'d (T-nza-02, mitigated); covers lazy-load per visible tile with no fan-out (T-nza-03, accept); no new dependencies (T-nza-SC).

## Known Stubs

None — `pendingTrack` is an intentional optimistic overlay (cleared on resolve), not an unwired data stub. No placeholder/empty-value patterns introduced.

## User Setup Required

None — no external service configuration required. CAA needs no key, no User-Agent, and has no rate limit; the `LASTFM_KEY` posture is unchanged.

## Next Phase Readiness

- FIX-A and FIX-B complete; home/album/now-bar wired; tests green; `pnpm check` clean.
- The MusicBrainz no-mbid search fallback (`/api/cover?artist=&title=`) remains **deferred** per the plan — items without an mbid keep the gradient (always graceful). Pull in as its own scoped quick task only if the gradient-block rate proves too high in practice.

## Self-Check: PASSED

- Created files verified present: `cover-art.ts`, `cover-art.test.ts`, `player.svelte.test.ts`, this SUMMARY.
- Task commits verified in git log: `9a4f698`, `f33e73b`, `4b7a03d`.
- `src/routes/+layout.svelte` (root) NOT in the plan diff (forbidden file untouched).
- `pnpm check` clean (0 errors / 0 warnings); `pnpm test` green (186/186, +15 new).

---
*Phase: quick-260606-nza*
*Completed: 2026-06-06*
