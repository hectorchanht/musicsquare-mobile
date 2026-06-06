# SECURITY.md — Phase 10: Last.fm searchable source / re-search resolver (best-match scoring)

**Audit date:** 2026-06-06
**ASVS level:** 2
**block_on:** high
**Register source:** `10-01-PLAN.md` `<threat_model>` (register_authored_at_plan_time = true)
**Disposition:** SECURED — 3/3 threats CLOSED, 0 open, 0 unregistered flags.

Surface note confirmed against code: Phase 10 adds NO new endpoint, NO new secret, NO new
external call. `scoreMatch` is a pure in-memory ranking function; `resolveStub` reuses the
already-deployed `searchAll` fan-out. No new network/secret surface introduced.

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-10-01 | Spoofing (wrong-song / mismatched content) | mitigate | CLOSED | `src/lib/services/score-match.ts:25-57` (VARIANT_KEYWORDS English+CJK), `:131-148` (variantPenalty), `:80-102` (matchKey similarity reward), `:155-157` (scoreMatch = similarity − penalty); wired in `src/lib/services/discovery.ts:38-50` (stable-max scored pick over dedupeBest); tests `score-match.test.ts:35-103` + `discovery.test.ts:80-99` (clean beats 翻唱/cover ordered-first) |
| T-10-02 | Denial of Service (resolver stalling shared fan-out) | accept (preserve existing control) | CLOSED | `src/lib/services/discovery.ts:32-54` (try/catch → null, never-throws, lazy per-tap, synchronous in-memory scorer adds no I/O); `score-match.ts` has zero I/O imports (only `matchKey` + `Track` type at `:16-17`); per-adapter isolation intact in `catalog.ts:115-138` (each adapter wrapped in `.then/.catch/.finally` under `Promise.all` + AbortSignal guard `:132`); tests `discovery.test.ts:115-121` (zero results → null, throw → null) |
| T-10-03 | Tampering (supply chain — npm/pnpm installs) | mitigate (N/A this phase) | CLOSED | No dependency change: `git diff` over the 5 phase-10 commits (`37069ae`, `9e831df`, `29da8bf`, `a2cb6a1`, `9199195`) touches only `src/lib/services/{score-match,discovery}.{ts,test.ts}` + `.planning/*` — 0 lines in `package.json`/`pnpm-lock.yaml`. `score-match.ts:16` imports only the local `match-key` module (no new package). |

---

## Per-threat detail

### T-10-01 — Spoofing (wrong-song resolution) — CLOSED

Declared mitigation: `scoreMatch` penalizes cover/karaoke/live/instrumental/CJK variant
titles and rewards normalized artist+title (matchKey) similarity so a tap plays the real
song, not a variant.

Verified in code (not documentation):
- `VARIANT_KEYWORDS` (`score-match.ts:25-57`) contains both English (`cover`, `karaoke`,
  `live`, `instrumental`, `remix`, `acoustic`, …) and CJK terms (`翻唱`, `卡拉ok`, `现场`,
  `伴奏`, `纯音乐`, `重制`, …).
- `variantPenalty` (`:131-148`) scans the candidate **title** for keywords not present in the
  query title, subtracting `VARIANT_WEIGHT` (4) each. Word-boundary regex for latin
  (`:116-123`) prevents `Olive`→`live` false positives (CR-01); paired-keyword de-dup
  (`:144-146`) so `live`⊂`live版` counts once (CR-02); query-asked-for-variant exception at
  `:139`.
- `similarity` (`:80-102`) reuses `matchKey` (artist-first normalization from
  `match-key.ts:37`): exact key = `SIM_EXACT` (10), else graded per-component + token overlap.
- `scoreMatch` (`:155-157`) = `similarity − variantPenalty`, pure and deterministic.
- Wired into `resolveStub` (`discovery.ts:41-50`) as a stable max over the dedupeBest list —
  a variant ordered first by `dedupeBest[0]` no longer wins the tap.
- Behavioral proof tests PASS (re-run, 43/43 green across score-match + discovery suites):
  `discovery.test.ts:80-99` asserts a 翻唱/cover candidate ordered FIRST resolves to the
  clean track's uid.

### T-10-02 — DoS (resolver stalling the shared fan-out) — CLOSED (accepted control preserved)

Declared basis: `resolveStub` keeps try/catch → null, never-throws, lazy-per-tap; reuses
searchAll isolation; scorer is synchronous/in-memory with no new I/O.

Verified in code:
- `resolveStub` (`discovery.ts:33-53`) still wraps the whole body in `try { … } catch
  { return null }`; null is returned only on empty candidates (`:39`). Never throws.
- `scoreMatch` adds no I/O — `score-match.ts` imports only `matchKey` and the `Track` type
  (`:16-17`); no `$state`, no `$app/*`, no `fetch`. The loop at `discovery.ts:43-49` is a
  synchronous in-memory scan.
- The shared fan-out's per-source isolation is intact in `catalog.ts:115-138`: each adapter
  call is individually `.then/.catch/.finally`-wrapped under `Promise.all`, with an
  AbortSignal abort guard (`:132`). One source throwing cannot reject the aggregate.
  NOTE: a concurrent (D-06) session replaced the literal `Promise.allSettled` named in the
  plan with semantically-equivalent per-adapter `.catch` under `Promise.all` — this PRESERVES
  the "every source isolated, aggregate never rejects" contract the threat relies on; the
  accepted control still holds.
- Graceful-miss/never-throws tests PASS: `discovery.test.ts:115-121`.

Accepted-risk basis recorded here: no new timeout is added; the scorer introduces no new
blocking or I/O surface, so no new DoS vector exists for this phase. CLOSED.

### T-10-03 — Tampering (supply chain) — CLOSED (N/A — no install)

Declared basis: no new dependency added.

Verified: the diff across all five phase-10 commits touches zero lines of `package.json` and
`pnpm-lock.yaml`. The only import added is the local `$lib/services/match-key` module
(`score-match.ts:16`). No `[ASSUMED]`/`[SUS]` package, no install task — supply-chain
checkpoint not triggered. CLOSED.

---

## Unregistered flags

None. SUMMARY.md `## Threat Surface Scan` reports "No new threat surface" and maps cleanly to
the three registered threats (T-10-01 hardened, T-10-02 preserved, T-10-03 N/A). No new attack
surface appeared during implementation.

## Accepted risks log

- **T-10-02 — Resolver running inside the shared searchAll best-effort path.** Accepted
  (control preserved). Basis: `resolveStub` try/catch → null + never-throws + lazy-per-tap;
  reuses searchAll's per-adapter isolation (`catalog.ts:115-138`) + AbortSignal; scorer is
  synchronous in-memory with no new I/O. No new timeout warranted. Verified 2026-06-06.

---

## Verification commands run

- `pnpm test -- score-match discovery` → 43/43 passed (3 files).
- `git diff` over phase-10 commits → 0 lines in `package.json` / `pnpm-lock.yaml`.
- Grep of `score-match.ts` imports → only `match-key` + `Track` type (no I/O, no new dep).
- Grep of `catalog.ts` → per-adapter `.then/.catch/.finally` + AbortSignal isolation intact.
