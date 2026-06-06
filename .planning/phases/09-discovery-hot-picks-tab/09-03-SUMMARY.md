---
phase: 09-discovery-hot-picks-tab
plan: 03
subsystem: ui
tags: [lastfm, discovery, artist-page, album-page, svelte5-runes, resolve-on-tap, top-albums, tracklist, i18n]

# Dependency graph
requires:
  - phase: 09-discovery-hot-picks-tab
    plan: 01
    provides: "services/lastfm.ts getArtistTopAlbums + getAlbumTracklist (album.getinfo tracks[]), services/discovery.ts resolveStub, /api/lastfm/discovery + /api/lastfm/info edge endpoints (absent-key → [])"
  - phase: 09-discovery-hot-picks-tab
    plan: 02
    provides: "resolve-on-tap pattern (playStub → resolveStub → player.setQueue/play), component-local unplayable toast, fallbackCover(seed) gradient"
  - phase: 08-last-fm-read-foundation-metadata-enrichment
    provides: "enrichArtist bio/tags hero, enrichAlbum listeners/playcount hero, TagChips"
provides:
  - "/artist/[name] page shows the REAL artist.getTopAlbums album row (replacing the searchAll-grouped-by-track.album approximation), in its own race-guarded $effect"
  - "Artist-page album click navigates to /album/[name]?artist=<artist> (D-04), carrying the album artist; no longer player.setQueue/play of derived tracks"
  - "/album/[name] page shows the REAL ordered album.getInfo tracklist (replacing the searchAll-grouped approximation), artist read from the ?artist= URL query param"
  - "Album-page select-to-play: each Last.fm {artist,title} stub resolves lazily on tap via resolveStub → player.play; a resolve miss shows an unplayable toast and never breaks the page or player (D-05/D-03)"
  - "Graceful empty states: absent key / no Last.fm match / deep link with no ?artist= → albums section hides (artist) or 'open from an artist' empty state (album); Phase-8 heros preserved"
  - "artist.albumLabel + album.tracklistNote / album.openFromArtist / album.unplayable i18n keys in en/zh-Hant/zh-Hans (additive)"
