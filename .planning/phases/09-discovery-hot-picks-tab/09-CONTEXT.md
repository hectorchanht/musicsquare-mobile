# Phase 9: Discovery / Hot-Picks Tab - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Last.fm-powered **discovery** that the user can browse AND tap to play. Per this discussion the surface is the **home landing page's Top-picks area** (NOT a separate Explore tab — see D-01, which supersedes the ROADMAP goal's "Explore tab" wording). Requirements DISCO-01/02/03/04.

**Scope expansion (flagged — see Deferred):** This discussion pulled the **artist top-albums → album-page real tracklist → tap-a-song-to-play** flow into Phase 9 (D-04/D-05), and made discovery items **tap-to-play by reusing the existing `searchAll` + `dedupeBest` resolver** (D-03) — so Phase 10's formal `lastfm` SourceId adapter (LFSRC-01/02/03) is NOT a prerequisite for the user's "select songs to play" ask. The roadmapper/planner should note Phase 10 likely shrinks/refocuses (formalize the source adapter + the deferred GD Studio ytmusic).

Out of this phase: Phase 11 auth, Phase 12 scrobble, Phase 13 loved-sync. Personal/user-scoped discovery (your top artists, history) stays deferred (needs auth).
</domain>

<decisions>
## Implementation Decisions

### Placement
- **D-01:** Last.fm discovery lives on the **HOME landing page Top-picks area** — NO new Explore tab. This **supersedes the ROADMAP Phase 9 goal's "Explore tab in the bottom-nav" wording**; DISCO-04's "usable signed-out + edge-cached" still holds, just on home. Last.fm becomes the home Top-picks source, replacing the random-`ARTIST_POOL` `buildDiversePicks` shelf as PRIMARY (D-06 keeps it as fallback).

### Discovery shelves (the "many ways to find songs")
- **D-02:** The home surface shows FOUR Last.fm-powered shelves:
  1. **Top hits** — `chart.getTopTracks` (global trending songs).
  2. **Top artists** — `chart.getTopArtists` (tap an artist → existing `/artist/[name]` page).
  3. **Genre / mood tag shelves** — `tag.getTopTracks` for a curated set of genre/mood tags, one horizontal row per tag (the "genre/vibe tags" ask). [DISCO-02]
  4. **Country / region charts** — `geo.getTopTracks` for a curated country set (CN/TW/HK + a few Western). [DISCO-03]
  Shelves 1+2 = DISCO-01. Tracks across shelves are tap-to-play (D-03).

### Playability (the 9↔10 coupling — resolved)
- **D-03:** Discovery items (chart tracks, tag tracks, geo tracks, and album tracklist songs) are **tap-to-play**. A Last.fm `{artist, title}` stub resolves to a playable CN-source track ON TAP via the **EXISTING `searchAll` + `dedupeBest` (`catalog.ts`/`dedupe.ts`)** — the same resolver `picks.ts`/`similar.ts` already use. This does NOT require Phase 10's formal `lastfm` SourceId adapter. Resolution failure degrades gracefully (item shows unplayable / skips; never breaks the surface or the player).

### Artist top-albums + album page (real Last.fm catalog)
- **D-04:** The `/artist/[name]` page gains a **real album list from `artist.getTopAlbums`**, replacing the current `searchAll`-grouped-by-`track.album` approximation. (Phase 8 added bio/tags to this page; this adds top-albums.)
- **D-05:** Clicking an album opens `/album/[name]` showing that album's **real ordered tracklist from `album.getInfo`**, replacing the searchAll-grouped approximation. The user can **select any song from the tracklist to play** (resolve-on-tap via D-03).

### Existing picks fate
- **D-06:** Last.fm is the PRIMARY home Top-picks source; the existing `buildDiversePicks` (random `ARTIST_POOL`) stays as a **FALLBACK** when `LASTFM_KEY` is absent or Last.fm errors/rate-limits — home stays populated signed-out / no-key (parity with the absent-key-graceful posture from Phase 8).

