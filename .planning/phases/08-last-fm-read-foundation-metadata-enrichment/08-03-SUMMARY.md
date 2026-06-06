---
phase: 08-last-fm-read-foundation-metadata-enrichment
plan: 03
subsystem: lastfm-enrichment
tags: [lastfm, enrichment, album-page, cover-art, listeners, playcount, i18n]
requires:
  - "src/lib/services/lastfm.ts (Plan 01 — enrichAlbum contract, never throws; EnrichResult.listeners/playcount)"
  - "src/lib/i18n/en.ts (Plan 01 — lastfm.listeners, lastfm.playcount keys)"
provides:
  - "/album/[name] page augmented with a higher-res Last.fm cover (when strictly better) + listeners/playcount info line"
affects:
  - "src/routes/(app)/album/[name]/+page.svelte (album page — additive enrichment)"
tech-stack:
  added: []
  patterns:
    - "Second SEPARATE $effect keyed on name + albumArtist that void-fires enrichAlbum OFF the searchAll critical path (augment, never block/replace — D-02)"
    - "Own enrichedFor key-guard + key-match race guard (mirrors the Plan-02 artist-page idiom; key = `${name} ${albumArtist}` because the album page has no artist param)"
    - "albumArtist derived from the resolved searchAll tracks (tracks[0]?.artist) — enrichment naturally runs after the list resolves"
    - "heroImg = lastfmArt ?? derived hero — a real cover never regresses to a placeholder (ENRICH-02 overrides D-03)"
    - "Album info line gated on listeners != null || playcount != null — renders nothing when absent (silent degradation)"
key-files:
  created:
    - ".planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-03-SUMMARY.md"
  modified:
    - "src/routes/(app)/album/[name]/+page.svelte"
decisions:
  - "Enrichment $effect keyed on a composite `${name} ${albumArtist}` (not name alone): the album page has no artist param, so albumArtist is derived from tracks[0]?.artist and resolves only after searchAll lands. Keying on the composite means enrichAlbum fires exactly once the artist is known and re-fires correctly if the resolved artist changes — naturally deferring enrichment off the initial render path."
  - "heroImg is a $derived(enrich?.lastfmArt ?? hero) consumed directly in the .cover background-image — no preload guard (unlike NowPlaying's cover-swap). The album hero is not the playback background, the service already placeholder-filtered lastfmArt, and the ?? hero fallback satisfies ENRICH-02 without the preload machinery (same call as the Plan-02 artist hero)."
  - "Album info rendered as a single .info line under the existing .note, each metric gated independently (listeners != null, playcount != null) and formatted with Intl.NumberFormat() — the line itself is gated on either metric being present so a no-match album shows no orphan info line."
metrics:
  duration_min: 5
  tasks_completed: 1
  files_created: 1
  files_modified: 1
  tests_total: 112
  completed: 2026-06-06
---

# Phase 8 Plan 03: Album-Page Metadata Enrichment Summary

The `/album/[name]` page now shows a higher-res Last.fm album cover (swapped only when present and never a placeholder) and a listeners / playcount info line — both layered on via a SEPARATE `$effect` keyed on `name` + a derived `albumArtist` that never touches or blocks the existing derived `searchAll` track-list, exact-album filtering, or list rendering.

## What Was Built

- **Second enrichment `$effect` (D-02 augment, never replace):** A new `$effect` keyed on a composite `${name} ${albumArtist}`, fully separate from the existing `searchAll` effect, with its own `enrichedFor` guard. Because the album page has no artist param, `albumArtist` is `$derived(tracks[0]?.artist ?? '')` — so the key only completes once `searchAll` resolves, naturally deferring enrichment off the initial render path. When the key changes and `albumArtist` is non-empty it sets `enrichedFor = key`, clears `enrich = null`, then `void enrichAlbum(name, albumArtist).then(...)` — best-effort, async, never awaited, never throwing (Plan-01 contract). A key-match race guard (`if (enrichedFor === key) enrich = r`) discards stale in-flight results. The original `searchAll` effect, the exact-album `.filter((t) => (t.album||'').trim() === n)`, and the track list are byte-for-byte unchanged.
- **Higher-res cover, no placeholder regression (ENRICH-02 overrides D-03):** `const heroImg = $derived(enrich?.lastfmArt ?? hero)` now feeds the `.cover` background-image (previously `hero`). `lastfmArt` is already placeholder-filtered by the Plan-01 service (grey-star hash `2a96cbd8b46e442fc41c2b86b821562f` / empty `#text` dropped — and sourced from `album.getInfo`, D-04 guardrail 1), and the `?? hero` fallback keeps the existing derived cover whenever Last.fm has no usable image — a real cover never regresses to a placeholder. No preload guard (same rationale as the Plan-02 artist hero: not the playback background; the page is not the now-playing surface).
- **Album info line (D-01c):** A `.info` paragraph rendered under the existing `.note`, gated on `enrich?.listeners != null || enrich?.playcount != null`, with each metric independently gated and formatted via a module-level `Intl.NumberFormat()`. Uses the Plan-01 `lastfm.listeners` / `lastfm.playcount` keys. When Last.fm has no match (or the key is absent → all-empty shape), neither metric is present and the line does not render — no orphan info line.
- **i18n consumption only:** Uses the `lastfm.listeners` and `lastfm.playcount` keys Plan 01 already added to en/zh-Hant/zh-Hans. No i18n file was added or edited.
- **Styles:** Added a single `.info` rule (muted, centered, flex-gap, wrap) reusing existing `app.css` design tokens. No existing styles changed.

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Album hi-res cover + listeners/playcount enrichment (augment, never replace) | d4930de (feat) |

