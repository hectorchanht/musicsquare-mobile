---
status: resolved
trigger: Home 精選推薦 tiles render color-gradient blocks (5th report) while search resolves covers fine; + zh-Hans→zh-Hant translation skip; + tile-label marquee overflow
created: 2026-06-07
updated: 2026-06-07
resolved: 2026-06-07
---

# Debug: home covers blocks vs search — RESOLVED

## Method
Runtime-first, main-context (the gsd-debugger subagent has no browser tools). Ran the app
on a managed preview (.claude/launch.json "dev" @4321; .dev.vars surfaces LASTFM_KEY via
adapter 7.2.8) and inspected the live page with Claude_Preview eval/screenshot/network — the
step the 4 prior code-only attempts skipped.

## Root causes (found from the live network log, not from tests)

1. **Covers (BUG 1).** `tileCover` order was: Last.fm image → CAA-by-mbid → cached backfill →
   gradient. The network log showed dozens of `coverartarchive.org/release-group/{mbid}/front-250
   → net::ERR_BLOCKED_BY_ORB` — the browser blocks those cross-origin image loads (Opaque
   Response Blocking). Most Last.fm chart items carry an mbid, so `tileCover` returned the
   ORB-blocked CAA URL (broken → gradient) AND `scheduleBackfill` skipped mbid items
   (`!it.image && !it.mbid`), so the working Deezer backfill never even ran for them. Net: most
   tiles stranded as gradients. (Deezer-sourced tiles without mbid worked — the "few" real ones.)
   FIX: source top-hits + top-artists from a new `/api/deezer/chart` proxy (covers + artist
   pictures EMBEDDED → one request, ~100% covered, no per-tile backfill); Last.fm chart kept as
   per-source fallback; removed the dead CAA tier; backfill now fills only still-imageless
   tag/country tiles (backup). Verified live: 251/251 cover imgs render. Commit 246e93d.

2. **Marquee/label width (BUG 3).** `.album` had default `min-width:auto`, so a nowrap
   `.al-name` grew the tile past its 130px basis → widened the row AND defeated the marquee
   (clientWidth grew to text width, so scrollWidth>clientWidth never tripped). FIX: `min-width:0`
   + `max-width:130px` on `.album`. Verified live: tiles pinned 130px; long titles marquee.
   Commit 7774e13.

3. **zh-Hans→zh-Hant skip (BUG 2).** `shouldTranslate` skipped when detected src===target. zh
   detection rides a ~50-char disambiguation set; 陈/奕/迅 aren't in it → 陈奕迅 misdetects as the
   zh-Hant default → matched target → skipped → simplified left on screen. `/api/translate`
   converts correctly (curl: 陈奕迅→陳奕迅). FIX: for zh-Hant/zh-Hans targets, don't skip on
   src===target — route Han through the converter (no-op when correct, cached). Commit 179b530.

## Outcome
All three confirmed fixed (covers verified visually; translation verified via curl + unit test).
408+ tests pass, check 0, build OK each.