### Claude's Discretion (planner/researcher decide)
- **Read endpoint shape:** the Phase-8 `/api/lastfm/info` endpoint's `ALLOWED_METHODS` allow-list is only `track/artist/album.getinfo`. Discovery needs `chart.gettoptracks`, `chart.gettopartists`, `tag.gettoptracks`, `geo.gettoptracks`, `artist.gettopalbums` (+ existing `album.getinfo`). Either EXTEND the allow-list + add reshapers, or add a dedicated `/api/lastfm/discovery` endpoint. Mirror the `/api/lastfm/info` posture (key edge-only, absent-key 200 graceful, scoped CORS, fetchWithRetry, Cache API).
- **Curated lists:** the genre/mood tag set and the country set (sensible CN-biased defaults, small — e.g. tags: pop/rock/electronic/lo-fi/mandopop/cantopop/jazz/workout; countries: China/Taiwan/Hong Kong/United States/Japan/Korea). Keep editable.
- **Edge-cache TTLs** via Cloudflare Cache API: charts ~1h, tags ~6h, getTopAlbums/album.getInfo ~24h (research). Cap fan-out concurrency 3–5 in-flight (PITFALLS Pitfall 11).
- **Album tracklist resolution timing:** lazy/on-tap (resolve a song only when played) vs eager (resolve all on album open). Lean **lazy/on-tap** to avoid fan-out; planner decides.
- Shelf order, count per shelf, horizontal-scroll row UI — reuse existing home `.section` + artist `.albumrow` patterns and design tokens.
- Cover art for chart/tag/album items: reuse the Phase-8 placeholder-star filter; fall back gracefully when Last.fm art missing.
</decisions>

<specifics>
## Specific Ideas

- User's words: "landing page Top picks sections should get from Last.fm too, with many tags like genre, top artist, top hits and many more ways to find songs."
- User's words: "get list of albums info of the artist in the artist page from Last.fm; when the album is clicked, go to the album page of that artist where user can select songs from that album to play."
- Reuse the SHIPPED Phase-8 enrichment plumbing: `services/lastfm.ts` (`enrichArtist`/`enrichAlbum`), the `/api/lastfm/info` edge pattern, `TagChips`, and the placeholder-art filter.
- The artist page already wires album click → `player.setQueue(al.tracks); player.play(al.tracks[0])` for derived albums — adapt this to real Last.fm albums + resolve-on-tap.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's contract
- `.planning/ROADMAP.md` §"Phase 9: Discovery / Hot-Picks Tab" — goal (NOTE: "Explore tab" wording superseded by D-01 home placement), DISCO-01..04, security note (public key-only, Cache API TTLs, fan-out cap)
- `.planning/REQUIREMENTS.md` — DISCO-01/02/03/04 exact wording

### Last.fm v1.1 research
- `.planning/research/SUMMARY.md` — Phase 9 implications, Cache API, the "discovery low-value without playable source" tension (resolved here via D-03)
- `.planning/research/ARCHITECTURE.md` — read-call routing, discovery service design, SSR `+page.ts` vs client-fetch, the searchAll-resolver bridge
- `.planning/research/FEATURES.md` — chart.*/tag.*/geo.*/artist.getTopAlbums/album.getInfo params + response shapes; image-array handling; country = ISO names not codes
- `.planning/research/PITFALLS.md` — Pitfall 11 (rate-limit fan-out + caching), placeholder-art, personalized-cache separation (none here — all public)

### Phase 8 (shipped — reuse, don't duplicate)
- `.planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-CONTEXT.md` — D-01..D-08 (placeholder filter, enrichment additive/async)
- `.planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-SUMMARY*` (08-01/02/03 SUMMARYs) — what shipped: `/api/lastfm/info`, `services/lastfm.ts`, `matchKey`, `TagChips`, enriched artist/album pages

