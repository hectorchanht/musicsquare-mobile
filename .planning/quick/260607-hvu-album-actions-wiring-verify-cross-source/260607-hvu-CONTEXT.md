# Quick Task 260607-hvu — Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Task Boundary

Three asks:
- **PART A** — Wire the album-page action bar so each button acts on ALL album tracks.
- **PART B** — Verify cross-source fallback (SRC-FB-01) from gte still works; fix if broken.
- **PART C** — Add 1–2 new song sources informed by upstream `CharlesPikachu/musicsquare`
  + `CharlesPikachu/musicdl` (a researcher will recommend the best candidates).
</domain>

<decisions>
## Implementation Decisions

### Album "Like" semantics (locked via AskUserQuestion)
- **Like the missing ones (idempotent)**. If any track in the album is not liked yet, like
  the missing ones. If ALL tracks are already liked, the tap unlikes them all (so the user
  has a way to undo). Predictable + the most common mental model.

### Album action fan-out (Claude's discretion)
- **Download**: throttled to 3 concurrent re-resolves via `mapWithConcurrency` (already
  used elsewhere in the codebase for fan-out caps). Each track re-resolved at
  `settings.downloadQuality` then triggered via the existing per-track download path.
- **Add to playlist**: open the existing playlist picker UI once (today's per-track
  picker), then on selection append EVERY track (deduped by uid) to the chosen playlist.
- **Like**: pure local state operation (library.toggleLike), no network — runs synchronously.
- **Share**: today's share path stays; just confirm the URL still resolves.
- **albumBusy** flag remains the row-disable while any async fan-out is in flight.

### Cross-source fallback (Part B) — Claude's discretion
- Trace the path: `<audio> 'error'` event → `runFallback(failed)` → `tryFallback()`
  (services/fallback.ts) → `searchAll → dedupeBest → ensureTrackDetails` for each
  remaining source, preferred-source first. Confirm `playGen` supersedence still
  guards a concurrent newer play(). If any link is broken, fix it minimally.

### Sources to add (Part C) — researcher will recommend, planner will lock
- The researcher fetches musicsquare + musicdl READMEs and the per-source adapter files
  to enumerate candidates. Recommends 1–2 with: catalog gap covered, no signed-secret,
  stable public API or proxy reachable from a Cloudflare edge function, shipable in this
  task. Constraint already known: `ytmusic` deferred to v2 per STATE.md (instance failover
  + s-checksum drift).
- Adapter shape MUST match `SourceAdapter` in src/lib/sources/types.ts so the registry
  pattern (DATA-04: no source named outside the registry) holds. New source = new client
  adapter file + new edge proxy file + one line in registry + i18n strings if user-facing.

</decisions>

<specifics>
## Specific Ideas

- The `mapWithConcurrency` helper lives in `src/lib/services/discovery.ts` — already used
  by the home page's fan-out (FANOUT_CAP = 4). Reuse, don't reinvent.
- The album page already imports `library` for Like state and the playlist picker — wiring
  is glue, not new infrastructure.
- The cross-source fallback file is `src/lib/services/fallback.ts` (added by gte). The
  wiring point is the `<audio>` element's `error` handler + `play()`'s no-audioUrl branch
  inside `src/lib/stores/player.svelte.ts`.

</specifics>

<canonical_refs>
## Canonical References

- musicsquare upstream (CN-platform desktop player, same author):
  https://github.com/CharlesPikachu/musicsquare
- musicdl (~20-source downloader, candidate adapters):
  https://github.com/CharlesPikachu/musicdl
- STATE.md `Blockers/Concerns` — `ytmusic` deferred to v2 (instance failover risk).
- SourceAdapter contract: src/lib/sources/types.ts.
- Registry: src/lib/sources/registry.ts.

</canonical_refs>
