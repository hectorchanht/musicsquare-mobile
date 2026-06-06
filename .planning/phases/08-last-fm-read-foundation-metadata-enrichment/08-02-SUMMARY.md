---
phase: 08-last-fm-read-foundation-metadata-enrichment
plan: 02
subsystem: lastfm-enrichment
tags: [lastfm, enrichment, artist-page, bio, tags, attribution, i18n]
requires:
  - "src/lib/services/lastfm.ts (Plan 01 — enrichArtist contract, never throws)"
  - "src/lib/components/TagChips.svelte (Plan 01 — display-only chip row)"
  - "src/lib/i18n/en.ts (Plan 01 — lastfm.about, lastfm.readMore keys)"
provides:
  - "/artist/[name] page augmented with Last.fm bio + top-tag chips + better hero image"
  - "Always-present 'Read more on Last.fm' attribution link (D-08 / ToS) whenever a bio shows"
affects:
  - "src/routes/(app)/artist/[name]/+page.svelte (artist page — additive enrichment)"
tech-stack:
  added: []
  patterns:
    - "Second SEPARATE name-keyed $effect that void-fires enrichArtist OFF the searchAll critical path (augment, never block/replace — D-02)"
    - "Own enrichedFor guard + name-match race guard (mirrors NowPlaying's enrichedFor/uid idiom)"
    - "Bio render gated on BOTH bio AND bioUrl so attribution is never orphaned (D-08)"
    - "heroImg = lastfmArt ?? derived hero — never regresses to a placeholder (ENRICH-02 overrides D-03)"
key-files:
  created:
    - ".planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-02-SUMMARY.md"
  modified:
    - "src/routes/(app)/artist/[name]/+page.svelte"
decisions:
  - "Bio block gated on bio && bioUrl (not just bio): if Last.fm returns a bio with no attribution URL, the whole block is suppressed rather than rendering a bio without the ToS-required 'Read more on Last.fm' link (D-08 lock — attribution is never missing)."
  - "heroImg is a $derived(enrich?.lastfmArt ?? hero) consumed directly in the .herocover background-image — no preload guard here (unlike NowPlaying's cover-swap): the artist hero has no prior real cover to flash-regress, and the service already placeholder-filtered lastfmArt, so a plain fallback to the derived hero satisfies ENRICH-02 without the preload machinery."
  - "Tags placed inside the centered hero header (.herotags) directly under the .note line; bio placed as a left-aligned <section class='bio'> still inside <header> so it sits above the existing albums/hit-songs sections without touching them."
metrics:
  duration_min: 4
  tasks_completed: 1
  files_created: 1
  files_modified: 1
  tests_total: 112
  completed: 2026-06-06
---

# Phase 8 Plan 02: Artist-Page Metadata Enrichment Summary

The `/artist/[name]` page now shows a Last.fm artist-bio snippet (English-as-is, HTML-stripped) with the always-present "Read more on Last.fm" attribution link, top-tag chips (reusing TagChips), and a higher-res hero image when available — all layered on via a SEPARATE name-keyed `$effect` that never touches or blocks the existing derived `searchAll` track-list, albums, or hit-songs behavior.

## What Was Built

