---
phase: 17-up-next-sourcing-settings-plumbing
plan: 01
subsystem: playback
tags: [svelte5-runes, player-store, settings-store, i18n, up-next-sourcing, queue-context]

# Dependency graph
requires:
  - phase: 16-playback-resilience-core
    provides: never-stop engine (regenerate/ensureAhead/buildSimilarQueue), play({fresh}) signature, manualUids side-Set, repeat 2-state
provides:
  - UPNEXT_DEFAULTS config group (UpnextMode + QueueContext types) in defaults.ts
  - settings.upnextMode/upnextPerContext persisted fields + effectiveUpnextMode(ctx) resolver
  - player.queueContext $state field (not persisted) + context-threaded setQueue/playStub
  - per-context fresh-play branch (generated->regenerate, same-list->ensureAhead snapshot)
  - autoExpandOnPlay fresh-only guard (D-05 track-change auto-expand fix)
  - Settings -> Playback per-context Up-next sourcing selector (8 contexts)
  - ALL Phase-17 new i18n keys batched across all 15 locales (sole i18n owner)
affects: [17-02 queue-clear/swipe-remove, 17-03 text-size demo, 17-04 deezer enrichment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-context mode resolution: config default group (UPNEXT_DEFAULTS) -> persisted per-context map -> resolver method on the leaf settings store"
    - "Origin tracking as ONE player $state field (queueContext), never a per-Track field — mirrors manualUids side-state discipline"
    - "Context threaded through the single setQueue/playStub write path; never a second queue-write path"
    - "Phase owns ALL i18n keys in one batch (Wave-1 plan) so Wave-2 plans consume via t(...) with no locale-file write conflict"

key-files:
  created: []
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/settings/playback/+page.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/+page.svelte
    - src/lib/i18n/{en,zh-Hant,zh-Hans,es,fr,de,pt,it,ru,tr,ar,hi,id,vi,th}.ts

key-decisions:
  - "queueContext is intentionally NOT persisted (reload -> null -> global 'generated' default, the safe behavior)"
  - "playStub gets an optional trailing context arg threaded into its single internal setQueue (Open Question 2 resolution)"
  - "Per-context labels reuse existing surface keys (library.liked/playlists/downloads, history.heading) — only ctxSearch/ctxAlbum/ctxArtist/ctxHomeDiscovery are net-new"
  - "Non-en/zh locales get English placeholders for the 16 new keys (consistent with their machine-translated headers); zh-Hant/zh-Hans get real translations"

patterns-established:
  - "effectiveUpnextMode(ctx): perContext[ctx] ?? global upnextMode; null ctx -> global default"
  - "auto-expand fires only when opts?.fresh && settings.autoExpandOnPlay"

requirements-completed: [QUEUE-01, QUEUE-02, QUEUE-03]

# Metrics
duration: 12min
completed: 2026-06-11
---

# Phase 17 Plan 01: Up-Next Sourcing + Settings Plumbing Summary

**Per-context up-next sourcing (`'same-list' | 'generated'`, global default `generated`) layered onto the existing never-stop engine via a new `queueContext` player field, an `effectiveUpnextMode` settings resolver, a Settings → Playback selector, and a fresh-only auto-expand guard — plus all 16 Phase-17 i18n keys batched across 15 locales.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-11T00:22:00Z
- **Completed:** 2026-06-11T00:33:00Z
- **Tasks:** 4
- **Files modified:** 24

## Accomplishments
- `UPNEXT_DEFAULTS` config group with `UpnextMode`/`QueueContext` types (defined in `defaults.ts` so player + settings import without a circular dep), registered in `DEFAULTS`.
- `settings.upnextMode` + `upnextPerContext` persisted fields with a defensive load() parse (T-17-01 mitigation), reset-wired, plus the `effectiveUpnextMode(ctx)` resolver. Settings stays a leaf store (imports nothing from player).
- `player.queueContext` `$state` field (NOT persisted); `setQueue`/`playStub` thread an optional context arg through the single queue-write path.
- Per-context fresh-play branch: `generated` → `regenerate` (genre-similar), `same-list` → `ensureAhead` snapshot that still grows on exhaust (D-03). Non-fresh plays never regenerate.
- D-05 auto-expand fix: the nowbar auto-expand now fires ONLY on `opts.fresh` user-initiated plays, never on auto-advance/failover/queue-progression.
- Settings → Playback per-context selector (8 contexts, Same-list/Genre-generated `.seg` toggles; settings-only per D-02).
- Context threaded at the home/library/search call sites this plan owns (search `'search'`, library liked/downloads/playlist + history `'history'`, home setQueue/playStub `'home-discovery'`).
- All 16 new Phase-17 i18n keys added to all 15 locales (up-next sourcing + ctx labels, `nowplaying.clearQueue`, `settings.demoPrefix`, `deezer.*`).

## Task Commits

1. **Task 1: UPNEXT_DEFAULTS + settings resolver** - `c5127d6` (feat)
2. **Task 2: queueContext field + context-threaded play + per-context fresh-play branch** - `ab54148` (feat)
3. **Task 4: batch all Phase-17 i18n keys across all 15 locales** - `fe1d80f` (feat)
4. **Task 3: per-context selector + thread context through call sites** - `5994103` (feat)

_Note: Task 4 (i18n) was committed before Task 3 because Task 3's `svelte-check` gate consumes the keys Task 4 creates. TDD Tasks 1 and 2 were each implemented + tested in a single feat commit (extending existing test files, RED verified by running the new cases)._

## Files Created/Modified
- `src/lib/config/defaults.ts` - UpnextMode/QueueContext types + UPNEXT_DEFAULTS group, registered in DEFAULTS
- `src/lib/stores/settings.svelte.ts` - upnextMode/upnextPerContext fields, load/save/resetPlayback wiring, effectiveUpnextMode resolver
- `src/lib/stores/settings.svelte.test.ts` - 7 QUEUE-03 behavior cases (resolver, fallback, reset, malformed/absent parse)
- `src/lib/stores/player.svelte.ts` - queueContext field, context-threaded setQueue/playStub, fresh-only auto-expand guard, per-context fresh-play branch
- `src/lib/stores/player.svelte.test.ts` - 8 QUEUE-01/03 + D-05 cases (extended, not replaced)
- `src/routes/(app)/settings/playback/+page.svelte` - per-context Up-next sourcing selector section
- `src/routes/(app)/search/+page.svelte` - setQueue(results, 'search')
- `src/routes/(app)/library/+page.svelte` - tab-mapped context (liked/playlist/downloads) + history 'history'
- `src/routes/(app)/+page.svelte` - 'home-discovery' on setQueue/playStub call sites
- `src/lib/i18n/{en,zh-Hant,zh-Hans,es,fr,de,pt,it,ru,tr,ar,hi,id,vi,th}.ts` - 16 new keys each (15 files)

## Decisions Made
- `queueContext` left out of the persist serializer so a reload starts `null` → global `generated` (safe default). Verified by a test asserting the persisted snapshot has no `queueContext` property.
- `playStub` received an optional trailing `context` arg (Open Question 2 recommendation) so its one internal `setQueue([tr], context)` receives the origin — preserves the one-write-path discipline.
- Per-context labels reuse `library.liked`/`library.playlists`/`library.downloads`/`history.heading` (existing) and add only `ctxSearch`/`ctxAlbum`/`ctxArtist`/`ctxHomeDiscovery` (i18n minimization, Pitfall 4).
- `library` tab `'playlists'` maps to the `'playlist'` QueueContext token (singular) inside `playList`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a JSDoc comment to keep the leaf-store acceptance grep accurate**
- **Found during:** Task 1
- **Issue:** The plan's acceptance grep `grep -v '^//' settings.svelte.ts | grep -c "import.*player"` expects 0, but a JSDoc line I wrote ("resolver imports nothing from player") matched because `grep -v '^//'` only strips lines starting with `//`, not block-comment continuation lines (` *`). No real player import exists — it was a false positive.
- **Fix:** Reworded the comment to "depends on no other store" so the grep returns 0 and the leaf invariant reads unambiguously.
- **Files modified:** src/lib/stores/settings.svelte.ts
- **Verification:** `grep -v '^//' ... | grep -c "import.*player"` returns 0; settings genuinely imports nothing from player.
- **Committed in:** c5127d6 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — cosmetic, to satisfy an acceptance grep).
**Impact on plan:** No functional deviation. All four tasks executed as written; no architectural changes, no new dependencies (confirmed zero-dep phase per RESEARCH).

