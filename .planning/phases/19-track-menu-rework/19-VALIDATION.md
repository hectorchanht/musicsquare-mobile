---
phase: 19
slug: track-menu-rework
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `19-RESEARCH.md` § Validation Architecture. **Node-only Vitest project (no jsdom)** — pure functions + runes-backed store logic are auto-testable; component DOM behavior (header re-measure) and gesture visuals (MENU-03 stuck-state) are device/preview-only.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.3 (single `server` project, `environment: node`) |
| **Config file** | `vitest.config.ts` (includes `src/**/*.{test,spec}.{js,ts}`; `*.svelte.test.ts` runs under node — the SvelteKit Vite plugin transforms runes) |
| **Quick run command** | `pnpm test` (= `vitest --run`) |
| **Full suite command** | `pnpm test` then `pnpm check` (svelte-check — type + a11y) |
| **Estimated runtime** | ~seconds (600+ tests run in seconds; svelte-check a few seconds) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` + `pnpm check` (svelte-check must be 0/0 — the established bar in every prior quick-task log)
- **After every plan wave:** `pnpm test` + `pnpm check` + a `pnpm build` smoke for any task touching imports/types (Cloudflare adapter emits the worker entry)
- **Before `/gsd:verify-work`:** Full suite green + svelte-check 0/0 + a real-device pass on the two non-node-testable contracts (MENU-02 marquee re-measure, MENU-03 stuck-state)
- **Max feedback latency:** < 30 seconds (node suite is fast)

---

## Per-Task Verification Map

> Task IDs assigned by the planner; rows below are requirement-level seams from research. Each plan task that implements a row MUST carry the matching `<automated>` verify (or a Wave-0 dependency on the helper extraction).

| Seam | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Gating predicate `detailsLoaded && uid && audioUrl` selects the gated set | 0→1 | MENU-01 | — | N/A (client UI) | unit (pure) | `pnpm test src/lib/components/track-menu-gate` | ❌ W0 (extract helper) | ⬜ pending |
| In-flight dedupe: 2nd call while `key ∈ inFlight` is a no-op | 0→1 | MENU-01 | — | N/A | unit (pure) | `pnpm test src/lib/components/track-menu-gate` | ❌ W0 | ⬜ pending |
| Resolve failure clears the in-flight key (never stuck spinner) | 0→1 | MENU-01 | — | N/A | unit (pure) | `pnpm test src/lib/components/track-menu-gate` | ❌ W0 | ⬜ pending |
| `ensureTrackDetails` idempotency (resolved short-circuits) | 1 | MENU-01 | — | N/A | unit | catalog readiness-guard test (add focused case if absent) | ⚠️ partial | ⬜ pending |
| Marquee `isOverflowing(scrollWidth, clientWidth)` strict-`>` | 1 | MENU-02 | — | N/A | unit (pure) | `pnpm test src/lib/actions/marquee` | ✅ `marquee.ts:20` | ⬜ pending |
| Two-row header renders + `{#key uid}` re-measures on resolve | 1 | MENU-02 | — | N/A | component-behavior | **device/preview-verify** (no jsdom) | n/a | ⬜ manual |
| i18n parity: all 15 locales carry `menu.remix`/`toast.remixing`/`menu.preparing` | 0 | MENU-02 | — | N/A | unit (pure) | `pnpm test src/lib/i18n` (extend to iterate all `dicts`) | ⚠️ exists, checks 3/15 — extend | ⬜ pending |
| Trailing-click suppressed after longpress | 1 | MENU-03 | — | N/A | unit (pure) | `pnpm test src/lib/actions/longpress` | ✅ `longpress.ts:26` | ⬜ pending |
| No stuck `:active`/`:hover`/focus under finger | 1 | MENU-03 | — | N/A | manual-only | **device-verify (iOS Safari + Android Chrome)** | n/a | ⬜ manual |
| `effectiveUpnextMode('remix') === 'generated'` despite user override | 0→1 | QUEUE-04 | — | N/A | unit | `pnpm test src/lib/stores/settings` | ❌ W0 (add `'remix'` ctx) | ⬜ pending |
| `regenerate` output = `dedupeBest([seed, ...manualEntries, ...auto])` preserving `manualUids` | 1 | QUEUE-04 | — | N/A | unit (runes) | `pnpm test src/lib/stores/player` (add remix-context case) | ⚠️ partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extract the gating logic to a pure helper `src/lib/components/track-menu-gate.ts` — `isGatedReady(track)` (`detailsLoaded && uid && audioUrl`) + `shouldStartResolve(inFlight, key)` + the failure-clear transition — so MENU-01 is node-testable without a DOM. — covers MENU-01
- [ ] `src/lib/components/track-menu-gate.test.ts` — gating predicate + dedupe + failure-clear transitions. — covers MENU-01
- [ ] Extend `src/lib/i18n/i18n.test.ts` to iterate ALL 15 `dicts` (not just en/zh-Hant/zh-Hans) so the 3 new keys are self-enforced across every locale. — covers MENU-02 i18n parity
- [ ] Add a `settings.svelte.ts` test asserting `effectiveUpnextMode('remix') === 'generated'` even when `upnextMode='same-list'`. — covers QUEUE-04 D-06
- [ ] Add a player `*.svelte.test.ts` case: Remix context → `regenerate` preserves a manual-pinned uid and discards the prior generated tail. — covers QUEUE-04 D-05
- [ ] No framework install needed (Vitest + svelte-check already present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-row header marquee re-measures on stub→resolved | MENU-02 | No jsdom project — DOM measurement (`scrollWidth`/`ResizeObserver`) is not exercised under node | Long-press a home tile (discovery stub) → menu opens → as the track resolves, a long song/artist name must begin marquee-bouncing (or stay static ellipsis if it fits / reduced-motion). Verify in browser preview + real device. |
| No stuck `:active`/`:hover`/focus under finger after long-press | MENU-03 | Touch synthetic-click + sticky `:hover`-on-touch differ across iOS Safari vs Android Chrome; only confirmable on hardware | On iOS Safari AND Android Chrome: long-press a tile/row → menu opens → on finger-up the trigger shows NO residual pressed/hover/focus highlight, and the row does NOT also play/navigate. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (gating helper, i18n parity, remix-context settings + player tests)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
