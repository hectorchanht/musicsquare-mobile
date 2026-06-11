---
gsd_debug_version: 1.0
slug: album-queue-and-next-song-bug
status: resolved
trigger: "Default album page song play will append the rest of song in album to up next list. And even playback sourcing of album set to same list, the next up is still generated in stead of rest of the song in list. Click next song Fail to be done even the up next list is non empty"
created: 2026-06-11T07:55:33Z
updated: 2026-06-11T08:20:00Z
---

# Debug Session: album-queue-and-next-song-bug

## Symptoms

Two related bugs in the queue / up-next subsystem (scoped together; Android PWA refresh bug is a separate session B).

### Bug 1 — Album default-play populates up-next wrongly

- **Expected behavior:** Tapping a song on the album page (default play) should set the play context to the album list. The "up next" should be the **remaining songs of that album list** (the tracks after the tapped one). When the playback source is explicitly set to "same list" (the album), up-next should reflect the rest of that list — NOT a freshly generated/recommended queue.
- **Actual behavior:**
  - Tapping a song on the album page **appends the rest of the album's songs to the up-next list** (additively, rather than the up-next BEING the album remainder).
  - Even when the playback sourcing is set to "same list" (album), the next-up is **still generated** (recommendation/auto-generated queue) instead of using the rest of the songs already in the album list.
- **Error messages:** none reported (behavioral).
- **Reproduction:** Open an album page → tap a song to play (default play) → open the up-next / queue view → observe up-next contents vs. the album's remaining tracks. Try also with playback source set to "same list".

### Bug 2 — "Next song" click fails despite non-empty up-next

- **Expected behavior:** Clicking the "next song" control should advance to the next track in the up-next list.
- **Actual behavior:** Clicking "next song" **fails to advance** even when the up-next list is **non-empty**.
- **Error messages:** none reported yet (check console for errors / unresolved audioUrl / playNext throwing).
- **Reproduction:** With a non-empty up-next list, click the "next song" control → observe no advance.

### Suspected relationship

Bugs 1 and 2 are likely the same subsystem (queue / playContext / playNext) and may share a root cause — e.g. the up-next list and the actual "active list" used by next-advance are out of sync, or the play context type ("results" vs "album"/"same list") is mis-set so playNext indexes into the wrong list. CONFIRM or REFUTE that they share a root cause.

## Likely Location

This project was rebuilt from the desktop `index.html` into SvelteKit (milestone v1.2). The queue logic in the original lived in `playContext`, `getActiveList()`, `playNext()`, `playFromList()` (`index.html` ~lines 2668–2733). Find the ported equivalents — likely a player/queue store under `src/lib/` (e.g. `src/lib/stores/` or `src/lib/services/`) plus the album route under `src/routes/`. Identify:
- Where album default-play sets the play context / queue.
- What "up next" reads from, and whether it is the play-context list remainder or a separately-generated list.
- The "playback sourcing = same list" setting and where it branches between list-remainder vs generated queue.
- The "next song" handler and `playNext` index/advance logic.

## Hypothesis Seed

The album play path sets a play context that does not match the list the up-next view and the next-advance logic read from — so up-next gets a generated queue (and/or duplicate-appended album tracks) and "next song" indexes into an empty or wrong list. (Unverified — debugger to investigate.)

## Current Focus

- hypothesis: SHARED ROOT CAUSE CONFIRMED — the album single-tap path installs a queue of ONLY the tapped track (`setQueue([tr])`), so up-next is never the album remainder; and the whole-album Play path resolves the current track and the queue list independently, so `current.uid` is not guaranteed to be a member of the queue, breaking `indexOf(current)` → `next()`.
- test: read all play-entry call sites + player.next()/setQueue/play(fresh)/ensureAhead.
- expecting: confirmed via static trace.
- next_action: apply fix to album page play paths; add regression tests.

## Evidence

- timestamp: 2026-06-11T08:02:00Z
  type: code-read
  ref: src/routes/(app)/album/[name]/+page.svelte:184-187 (playStub), :257-271 (playAlbum)
  note: |
    SINGLE-SONG TAP (`playStub`): calls `player.playStub(stub.artist, stub.title, null, 'album')`.
    There is NO setQueue of the album tracklist before/after — the only queue install is the one
    INSIDE player.playStub.
    WHOLE-ALBUM PLAY (`playAlbum`): `playStub(tracks[0])` (sets queue=[first]) THEN
    `resolveAllCached()` (~10s, re-resolves EVERY stub independently incl. index 0) THEN
    `player.setQueue(all, 'album')`.

