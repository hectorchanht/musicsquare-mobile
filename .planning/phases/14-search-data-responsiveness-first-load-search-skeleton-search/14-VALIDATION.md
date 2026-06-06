---
phase: 14
slug: search-data-responsiveness-first-load-search-skeleton-search
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-06
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 14-RESEARCH.md § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 `[VERIFIED: package.json]` |
| **Config file** | `vite.config.ts` — single `projects: [{ name: 'server', environment: 'node' }]`; `expect.requireAssertions: true`. NO jsdom/client project. |
| **Quick run command** | `pnpm test <touched test file>` |
| **Full suite command** | `pnpm test && pnpm check` |
| **Estimated runtime** | ~5–15 seconds (201 tests today) |

**Critical:** everything runs under the `node` project. `.svelte.test.ts` files run there too (SvelteKit Vite plugin transforms `$state` for node — `player.svelte.test.ts` proves it). D-02 store + D-04 cache MUST be node-unit-testable as pure logic. D-01 skeleton is component markup → manual verify (or extract the `loading && results.length===0` boolean).

---

## Sampling Rate

- **After every task commit:** Run `pnpm test <touched test file>`
- **After every plan wave:** Run `pnpm test` (full vitest)
- **Before `/gsd:verify-work`:** `pnpm test && pnpm check` green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Item | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| D-04 TTL cache hit/miss/expiry/page-key | 0/1 | D-04 | Page+source-keyed key (no cross-query poisoning) | unit | `pnpm test src/lib/services/ttl-cache.test.ts` | ❌ W0 | ⬜ pending |
| D-04 `searchAll` no re-fan-out within TTL | 1 | D-04 | — | unit | `pnpm test src/lib/services/catalog.test.ts` | ✅ extend | ⬜ pending |
| D-03 `pickByQualityPref(tiers,'128')` selects 128–160 tier | 1 | D-03 | — | unit | `pnpm test src/lib/sources/qq.test.ts src/lib/sources/joox.test.ts` | ✅ extend | ⬜ pending |
| D-03 `settings.defaultQuality` defaults to `'128'` | 1 | D-03 | — | unit | `pnpm test` (settings test) | ❌ W0 | ⬜ pending |
| D-02 `searchSession` store/restore/reset | 0/1 | D-02 | Client-only writes (browser guard) — no SSR module-state leak | unit | `pnpm test src/lib/stores/searchSession.svelte.test.ts` | ❌ W0 | ⬜ pending |
| D-01 skeleton on `loading && results.length===0` | 1 | D-01 | — | manual / boolean unit | — (component) | n/a | ⬜ pending |
| D-06 `searchAll` `onPartial` emits growing deduped sets as staggered mock adapters settle | 1 | D-06 | onPartial suppressed after `sig.aborted` (no stale partials) | unit | `pnpm test src/lib/services/catalog.test.ts` | ✅ extend | ⬜ pending |
| D-06 abort: new query mid-stream drops in-flight partials | 1 | D-06 | Race guard `kw !== q.trim()` + `sig.aborted` | unit | `pnpm test src/lib/services/catalog.test.ts` | ✅ extend | ⬜ pending |
| D-05 `recordQuery` — prepend, case-insensitive de-dupe, cap 12, most-recent-first, ignore empty | 0/1 | D-05 | localStorage writes browser-guarded (no SSR leak) | unit | `pnpm test src/lib/search/search-history-logic.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/ttl-cache.test.ts` — D-04 cache helper (hit/miss/expiry/key); helper must export `__clearSearchCache()`/`__clear()` for `afterEach`
- [ ] `src/lib/stores/searchSession.svelte.test.ts` — D-02 store store/restore/reset-on-new-query
- [ ] Extract `pickByQualityPref()` pure helper so D-03 quality selection is unit-testable without mocking fetch
- [ ] Extend `src/lib/services/catalog.test.ts` — cache prevents re-fan-out + page-keyed correctness; cache must be clearable so existing 3 fan-out spy tests don't see stale spies
- [ ] Update `qq.test.ts:130-131`, `kuwo.test.ts:102-103`, `joox.test.ts:168-169,203` — currently assert `quality==='lossless'`; pass explicit `'lossless'` pref OR assert new `'128'` default tier
- [ ] `src/lib/search/search-history-logic.test.ts` — D-05 pure `recordQuery`/`parseSearchHistory` (cap 12, case-insensitive de-dupe, order, ignore empty, bad-JSON → [])
- [ ] Extend `src/lib/services/catalog.test.ts` — D-06 progressive emit: staggered mock adapters → `onPartial` called with monotonically-growing deduped sets; aborted signal suppresses further `onPartial`; existing blocking fan-out tests stay green (callback omitted = unchanged behavior)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First-load skeleton appears | D-01 | Svelte component markup; no node/jsdom test seam | Search a term → skeleton rows show before first batch → replaced by results |
| Search state restored across nav | D-02 | Cross-route + scroll restore is browser runtime | Search "jay" → load → go to Library → return to Search → same query+results instantly, no refetch (Network tab) |
| Faster audio load at 128–160k default | D-03 | Perceptual / live upstream | Play a track with default settings → confirm playable URL is the 128–160 tier, not lossless |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

## Assumptions to resolve (from RESEARCH Assumptions Log)

- A1: Kuwo non-`zp` level token for 128–160k MP3 — live-endpoint spike (Wave 0 optional)
- A2: Whether Meting/qijieya Netease honors a bitrate param (likely not — document best-effort)
- A3: JOOX `br` tier-set vs single-bitrate — prefer client-ladder reorder, leave `JOOX_BR=4` (keeps `proxy.test.ts` green)
