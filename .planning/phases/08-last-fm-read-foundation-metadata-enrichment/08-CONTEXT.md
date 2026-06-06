# Phase 8: Last.fm Read Foundation & Metadata Enrichment - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the milestone's shared **edge Last.fm read proxy** + **lazy, additive metadata enrichment** (top tags, artist-bio snippet, higher-res cover art) layered onto existing multi-source tracks, plus a reusable **`{artist}+{title}` match-key normalization primitive** that later phases (esp. Phase 13 loved-sync) reuse.

Enrichment is additive, async, and OFF the playback critical path — it never overwrites good per-source data, never blocks/delays the moment audio starts, and degrades silently when `LASTFM_KEY` is absent or Last.fm misses (error 6). Requirements: ENRICH-01, ENRICH-02, ENRICH-03.

Out of this phase: discovery tabs (Phase 9), the Last.fm-searchable source (Phase 10), auth/signed calls (Phase 11), scrobble (Phase 12), loved-sync (Phase 13). Discovery-style tag *browsing* is Phase 9 — Phase 8 tag chips are display-only.
</domain>

<decisions>
## Implementation Decisions

### Enrichment surfaces (where Last.fm data shows)
- **D-01:** Enrich ALL THREE existing surfaces — (a) full-screen **now-playing**: top-tag chips under the title; (b) the existing **`/artist/[name]` page**: artist-bio snippet + tags + better artist image; (c) the existing **`/album/[name]` page**: album art + album info (e.g. listeners/playcount).
- **D-02:** Tags surface as chips; bio lives on the artist page; album art/info on the album page. The artist/album routes already exist and currently just `searchAll` — enrichment augments them, it does not replace their existing track-list behavior.

### Cover-art "higher-res when better" policy
- **D-03:** **Prefer Last.fm album art when it is higher-res** than the existing per-source cover — i.e. a real swap is allowed, not just fill-when-missing. (User chose the quality-maximizing option over the zero-flicker option.)
- **D-04:** GUARDRAILS for D-03 (mitigate the known risks of this choice — see PITFALLS Pitfall 8 + the grey-star issue): (1) source the image from **`album.getInfo`** (most reliable Last.fm art; track/artist getInfo art is frequently the grey-star placeholder); (2) **never use the grey-star placeholder** (`2a96cbd8b46e442fc41c2b86b821562f`) or an empty `#text` — a track with real cover art must NEVER regress to a broken/placeholder image (ENRICH-02 is non-negotiable and overrides D-03); (3) only swap when the Last.fm image is **strictly larger / higher-res**, otherwise keep the source cover; (4) **preload** the Last.fm image before swapping the now-playing background so the swap is not a jarring flash; (5) the swap is best-effort and async — it never delays first paint or playback.

### Tags presentation
- **D-05:** Show up to **top 5** tags as chips.
- **D-06:** Chips are **display-only in Phase 8** (non-interactive). Wiring them tappable → discovery is **Phase 9** work (the discovery tab does not exist yet). Build the chip component so Phase 9 can make it tappable without a rewrite.