- timestamp: 2026-06-11T08:03:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:1073-1116 (playStub), :1106-1107
  note: |
    player.playStub: on success → `this.setQueue([tr], context)` then `void this.play(tr, {fresh:true})`.
    The queue is set to ONLY the tapped track `[tr]` — the rest of the album is never loaded into the
    queue on the single-tap path. This is the direct cause of Bug 1: up-next can only come from
    generation/ensureAhead because the album remainder was never put in the queue.

- timestamp: 2026-06-11T08:04:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:1276-1287 (fresh-play sourcing branch), :971-987 (ensureAhead)
  note: |
    play(fresh) → effectiveUpnextMode(queueContext='album'):
      - 'generated' (global default) → regenerate(seed) → buildSimilarQueue (RECOMMENDED songs).
      - 'same-list' → ensureAhead(). But queue is [tr] (length 1), current at index 0, so
        `queue.length - i = 1` is NOT `> 2` → ensureAhead GROWS via buildDiversePicks(8) =
        GENERATED picks. So even with album set to "same-list", up-next is still generated, because
        the snapshot the "same-list" branch is meant to preserve only ever contained one song.
    => CONFIRMS Bug 1 second clause ("same list still generated").

- timestamp: 2026-06-11T08:05:00Z
  type: code-read
  ref: src/lib/stores/player.svelte.ts:1336-1350 (next), :989-992 (indexOf)
  note: |
    next(): `i = indexOf(current)`. If `i >= 0 && i+1 < queue.length` → play(queue[i+1]).
    Else (incl. i === -1 when current is NOT in the queue) → ensureAhead().then(re-check indexOf).
    ensureAhead early-returns when `i < 0` (line 974), so the queue does NOT grow and the re-check
    `indexOf(current)` is STILL -1 → NO advance. => next() silently fails when current.uid ∉ queue.

- timestamp: 2026-06-11T08:06:00Z
  type: analysis
  ref: src/routes/(app)/album/[name]/+page.svelte:228-245 (resolveAll/resolveAllCached) + discovery.ts:32-54 (resolveStub)
  note: |
    Bug 2 root cause on the whole-album Play path: `first` = playStub's resolveStub(tracks[0]).
    `all` = resolveAllCached() which calls resolveStub(tracks[i]) AGAIN per track (incl. i=0).
    resolveStub is non-deterministic across calls (searchAll network ordering + scoreMatch ties),
    and setQueue runs dedupeBest (reorder/collapse). So `all`'s entry for track 0 can have a
    DIFFERENT uid than `first` (= player.current). Then indexOf(current) === -1 → next() dead.
    Even when uids match, the user-visible "next fails" also reproduces on the SINGLE-TAP path
    whenever the generated/grown queue does not contain current at a resolvable index — but the
    dominant, deterministic failure is the playAlbum current-vs-queue identity mismatch.

- timestamp: 2026-06-11T08:07:00Z
  type: code-read
  ref: src/routes/(app)/artist/[name]/+page.svelte:376, :118-131
  note: |
    CORRECT reference pattern (artist page): row tap does
    `player.setQueue(songs, 'artist'); player.play(track)` — queue is the FULL list and the tapped
    `track` IS a member of it, so indexOf(current) is valid and up-next = rest of the list. The
    album page CANNOT do this synchronously because album rows are Last.fm {artist,title} STUBS
    (not Tracks) that must be resolved on tap. The fix must reproduce the artist-page invariant:
    set the queue to the whole resolved album with the tapped track present, and ensure
    player.current is the SAME object (same uid) that lives in the queue.

- timestamp: 2026-06-11T08:08:00Z
  type: analysis
  ref: shared-root-cause
  note: |
    SHARED ROOT CAUSE CONFIRMED: both bugs stem from the album play paths failing to maintain the
    invariant "player.current is a member of player.queue and the queue IS the album list".
    - Bug 1: single-tap installs queue=[tr] (never the album remainder) → up-next can only be
      generated/grown.
    - Bug 2: whole-album path lets current (`first`) and queue (`all`) be resolved independently →
      identity mismatch → indexOf(current) === -1 → next() can't advance.

## Eliminated

- The `effectiveUpnextMode` resolver itself is correct (settings.svelte.ts:442-449) — 'remix' forces
  generated, null → global, per-context override else global. Not the bug.