affects: [phase-10-source-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real Last.fm catalog data source SWAP on an existing page: replace a $derived approximation with a race-guarded $effect over a Plan-01 builder (own *For guard), keep the existing markup/styles, change only the data + onclick"
    - "URL query param as the cross-page artist carrier (/album/[name]?artist=…): read via page.url.searchParams.get, NOT derived from tracks[0] (which no longer exists before the real tracklist loads)"
    - "Stub-list page model: tracks: AlbumStub[] (NOT Track[]), keyed by index, resolved to a real Track only on tap (resolve-on-tap, mirrors home D-03)"

key-files:
  created:
    - .planning/phases/09-discovery-hot-picks-tab/09-03-SUMMARY.md
  modified:
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts

key-decisions:
  - "Album artist carried via the ?artist= URL query param (set by the artist-page album link), read with page.url.searchParams.get — replaces the old tracks[0]?.artist derivation, which cannot exist before a real stub tracklist resolves and is needed up-front by album.getInfo"
  - "Albums section moved ABOVE the Hit-songs loading gate on the artist page: top-albums now load in an independent $effect, so they render without waiting on the searchAll Hit-songs load (and vice versa)"
  - "Album tracklist modelled as AlbumStub[] keyed by index (stubs have no uid); longpress/TrackMenu dropped on the album rows (TrackMenu needs a real Track) — select-to-play resolves on tap instead"
  - "fallbackCoverSeed(string) added beside the existing fallbackCover(Track) on the artist page; the album page uses a single fallbackCover(seed:string) since its rows are all stubs"

patterns-established:
  - "Data-source SWAP on an existing page (approximation $derived → real Plan-01 builder in a race-guarded $effect) while preserving markup/styles + Phase-8 heros"
  - "Cross-page artist carrier via ?artist= query param + resolve-on-tap stub tracklist"

requirements-completed: [DISCO-02]

# Metrics
duration: 7min
completed: 2026-06-06
---

# Phase 9 Plan 03: Artist Top-Albums + Album Tracklist Select-to-Play Summary

**The artist page now lists the artist's REAL Last.fm albums (`artist.getTopAlbums`) and clicking one opens the album page with its REAL ordered tracklist (`album.getInfo`), where tapping any song resolves lazily via `resolveStub` and plays — closing the user's "get the artist's albums; open an album; select songs to play" ask (D-04/D-05) using the same resolve-on-tap path as the home shelves, with the Phase-8 bio/tags + listeners/playcount heros preserved and graceful empty/absent-key degradation throughout.**

## Performance

- **Duration:** ~7 min (implementation tasks 1–2 + commits; Task 3 is a human-verify checkpoint — auto-verifiable paths run, browser-visual deferred to human)
- **Started:** 2026-06-06T08:08:10Z
- **Tasks:** 3 (Tasks 1–2 `auto`, committed; Task 3 `checkpoint:human-verify`)
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- **D-04 (artist page real top-albums):** the `albums = $derived.by(...)` block that grouped `searchAll` results by `track.album` is gone; albums now come from `getArtistTopAlbums(name)` (the Plan-01 builder) in its own race-guarded `$effect` (`albumsFor` guard, cloned from the `enrichedFor` pattern). The `.albumrow` markup + CSS are unchanged; only the data binding (`al.image`, `fallbackCoverSeed(al.name)`, a static `artist.albumLabel`) and the click target changed.
- **D-04 navigation:** the album button onclick is now `goto('/album/' + encodeURIComponent(al.name) + '?artist=' + encodeURIComponent(name))` — opening the real album page carrying the album artist — replacing the old `player.setQueue(al.tracks); player.play(al.tracks[0])` (those derived tracks no longer exist for a real Last.fm album).
- **D-05 (album page real ordered tracklist):** the `searchAll(n,1) → dedupeBest → filter-by-track.album` `$effect` is replaced by `getAlbumTracklist(name, albumArtist)` → ordered `{artist,title}` stubs (`AlbumStub[]`), race-guarded on `name|albumArtist`. The artist is read from the `?artist=` URL query param (set by the Task-1 link), NOT from `tracks[0]` (fixed — the stubs have no resolved artist before tap, and `album.getInfo` needs the artist up front).
- **D-05/D-03 (select-to-play):** each album row onclick is async resolve-on-tap — `resolveStub(stub.artist, stub.title)` → on a `Track`, `player.setQueue([tr])` + `player.play(tr)`; on `null`, a component-local unplayable toast (same lightweight pattern as the home page). Strictly lazy: one tap → one `resolveStub` → one `searchAll`; never eager over the whole tracklist (Pitfall 11 / T-09-12).
- **Phase-8 heros preserved:** the artist-page bio/tags hero (`enrichArtist`) + the searchAll-derived Hit-songs list, and the album-page listeners/playcount hero (`enrichAlbum`, still keyed on `name + ' ' + albumArtist`) are untouched and still render.
- **Graceful degradation (T-09-13 / DISCO-04 posture):** `getArtistTopAlbums`/`getAlbumTracklist` return `[]` on absent key / no match → the albums section simply hides (artist page still shows bio + Hit songs) and the album tracklist shows the empty state (hero still renders). A deep link to `/album/[name]` with no `?artist=` skips the fetch and shows a dedicated "open from an artist" empty state instead of a hung spinner or crash.
- **i18n:** added `artist.albumLabel` and `album.tracklistNote` / `album.openFromArtist` / `album.unplayable` to all three locales (en/zh-Hant/zh-Hans) — additive, no existing keys reordered or removed (the now-unused `artist.trackOne`/`artist.trackMany`/`album.derived` keys were intentionally left in place per the additive constraint).

## Task Commits

Each implementation task was committed atomically:

1. **Task 1: Artist page real artist.getTopAlbums + album-click navigation + i18n** — `5e289b2` (feat)
2. **Task 2: Album page real album.getInfo tracklist + select-to-play via resolveStub** — `63dce0c` (feat)
3. **Task 3: Human-verify checkpoint** — no code; auto-verifiable paths run (see below), browser-visual paths deferred to human.

**Plan metadata:** committed separately with this SUMMARY + STATE/ROADMAP.

## Files Modified

- `src/routes/(app)/artist/[name]/+page.svelte` — Removed the `track.album`-grouped `albums` derived; added `albums = $state<DiscoveryAlbum[]>([])` + an `albumsFor`-guarded `$effect` over `getArtistTopAlbums`; moved the albums `.albumrow` section above the loading gate; album onclick → `goto('/album/…?artist=…')`; added `fallbackCoverSeed(string)` beside `fallbackCover(Track)`; imported `goto`, `getArtistTopAlbums`, `DiscoveryAlbum`. Bio/tags hero + Hit-songs list unchanged.
- `src/routes/(app)/album/[name]/+page.svelte` — Replaced the `searchAll`-grouped tracklist `$effect` with a `name|albumArtist`-guarded `getAlbumTracklist` fetch into `tracks: AlbumStub[]`; `albumArtist` now read from `page.url.searchParams.get('artist')`; rows keyed by index, onclick → async `playStub` (resolveStub → setQueue/play | unplayable toast); dropped `longpress`/`TrackMenu` on stubs; added a component-local toast + `fly` transition; synthetic gradient `fallbackCover(seed)`; `enrichAlbum` listeners/playcount hero preserved; added a `?artist`-aware "open from an artist" empty state. (This rewrite also removed a pre-existing single NUL byte from the old file — the old blob's NUL is why `git show --stat` labelled the diff `Bin`; the new blob is clean text, 0 NUL bytes.)
- `src/lib/i18n/en.ts` / `zh-Hant.ts` / `zh-Hans.ts` — +4 keys each (`artist.albumLabel`, `album.tracklistNote`, `album.openFromArtist`, `album.unplayable`), additive.

## Decisions Made

- **`?artist=` query param as the artist carrier** (key-link `goto('/album/…?artist=…')` → `page.url.searchParams.get('artist')`): the album page previously derived `albumArtist` from `tracks[0]?.artist`, which is impossible before a real stub tracklist resolves AND is needed up-front to query `album.getInfo`. The artist-page link now carries it explicitly.
- **Albums section above the loading gate** (artist page): top-albums load in an independent `$effect`, so the albums row renders without waiting for the Hit-songs `searchAll`, and the Hit-songs list still has its own loading gate.
- **Stub-list model, drop the menu** (album page): `tracks: AlbumStub[]` keyed by index (no uid); `TrackMenu`/`longpress` removed because the menu needs a real `Track` — select-to-play resolves to a `Track` on tap instead.

## Deviations from Plan

None — plan executed as written. No auto-fixes were required: `pnpm check` (0 errors / 0 warnings) and `pnpm test` (19 files / 164 tests) were clean on the first run for both tasks. No new dependencies; `catalog.ts`/`dedupe.ts`/`player`/the Plan-01 services were not modified (pure reuse). `src/routes/+layout.svelte` was not touched.

Incidental: the Task-2 rewrite removed a single pre-existing NUL byte that was present in the old `album/[name]/+page.svelte` blob (HEAD~1 had 1 NUL; the new blob has 0). This is a clean-up side effect, not a behavioral change — the page renders identically; only git's binary heuristic on the *old* blob produced the `Bin 6889 -> 8845 bytes` line in `git show --stat`.

## Threat Surface

- **T-09-11 (Tampering — `?artist` param → getAlbumTracklist)** mitigated: the param flows only as a Last.fm read query value (`encodeURIComponent`'d on the artist-page link + on the edge in Plan 01), used for a read-only `album.getInfo`; no command/markup construction. Rendered via `names.dn`/text bindings (Svelte auto-escapes), never `innerHTML`.
- **T-09-12 (DoS — tracklist resolution)** mitigated: select-to-play is strictly on-tap (one tap → one `resolveStub` → one `searchAll`); never eager-resolves the whole tracklist on album open. `resolveStub` returns `null` on a miss → unplayable toast, never throws/stalls.
- **T-09-13 (Availability — absent key / no match / deep link)** mitigated: `[]` → albums section hides / tracklist empty state; deep link with no `?artist=` → dedicated empty state; bio/Hit-songs (artist) + listeners/playcount (album) heros still render; the page never crashes.
- **T-09-14 (Info disclosure)** accept (public key-only data); **T-09-SC (installs)** N/A — no new dependencies (reuses Plan-01 services, player, lucide, i18n).

No new security-relevant surface beyond the plan's threat model. **No Threat Flags.**

## Known Stubs

None that block the plan's goal. The album tracklist items ARE Last.fm `{artist,title}` stubs by design (D-05) — they resolve to real Tracks on tap via `resolveStub`; this is the intended resolve-on-tap behavior, not a placeholder. The `[]` returns from the builders are the documented never-throw graceful states (absent-key / miss / failure), each covered by a Plan-01 test. The album rows use a synthetic gradient cover (`fallbackCover(seed)`) because a Last.fm tracklist stub carries no source cover — intended, matching the home shelves' stub rendering.

## Checkpoint: Task 3 (human-verify) — auto-verified vs. deferred-to-human

**Auto-verified (headless) — PASSED:**
- `pnpm check` → 0 errors / 0 warnings (acceptance criterion for both tasks).
- `pnpm test` → 19 files / 164 tests passing (unchanged from Plan 02 — no new tests were required by this plan; the consumed paths are Plan-01-covered).
- **Resolve-on-tap (D-05/D-03) — unit-covered (Plan 01):** `resolveStub` returns the top hit / first-of-many / `null` on miss / `null` (never throws) on `searchAll` throw (`discovery.test.ts`, 4 cases). The album-page `playStub` is a direct reuse of this transform (identical to the home-page `playStub`).
- **Builders → `[]` graceful (DISCO-04) — unit-covered (Plan 01):** `getArtistTopAlbums`/`getAlbumTracklist` return `[]` on absent-key / throw (`lastfm.test.ts`); `/api/lastfm/discovery` + `/api/lastfm/info` return empty on absent key / code-29 (endpoint tests). The artist albums-section-hide and album empty-state are the direct consequence.
- **No-`?artist`/deep-link path — logic-confirmed:** with `albumArtist === ''` the tracklist `$effect` skips the fetch, sets `loading = false`, and the `{:else if !albumArtist}` branch renders `album.openFromArtist`; the hero still renders. (No spinner, no crash.)

**Deferred to human (requires `wrangler pages dev` / `pnpm preview` build with `LASTFM_KEY` + a browser — not headless-runnable):**
1. From home, open `/artist/<well-known artist, e.g. Taylor Swift>` → the "Albums" row shows real album titles + covers (not search-grouped fragments), AND the Phase-8 bio/tags hero + Hit-songs list still render.
2. Click an album → navigates to `/album/<album>?artist=<artist>` and shows the REAL ordered tracklist (track 1, 2, 3… in album order), with the listeners/playcount hero present.
3. Tap a song → resolves and starts playing within ~1–2s (now-playing bar appears); tap a second song → it also plays.
4. (graceful) Open `/artist/<a CN artist not on Last.fm>` or run plain `vite dev` (no key) → albums section / tracklist simply empty; page still renders (bio/Hit songs on artist; hero on album); no crash, no error toast.
5. A resolve miss (obscure track with no CN-source match) shows an "unplayable" toast rather than breaking the page or the player.

**How to run the deferred human check:** `pnpm build && pnpm preview` (or `wrangler pages dev .svelte-kit/cloudflare`) with `LASTFM_KEY` configured, then follow the steps in 09-03-PLAN.md Task 3 `<how-to-verify>`.

## Self-Check: PASSED

- All 5 modified files present on disk and committed.
- Both task commits present in git history: `5e289b2` (Task 1), `63dce0c` (Task 2).
- `pnpm check`: 0 errors / 0 warnings. `pnpm test`: 19 files / 164 tests passing.
- `src/routes/+layout.svelte` NOT touched. i18n edits are additive (4 new keys per locale, no reorder/removal).

---
*Phase: 09-discovery-hot-picks-tab*
*Completed: 2026-06-06*