## Verification

- `pnpm check` — 0 errors, 0 warnings (3991 files). `enrichAlbum` / `EnrichResult` imports typecheck; the second `$effect`, `albumArtist`, and `heroImg` deriveds compile cleanly.
- `pnpm test` — 112/112 passing (16 files), unchanged from Plans 01/02 — no regressions. This plan adds no new tests (per its acceptance criteria: a Svelte route-page augmentation whose behavior is exercised by the human-check; the `enrichAlbum` service it consumes is already fully covered by Plan-01's 112 tests, including absent-key, placeholder-filter, and no-leak paths).
- **Human-check (deferred — requires `wrangler dev`/deployed build with `LASTFM_KEY`):** open `/album/<a well-known album>` → confirm a higher-res cover (if better) + a listeners/playcount line appear while the existing derived track list still renders; then `/album/<an obscure CN album not on Last.fm>` → confirm the page renders exactly as before with no info line and no broken/placeholder cover. This is the plan's `<human-check>` and cannot run headless; the absent-key / placeholder / no-leak paths it depends on are already automated in Plan 01.

## Deviations from Plan

None — plan executed exactly as written. All key implementation notes honored: a SECOND `$effect` separate from the `searchAll` effect with its own `enrichedFor` guard; `albumArtist` derived from `tracks[0]?.artist`; `void`-fired `enrichAlbum`, never awaited; `heroImg = $derived(enrich?.lastfmArt ?? hero)` so a real cover never regresses; listeners/playcount rendered only when present via the Plan-01 keys; `searchAll` / exact-album filter / track list untouched; no i18n edits; `+layout.svelte` untouched.

One implementation detail worth noting (not a deviation — within the plan's instructions): the enrichment `$effect` is keyed on the composite `${name} ${albumArtist}` rather than `name` alone, exactly as the plan specified ("keyed on `name` + `albumArtist`"). This is necessary because, unlike the artist page (keyed on `name` only), the album page derives its artist from the resolved tracks, so the key must include `albumArtist` to fire once the artist becomes known.

## Known Stubs

None. The cover swap and the listeners/playcount line are all fed by the live `enrichAlbum(name, albumArtist)` call. When Last.fm has no match or the key is absent, the service resolves to the all-empty shape, `lastfmArt` is null (cover falls back to the derived `hero`), and `listeners`/`playcount` are absent (info line does not render) — silent degradation, the intended design, not a stub.

## Threat Flags

None. All surface is enumerated in the plan's `<threat_model>`: T-08-12 (key edge-only — inherited from Plan 01's `/api/lastfm/info`; the client `enrichAlbum` only ever sees the clean shape), T-08-13 (DoS-of-UX — enrichment runs in a separate `void`-fired `$effect` gated on the derived album artist, never awaited, never blocks the searchAll load; `enrichAlbum` never throws), T-08-14 (cover never regresses to a placeholder — `?? hero` fallback over the upstream-placeholder-filtered `lastfmArt`). No new package installs (T-08-SC accept holds).

## Self-Check: PASSED

- `src/routes/(app)/album/[name]/+page.svelte` exists and contains `enrichAlbum`, the second `name`+`albumArtist`-keyed `$effect`, the `albumArtist` derived, `heroImg`, and the listeners/playcount info line.
- `.planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-03-SUMMARY.md` exists.
- Commit `d4930de` is present in git history.