- `setQueue` / `queueGen` / WR-06 regenerate supersedence is correct — playAlbum's later setQueue DOES
  win over a racing regenerate. Not the bug.
- `next()` / `prev()` / `indexOf` logic is internally correct given a valid queue; they only fail
  because they are FED a queue whose member set excludes `current`.

## Specialist Review

specialist_hint: typescript (SvelteKit + Svelte 5 runes). Reviewed against typescript-expert idioms.

Verdict: LOOKS_GOOD.
- Reuses existing pure primitives (`dedupeBest`, `sameSongKey`) rather than re-implementing
  same-song matching — the same helpers fallback.ts already relies on.
- The new `ensureAhead` `queueGen` guard mirrors the established `regenerate` WR-06 supersedence
  idiom exactly (snapshot queueGen → re-check after the await → discard if an explicit queue landed),
  so the concurrency model stays consistent across the store.
- `setListQueue` preserves the EXACT `current` object (its resolved audioUrl/lrc) in the queue slot,
  so re-anchoring does NOT restart playback (avoids the play()-reset glitch).
- Reproduces the proven artist-page invariant ("current is a member of the queue") without adding any
  per-Track origin field or new store — consistent with the manualUids/removedUids side-state
  discipline.
- No `any`, no non-null assertions added; types verified clean by svelte-check (0 errors/0 warnings).

## Resolution

- root_cause: |
    SHARED ROOT CAUSE (confirmed). Both album bugs stem from the album play paths violating the
    invariant "player.current is a member of player.queue, and the queue IS the album list".
    - Bug 1 (album default-play populates up-next wrongly): the single-song tap path goes through
      player.playStub, which installs a queue of ONLY the tapped track (`setQueue([tr])`). The album
      remainder is never loaded into the queue, so up-next can only come from generation
      (regenerate → buildSimilarQueue) or growth (ensureAhead → buildDiversePicks). Even with the
      'album' context set to "same-list", ensureAhead grows the one-track queue with GENERATED picks
      because the "snapshot" it is meant to preserve only ever contained one song.
    - Bug 2 (next-song click fails): the whole-album Play path resolves the current track (`first`,
      via playStub's resolveStub) and the queue list (`all`, via resolveAllCached's per-track
      resolveStub) INDEPENDENTLY. resolveStub is non-deterministic and dedupeBest collapses
      cross-source variants, so `current.uid` is not guaranteed to be a member of the deduped queue.
      When it isn't, indexOf(current) === -1, so next() takes the end-of-queue branch where
      ensureAhead early-returns (i < 0) and the re-check indexOf(current) is still -1 → no advance.

- fix: |
    Added player.setListQueue(tracks, context) — installs an explicit ordered list as the up-next
    queue while GUARANTEEING the now-playing track is a member: dedupe the list, locate current by
    uid then by sameSongKey, and either replace that slot with the exact current object (no playback
    restart) or splice current at the front if its song is absent. The album page now calls
    setListQueue(allAlbumTracks, 'album') on BOTH the single-song-tap path (after the optimistic
    one-track play, resolve the rest of the album and re-anchor) and the whole-album Play path
    (re-anchor `first` into the resolved album list). Added a queueGen guard to ensureAhead (mirroring
    regenerate's WR-06) so a stale grow started against the optimistic one-track queue cannot append
    generated picks after the full album is installed.

    Files changed:
    - src/lib/stores/player.svelte.ts — import sameSongKey; new setListQueue() method;
      ensureAhead() queueGen supersedence guard.
    - src/routes/(app)/album/[name]/+page.svelte — playStub() and playAlbum() now re-anchor the
      queue to the full album via setListQueue (single-tap waits for the album resolve then installs;
      whole-album path replaces the plain setQueue(all)).
    - src/lib/stores/player.svelte.test.ts — 5 new regression tests (uid anchor, same-song-key anchor,
      front-splice fallback, no-current delegation, ensureAhead queueGen race discard).

- verification: |
    - pnpm vitest run src/lib/stores/player.svelte.test.ts → 81 passed (76 prior + 5 new).
    - pnpm vitest run (full suite) → 51 files, 631 passed.
    - pnpm svelte-check → 0 errors, 0 warnings (4100 files).
    Node pinned to v22.22.0 for all tooling (per the project node-version gotcha).

- cycles: 1 investigation + 1 fix
- tdd: no
- specialist_review: typescript-expert (inline) — LOOKS_GOOD
