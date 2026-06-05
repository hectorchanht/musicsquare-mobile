---
phase: 01-data-layer-proxy-foundation
plan: 02
subsystem: api
tags: [sveltekit, source-adapter, proxy-adapter, qq, kuwo, vitest, data-layer]

# Dependency graph
requires:
  - phase: 01-01
    provides: SourceAdapter/ProxyAdapter contracts, makeUid, inferQualityFromUrl, SOURCES/PROXIES registries, /api/[source]/[...path] proxy route, Netease reference adapter
provides:
  - QQ client adapter (search + resolve) with verbatim dual-format guard and no-detailsLoaded-on-failure retry semantics
  - Kuwo client adapter (search + resolve) with rid keying, level=zp lossless, throw-on-code-mismatch
  - QQ + Kuwo proxy adapters (upstream URL builders, no auth) mapping /api/qq/* and /api/kuwo/* onto tang + cenguigui endpoints
  - Fixture-backed unit tests (13 total) covering normalization, dual-format contract-drift, quality priority, and retry semantics
affects: [01-03 (JOOX adapter — same pattern), catalog aggregation, Phase 4 source-status UX]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Search-then-detail source: search returns audioUrl=null stubs; resolve() lazily populates audioUrl+lrc+quality (unlike Netease which has audioUrl at search time)"
    - "Contract-drift = THROW (not swallow-and-return-0) so Promise.allSettled records a typed per-source error"
    - "Single upstream endpoint, path-segment-keyed proxy (/api/<src>/search vs /detail) distinguished by params (mid / id+type=song)"

key-files:
  created:
    - src/lib/sources/qq.test.ts
    - src/lib/sources/kuwo.test.ts
    - src/lib/sources/__fixtures__/qq.search.json
    - src/lib/sources/__fixtures__/qq.detail.json
    - src/lib/sources/__fixtures__/kuwo.search.json
    - src/lib/sources/__fixtures__/kuwo.detail.json
  modified:
    - src/lib/sources/qq.ts
    - src/lib/proxy/qq.ts
    - src/lib/sources/kuwo.ts
    - src/lib/proxy/kuwo.ts

key-decisions:
  - "QQ search and detail share ONE tang upstream endpoint; the proxy routes /api/qq/search vs /api/qq/detail to the same URL, distinguished only by presence of mid (legacy used no real path)"
  - "Kuwo search vs detail routed by params in the proxy (name= for search list, id=&type=song&level=zp for detail) against one cenguigui host"
  - "QQ resolve re-throws on failure (instead of legacy silent catch) so the fan-out sees the error, but detailsLoaded stays false — preserving retry-on-next-play"

patterns-established:
  - "Pattern 1: DATA-04 acceptance demonstrated in practice — adding QQ + Kuwo touched ONLY their 4 adapter files + tests/fixtures; registry.ts, proxy-registry.ts, types.ts, +server.ts untouched"
  - "Pattern 2: Dual-format guard ported verbatim — Array.isArray(json)?json:json?.data — with neither-shape mapped to a thrown contract-drift error"

requirements-completed: [SRC-01, DATA-01]

# Metrics
duration: 8min
completed: 2026-06-05
---

# Phase 1 Plan 02: QQ + Kuwo Adapters Summary

**Ported the QQ and Kuwo search-then-detail source/proxy adapters from the monolith — preserving the QQ dual-format guard and no-detailsLoaded-on-failure retry semantics and Kuwo's level=zp lossless + code!==200 throw — by filling ONLY the four adapter bodies, proving the DATA-04 zero-shared-edit acceptance test.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-05T14:33:00Z
- **Completed:** 2026-06-05T14:41:54Z
- **Tasks:** 2
- **Files modified:** 10 (4 adapters, 2 tests, 4 fixtures)

## Accomplishments
- QQ client+proxy adapters: dual-format guard (`Array.isArray(json)?json:json?.data`) ported verbatim; throws typed contract-drift on neither-shape bodies; quality priority sq>pq>accom>hq>standard>fq>fallback; colon uid `qq:<song_mid>`; resolve leaves `detailsLoaded=false` on failure for retry-on-next-play.
- Kuwo client+proxy adapters: search keyed by `rid` → colon uid `kuwo:<rid>`, throws contract-drift on `code!==200`/missing data; resolve uses `level=zp` lossless, inline lyric, `lrcUrl=null`, `inferQualityFromUrl` quality, throws on `code!==200` (legacy model preserved).
- 13 fixture-backed unit tests (7 QQ + 6 Kuwo), all green; `pnpm check` strict passes with 0 errors / 0 warnings.
- DATA-04 acceptance proven: `git diff --name-only` lists exactly the 10 QQ/Kuwo adapter/test/fixture files — no edits to `registry.ts`, `proxy-registry.ts`, `types.ts`, or `+server.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: QQ adapter — dual-format guard, quality priority, retry-on-failure** - `2cd903a` (feat)
2. **Task 2: Kuwo adapter — rid keying, level=zp lossless, throw-on-code-mismatch** - `87c4917` (feat)

_Note: each TDD task's failing-test + implementation were authored together and committed as one feat commit (implementation + passing fixture tests in the same atomic unit)._

## Files Created/Modified
- `src/lib/sources/qq.ts` - QQ client adapter: `searchQQ` + `fetchQQDetails`/`pickBestPlayUrl` ported; same-origin `/api/qq/*` fetch; dual-format guard; retry semantics.
- `src/lib/proxy/qq.ts` - QQ proxy adapter: builds `tang.api.s01s.cn/music_open_api.php?...&type=json[&mid=]`; search vs detail by `mid` presence.
- `src/lib/sources/kuwo.ts` - Kuwo client adapter: `searchKuwo` + `fetchKuwoDetails` ported; same-origin `/api/kuwo/*` fetch; rid keying; level=zp lossless.
- `src/lib/proxy/kuwo.ts` - Kuwo proxy adapter: builds `kw-api.cenguigui.cn/?...`; search (`name=`) vs detail (`id=&type=song&level=zp&format=json`).
- `src/lib/sources/qq.test.ts` - 7 tests: bare-array shape, wrapped shape, contract-drift throw, quality priority, hq fallthrough, two retry-semantics cases.
- `src/lib/sources/kuwo.test.ts` - 6 tests: rid normalization, two contract-drift throws, resolve (lossless + 320k), code-mismatch throw.
- `src/lib/sources/__fixtures__/qq.search.json` - bare-array QQ search body (song_mid/song_title/singer_name/pay).
- `src/lib/sources/__fixtures__/qq.detail.json` - QQ detail body with sq/pq/hq/standard/fallback play URLs + inline lyric.
- `src/lib/sources/__fixtures__/kuwo.search.json` - `{code:200,data:[{rid,name,artist,album,pic}]}` search body.
- `src/lib/sources/__fixtures__/kuwo.detail.json` - `{code:200,data:{...url,lyric}}` detail body (`.flac` lossless url).

## Decisions Made
- **QQ proxy path semantics:** legacy used a single tang endpoint for both search and detail (distinguished only by `&mid=`). The client calls `/api/qq/search` vs `/api/qq/detail`; the proxy maps both to the same upstream and forwards `msg`/`mid`. This keeps the proxy a thin passthrough (D-09) while staying uniform with the per-source path convention Netease established.
- **Kuwo proxy path semantics:** same single-host approach; the proxy branches on the path segment to forward the right param set (`name`/`page`/`limit` for search; `id`/`type=song`/`level=zp`/`format=json` for detail).
- **QQ resolve error handling:** the monolith silently swallowed detail errors (logged, left `detailsLoaded` false). The adapter re-throws so the fan-out / caller sees a typed error, but crucially the throw happens BEFORE `detailsLoaded=true`, so the retry-on-next-play invariant (legacy:2392-2395) is preserved — verified by a test asserting `detailsLoaded===false` after a failed resolve.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria, verification commands, and DATA-04 zero-shared-edit constraint were satisfied without any auto-fixes.

## Issues Encountered
None. `node_modules` was absent in the fresh worktree (expected) and installed via `pnpm install` before tests.

## Threat Model Compliance
- **T-01-05a (QQ shape drift):** mitigated — dual-format guard preserved verbatim; neither-shape body throws typed contract-drift (qq.test.ts "THROWS on a body that is neither array nor {data:[]}").
- **T-01-05b (Kuwo code!==200):** mitigated — search and resolve both throw on `code!==200`/missing data (kuwo.test.ts contract-drift + detail-failed tests).
- **T-01-03 (XSS):** adapters return plain strings into Track; no `{@html}`, no source-HTML interpolation.
- **T-01-06 (QQ pay):** accepted — `pay` captured as a plain string into `pay`/`qqQualityText` for Phase-4 UX; non-secret upstream metadata.

## User Setup Required
None - no external service configuration required (QQ + Kuwo are token-free; only JOOX needs a secret, handled in 01-03).

## Next Phase Readiness
- 3 of 4 sources (Netease, QQ, Kuwo) now search + resolve end-to-end through the same-origin `/api/*` proxy.
- 01-03 (JOOX, running in parallel) is the last source; it follows the identical adapter-only pattern plus the token-injection + URL-probe specifics.
- DATA-04 acceptance is demonstrated twice over (QQ + Kuwo) — the registry/aggregation seam holds.

## Self-Check: PASSED

- All 10 adapter/test/fixture files verified present on disk.
- SUMMARY.md present.
- Both task commits (`2cd903a`, `87c4917`) verified in git log.

---
*Phase: 01-data-layer-proxy-foundation*
*Completed: 2026-06-05*
