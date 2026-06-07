---
quick_id: 260607-jip
slug: more-like-this-shelf-on-artist-page-deez
date: 2026-06-07
status: complete
commits:
  - bad6185
---

# Quick Task 260607-jip — Wire jau's Deezer helpers into real consumers

Two consumers for the helpers added in jau (`deezerRelatedArtists`, `deezerSearchTopN`).

## 1. More like this shelf — artist page
**File:** `src/routes/(app)/artist/[name]/+page.svelte` (+ i18n)
- New `related: RelatedArtist[]` $state + race-guarded `$effect` keyed on `name`.
- `getSimilarArtists()` chain (Last.fm primary → Deezer fallback via jau → []). Per-name
  avatar via `deezerArtistCover` at concurrency 4 (`mapWithConcurrency`).
- Markup: round artist tiles below "Hit songs". `.al-cover.round` + `.al-name.center`
  variants added locally (parallel to home-page tile styles). Tap = goto artist page.
- 1 new i18n key `artist.moreLikeThis` × 15 locales.

## 2. Deezer-boosted dedupe — cross-source quality picks
**Files:** new `src/lib/services/dedupe-deezer.ts`, wired into `src/routes/(app)/search/+page.svelte`
- `dedupeBestWithDeezer(tracks, preferred, signal)` async wrapper:
  1. Run sync `dedupeBest` → baseline winners + dedup order.
  2. Re-group **input** by matchKey (full candidate sets per group).
  3. Multi-candidate groups → fire `deezerSearchTopN(title+artist, 2)` at concurrency 3.
     Important: limit MUST be >1 — proxy only populates `results[]` on `>1`; `limit=1`
     is the cover-only backcompat path (caught + fixed during live verify).
  4. `scoreAgainstDeezer` (pure, exported): title (0/2/3) + artist (0/2/4) + album (0/1/3).
  5. Highest non-baseline score swaps in; ties keep baseline so sync quality/source-rank
     stays the floor.
  6. Singletons + Deezer miss + abort → baseline unchanged. Never throws.
- Wired into `/search` AFTER first paint: sync `dedupeBest` paints immediately;
  `dedupeBestWithDeezer` runs in the background and swaps `results` when it returns.
  Aborts on supersede (`myAc.signal.aborted || kw !== q.trim()` guard, same as the rest
  of `run()`).

## Verification (live preview)
- **Artist page** `/artist/Daft%20Punk`: section "More like this" renders 6 round avatars
  with real Deezer artist pictures — Justice, Modjo, Stardust, Thomas Bangalter, Kavinsky,
  Cassius.
- **Dedupe boost trace**: two candidates for the same matchKey
  (Kygo "Stargazing"). `netease:1` has wrong album ("Random Album"), `joox:2` has
  Deezer-canonical album ("Stargazing - EP"). Deezer top hit: Kygo "Stargazing - EP".
  - `scoreAgainstDeezer(netease)` = **7** (title+artist match, album miss).
  - `scoreAgainstDeezer(joox)` = **10** (title+artist+album all match).
  - Sync `dedupeBest(preferred=netease)` picks `netease:1` (source rank 4 > 1).
  - `dedupeBestWithDeezer` **flips** to `joox:2` — album signal overrode the static
    SOURCE_RANK floor. **flipped: true** ✓.
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.

## Notes / follow-ups
- The boost runs on `/search` only. Home picks + similar.ts + resolveStub continue using
  sync `dedupeBest` (cheaper; matters less on those paths).
- A future task could memo the Deezer hits in `services/ttl-cache.ts` so a same-search
  re-run doesn't re-query Deezer for the same groups. Today each search hits Deezer fresh
  (max 3 in-flight per multi-candidate group); for typical search-result sizes (≤20 with
  ≤5 multi-candidate groups) that's ≤5 extra calls per search.
- `scoreAgainstDeezer` is exported pure → testable in isolation; no unit tests written
  this task but the design is ready for them.
