# Phase 8: Last.fm Read Foundation & Metadata Enrichment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 08-last-fm-read-foundation-metadata-enrichment
**Areas discussed:** Enrichment surfaces, Cover-art swap policy, Tags presentation, Artist bio handling

---

## Enrichment surfaces (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Now-playing tag chips | Top tags as chips under the title on full-screen now-playing | ✓ |
| Artist page (bio+tags+image) | Enrich existing /artist/[name] with bio snippet, tags, better image | ✓ |
| Album page (art+info) | Enrich existing /album/[name] with album art + listeners/playcount | ✓ |

**User's choice:** All three surfaces.
**Notes:** Artist + album routes already exist (currently just `searchAll`) — enrichment augments them rather than adding new routes.

---

## Cover-art swap policy

| Option | Description | Selected |
|--------|-------------|----------|
| Replace only when source cover missing (Recommended) | Use Last.fm art only when track has no per-source cover. Zero flicker/regression. | |
| Prefer Last.fm album-art when higher-res | Swap to Last.fm album art whenever larger, even if a source cover exists. Best quality, risks swap/flicker + wrong-album. | ✓ |
| Last.fm art only on artist/album pages | Never touch the now-playing track cover; fill only artist/album page art. | |

**User's choice:** Prefer Last.fm album-art when higher-res (the quality-maximizing, higher-risk option).
**Notes:** Because this is the riskier choice, CONTEXT.md D-04 attaches explicit guardrails — source from `album.getInfo`, never use the grey-star placeholder (ENRICH-02 overrides), swap only when strictly higher-res, preload before swapping to avoid flash, stay async/off the playback path.

---

## Tags presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Top 5, display-only now (Recommended) | Up to 5 tags as non-interactive chips in Phase 8; tappable→discovery in Phase 9 | ✓ |
| Top 3, display-only | Leaner — 3 display-only chips | |
| Top 5, tappable forward-link now | Tappable in Phase 8, coupling to a Phase 9 route that doesn't exist yet | |

**User's choice:** Top 5, display-only now.
**Notes:** Chip component built so Phase 9 can make it tappable without a rewrite.

---

## Artist bio handling

| Option | Description | Selected |
|--------|-------------|----------|
| Short paragraph, English as-is (Recommended) | ~2-3 sentences, HTML stripped, English, + required attribution link | ✓ |
| 1 sentence, English as-is | Opening sentence + attribution link | |
| Short paragraph, auto-translate to zh | Translate bio to zh for zh users via translate.ts + attribution | |

**User's choice:** Short paragraph, English as-is.
**Notes:** Attribution link ("Read more on Last.fm") is locked regardless — Last.fm ToS requires it for displayed bios. No translation in Phase 8 (avoids translate call/latency); translate.ts remains available if revisited.

---

## Claude's Discretion

- Read-proxy route shape (dedicated `/api/lastfm/...` vs catch-all `source=lastfm`) — planner decides per research ARCHITECTURE.md; key stays edge-only either way.
- Enrichment trigger timing (on play / on view / both) + edge caching (Cache API TTLs) — provided enrichment stays async + off the playback path.
- Data-model placement of enriched fields (extend `Track` optional fields vs side cache keyed by uid) — must not break the `serializeTrack` persistence whitelist.
- Exact normalization rules in the `{artist}+{title}` match-key primitive (CJK Trad/Simp folding deferred to Phase 13).

## Deferred Ideas

- Tappable tag chips → tag discovery — Phase 9.
- Last.fm-searchable source / tap-to-play — Phase 10.
- Bio i18n (translate to zh) — post-v1.1 if requested.
- CJK Traditional/Simplified folding in match-key — Phase 13.
- Personal/user-scoped metadata (your tags/playcount) — needs auth, Phase 11+.