### Artist bio handling
- **D-07:** Show a **short paragraph** (first ~2-3 sentences) of the Last.fm artist bio, **HTML stripped**, **English as-is** (Last.fm bios are English-only; no translation in Phase 8 — keeps it simple, avoids a translate call/latency).
- **D-08:** **Always render the Last.fm attribution link** ("Read more on Last.fm" → the bio's `content`/`url`) — REQUIRED by Last.fm ToS for displayed bios. This is locked regardless of length/language.

### Claude's Discretion (planner/researcher decide — within the locked guardrails above)
- Proxy route shape for read calls: a dedicated `/api/lastfm/...` read route mirroring `/api/similar`, vs riding the `/api/[source]/[...path]` catch-all as `source=lastfm`. Research ARCHITECTURE.md recommends the catch-all for read-only methods; the `/api/similar` precedent is a dedicated route. Planner picks — key stays edge-only either way.
- Enrichment trigger timing (on play vs on view vs both) and edge caching (Cache API TTLs — research suggests getInfo ~24h) — provided enrichment stays async + off the playback path.
- Where enriched fields live on the data model (extend the `Track` type with optional `tags?`/`bio?`/`lastfmArt?` vs a separate enrichment cache keyed by `uid`). The `serializeTrack` whitelist (library persistence) must not break.
- Exact normalization rules inside the `{artist}+{title}` match-key primitive (lowercasing, trim, punctuation/whitespace folding). CJK Traditional/Simplified folding is explicitly a **Phase 13** concern — Phase 8 ships the primitive, Phase 13 may extend it.
</decisions>

<specifics>
## Specific Ideas

- Mirror the shipped `/api/similar` edge route exactly for the read proxy: reads `platform?.env.LASTFM_KEY`, scoped CORS via `corsHeaders` (never `*`), `fetchWithRetry` + `AbortSignal.timeout`, returns a clean shape, **never logs the key or upstream URL**, and treats an absent key as a SUPPORTED 200 state (not a throw).
- The match-key primitive is the same normalization used to align Last.fm names with local tracks — make it a standalone exported helper (sibling to `dedupe.ts`'s `key()`), since Phase 13 loved-sync reconciliation consumes it.
- `names.dn()` (display-name helper) already governs how titles/artists render — enrichment chips/bio should sit alongside it, not fight it.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's contract
- `.planning/ROADMAP.md` §"Phase 8: Last.fm Read Foundation & Metadata Enrichment" — goal, 5 success criteria, ENRICH-01..03, security note (owns Pitfall 8)
- `.planning/REQUIREMENTS.md` — ENRICH-01, ENRICH-02, ENRICH-03 exact wording + Out-of-Scope reversals

### Last.fm v1.1 research (canonical for this milestone)
- `.planning/research/SUMMARY.md` — headline decisions, Phase 8 implications, placeholder-art filter, no-new-deps
- `.planning/research/ARCHITECTURE.md` — read-call routing (catch-all vs dedicated), enrichment service design, where enrichment attaches, match-key primitive
- `.planning/research/PITFALLS.md` — Pitfall 8 (enrichment on critical path + placeholder overwrite), the grey-star hash, error-6 silence, `platform.env` dev-vs-prod
- `.planning/research/FEATURES.md` — track/artist/album.getInfo params + response shapes, image-array handling

### The edge pattern to mirror (existing code)
- `src/routes/api/similar/+server.ts` — exact edge-proxy template (env read, graceful absent-key, CORS, retry, no-leak)
- `src/routes/api/similar/similar-endpoint.test.ts` — the no-leak test pattern (assert key never in body/headers) to replicate
- `src/lib/proxy/http.ts` — `fetchWithRetry`, `corsHeaders`
- `src/lib/proxy/proxy-types.ts` — `Env` (`LASTFM_KEY`, `LASTFM_SECRET`)

### Data + UI integration points
- `src/lib/sources/types.ts` — `Track` shape (uid = `source:songid`), `makeUid`; where optional enrich fields would go
- `src/lib/services/dedupe.ts` — existing `key()` normalization the match-key primitive parallels
- `src/lib/services/similar.ts` — existing client→/api/similar usage + graceful-fallback pattern
- `src/lib/components/NowPlaying.svelte` — now-playing render (`player.current.cover` bg-image, title, artist → `/artist/[name]`); where tag chips + cover swap land
- `src/routes/(app)/artist/[name]/+page.svelte` — artist page to enrich (bio/tags/image)
- `src/routes/(app)/album/[name]/+page.svelte` — album page to enrich (art/info)
- `src/lib/stores/player.svelte.ts` — `player.current` (enrich trigger source)

### Project-level
- `.planning/PROJECT.md` — v1.1 milestone block, boundaries (local-first, edge-only secrets), constraints

### This phase's prior context
- `.planning/phases/01-data-layer-proxy-foundation/01-CONTEXT.md` — D-09 (thin passthrough proxy), D-10 (`source:songid` uid), `platform.env` secret handling
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/api/similar/+server.ts` — copy/adapt as the Last.fm read-proxy template (the single most reusable asset for ENRICH-03).
- `src/lib/proxy/http.ts` (`fetchWithRetry`, `corsHeaders`) — reuse directly in the new read endpoint(s).
- `src/lib/services/dedupe.ts` `key()` — the normalization to generalize into the shared match-key primitive.
- Existing `/artist/[name]` + `/album/[name]` routes — already render per-source data; enrichment augments them (no new routes needed for bio/album-info).
- `src/lib/services/translate.ts` `translateLines()` — available but NOT used in Phase 8 (bio stays English per D-07); relevant only if bio i18n is revisited.

### Established Patterns
- `Track` has NO tags/bio/lastfm fields today — extending it (optional fields) vs a side enrichment cache is a planner decision; `serializeTrack` persistence whitelist must stay intact.
- `names.dn()` (names.svelte.ts) is the display-name layer for titles/artists — enrichment UI coexists with it.
- Secrets via `platform?.env` only; absent key is a first-class supported state (per `/api/similar` + ENRICH-03).

### Integration Points
- New edge read endpoint(s) for getInfo (track/artist/album) — shape per Claude's-discretion routing decision.
- New client enrichment service (sibling to `similar.ts`) returning a clean enriched shape; called async after play/view.
- New shared match-key helper (sibling to `dedupe.ts`).
- UI: tag-chip component (now-playing + reused on artist page), bio block + attribution link (artist page), cover-swap logic (NowPlaying bg-image, with preload guard).
</code_context>

<deferred>
## Deferred Ideas

- Making tag chips tappable → tag discovery — **Phase 9** (discovery tab).
- The Last.fm-searchable source / tap-to-play discovery results — **Phase 10**.
- Bio i18n (translate English bios to zh) — revisit post-v1.1 if users ask; translate.ts is ready.
- CJK Traditional/Simplified folding in the match-key — **Phase 13** (loved-sync reconciliation) may extend the Phase 8 primitive.
- Personal/user-scoped metadata (your tags, your playcount) — needs auth, **Phase 11+**.

No scope creep raised during discussion.
</deferred>

---

*Phase: 08-last-fm-read-foundation-metadata-enrichment*
*Context gathered: 2026-06-06*
