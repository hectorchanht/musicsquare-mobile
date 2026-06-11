---
phase: quick-260611-gln
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/share.ts
  - src/lib/services/share.test.ts
  - src/routes/(app)/+page.svelte
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/TrackMenu.svelte
  - src/routes/(app)/+page.ts
  - src/routes/(app)/artist/[name]/+page.ts
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/album/[name]/+page.ts
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/+layout.svelte
  - src/lib/i18n/*.ts
autonomous: false
requirements:
  - GLN-1-share-continuity
  - GLN-2-share-queue
  - GLN-3-share-slug
  - GLN-4-og-metadata
  - GLN-5-clearqueue-menu
  - GLN-6-android-persist
must_haves:
  truths:
    - "Opening a shared link auto-advances after the shared song ends (does not stop) and prefetches the next track"
    - "A shared link restores the up-next queue, not just one song"
    - "Share URLs are human-readable (song + artist slug) and still decode to the same track"
    - "A shared-song link, an artist page, and an album page each emit identifiable OG/Twitter card title/description/image in SERVER-rendered HTML"
    - "The clear/empty up-next action lives in the now-playing options (MoreVertical) menu; the standalone subnav Clear button is gone"
    - "Backgrounding on Android then returning restores playback position instead of restarting from 0"
  artifacts:
    - path: "src/lib/services/share.ts"
      provides: "Slug encode/decode + queue-carrying token + pure server-importable decode"
    - path: "src/routes/(app)/+page.ts"
      provides: "Universal load that decodes ?play token + derives OG data at SSR"
    - path: "src/routes/(app)/artist/[name]/+page.ts"
      provides: "Universal load deriving artist OG title/desc/image at SSR"
    - path: "src/routes/(app)/album/[name]/+page.ts"
      provides: "Universal load deriving album OG title/desc/image at SSR"
  key_links:
    - from: "src/routes/(app)/+page.svelte (?play handler)"
      to: "player.play(..., { fresh: true })"
      via: "fresh-play path → regenerate/ensureAhead/prefetchNext"
      pattern: "player\\.play\\([^)]*fresh"
    - from: "src/lib/components/NowPlaying.svelte (options menu)"
      to: "player.clearQueue()"
      via: "TrackMenu clear-queue item"
      pattern: "clearQueue"
    - from: "src/lib/stores/player.svelte.ts (attach)"
      to: "localStorage openmusic:player:v1"
      via: "visibilitychange/pagehide immediate persist() flush"
      pattern: "visibilitychange|pagehide"
---

<objective>
Six related improvements around sharing, metadata, and playback persistence, each shipped as an
independent commit so it can be verified/reverted on its own.

Purpose: shared links should behave like normal continuous playback (auto-advance + prefetch +
restore the up-next queue), be human-readable, and produce crawler-correct share cards; the
clear-queue action belongs in the options menu; and Android background-return must resume from the
saved position instead of restarting at 0.

Output: a humanized share token carrying the queue; SSR-rendered OG for shared songs, artists, and
albums; a relocated clear-queue menu item; and visibility/lifecycle persistence in the player store.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md

Runtime: this project uses pnpm + Node >=22 (.nvmrc=22). Run all commands with Node 22.
Verify with `pnpm run check` (svelte-check, must stay 0/0) and `pnpm test` (vitest --run).
Pure logic (slug encode/decode, queue token) gets dedicated tests in the node vitest project
(see vitest.config.ts: single `server` project, environment node, includes src/**/*.test.ts).
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

<critical_findings>
SSR POSTURE (verified): adapter-cloudflare, and there is NO `export const ssr = false` / `prerender`
/ `csr` anywhere in src/routes, and NO existing load files (`+page.ts`/`+page.server.ts`/`+layout.*`).
SvelteKit's default with no opt-out + adapter-cloudflare = **SSR is ON** — pages are server-rendered
at the edge on first request. THEREFORE per-page `<svelte:head>` OG tags ARE baked into the initial
HTML crawlers see — BUT ONLY if their values exist at SSR time. Today the artist hero cover, album
cover, and shared-song identity are all resolved CLIENT-SIDE (onMount/$effect via enrichArtist /
decodeTrack / deezer*), so the SSR HTML carries NO per-page OG. Share-card crawlers (Twitter/FB/
Slack/WhatsApp/iMessage) do NOT run JS → they would see only the static site-default OG from the root
layout. The crawler-correct fix is a per-route `+page.ts` (universal `load`) that derives
{title, artist/album, cover} at request time; universal load RUNS ON THE SERVER during SSR, so the
returned data feeds `<svelte:head>` in the rendered HTML. `+page.ts` (not `.server.ts`) is correct
here because the data sources are own-origin `/api/deezer/*` proxies reachable from both server and
client, and we want the same derivation on client navigation too. Do NOT ship client-only
`<svelte:head>` OG — it silently fails for crawlers.

