---
status: resolved
trigger: "at the early age of the music app like the first day of dev, it can keep on playing without problem, as more function added, it fail to move to next track, now it stops when current song ends. maybe the app is overcomplicated now, all i want is append next up list according to setting behaviour. pre-fetch next song so the music can be played continuously. maybe we do not need to add more to it to make non-stop playing possible but remove some blocker that was hidden from code review. the goal is keep music flowing all the time except timer is up, or 10 consecutive song failing to play on all music sources. if the app went offline in the middle, the up next list will be replaced by download songs with a toast telling user about it"
created: 2026-06-11
updated: 2026-06-11
---

## Symptoms

expected: |
  When the current song ends, playback advances automatically to the next
  track (per up-next / play-mode settings). Next song is pre-fetched so
  audio flows continuously. Music keeps playing indefinitely except:
  (a) sleep timer expires, or (b) 10 consecutive tracks fail across all
  music sources. If the app goes offline mid-session, the up-next list is
  replaced by downloaded songs with a toast notifying the user.
actual: |
  Playback stops when the current song ends. Player fails to move to the
  next track. This is a regression: continuous playback worked at the
  earliest stage of development and degraded as features were added.
errors: "None reported by user — console/runtime errors unknown, needs evidence gathering."
timeline: |
  Worked on ~day one of development. Broke gradually as more functionality
  was added. User suspects a hidden blocker introduced by later code (not
  caught in code review) rather than missing functionality.
reproduction: "Play any track, let it reach its end. Player stops instead of advancing."

## Context

- User's framing: likely do NOT need new code for continuity — find and
  remove the blocker that prevents auto-advance at track end.
- Desired end-state behaviors (scope reference for the fix, may exceed
  pure bug fix): up-next appended per settings behavior; pre-fetch next
  song; stop only on timer or 10 consecutive all-source failures; offline
  → swap up-next to downloaded songs + toast.
- Possibly related active session: .planning/debug/android-pwa-no-refresh-resume.md
  (Android PWA resume/refresh behavior). Project constraint: player must
  NEVER refresh on re-entry; no visibilitychange→invalidateAll hook; keep
  MediaSession alive.
- Regression hunt hint: git history is intact — bisecting when `ended`
  handling / auto-advance last worked may be productive.

## Current Focus

hypothesis: CONFIRMED — auto-advance is structurally intact (`ended`→`next()`),
  but `next()` goes silently dead whenever `indexOf(this.current) === -1`
  (the playing track is not a member of `this.queue`). The list-tap play
  call sites run `player.setQueue(list)` (which runs `dedupeBest`) then
  `player.play(tappedTrack)`. When the tapped track's same-song variant from
  a higher-ranked source is also in the list, `dedupeBest` DROPS the tapped
  object and keeps the higher-ranked one — so `current` (the tapped uid) is
  no longer in `queue`. `next()` then takes the `i < 0` branch, calls
  `ensureAhead()`, which ALSO early-returns at `i < 0`, so the queue never
  grows and no advance happens → playback stops at track end.
test: static trace of all play-entry call sites + player.next()/ensureAhead/
  indexOf/setQueue/setListQueue + dedupeBest source-ranking + git history of
  the prior album fix (commit a37f1ee).
expecting: confirmed via static trace and prior resolved session.
next_action: apply the re-anchor fix to the unfixed list-tap call sites
  (search, artist, library) mirroring the album page's `setListQueue` fix.
reasoning_checkpoint: the album path was already fixed (a37f1ee) by re-anchoring
  current into the queue via setListQueue. The SAME root cause survives at the
  search/artist/library call sites because they still use the unsafe
  `setQueue(list); play(t)` pattern. Search interleaves ALL sources, so it is
  the most reproducible — matching "play any track, let it end, it stops."

## Evidence

- timestamp: 2026-06-11T00:00:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:786-824 (ended listener)
  note: |
    The `ended` listener is correct: decideEndedAction(sleepTimer.mode='off' default,
    repeatMode='off' default) → 'advance' → this.next(). No spurious sleep-stop, no
    repeat-rewind trap by default. So the stop is NOT in the ended handler itself.

- timestamp: 2026-06-11T00:01:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:1386-1400 (next), :1013-1037 (ensureAhead), :1039-1042 (indexOf)
  note: |
    next(): i = indexOf(current). If i>=0 && i+1<queue.length → play(queue[i+1]).
    Else (incl. i === -1) → ensureAhead().then(re-check indexOf). ensureAhead early
    returns when `i < 0` (line 1015-1016: `if (i < 0 || this.queue.length - i > 2) return`),
    so the queue does NOT grow and the re-check indexOf(current) is STILL -1 → NO advance.
    => next() silently fails when current.uid is not a member of queue.

- timestamp: 2026-06-11T00:02:00Z
  type: code-read
  ref: src/lib/services/dedupe.ts:16,52-88 (SOURCE_RANK + dedupeBest)
  note: |
    dedupeBest collapses same-song-different-source rows to ONE winner by quality then
    SOURCE_RANK (netease 4 > qq 3 > kuwo 2 > joox 1 > fivesing 0 > jamendo -1). The
    winner object is whichever source outranks — NOT necessarily the row the user tapped.
    So deduping a multi-source results list can DROP the exact tapped Track (its uid is
    gone from the output array).