## Issues Encountered
- The plan referenced a `17-PATTERNS.md` that does not exist in the phase directory; used `17-RESEARCH.md` (which contains the same Pattern 1/2 + pitfalls + call-site grep) and `17-CONTEXT.md`-derived decisions instead. No impact — RESEARCH carried the needed seams.
- Plan verify blocks say `pnpm vitest`/`pnpm svelte-check`; the project's actual scripts are `pnpm test` (vitest --run) and `pnpm check` (svelte-kit sync && svelte-check). Used `pnpm vitest run <file>` (works directly) for per-task runs and `pnpm check`/`pnpm test` for the gates. All green.

## Threat Surface
No new network endpoints, auth paths, or trust boundaries beyond the plan's threat model. T-17-01 (untrusted `upnextPerContext` on load) is mitigated by the object-not-array defensive parse + 2-value-union validation for `upnextMode`. T-17-03 (no new blob/object-URL) confirmed — only the queue array + a string field are mutated. No `threat_flag` surface found.

## Verification
- `pnpm vitest run src/lib/stores/settings.svelte.test.ts` — 9 passed (7 new QUEUE-03 cases)
- `pnpm vitest run src/lib/stores/player.svelte.test.ts` — 47 passed (8 new cases, no regression to prior 39)
- `pnpm vitest run src/lib/i18n/i18n.test.ts` — 11 passed (15-locale parity)
- `pnpm check` (svelte-check) — 0 errors, 0 warnings (Dict parity + QueueContext/UpnextMode types compile)
- `pnpm test` (full suite) — 477 passed across 44 files (no regression)

## Next Phase Readiness
- Plans 02/03/04 (Wave 2) can now consume the batched i18n keys (`nowplaying.clearQueue`, `settings.demoPrefix`, `deezer.*`) via `t(...)` with no locale-file edits.
- `player.queueContext`, `setQueue(tracks, ctx)`, `playStub(..., ctx)`, and `settings.effectiveUpnextMode(ctx)` are available for the queue-clear/swipe-remove work (Plan 02).
- Artist/album page call sites (`artist/[name]`, `album/[name]`) were intentionally NOT threaded here — they are owned by Plan 04 (Deezer enrichment) per the plan's call-site ownership note.

---
*Phase: 17-up-next-sourcing-settings-plumbing*
*Completed: 2026-06-11*

## Self-Check: PASSED
- FOUND: src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/lib/stores/player.svelte.ts, src/routes/(app)/settings/playback/+page.svelte, src/lib/i18n/en.ts
- FOUND commits: c5127d6, ab54148, fe1d80f, 5994103