ROOT LAYOUT OG: `src/routes/+layout.svelte` lines 30-48 emit static site-default OG/Twitter. SvelteKit
auto-dedupes `<title>` but does NOT dedupe arbitrary `<meta>` tags — both layout and page tags render.
Crawlers generally honor the LAST occurrence of a given `og:`/`twitter:` property; page `<svelte:head>`
renders AFTER layout in `%sveltekit.head%`. To be safe + unambiguous, gate the root layout's
og:title/og:description/og:image/og:url + twitter:* so they only render when the page did NOT supply
its own (expose a page-level signal via `page.data`), keeping the static block as the fallback for
routes without per-page OG. Verify the rendered HTML (see Task 5 verify) shows exactly one of each
og:* property with the page-specific value on /artist, /album, and /?play=.

SHARE: `src/lib/services/share.ts` — `encodeTrack`/`decodeTrack`/`shareUrl`. SINGLE track, opaque
base64url token. `btoa`/`atob` exist in the Workers runtime; `location` is already typeof-guarded.
decodeTrack is pure (only imports the Track type) → server-importable as-is.

DEEP-LINK: `src/routes/(app)/+page.svelte` ~lines 567-576 — `onMount` reads `?play=<token>`,
`decodeTrack`, then `player.setQueue([tr], 'home-discovery'); player.play(tr);` — a 1-item queue,
NON-fresh play (no regenerate), no prefetch trigger from this path → STOPS at end. This is item 1+2's
hook.