- timestamp: 2026-06-11T00:03:00Z
  type: code-read
  ref: src/routes/(app)/search/+page.svelte:382-384
  note: |
    `#each results as t` iterates the RAW interleaved results (multi-source, contains
    same-song variants). onclick: `player.setQueue(results, 'search'); player.play(t)`.
    setQueue runs dedupeBest(results) → if the tapped variant `t` is dropped in favor of
    a higher-ranked same-song variant, `t` (= current) is NOT in queue → next() dead.
    Also missing `{ fresh: true }` (secondary deviation from the artist/home pattern).

- timestamp: 2026-06-11T00:04:00Z
  type: code-read
  ref: src/routes/(app)/artist/[name]/+page.svelte:376 ; src/routes/(app)/library/+page.svelte:115-126
  note: |
    Same unsafe pattern at two more call sites:
      artist row tap: setQueue(songs, 'artist'); play(track)
      library playList/playEntry: setQueue(list|history, ctx); play(t|track)
    Artist/library lists are usually single-source so they orphan current less often
    than search, but they are vulnerable to the identical dedupe-drop.

- timestamp: 2026-06-11T00:05:00Z
  type: git-history
  ref: commit a37f1ee "fix(player): album play uses rest-of-album as up-next; next-song works"
  note: |
    The IDENTICAL root cause (current.uid not in queue → next() dead) was already found
    and fixed for the ALBUM path in the resolved session
    .planning/debug/resolved/album-queue-and-next-song-bug.md. The fix introduced
    setListQueue() which re-anchors `current` into the list by uid then sameSongKey,
    keeping the exact playing object as the member so playback is uninterrupted. The
    album page now calls `player.setListQueue(all, 'album')` AFTER current is set
    (album/[name]/+page.svelte:197,283). The search/artist/library call sites were
    NOT migrated — they still use the unsafe setQueue(list); play(t) pattern.

- timestamp: 2026-06-11T00:06:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:938-959 (setListQueue), :1175-1203 (play sets current synchronously)
  note: |
    setListQueue anchors `this.current` into the deduped list: finds it by uid, else by
    sameSongKey; replaces that slot with the EXACT current object (preserves resolved
    audioUrl); if not present, splices current at the front. play() sets `this.current`
    SYNCHRONOUSLY at its top (line 1182, before any await). So the safe call order is
    `player.play(t); player.setListQueue(list, ctx)` — play sets current, then
    setListQueue guarantees it is a queue member → indexOf(current) valid → next() works.

## Eliminated

- ended handler logic — correct; default sleepMode/repeatMode yield 'advance' → next().
- decideEndedAction — only 'end-of-track' sleep mode yields 'sleep-stop'; default 'off'.
- attach() / audio wiring — +layout.svelte:19-27 attaches the singleton <audio> unconditionally
  in a client $effect; the `ended` listener IS registered.
- Never-stop machinery (consecutiveFailures, errorBurst, FAILURE_CAP, tripLoopGuard,
  runFallback, handleOffline) — all internally correct; they are not reached on a CLEAN
  end-of-track (no error event fires), so they are not the stop cause.
- next()/prev()/indexOf logic itself — internally correct GIVEN a valid queue; they only
  fail because they are FED a queue whose member set excludes current (same finding as the
  prior album session).

## Resolution

root_cause: |
  `next()` (and `ensureAhead()`) silently no-op whenever the currently-playing track is
  not a member of `player.queue` (`indexOf(current) === -1`). The list-tap play call sites
  run `player.setQueue(list)` — which applies `dedupeBest` — and then `player.play(tappedTrack)`.
  `dedupeBest` collapses same-song variants across sources to the highest-ranked source's
  object, so it can DROP the exact track the user tapped. The tapped track becomes `current`
  but is absent from `queue`, so at track end `ended → next()` finds no next index, `ensureAhead`
  also bails on the orphaned index, and playback stops. This is the same root cause already
  fixed for the album path (commit a37f1ee via setListQueue) but left unfixed at the
  search / artist / library call sites. Search is the most reproducible because it interleaves
  all sources into one results list.
fix: |
  APPLIED (mirrors the album fix, commit a37f1ee). At each unsafe list-tap call site, the tapped
  track is set as current first, then re-anchored into the list so it is guaranteed a queue member:
    search/+page.svelte:384  → player.play(t); player.setListQueue(results, 'search');
    artist/[name]/+page.svelte:376 → player.play(track); player.setListQueue(songs, 'artist');
    library/+page.svelte playList() → player.play(t); player.setListQueue(list, ctx);
    library/+page.svelte playEntry() → player.play(track); player.setListQueue(history.entries, 'history');
  Removes the hidden blocker (orphaned current) without adding new continuity code, matching the
  user's "remove the blocker" intent. `{ fresh: true }` on the search tap deliberately NOT added —
  kept the fix minimal; noted as possible follow-up.
verification: |
  VERIFIED.
  - Unit: new regression test in player.svelte.test.ts — current = tapped lower-ranked (qq)
    variant, setListQueue(list incl. higher-ranked netease same-song variant, 'search') keeps the
    EXACT tapped object a member with a valid next target. Full player suite: 82/82 pass.
  - svelte-check: 0 errors, 0 warnings (4102 files).
  - Live (vite dev, preview browser): searched "Adele Hello", tapped first row → current =
    kuwo:6686351 (lower-ranked source, the exact dedupe-drop case), indexOf(current) = 0 in a
    9-track queue. Dispatched `ended` on the <audio> → player auto-advanced to qq:001VvqYM0UdbHj
    ("HeLLo (Marshmello Remix)"), indexOf(current) = 1, mini-player updated. The reported
    "stops when current song ends" no longer reproduces.
files_changed:
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/lib/stores/player.svelte.test.ts
