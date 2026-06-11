---
phase: 22
slug: lyrics-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-12
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `22-RESEARCH.md` § Validation Architecture. **Node-only Vitest project (no jsdom)** — all new lrc.ts pure functions (pair-reorder, dominant-script detection, widened bracket split) are auto-testable; touch-suspend (LYR-02), tap-to-seek feel (LYR-01), and end-spacer centering (LYR-03) are device/preview-only.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (node project) |
| **Config file** | `vite.config.ts` (test.projects[0], `environment: 'node'`, include `src/**/*.{test,spec}.{js,ts}`) |
| **Quick run command** | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm vitest run src/lib/services/lrc.test.ts` |
| **Full suite command** | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm vitest run` then `pnpm check` |
| **Estimated runtime** | < 1s for lrc suite; full suite seconds; svelte-check a few seconds |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run src/lib/services/lrc.test.ts` (pure lrc functions — < 1s) + `pnpm check` 0/0
- **After every plan wave:** full `pnpm vitest run` green + `pnpm check` 0/0
- **Before `/gsd:verify-work`:** full suite green + svelte-check 0/0 + real-device pass on the non-node-testable contracts (LYR-02 touch-suspend incl. momentum scroll, LYR-01 tap-seek + paused-resume, LYR-03 spacer centering in half AND full)
- **Max feedback latency:** < 30 seconds

---

## Per-Task Verification Map

> Task IDs assigned by the planner; rows below are requirement-level seams from research. Each plan task that implements a row MUST carry the matching `<automated>` verify (or a Wave-0 dependency on the fixture extension).

| Seam | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| `reorderPairs`: CN-translation-above-original → original first | 0→1 | LYR-04 | — | N/A (client UI) | unit (pure) | `pnpm vitest run src/lib/services/lrc.test.ts -t reorderPairs` | ❌ W0 (new fn + fixtures) | ⬜ pending |
| `reorderPairs`: pure-CN song → unchanged (no-op) | 0→1 | LYR-04 | — | N/A | unit (pure) | (same suite) | ❌ W0 | ⬜ pending |
| `dominantScript`: han/kana/hangul/latin/mixed → correct enum; kana-presence ⇒ JP | 0→1 | LYR-04 | — | N/A | unit (pure) | `pnpm vitest run src/lib/services/lrc.test.ts -t dominantScript` | ❌ W0 | ⬜ pending |
| Widened `splitParenLines`: all 9 bracket pairs recognized | 0→1 | LYR-05 | — | N/A | unit (pure) | `pnpm vitest run src/lib/services/lrc.test.ts -t splitParenLines` | ⚠️ extend existing | ⬜ pending |
| Script-mismatch-only split: same-script clause stays inline (never `fromParen`) | 0→1 | LYR-05 | — | N/A | unit (pure) | (same suite) | ❌ W0 | ⬜ pending |
| Whole-line bracket passthrough (markers, whole-line clauses) | 0→1 | LYR-05 | — | N/A | unit (pure) | (same suite — existing case stays green) | ✅ exists | ⬜ pending |
| Never-drop: line with original lyrics always renders its main text | 0→1 | LYR-05 | — | N/A | unit (pure) | (same suite) | ❌ W0 | ⬜ pending |
| Tap-to-seek converts `line.time/duration` → `seekFraction` (guard duration>0) | 1 | LYR-01 | — | N/A | unit (pure helper) | `pnpm vitest run src/lib/services/lrc.test.ts -t seekFraction` (if helper extracted) | ❌ W0 optional | ⬜ pending |
| Tap while paused seeks AND starts playback (`seekFraction` auto-play verified in code) | 1 | LYR-01 | — | N/A | manual (device) | **device-verify** | n/a | ⬜ manual |
| Touch/hold/scroll suspends auto-scroll; resumes ~3s after idle incl. momentum glide | 1 | LYR-02 | — | N/A | manual-only | **device-verify (iOS Safari — REPORTED BROKEN, primary live item)** | n/a | ⬜ manual |
| Tap re-centers instantly, overriding the suspend its own pointerdown fired | 1 | LYR-01/02 | — | N/A | manual (device) | **device-verify** | n/a | ⬜ manual |
| Last lines center via end spacer in half AND full sheet modes | 1 | LYR-03 | — | N/A | manual (device) | **device/preview-verify** | n/a | ⬜ manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `src/lib/services/lrc.test.ts` — `reorderPairs` fixtures: CN-above-EN original pair, pure-CN no-op, JP kana pair, KR hangul pair, 3-lines-per-timestamp group. — covers LYR-04
- [ ] Extend `lrc.test.ts` — `dominantScript` fixtures (han/kana/hangul/latin/other/mixed; kana-presence ⇒ Japanese). — covers LYR-04
- [ ] Extend `lrc.test.ts` — widened `splitParenLines`: 9 bracket pairs, script-mismatch-only split, same-script inline, mixed-bracket line, whole-line passthrough, never-drop. — covers LYR-05
- [ ] (Optional) extract pure `lineSeekFraction(time, duration)` helper for a LYR-01 unit test. — covers LYR-01
- [ ] No framework install needed (Vitest already present; 13 lrc tests green as of research).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Touch-suspend + ~3s idle resume (incl. momentum) | LYR-02 | No jsdom; iOS momentum-scroll fires no pointer events — root cause is a device-only phenomenon (REPORTED BROKEN) | On iOS Safari: open lyrics, flick-scroll hard → during the glide and for ~3s after, the view must NOT snap back; after ~3s idle it smoothly re-centers the current line. Repeat with finger held down. |
| Tap-to-seek + instant re-center + paused-resume | LYR-01 | Pointer interplay (tap vs scroll discrimination) is device behavior | Tap a line → playback jumps to its time, line centers immediately. Pause, tap another line → playback resumes from that line. |
| End-spacer centering | LYR-03 | Layout measurement under half/full sheet modes | Seek near song end → last lines center in HALF mode and FULL mode (not pinned to bottom). |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (reorderPairs, dominantScript, widened split fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