PLAYER ENGINE (verified in src/lib/stores/player.svelte.ts):
  - `play(track, { fresh: true })` → regenerate (similar-artist up-next) OR ensureAhead per
    queueContext, THEN prefetchNext. A bare `play(track)` does NEITHER regenerate nor (for a 1-item
    queue) meaningful prefetch.
  - `setQueue(tracks, context)` installs an explicit queue + queueContext.
  - `clearQueue()` already exists (keeps current, resets manual pins). This is the method item 5 wires.
  - `persist()` writes {current, queue, currentTime, shuffle, repeatMode} to localStorage
    `openmusic:player:v1`. `persistThrottled()` coalesces the timeupdate firehose to ONE write / 2000ms.
  - `restore()` re-resolves the track + arms `pendingSeek = seek`, applied on loadedmetadata.
  - `attach()` adds audio listeners; there are NO `visibilitychange`/`pagehide`/`freeze`/`pageshow`
    listeners anywhere (item 6's gap). The stale-currentTime-on-hide is the likely Android root cause.

NOW-PLAYING (src/lib/components/NowPlaying.svelte):
  - kebab `MoreVertical` at ~line 666 → `openMenu(player.current)` → `<TrackMenu>` at ~line 825.
  - standalone Clear button at ~lines 762-763: `{#if tab === 'queue' && player.queue.length > 1}
    <button class="clear" onclick={() => player.clearQueue()} ...><Trash2/></button>` — REMOVE this.

TRACKMENU (src/lib/components/TrackMenu.svelte): menu items are `<button class="mi" onclick=...>`;
"Shuffle queue" item at ~line 181-183 is gated `{#if player.queue.length > 1}`. Add "Clear queue"
alongside it. Imports `Trash2` from `@lucide/svelte` (NowPlaying already imports it; TrackMenu does
not yet).

I18N: 15 dict files in src/lib/i18n/ (en is the reference → TranslationKey). The parity test
(i18n.test.ts) only asserts en/zh-Hant/zh-Hans identical key sets, BUT the project convention +
constraint is to add new keys to ALL 15 files. `t()` is the reactive lookup.

ARTIST PAGE (src/routes/(app)/artist/[name]/+page.svelte): head is ONLY
`<svelte:head><title>{name} · openmusic</title></svelte:head>` (line 248). `name` = decoded route
param. Hero cover resolved client-side via enrichArtist/deezerArtist.

ALBUM PAGE (src/routes/(app)/album/[name]/+page.svelte): head is ONLY `<title>` (line 404). `name` =
route param; `albumArtist` = `?artist=` query param. Cover client-side via enrichAlbum/deezerAlbum.

TRACK STUB FIELDS: uid/source/songid/title/artist/album/cover (Stub in share.ts). SourceId =
'netease'|'qq'|'kuwo'|'joox'|'fivesing'|'jamendo'. uid = `${source}:${songid}`.
</critical_findings>

<interfaces>
From src/lib/services/share.ts (current):
```typescript
type Stub = Pick<Track, 'uid' | 'source' | 'songid' | 'title' | 'artist' | 'album' | 'cover'>;
export function encodeTrack(t: Track): string;     // base64url JSON stub
export function decodeTrack(token: string): Track | null;
export function shareUrl(t: Track): string;         // `${origin}/?play=${token}`
```

From src/lib/stores/player.svelte.ts:
```typescript
play(track: Track, opts?: { fresh?: boolean; fromFallback?: boolean }): Promise<void>;
setQueue(tracks: Track[], context?: QueueContext): void;   // QueueContext from $lib/config/defaults
clearQueue(): void;
// queueContext values seen in-repo: 'home-discovery' | 'search' | 'same-list-*' | null
```

From src/lib/services/deezer.ts (own-origin proxies; never throw; server+client callable):
```typescript
export async function deezerSongCover(title: string, artist: string, signal?): Promise<string | null>;
export async function deezerArtistCover(name: string, signal?): Promise<string | null>;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Humanized share slug + queue-carrying token (items 3 + 2 data layer)</name>
  <files>src/lib/services/share.ts, src/lib/services/share.test.ts</files>
  <behavior>
    - encodeShare(current, queue): produces a URL path of the form `/s/<slug>?d=<token>` OR keeps
      the `/?play=` entry but with a readable slug segment — choose the form that lets the EXISTING
      (app)/+page.svelte deep-link handler keep working with minimal change. Decision: keep the
      `/?play=` query entry (no new route needed) and ADD a human-readable `?t=<slug>` companion
      param for readability; the authoritative decode still reads the opaque payload param. The
      visible URL therefore reads e.g. `/?t=dao-xiang-jay-chou&play=<payload>` (GLN-3: human-readable
      slug present in the URL; GLN-2: payload now carries the queue).
    - slugify(title, artist): lowercases, transliterates spaces/punct to '-', collapses repeats,
      trims leading/trailing '-', caps length (~60 chars). CJK-safe: preserve CJK codepoints as-is
      (do NOT strip them — `decodeURIComponent`/`encodeURIComponent` round-trips them); only ASCII
      punctuation/space becomes '-'. Test: slugify('稻香','Jay Chou') is non-empty + URL-safe;
      slugify('Hello World!!','A B') === 'hello-world-a-b' (or documented equivalent).
    - encodeShare carries BOTH the current track stub AND a capped queue (cap ~30 stubs to bound URL
      length) in the payload. Test: round-trip encodeShare→decodeShare returns the same current uid
      AND the same queue uids/titles. Empty/1-item queue round-trips to a 1-item (or empty) queue.
    - decodeShare(payloadToken): returns `{ current: Track | null, queue: Track[] }`. Backward-compat:
      a LEGACY single-track token (today's encodeTrack output, no queue field) still decodes — current
      = the track, queue = [current]. Test both the new {current,queue} payload and a legacy token.
    - decodeShare is PURE (no browser/DOM/$state) so a server `load` can import it. Keep decodeTrack
      exported (legacy callers) but implement it in terms of decodeShare or keep both.
    - shareUrl(current, queue?): builds `${origin}/?t=${slug}&play=${payload}`; origin guarded for SSR.
  </behavior>
  <action>
    Extend src/lib/services/share.ts (GLN-2, GLN-3). Add `slugify(title, artist)` (pure, CJK-safe,
    capped). Change the payload shape to `{ v: 2, c: Stub, q: Stub[] }` (current + capped queue, cap
    30). Add `encodeShare(current: Track, queue: Track[]): string` (base64url of the v2 payload) and
    `decodeShare(token): { current: Track | null; queue: Track[] }` that ALSO accepts a legacy v1
    payload (a bare Stub object — detect by absence of `q`/`v` and presence of `uid`) and returns
    {current, queue:[current]}. Keep `decodeTrack(token)` working (delegate to decodeShare and return
    `.current`) so no existing import breaks. Update `shareUrl` to accept `(current, queue?)` and emit
    `${base}/?t=${slugify(...)}&play=${encodeShare(current, queue ?? [])}`. Do NOT inline code here —
    reference the existing btoa/atob base64url transform already in the file and reuse it. Add a
    dedicated src/lib/services/share.test.ts covering slugify (ASCII + CJK), v2 round-trip (current +
    queue), legacy v1 decode, and empty-queue decode. NO new deps.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm test -- --run src/lib/services/share.test.ts</automated>
  </verify>
  <done>share.test.ts passes: slugify is URL-safe for ASCII + CJK; encodeShare/decodeShare round-trips current + capped queue; legacy single-track token still decodes to {current, queue:[current]}; `pnpm run check` 0/0.</done>
</task>

<task type="auto">
  <name>Task 2: Shared-link continuity + queue restore + prefetch (items 1 + 2 wiring)</name>
  <files>src/routes/(app)/+page.svelte</files>
  <action>
    In src/routes/(app)/+page.svelte (GLN-1, GLN-2), replace the `?play=` onMount handler (~lines
    567-576). Decode the token with `decodeShare` from $lib/services/share. When a `queue` of length
    > 1 is present: `player.setQueue(queue, 'home-discovery')` then `player.play(current, { fresh:
    true })` so the shared playback runs through the SAME continuity path normal play uses
    (regenerate/ensureAhead + prefetchNext) and AUTO-ADVANCES at end instead of stopping. When only a
    single track is present (legacy token or 1-item queue): `player.setQueue([current],
    'home-discovery')` then `player.play(current, { fresh: true })` — `fresh:true` makes the player
    regenerate a similar-artist up-next so the shared song keeps playing continuously AND prefetches
    (matches normal tap-to-play). Keep clearing the URL params via `history.replaceState(null, '',
    location.pathname)` (note: the file imports the history store as `playHistory` to avoid shadowing
    `window.history` — use `window.history.replaceState` or the existing global reference, do NOT
    use the `playHistory` store). Preserve the existing `if (token)` guard that suppresses the
    cold-cache queue seed (the `refresh(!token)` / `!token && cached.useFallback` branches) so the
    shared queue is not overwritten by discovery picks. Use `current` for the null-check that today
    uses `tr`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm run check</automated>
  </verify>
  <done>check 0/0. The ?play handler decodes via decodeShare, installs the shared queue (multi-item) or a 1-item queue, and calls play(current,{fresh:true}); discovery seed is still suppressed when a token is present.</done>
  <human-check device-dependent="false">
    On `pnpm dev`, copy a multi-track share URL (generate via the share action), open it in a fresh
    tab, tap play: confirm (a) it plays the shared song, (b) the Up Next list shows the shared queue,
    (c) when the shared song ends it AUTO-ADVANCES to the next queued song rather than stopping.
  </human-check>
</task>

<task type="auto">
  <name>Task 3: Wire share action to carry the up-next queue (item 2 producer)</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
    In src/lib/components/TrackMenu.svelte `doShare()` (~lines 108-117), pass the current up-next
    queue to `shareUrl` so the produced link carries it (GLN-2). Import `player` is already present.
    Call `shareUrl(track, player.queue)` instead of `shareUrl(track)`. Keep the existing
    navigator.share / clipboard fallback. The `navigator.share({ title, url })` title stays
    `${track.title} — ${track.artist}`. No behavior change when the queue is empty (shareUrl handles
    `queue ?? []`).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm run check</automated>
  </verify>
  <done>check 0/0. doShare passes player.queue into shareUrl so the generated link carries the up-next list.</done>
</task>

<task type="auto">
  <name>Task 4: Move clear-queue into the now-playing options menu (item 5)</name>
  <files>src/lib/components/TrackMenu.svelte, src/lib/components/NowPlaying.svelte, src/lib/i18n/*.ts</files>
  <action>
    GLN-5. (a) In src/lib/components/TrackMenu.svelte, add a "Clear queue" menu item next to the
    existing "Shuffle queue" item (~line 181-183), gated `{#if player.queue.length > 1}` (clearing a
    queue that is just [current] is a no-op). Use the `Trash2` icon — add `Trash2` to the existing
    `@lucide/svelte` import. The button calls a local `clearQueue()` handler that does
    `player.clearQueue(); close();`. Use a NEW i18n key `menu.clearQueue`. (b) In
    src/lib/components/NowPlaying.svelte, REMOVE the standalone subnav Clear button (~lines 762-763,
    the `{#if tab === 'queue' && player.queue.length > 1} <button class="clear" ...><Trash2/></button>`
    block) and its now-unused `.clear` CSS rule if present. Keep the `Trash2` import in NowPlaying
    only if still used elsewhere (grep — the reorder/queue rows may use it; if not, remove the import
    to keep check clean). Verify the subnav tap-routing comments (~line 504) still hold — removing the
    Clear button must not break the "Clear queue button must act alone" tap routing (it simply no
    longer exists). (c) Add `menu.clearQueue` to ALL 15 dict files in src/lib/i18n/ (en value:
    "Clear queue"; localize the others; zh-Hant/zh-Hans must be real translations so the parity +
    no-blank tests pass). Place it adjacent to `menu.shuffleQueue` in each file for consistency.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm test -- --run src/lib/i18n/i18n.test.ts && pnpm run check</automated>
  </verify>
  <done>i18n parity + no-blank tests pass with menu.clearQueue in all 15 dicts; check 0/0; TrackMenu shows a gated "Clear queue" item wired to player.clearQueue; the standalone subnav Clear button is gone.</done>
  <human-check device-dependent="false">
    On `pnpm dev`, play a track with an up-next of 2+ songs: open the now-playing options (kebab) →
    confirm a "Clear queue" item appears (and is absent when the queue is just the current track);
    tap it → Up Next collapses to the current track only. Confirm the old Clear button no longer
    shows in the Up Next subnav.
  </human-check>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Crawler-correct OG metadata via universal load (item 4)</name>
  <files>src/routes/(app)/+page.ts, src/routes/(app)/artist/[name]/+page.ts, src/routes/(app)/album/[name]/+page.ts, src/routes/(app)/artist/[name]/+page.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/+page.svelte, src/routes/+layout.svelte</files>
  <behavior>
    - Shared-song card: `/?play=<token>` SSR HTML contains og:title = "{song} — {artist}",
      og:description mentioning openmusic + listen, og:image = a cover URL when derivable (else the
      static /og.svg fallback), twitter:card = summary_large_image.
    - Artist card: `/artist/<name>` SSR HTML contains og:title with the artist name, og:description,
      og:image (resolved cover or fallback).
    - Album card: `/album/<name>?artist=<a>` SSR HTML contains og:title with the album name,
      og:description, og:image (resolved cover or fallback).
    - Each route emits exactly ONE of each og:*/twitter:* property (no duplicate from the root
      layout) with the page-specific value.
  </behavior>
  <action>
    GLN-4. Add universal `+page.ts` load functions (they run on the server during SSR, so the values
    land in the rendered HTML — this is the crawler-correct path; a client-only <svelte:head> would
    silently fail for non-JS crawlers).

    1) src/routes/(app)/+page.ts: `export const load` reads `url.searchParams.get('play')`. If
       present, import `decodeShare` from $lib/services/share (pure, server-safe) → derive
       `{ ogTitle, ogDescription, ogImage }` from `current` (title/artist; ogImage = current.cover
       if it is a usable absolute https URL, else null). Best-effort cover upgrade: optionally call
       `deezerSongCover(title, artist)` from $lib/services/deezer (own-origin proxy, never throws,
       pass the `fetch` from load's event for SSR) — but keep it cheap + bounded; on any miss leave
       ogImage null. Return `{ og: { title, description, image } | null }`. No token → return
       `{ og: null }`.
    2) src/routes/(app)/artist/[name]/+page.ts: derive name from `params.name` (decodeURIComponent).
       og.title from the artist name + " · openmusic"; description from an `artist.shareDesc` i18n-
       style string (or a literal — load runs server-side where `t()` reads $state; prefer a plain
       English-or-name string in load, NOT t(), to stay SSR-safe). ogImage = best-effort
       `deezerArtistCover(name, fetch)` (never throws) else null. Return `{ og }`.
    3) src/routes/(app)/album/[name]/+page.ts: name from `params.name`; artist from
       `url.searchParams.get('artist')`. og.title = album name + " · openmusic"; ogImage =
       best-effort `deezerSongCover`/album cover lookup else null. Return `{ og }`.

    4) In artist/+page.svelte and album/+page.svelte and (app)/+page.svelte: accept `data` via
       `let { data } = $props()` (or extend existing props) and add a `<svelte:head>` that, when
       `data.og` is non-null, emits og:title/og:description/og:image (+ image width/height when
       known), og:type, og:url, twitter:card/title/description/image. Keep the existing `<title>`.
       For the artist/album pages the client-resolved hi-res cover may differ — that is fine; the
       SSR cover is what crawlers read.

    5) Root layout dedup (src/routes/+layout.svelte): expose whether the active page supplied OG via
       `page.data.og` (from $app/state `page`). Wrap the layout's og:title/og:description/og:image/
       og:url + twitter:* in `{#if !page.data?.og}` so the static site-default block is the FALLBACK
       only; when a page supplies OG, only the page's tags render (exactly one of each property).
       Keep the layout's `<title>`/description/canonical/og:type/og:site_name as-is (title is
       auto-deduped by SvelteKit; site_name/type are fine to keep).

    Add a pure unit test for the OG derivation helper IF you factor one out (recommended: a small pure
    `buildOg({title, artist, album, cover})` in share.ts or a new og.ts so it is node-testable);
    otherwise rely on the rendered-HTML human-check below. Prefer the pure helper + test.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm run check && pnpm test -- --run</automated>
  </verify>
  <done>check 0/0; full test suite green (incl. any new og helper test); three +page.ts load functions return `{ og }`; artist/album/home emit page-specific og:* in <svelte:head>; root layout OG is gated behind `{#if !page.data?.og}`.</done>
  <human-check device-dependent="false">
    Build + run SSR: `pnpm build` then `pnpm preview` (wrangler pages dev). With curl (no JS), fetch
    the SSR HTML and confirm page-specific OG is present in the SERVER response — e.g.
    `curl -s "http://127.0.0.1:4173/artist/Jay%20Chou" | grep -i 'og:title\|twitter:card'` shows the
    artist name (NOT just the site default), and the same for `/album/...?artist=...` and a
    `/?play=<token>` URL. Confirm exactly one og:title appears (no layout duplicate). Optionally paste
    a deployed URL into a card validator (Twitter/Slack/Facebook debugger) once deployed.
  </human-check>
