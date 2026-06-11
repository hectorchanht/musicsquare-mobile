---
gsd_debug_version: 1.0
slug: next-end-swipe-prefetch-queue
status: resolved
trigger: "still can not play the next song when current song ended; next button and right-to-left swipe do nothing with resistance; keep pre-fetch next song; tapping up-next rows must keep the same list instead of regenerating it"
created: 2026-06-11T19:02:00+08:00
updated: 2026-06-11T19:32:00+08:00
---

# Debug Session: next-end-swipe-prefetch-queue

## Symptoms

- Track end sometimes stops instead of advancing.
- Next button can no-op when the current track is at the visible end of the queue.
- Right-to-left nowbar / cover swipe resists at the visible queue end.
- Next track is not reliably pre-resolved after an auto-grow.
- Next track details may be resolved, but the audio URL and cover image are not warmed, so the
  transition can still buffer or briefly show an unloaded cover.
- Tapping a row in Up Next regenerates the queue instead of preserving the current list.

## Root Cause

- `ensureAhead()` returned immediately while a grow was already in flight. A next button click or `ended -> next()` arriving during that window rechecked the queue before the grow settled, found no next item, and no-oped.
- `play()` called `ensureAhead()` and `prefetchNext()` independently. On an exhausted queue, `prefetchNext()` ran before the grow appended a next track, so nothing was pre-resolved.
- `prefetchNext()` stopped after writing resolved details into the queue. Already-resolved next
  tracks returned early, and unresolved ones did not warm audio bytes or image decode after resolve.
- Generated/deduped queue writes could drop the exact current track when a preferred-source same-song variant won `dedupeBest`, breaking the `current in queue` invariant again.
- Nowbar and cover swipe passed `hasNext:false` at the last visible queue slot, so left swipes rubber-banded instead of delegating to `player.next()` to grow and advance.
- Up-next row taps used `player.play(track, { fresh: true })`, which intentionally regenerated the queue.

## Fix

- Make queue growth awaitable via a shared `growPromise`; later `next()` calls wait for the same grow and advance after it settles.
- Add `primeNext()` = `ensureAhead()` then `prefetchNext()`, and use it after playback starts and after generated queue regeneration.
- Warm the selected next track after details resolve: create/reuse a muted `Audio` element with
  `preload='auto'`, set the resolved `audioUrl`, call `load()`, and preload the next cover through
  an `Image` with async decode/no-referrer. Already-resolved next tracks also warm assets.
- Centralize current-track anchoring for deduped queues and use it in `setListQueue()`, `ensureAhead()`, and `regenerate()`.
- Let next swipes commit whenever a current track exists; the store owns end-of-queue growth.
- Change Up Next row taps to non-fresh `player.play(track)` so the current queue remains intact.

## Verification

- `pnpm vitest run src/lib/stores/player.svelte.test.ts` → 85 passed.
- `pnpm test` → 53 files, 672 passed.
- `pnpm check` → 0 errors, 0 warnings.
- Browser smoke at `http://127.0.0.1:5174/` → app shell rendered, no console errors captured.
