---
quick_id: 260607-hvu
slug: album-actions-wiring-verify-cross-source
date: 2026-06-07
status: complete
---

# Quick Task 260607-hvu — Album-actions + fallback verify + new source

Decisions in CONTEXT.md. Research recommendations in RESEARCH.md (5sing recommended;
Jamendo deferred).

## Task 1 — Album-actions fixes (Part A)
**File:** `src/routes/(app)/album/[name]/+page.svelte`
- **Download**: real file save per track via fetch→blob→anchor.click (was only library
  add). Staggered 250ms apart. Final toast counts saved files.
- **Like-all**: idempotent — if any unliked, like missing ones; if all already liked,
  unlike them all (toggle-when-full).
- Immediate "preparing..." toast on like + add-to-playlist for visible feedback during
  the ~10s resolveAll fan-out.

## Task 2 — Verify cross-source fallback (Part B)
Walk the path; runtime trace; **fix only if broken**.
- `<audio> error` → `runFallback` → `tryFallback` → `play(swap, fromFallback:true)`.
- `playGen` supersedence + `AbortController` watchdog.
- If healthy, document the trace in SUMMARY. No code change expected.

## Task 3 — Add 5sing (Part C, from RESEARCH.md)
Per the researcher's recommendation. Ships **`enabledByDefault: false`**.

**Files:**
- `src/lib/sources/types.ts` — widen `SourceId` to include `'fivesing'`; add
  `fivesingSongType?: 'fc' | 'bz' | 'yc'` to Track extras.
- `src/lib/sources/fivesing.ts` (new) — `SourceAdapter`. Strips `<em class="keyword">`
  HTML. uid folds songtype: `fivesing:<type>-<id>` (songId NOT unique across types).
  Defensive recovery in `resolve()` for older saved tracks.
- `src/routes/api/fivesing/search/+server.ts` (new) — proxy →
  `http://search.5sing.kugou.com/home/json`. http (TLS cert mismatch confirmed).
- `src/routes/api/fivesing/url/+server.ts` (new) — proxy →
  `http://mobileapi.5sing.kugou.com/song/getSongUrl`. Validates songtype at the edge.
- `src/lib/sources/registry.ts` + `.test.ts` — enumerate; bump EXPECTED_KEYS.
- `src/lib/proxy/proxy-registry.ts` — `PROXIES` becomes `Partial<Record<…>>` because
  fivesing uses dedicated routes; catch-all 404s absent ids.
- `src/lib/services/dedupe.ts` — `SOURCE_RANK.fivesing = 0` (UGC never wins ties).
- `src/app.css` — `--src-fivesing` color.

## Must-haves
- Album Download saves real files for every track.
- Album Like is idempotent and toggles when all are already liked.
- Cross-source fallback documented as up and working (no regression).
- `searchAll(q, 1, { fivesing: true })` returns 5sing tracks with properly folded uids
  and stripped HTML.
- `pnpm check` 0/0, tests pass, build OK.