</task>

<task type="auto">
  <name>Task 6: Android background persistence — flush position on hide/freeze, restore on resume (item 6)</name>
  <files>src/lib/stores/player.svelte.ts</files>
  <action>
    GLN-6. In src/lib/stores/player.svelte.ts `attach(el)` (~lines 665-868), add document/window
    lifecycle listeners that flush the EXACT current position to localStorage immediately, bypassing
    the 2s `persistThrottled()` window — so an Android process eviction / tab freeze never leaves a
    stale (pre-roll) `currentTime`, which is the likely root cause of "restores to 0".

    Add (all SSR-safe — `attach` only runs client-side from the layout, but still guard `typeof
    document !== 'undefined'`):
      - `document.addEventListener('visibilitychange', ...)`: when `document.hidden`, sync
        `this.currentTime = el.currentTime` first, then call `this.persist()` directly (immediate,
        not throttled). Clear any pending persistTimer so the throttled write can't later clobber with
        a staler value (it won't, but cancel for cleanliness).
      - `window.addEventListener('pagehide', ...)`: same immediate flush (covers bfcache eviction /
        navigation away on mobile Safari + Chrome).
      - `document.addEventListener('freeze', ...)` (Page Lifecycle API, Chrome/Android): same
        immediate flush. Feature-detect by simply adding the listener (browsers without it ignore it).
      - `window.addEventListener('pageshow', (e) => ...)`: if `e.persisted` (restored from bfcache),
        the audio element is live-but-may-be-detached. Re-sync `this.currentTime = el.currentTime` and
        `this.playing = !el.paused` so the UI reflects reality; do NOT autoplay. (Restore-from-storage
        already runs in the layout on mount; pageshow(persisted) skips a full reload so this re-sync
        keeps the UI honest.)
    Factor the flush into a private `flushPersist()` that sets currentTime from the element then calls
    `persist()`; reuse it from all three hide listeners. Keep everything idempotent + never-throw.

    Do NOT change restore()'s pendingSeek mechanism — it already arms the saved seek and applies it on
    loadedmetadata; it is correct. The bug is the STALE saved value, which the immediate flush fixes.

    Add an automated test in the player's existing test file (or a new player-lifecycle test under the
    node vitest project) that, with a fake audio element ({ currentTime, paused, addEventListener }),
    simulates a `visibilitychange` to hidden after setting currentTime and asserts localStorage
    `openmusic:player:v1` was written with that exact currentTime (use a localStorage shim / the
    existing test setup). If wiring a DOM-event test is impractical under node, instead expose/cover
    `flushPersist()` directly: set currentTime, call it, assert the persisted JSON's currentTime.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && pnpm test -- --run && pnpm run check</automated>
  </verify>
  <done>check 0/0; test suite green; attach() registers visibilitychange/pagehide/freeze (immediate flush) + pageshow(persisted) re-sync; a test proves an immediate localStorage write of the exact currentTime on hide.</done>
  <human-check device-dependent="true">
    DESKTOP-VERIFIABLE part (do this): on `pnpm dev`, play a track ~30s in, then in DevTools toggle the
    tab hidden (or switch tabs) and inspect localStorage `openmusic:player:v1` — `currentTime` must be
    ~30 (the exact current position), written immediately, not the last 2s-throttled value. Reload the
    page → confirm the player restores to ~30s (seek lands on play).
    DEVICE-DEPENDENT part (cannot be verified in desktop preview): on a real Android phone PWA, play a
    song, background the app for a while, return — confirm it resumes at the saved position instead of
    restarting at 0 and that the progress knob no longer jumps to the beginning on first interaction.
  </human-check>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| crawler/visitor → share URL params | `?play=`/`?t=` are attacker-controllable strings parsed by decodeShare (client + server load) |
