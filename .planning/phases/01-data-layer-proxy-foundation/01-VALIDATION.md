---
phase: 1
slug: data-layer-proxy-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (SvelteKit default via `sv create`; else `pnpm add -D vitest`) |
| **Config file** | none yet — created by scaffold (`vite.config.ts` `test` block). See Wave 0. |
| **Quick run command** | `pnpm vitest run src/lib/sources` |
| **Full suite command** | `pnpm vitest run && pnpm check` |
| **Estimated runtime** | ~5s quick / ~30s full |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/lib/<module-just-changed>`
- **After every plan wave:** Run `pnpm vitest run && pnpm check`
- **Before `/gsd:verify-work`:** Full suite green + spike decision matrix committed
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; rows below are requirement-level until plans land. Planner MUST attach each criterion to a concrete task.

| Req | Wave | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|------|----------|-----------|-------------------|-------------|--------|
| DATA-01 | 1 | `parseLRC` parses `[mm:ss.xxx]` → sorted `{time,text}[]` | unit | `pnpm vitest run src/lib/services/lrc.test.ts` | ❌ W0 | ⬜ pending |
| DATA-01 | 1 | each adapter normalizes a recorded fixture → valid `Track` | unit (fixture) | `pnpm vitest run src/lib/sources` | ❌ W0 | ⬜ pending |
| DATA-02 | 1 | `/api/<source>/search` proxies + injects token; token NOT in response | integration | `pnpm vitest run src/routes/api/proxy.test.ts` | ❌ W0 | ⬜ pending |
| DATA-02 | 1 | JOOX token absent from client bundle | build-grep | `pnpm build && ! grep -rE "JOOX_TOKEN_VALUE" .svelte-kit/output/client` | ❌ W0 | ⬜ pending |
| DATA-03 | 1 | one source throwing leaves others' results intact (`allSettled`) | unit | `pnpm vitest run src/lib/services/catalog.test.ts -t allSettled` | ❌ W0 | ⬜ pending |
| DATA-04 | 1 | registry enumerates 4; `getEnabledAdapters` filters; aggregation names no source | unit | `pnpm vitest run src/lib/sources/registry.test.ts` | ❌ W0 | ⬜ pending |
| SRC-01 | 1 | each of 4 adapters resolves audioUrl + lrc from a fixture | unit (fixture) | `pnpm vitest run src/lib/sources` | ❌ W0 | ⬜ pending |
| #4 (JOOX identity) | 1 | reorder result set → resolve JOOX track → returned `songMid` matches expected | unit | `pnpm vitest run src/lib/sources/joox.test.ts -t identity` | ❌ W0 | ⬜ pending |
| #5 (egress spike) | last | browser-direct playback per source from deployed edge | manual / deployed harness | open `openmusic.pages.dev/spike` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vite.config.ts` test block (or `vitest.config.ts`) — scaffold; verify Vitest wired
- [ ] `src/lib/services/lrc.test.ts` — DATA-01 (`parseLRC`, `inferQualityFromUrl`)
- [ ] `src/lib/sources/*.test.ts` + `__fixtures__/*.json` (recorded real per-source responses) — SRC-01, DATA-01, contract-drift baseline
- [ ] `src/lib/sources/joox.test.ts` identity case — success criterion #4 (position-index trap)
- [ ] `src/lib/services/catalog.test.ts` — DATA-03 (allSettled isolation) + interleave/dedupe
- [ ] `src/lib/sources/registry.test.ts` — DATA-04
- [ ] `src/routes/api/proxy.test.ts` — DATA-02 (token injection + passthrough)
- [ ] `src/routes/spike/+page.svelte` — manual egress-spike harness (criterion #5; doubles as Walking Skeleton)
- [ ] Fixtures captured by hitting each live upstream once and saving JSON

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser-direct audio playback per source from a deployed Cloudflare edge | Criterion #5 (spike) | Cannot automate cross-origin CDN `<audio>` playback headlessly; needs real edge egress IP | Deploy `openmusic` to CF edge; open `/spike`; for each source run search → resolve detail → play `<audio>`; record per-source pass/fail in spike decision matrix; lock metadata-proxy-vs-browser-direct decision |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
