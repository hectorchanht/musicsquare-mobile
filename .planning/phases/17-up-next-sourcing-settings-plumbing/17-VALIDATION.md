---
phase: 17
slug: up-next-sourcing-settings-plumbing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 |
| **Config file** | `vite.config.ts` (vitest config co-located; existing `*.test.ts` siblings) |
| **Quick run command** | `pnpm vitest run <file>` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <touched test file>`
- **After every plan wave:** Run `pnpm vitest run` (full suite) + `pnpm svelte-check`
- **Before `/gsd:verify-work`:** Full suite must be green; `svelte-check` clean (the `Dict` type-parity check catches missing i18n keys)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | QUEUE-01 | — | search context → generated default; no append; no auto-expand on non-fresh | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | QUEUE-03 | — | `effectiveUpnextMode(ctx)` resolves perContext ?? global generated | unit | `pnpm vitest run src/lib/stores/settings.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | QUEUE-05 | — | `removeFromQueue` filters + removedUids; `clearQueue` keeps current, clears manualUids | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | QUEUE-05 | — | swipeRemove action: slop axis-lock, flick threshold, tap preserved | unit | `pnpm vitest run src/lib/actions/swipeRemove.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | QUEUE-02 / D-10 | — | removed uid excluded from buildSimilarQueue/buildDiversePicks; reset on fresh play | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | UX-03 | — | FONT_SCALE clamp widens to 50/200; persisted 70–160 values stay valid | unit | `pnpm vitest run src/lib/stores/settings.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | UX-07 | — | pure `darken(hex, amt)` correctness; applyTheme sets `--color-primary-hover` | unit | `pnpm vitest run src/lib/services/color.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ENRICH-04 | — | `deezerArtist`/`deezerAlbum` never throw; reshape null-safe | unit | `pnpm vitest run src/lib/services/deezer.test.ts` | ❓ verify | ⬜ pending |
| TBD | TBD | TBD | ENRICH-04 / D-15 | — | pure `mergeEnrich()` precedence: hi-res image wins, additive merge | unit | `pnpm vitest run` (merge helper test) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/actions/swipeRemove.test.ts` — axis-lock / flick / tap-preserve (mirror dragReorder/dragScroll test structure) — QUEUE-05 gesture
- [ ] `src/lib/services/color.test.ts` — pure `darken()` — UX-07
- [ ] `src/lib/stores/settings.test.ts` — verify exists; if not, add for `effectiveUpnextMode` (QUEUE-03) + FONT_SCALE clamp (UX-03)
- [ ] Extract pure `mergeEnrich(lastfm, deezer)` helper so D-15 precedence is unit-testable (ENRICH-04)
- [ ] Verify `src/lib/services/deezer.test.ts` covers `deezerArtist`/`deezerAlbum` never-throws; extend if not
- [ ] Extend `src/lib/stores/player.svelte.test.ts` for queueContext / removeFromQueue / clearQueue / removedUids / auto-expand-guard

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Swipe-remove feel (slide+fade, spring-back, flick) | QUEUE-05 | Touch gesture physics not assertable in jsdom | On device: swipe queue row partially (springs back), fully (removes), flick fast (removes), tap (opens/plays as before), vertical drag on grip still reorders |
| Accent recolor sweep | UX-07 | Visual confirmation across surfaces | Change accent in settings; verify progress bars, active tabs, chips, buttons recolor incl. hover shade |
| Text-size demo preview | UX-03 | Visual rendering at 50%/200% extremes | Drag each of 5 sliders to extremes; demo text shows current/last-played song & artist name |
| Deezer sections render + degrade | ENRICH-04 | Live network + layout | Open artist/album pages with and without Deezer hits; skeletons match shape; sections vanish cleanly on miss |
| Nowbar no auto-expand on track change | QUEUE-01 | Needs real auto-advance | Let a track end with autoExpandOnPlay on; nowbar must stay collapsed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