| route params/query → +page.ts load | `params.name`, `?artist=` flow into OG strings + own-origin proxy lookups |
| localStorage → restore()/flushPersist() | persisted player state is user-local but read back as JSON |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-gln-01 | Tampering | decodeShare(token) | mitigate | decodeShare is try/catch wrapped, validates required fields (uid/source), returns {current:null,queue:[]} on malformed/oversized input; queue cap (30) bounds payload; runs identically server + client |
| T-gln-02 | Injection (XSS) | OG `<svelte:head>` values | mitigate | Svelte escapes text/attribute bindings by default; OG values are bound via `content={...}` (escaped), never `{@html}`; cover URLs constrained to https/derived-from-proxy values, else fallback /og.svg |
| T-gln-03 | Info Disclosure | +page.ts server load | accept | No secrets read in load; deezer* helpers hit own-origin proxies that already gate keys edge-only; OG exposes only public song/artist/album names + public cover URLs |
| T-gln-04 | DoS | server-side cover lookup in load | mitigate | deezer* helpers are AbortSignal-timeout bounded + never-throw; on miss/timeout ogImage falls back to static /og.svg; no unbounded fan-out |
| T-gln-05 | Tampering | restore()/flushPersist localStorage | accept | localStorage is same-origin user-local; restore already reshapes + clamps seek (Math.max(0,…)); a tampered value only affects the user's own resume position |
| T-gln-SC | Tampering | npm/pip/cargo installs | mitigate | NO new dependencies are added by this plan (constraint); no install step → supply-chain surface unchanged |
</threat_model>

