---
phase: 18
slug: sleep-timer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.3 (single `server` node project; sveltekit Vite plugin transforms runes) |
| **Config file** | `vite.config.ts` (test block; `requireAssertions: true` — every test must assert) |
| **Quick run command** | `npm test -- src/lib/services/sleep-timer.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (full suite, ~171 tests) |

> Note: `npm run test:unit` is WATCH mode (`vitest`) — never use in automation. `npm test` = `vitest --run`.

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/lib/services/sleep-timer.test.ts`
- **After every plan wave:** Run `npm test` (full suite) + `npm run check`
- **Before `/gsd:verify-work`:** Full suite green + `npm run check` clean
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| deadline math (6 durations + null) | TBD | 1 | TIMER-01 | — | N/A | unit | `npm test -- src/lib/services/sleep-timer.test.ts -t deadline` | ❌ W0 | ⬜ pending |
| isExpired boundary (throttle-proof) | TBD | 1 | TIMER-01 | — | N/A | unit | `npm test -- src/lib/services/sleep-timer.test.ts -t expired` | ❌ W0 | ⬜ pending |
| fadeVolumeAt curve + clamps | TBD | 1 | TIMER-01 | — | N/A | unit | `npm test -- src/lib/services/sleep-timer.test.ts -t fade` | ❌ W0 | ⬜ pending |
| end-of-track beats repeat-one (D-03) | TBD | 1 | TIMER-01 | — | N/A | unit | `npm test -- src/lib/services/sleep-timer.test.ts -t arbitration` | ❌ W0 | ⬜ pending |
| timer store set/cancel/restart | TBD | 1 | TIMER-01 | — | N/A | unit (runes/node) | `npm test -- src/lib/stores/sleepTimer.svelte.test.ts` | ❌ W0 | ⬜ pending |
| expiry never touches failure counters / next() | TBD | 2 | TIMER-01 | STATE.md Phase-18 blocker | expiry pause is not failure-accounted | unit (player) | `npm test -- src/lib/stores/player.svelte.test.ts -t sleep` | ⚠️ extend existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/sleep-timer.ts` — pure helpers (computeDeadline / isExpired / remainingMs / fadeVolumeAt / decideEndedAction) for TIMER-01
- [ ] `src/lib/services/sleep-timer.test.ts` — deadline math, isExpired boundary, fade curve, end-of-track arbitration
- [ ] `src/lib/stores/sleepTimer.svelte.test.ts` — store transitions (mirrors `searchHistory.svelte.test.ts` pattern)
- [ ] Extend `src/lib/stores/player.svelte.test.ts` — `expireSleepTimer()` pauses without `consecutiveFailures`/`errorBurst` increment, without `next()` call
- [ ] Framework install: none — Vitest already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Volume fade ramps (Android/desktop), instant pause (iOS) | TIMER-01 | real-device volume honoring | Set 5-min timer, wait for expiry; observe ~10s fade vs instant stop on iPhone |
| Background-tab / locked-screen expiry timing | TIMER-01 | timer throttling only reproducible on device | Set timer, lock screen, confirm stop within seconds of deadline |
| Indicator on Nowbar + NowPlaying, tappable | TIMER-01 | visual/interaction | Set timer; check moon+countdown both surfaces; tap opens sheet |
| Sheet shows remaining + highlights active duration | TIMER-01 | visual | Reopen sheet mid-timer |
| Gesture mid-fade aborts stop (D-05) | TIMER-01 | timing/feel | Tap play during fade; volume restores, timer cleared |
| Media Session reads paused at expiry (D-09) | TIMER-01 | OS media UI | Check lock screen after expiry |
| Expiry while manually paused → silent clear (D-04) | TIMER-01 | timing | Pause manually, wait past deadline, indicator gone |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`npm test`, never `npm run test:unit`)
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