- **Second enrichment `$effect` (D-02 augment, never replace):** A new `$effect` keyed on `name`, fully separate from the existing `searchAll` effect, with its own `enrichedFor` guard. When `name` changes it sets `enrichedFor = n`, clears `enrich = null`, then `void enrichArtist(n).then(...)` — best-effort, async, never awaited, never throwing (Plan-01 contract). A name-match race guard (`if (enrichedFor === n) enrich = r`) discards stale in-flight results when the user navigates away. The original `searchAll` effect, `albums` derivation, and hit-songs list are byte-for-byte unchanged.
- **Bio + always-present attribution (D-07 / D-08):** The bio is rendered as plain Svelte text interpolation (`{enrich.bio}`) — already HTML-stripped server-side (no `{@html}`, no XSS surface — T-08-08) and English-as-is, deliberately NOT passed through `names.dn`. The whole bio `<section>` is gated on having BOTH `enrich?.bio` AND `enrich?.bioUrl`, so the ToS-required `<a … rel="noopener noreferrer">Read more on Last.fm</a>` (T-08-09 reverse-tabnabbing mitigation) is never orphaned. If a bio has no attribution URL the block is suppressed entirely.
- **Tag chips (reuse, display-only):** `<TagChips tags={enrich.tags} />` is rendered in a centered `.herotags` row under the `.note` line — the Plan-01 component reused as-is (no duplicate chip implementation, no `onTagClick` so it stays display-only per D-06).
- **Better hero, no placeholder regression (ENRICH-02):** `const heroImg = $derived(enrich?.lastfmArt ?? hero)` feeds the `.herocover` background-image. `lastfmArt` is already placeholder-filtered by the Plan-01 service (grey-star hash / empty `#text` dropped), and the `?? hero` fallback keeps the existing derived cover whenever Last.fm has no usable image — a real hero never regresses to a placeholder.
- **i18n consumption only:** Uses the `lastfm.about` and `lastfm.readMore` keys Plan 01 already added to en/zh-Hant/zh-Hans. No i18n file was added or edited.
- **Styles:** Added `.herotags` (centered chip row), `.bio` / `.bio h2` / `.bio p` (left-aligned, muted, readable line-height), and `.readmore` (primary-colored link) using existing `app.css` design tokens. No existing styles changed.

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Artist bio + tags + hero-image enrichment (augment, never replace) | 7bafea9 (feat) |

## Verification

- `pnpm check` — 0 errors, 0 warnings (3991 files). `enrichArtist`/`EnrichResult`/`TagChips` imports typecheck; the two `$effect`s and the `heroImg` derived compile cleanly.
- `pnpm test` — 112/112 passing (16 files), unchanged from Plan 01 — no regressions. This plan adds no new tests (per its acceptance criteria: a Svelte route-page augmentation whose behavior is exercised by the human-check; the enrichment service it consumes is already fully covered by Plan-01's 112 tests).
- **Human-check (deferred — requires `wrangler dev`/deployed build with `LASTFM_KEY`):** open `/artist/<a Western artist with a Last.fm bio>` → confirm bio snippet + "Read more on Last.fm" link + top-tag chips + (if available) a better hero appear, while albums + hit-songs still render; then `/artist/<a CN artist not on Last.fm>` → confirm the page renders exactly as before with no bio/tags/attribution and no broken hero. This is the plan's `<human-check>` and cannot run headless; the absent-key / placeholder / no-leak paths it depends on are already automated in Plan 01.

## Deviations from Plan

None — plan executed exactly as written. All key implementation notes honored: separate name-keyed `$effect` with its own `enrichedFor` guard; bio English-as-is and NOT via `names.dn`; attribution gated on `bio && bioUrl`; TagChips reused display-only; `heroImg` falls back to the derived hero; `searchAll`/albums/hit-songs untouched; no i18n edits; `+layout.svelte` untouched.

## Known Stubs

None. The bio, attribution link, tag chips, and hero image are all fed by the live `enrichArtist(name)` call. When Last.fm has no match or the key is absent, the service resolves to the all-empty shape and the enrichment blocks simply do not render (silent degradation — the intended design, not a stub).

## Threat Flags

None. All surface is enumerated in the plan's `<threat_model>`: T-08-07 (key edge-only — inherited from Plan 01's `/api/lastfm/info`), T-08-08 (XSS — bio is HTML-stripped server-side and rendered as Svelte text, never `{@html}`), T-08-09 (reverse-tabnabbing — `rel="noopener noreferrer"` on the attribution link), T-08-10 (DoS-of-UX — enrichment runs in a separate `void`-fired `$effect`, never awaited, never blocks the searchAll load; `enrichArtist` never throws), T-08-11 (hero never regresses to placeholder — `?? hero` fallback). No new package installs (T-08-SC accept holds).

## Self-Check: PASSED

- `src/routes/(app)/artist/[name]/+page.svelte` exists and contains `enrichArtist`, `TagChips`, the second name-keyed `$effect`, the `bio && bioUrl`-gated attribution link, and `heroImg`.
- `.planning/phases/08-last-fm-read-foundation-metadata-enrichment/08-02-SUMMARY.md` exists.
- Commit `7bafea9` is present in git history.
