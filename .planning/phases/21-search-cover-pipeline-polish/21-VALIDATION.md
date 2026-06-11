---
phase: 21
slug: search-cover-pipeline-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 (node project; transforms `$state` runes for `*.svelte.test.ts`) |
| **Config file** | `vite.config.ts` (`test.projects[0]`, `environment: 'node'`) |
| **Quick run command** | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm test -- <touched module>` |
| **Full suite command** | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run targeted `pnpm test -- <module>` + `pnpm check`
- **After every plan wave:** Run full `pnpm test` (D-07 regression set must stay green: score-match, discovery, fallback)
- **Before `/gsd:verify-work`:** Full suite green + manual checks (SRCH-03 focus fresh vs restored; SRCH-02 scroll-reveal; COVER-01 lock-screen art on no-cover source)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | | | SRCH-01 | — | N/A | unit | `pnpm test -- score-match` | ✅ extend | ⬜ pending |
| (filled by planner) | | | SRCH-01 (D-05) | — | N/A | unit | `pnpm test -- score-context` | ❌ W0 | ⬜ pending |
| (filled by planner) | | | SRCH-02 | — | https-only cover guard (T-0bb-01) | unit + manual | `pnpm test -- cover-backfill` | ✅ extend | ⬜ pending |
| (filled by planner) | | | SRCH-03 | — | N/A | manual | onMount focus — no DOM harness | manual | ⬜ pending |
| (filled by planner) | | | COVER-01 | — | N/A | unit + manual | `pnpm test -- media-session player` | ✅ extend | ⬜ pending |
| (filled by planner) | | | COVER-02 | — | https-only cover guard (T-0bb-01) | unit | `pnpm test -- cover-cache lazyCover` | ❌ W0 (lazyCover) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/score-context.test.ts` — SRCH-01 D-05 distinct-source map
- [ ] `src/lib/actions/lazyCover.test.ts` — COVER-02 action lifecycle (mirror `longpress.test.ts` IO-mock pattern)
- [ ] Extend `score-match.test.ts` — 試聽 penalty (D-03/D-04), short-title boost (D-06), penalty-dominance invariant
- [ ] Extend `cover-cache.test.ts` — uid key round-trip + uid→name read fallback (D-13)
- [ ] Extend `player.svelte.test.ts` — resolvedCover set-from-cover/cache/null + clear on play
- [ ] Update `itunes-cover.test.ts` — 600x600bb → 1200x1200bb assertion (D-11)
- [ ] Framework install: none — vitest already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Empty-query input autofocus; restored session never steals focus | SRCH-03 | No DOM harness (jsdom-less project); focus is browser behavior | Fresh visit to /search with empty query → input focused + recents open; navigate away after a search, return → results restored, input NOT focused |
| Lazy cover scroll-reveal | SRCH-02 / COVER-02 | IntersectionObserver real-viewport behavior | Search a query with cover-less results; scroll — covers resolve as rows enter view; re-scroll, no refetch (network tab) |
| Lock-screen/MediaSession artwork on no-cover source | COVER-01 | OS-level MediaSession rendering | Play a track from a source returning no cover; check nowbar, now-playing, and lock-screen artwork all render resolved cover |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