### Code integration points (existing)
- `src/routes/api/lastfm/info/+server.ts` — edge read pattern to extend/mirror; ALLOWED_METHODS allow-list to widen (or new `/api/lastfm/discovery`)
- `src/lib/services/catalog.ts` (`searchAll`, `ensureTrackDetails`) + `src/lib/services/dedupe.ts` (`dedupeBest`) — the tap-to-play resolver (D-03)
- `src/lib/services/picks.ts` (`buildDiversePicks`, `ARTIST_POOL`) — the fallback (D-06)
- `src/lib/services/lastfm.ts` — Phase-8 enrichment service to extend with discovery/getTopAlbums builders
- `src/routes/(app)/+page.svelte` — home Top-picks surface (`CACHE_KEY`, `buildDiversePicks`, `.section`)
- `src/routes/(app)/artist/[name]/+page.svelte` — artist page (albums section + `enrichArtist`)
- `src/routes/(app)/album/[name]/+page.svelte` — album page (tracklist + `enrichAlbum`)
- `src/lib/stores/player.svelte.ts` — `player.setQueue` / `player.play` for tap-to-play

### Project-level
- `.planning/PROJECT.md` — v1.1 milestone, local-first/edge-only-secrets constraints
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `searchAll` + `dedupeBest` (catalog/dedupe) — ALREADY resolve {artist,title}→playable track; the tap-to-play engine for D-03 (no new resolver needed).
- `/api/lastfm/info/+server.ts` — copy/extend as the discovery read proxy (absent-key graceful, scoped CORS, fetchWithRetry, no-leak).
- `services/lastfm.ts` — extend with discovery list builders + `getTopAlbums` + album-tracklist fetch.
- `buildDiversePicks` (picks.ts) — the D-06 fallback.
- Home `.section` + artist `.albumrow` markup/styles — reuse for shelves/rows.
- Phase-8 placeholder-star image filter — reuse for chart/tag/album art.

### Established Patterns
- Absent `LASTFM_KEY` is a SUPPORTED 200 graceful state; key edge-only (Phase-8 / JOOX_TOKEN parity). Discovery responses are public → `Cache-Control: public` + Cache API TTLs.
- Enrichment/discovery fetches are async + best-effort + never block the player.
- Track identity = `source:songid`; resolved discovery items get a real source uid via dedupeBest.

### Integration Points
- New edge endpoint(s) for chart/tag/geo/getTopAlbums (extend `/api/lastfm/info` allow-list or new `/api/lastfm/discovery`).
- Home page: swap primary Top-picks source to Last.fm shelves; keep buildDiversePicks fallback.
- Artist page: real `artist.getTopAlbums` list. Album page: real `album.getInfo` tracklist + select-to-play (resolve-on-tap).
</code_context>

<deferred>
## Deferred Ideas

- **Phase 10 rescope (FLAG for roadmapper):** D-03 satisfies "tap-to-play" via existing `searchAll`, so Phase 10's formal `lastfm` SourceId adapter (LFSRC-01/02/03) is no longer a prerequisite for playability. Phase 10 likely shrinks to: formalizing the `lastfm` source adapter as a clean abstraction + the deferred **GD Studio `ytmusic`** Western-catalog resolver. Recommend a roadmap note/update after this phase plans.
- Personal/user-scoped discovery (your top artists/tracks, listening history) — needs auth, Phase 11+.
- Tappable tag chips drilling into a full tag page (vs just shelves) — could extend later; Phase 9 ships tag shelves.
- GD Studio `ytmusic` source — deferred v1.x spike (per milestone Out-of-Scope).

No scope creep beyond the user's explicit asks; the album-play expansion was an explicit user request folded in (D-04/D-05).
</deferred>

---

*Phase: 09-discovery-hot-picks-tab*
*Context gathered: 2026-06-06*