<verification>
- `pnpm run check` → 0 errors / 0 warnings after every task.
- `pnpm test -- --run` → full suite green (existing 415+ tests + new share.test.ts + og helper test +
  player-lifecycle test). i18n parity + no-blank tests pass with `menu.clearQueue` in all 15 dicts.
- SSR OG verified via `pnpm build && pnpm preview` + curl (non-JS) on /artist, /album, /?play=.
- No new dependencies introduced (grep package.json diff = none).
</verification>

<success_criteria>
- Shared link auto-advances (does not stop) and prefetches, like normal play (item 1).
- Shared link restores the up-next queue, not just one song (item 2).
- Share URL is human-readable via a slug param; token still decodes (item 3).
- Shared-song, artist, and album pages emit identifiable OG/Twitter cards in SERVER-rendered HTML
  (item 4) — verified with curl against the SSR response, not client-only.
- Clear-queue action lives in the now-playing options menu; standalone subnav button removed (item 5).
- Player flushes exact position on hide/freeze/pagehide and restores it on resume; desktop-verified
  via localStorage + reload, Android resume marked device-dependent (item 6).
</success_criteria>

<output>
Create `.planning/quick/260611-gln-sharing-metadata-persistence-bundle-1-sh/260611-gln-SUMMARY.md` when done.
Commit each task independently (6 commits) so any item can be reverted on its own.
</output>
