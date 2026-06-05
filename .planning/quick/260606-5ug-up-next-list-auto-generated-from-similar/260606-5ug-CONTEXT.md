# Quick Task 260606-5ug: Smarter up-next (similar-vibe gen + reorder + length) - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Task Boundary

Three changes to the now-playing **Up-Next** (queue) experience in `src/lib/components/NowPlaying.svelte` + `src/lib/stores/player.svelte.ts`:

1. Up-next is auto-generated from songs **similar in vibe/genre** to the current track. It **regenerates when the user clicks a new song to play**, but **preserves** any songs the user added manually (Play Next / Add to Queue) or reordered.
2. Up-next rows are **reorderable** by dragging a handle at the far right of each row.
3. Show **song length** for the current track.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Similar-vibe generation (feature 1) — Last.fm `artist.getSimilar`
- Use the **Last.fm API `artist.getSimilar`** method (https://www.last.fm/api/rest) to get artists similar to `player.current.artist` based on Last.fm listening-network data. This is the real "similar vibe/genre" signal (no genre metadata exists in the Track model).
- **Key handling — server-side, mirror the JOOX_TOKEN pattern:**
  - Add `LASTFM_KEY` to `App.Platform.env` in `src/app.d.ts`.
  - Document it in `.dev.vars` (gitignored) for local `wrangler dev`; prod via `wrangler pages secret put LASTFM_KEY`.
  - New SvelteKit proxy endpoint (e.g. `src/routes/api/similar/+server.ts`) that reads `platform.env.LASTFM_KEY`, calls Last.fm `artist.getSimilar`, and returns a clean list of similar artist names. The key MUST never reach the client bundle (same threat model as JOOX_TOKEN / T-01-04).
- **Pipeline:** similar artists → for top N (~6-8) run the existing `searchAll(artist, 1)` → take each artist's top track → `dedupeBest` → exclude current + manual uids → that is the generated up-next.
- **Graceful fallback (REQUIRED):** if `LASTFM_KEY` is missing, or Last.fm errors / returns nothing, fall back to **same-artist** search `searchAll(current.artist)` (the current Related-tab behavior). The feature must work end-to-end even before a key is configured, just with less variety.
- New service module, e.g. `src/lib/services/similar.ts` (`getSimilarArtists(artist)` + `buildSimilarQueue(track, excludeUids)`), unit-tested with a fixture (Vitest, mirroring existing service tests).

### Queue regeneration + manual preservation (feature, defaulted — user skipped this gray area)
- Tag each queue entry's **origin**: `'manual'` vs `'auto'`. Implement via a `Set<string>` of manual uids on the player (plus the existing `queue: Track[]`), so Track objects stay clean.
- **Manual = preserved:** tracks added via `playNext()` / `addToQueue()`, AND any track the user **reorders** (drag pins it manual).
- **Regenerate trigger:** a *fresh, user-initiated* play (user taps a song in a list → `setQueue`+`play`, or otherwise starts a new song that is NOT auto-advance `next()`/`prev()` within the existing queue). On that event: rebuild the **auto** portion from the new current track's similar songs; **keep** all manual entries.
- **Ordering:** `current` first → manual entries (in their existing order) → generated/auto similar tracks.
- Keep the existing **auto-grow** (`ensureAhead`) so the queue never runs dry; auto-grown tracks are `'auto'` (cleared on next regen). `next()`/`prev()`/auto-advance must NOT trigger regen.

### Song length (feature 3) — current track only
- Show **mm:ss length for the current track only**, NOT per row in lists (user's explicit choice, given no source returns duration at search time — all 4 proxies strip it).
- Implement with the existing `fmtTime()` helper + `player.currentTime` / `player.duration`: add **elapsed / total** time labels around the now-playing progress bar in `NowPlaying.svelte` (e.g. `1:23 / 4:05`). Duration comes from the `<audio>` `loadedmetadata` (already wired in the store).
- NOTE — deviation from the literal request ("length on the right of each song row"): user picked "current track only" after the data constraint was surfaced. Per-row length is out of scope for this task.

### Reorder UX (feature 2) — pointer drag, pins manual
- **Custom touch/pointer drag** (NOT native HTML5 DnD — poor on touch). Match the existing pointer-drag style already in `NowPlaying.svelte` (grip/cover use `onpointerdown/move/up` + `setPointerCapture`).
- Drag **handle at the far right** of each up-next row (use a lucide `GripVertical` icon).
- Dragging reorders `player.queue`; the dragged track is **pinned as manual** (added to the manual uid set) so the next regen preserves it.
- Handles appear only on the **Up-Next (queue) tab** rows — not Lyrics/Related.
</decisions>

<specifics>
## Specific Ideas

- The **Related tab already implements same-artist similarity** (`searchAll(t.artist, 1)` → dedupe → top 20) — reuse this exact pattern as the fallback path, and as the model for the Last.fm-seeded multi-artist search.
- `buildDiversePicks` in `src/lib/services/picks.ts` is the model for "search N artists in parallel, take tops, dedupe, exclude uids" — `buildSimilarQueue` is the similar-seeded sibling of it.
- Player store already has: `queue`, `setQueue`, `playNext`, `addToQueue`, `ensureAhead` (auto-grow), `next/prev`, `play`. The regen + origin-tracking layers onto these.
- `fmtTime()` is exported from `player.svelte.ts` already.
</specifics>

<canonical_refs>
## Canonical References

- Last.fm API: https://www.last.fm/api/rest — method `artist.getSimilar` (params: `artist`, `api_key`, `format=json`, optional `limit`). Free API key via Last.fm account.
- Env/secret pattern to mirror: `JOOX_TOKEN` in `.dev.vars`, `src/app.d.ts` (`App.Platform.env`), `src/routes/api/[source]/[...path]/+server.ts` (reads `platform.env`), prod via `wrangler pages secret put`.
- Threat model: client-secret exposure — see `src/routes/api/proxy.test.ts` (JOOX_TOKEN never proxied as `undefined`, never on client).
</canonical_refs>
