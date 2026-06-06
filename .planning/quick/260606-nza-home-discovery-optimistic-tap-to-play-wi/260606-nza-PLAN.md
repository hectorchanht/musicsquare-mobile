---
phase: quick-260606-nza
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/+layout.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/lib/services/cover-art.ts
  - src/lib/services/cover-art.test.ts
  - src/routes/api/lastfm/discovery/+server.ts
  - src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts
  - src/lib/services/lastfm.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
autonomous: true
requirements: [FIX-A, FIX-B]

must_haves:
  truths:
    - "Tapping a discovery tile instantly shows that song's title+artist in the now-playing bar with a visible loading indicator, before the ~5-10s resolve completes"
    - "Tapping the SAME song again while it is resolving does not start a second resolve"
    - "Tapping a DIFFERENT song supersedes the in-flight resolve — the stale result never plays"
    - "On resolve success the now-bar swaps from loading to the real playing Track"
    - "On resolve miss the loading state clears and the unplayable toast shows; the bar/player never breaks"
    - "Discovery tiles with a Last.fm mbid show real Cover Art Archive cover art; tiles without art (404/no mbid) show the existing color gradient block, never a broken image"
    - "pnpm check is clean and pnpm test is green (existing + new tests)"
  artifacts:
    - path: "src/lib/stores/player.svelte.ts"
      provides: "pendingTrack + loading-guard playStub flow (dedupe by pending key + generation guard)"
      contains: "pendingTrack"
    - path: "src/lib/services/cover-art.ts"
      provides: "caaReleaseGroupCover(mbid) URL builder (release-group/front-250)"
      contains: "coverartarchive.org"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "unit tests for the pending dedupe + generation guard"
    - path: "src/lib/services/cover-art.test.ts"
      provides: "unit tests for the CAA URL builder"
  key_links:
    - from: "src/routes/(app)/+page.svelte"
      to: "player.playStub"
      via: "tile onclick calls the store optimistic-resolve flow"
      pattern: "player\\.playStub"
    - from: "src/routes/(app)/+layout.svelte"
      to: "player.pendingTrack / player.loading"
      via: "now-bar renders the pending stub + loading indicator"
      pattern: "pendingTrack"
    - from: "src/routes/api/lastfm/discovery/+server.ts"
      to: "DiscoveryItem.mbid"
      via: "reshape surfaces the upstream mbid per item"
      pattern: "mbid"
---

<objective>
Two home-page (Phase 9 discovery) UX fixes:

- FIX A — Optimistic tap-to-play. resolveStub (searchAll + dedupeBest across CN sources) takes ~5-10s before audio. Today a tap gives no feedback and concurrent taps stack uncancelled loads. Make a tap INSTANTLY lock the tapped {artist,title} into the now-playing bar (title + artist + cover-if-known) with a LOADING indicator, dedupe a repeat tap on the same song, and supersede an in-flight resolve when a different song is tapped (generation guard like the home page's existing refreshGen). On success swap loading→real Track; on miss clear loading + show the existing unplayable toast.

- FIX B — Real cover art on discovery tiles. Last.fm dropped track-level art so tiles are color blocks. Surface Last.fm's per-item `mbid` through /api/lastfm/discovery's reshape and build a Cover Art Archive URL CLIENT-SIDE (`release-group/{mbid}/front-250`) for the tile background; on 404/empty/no-mbid fall back to the existing color gradient (img that hides on error → gradient shows through). No broken images, off the render critical path.

Purpose: discovery taps feel instant + native, and tiles look like a real music app instead of color swatches.
Output: a pending/loading-guarded play path in the player store, optimistic now-bar rendering, mbid surfacing + CAA tile covers, and tests for all new logic.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Contracts the executor needs — extracted from the codebase. Use these directly. -->

Track (src/lib/sources/types.ts):
```typescript
export type SourceId = 'netease' | 'qq' | 'kuwo' | 'joox';
export interface Track {
  uid: string;          // `${source}:${songid}`
  source: SourceId;
  songid: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  audioUrl: string | null;
  // ...lrc, quality, detailsLoaded, etc.
}
```

Player store (src/lib/stores/player.svelte.ts) — relevant existing members:
```typescript
class Player {
  current = $state<Track | null>(null);
  playing = $state(false);
  loading = $state(false);        // already exists — flips during play() resolution
  error = $state<string | null>(null);
  setQueue(tracks: Track[]): void;
  async play(track: Track, opts?: { fresh?: boolean }): Promise<void>;
}
export const player = new Player();
```

resolveStub (src/lib/services/discovery.ts):
```typescript
// Last.fm {artist,title} stub → best playable Track | null. Never throws.
export async function resolveStub(artist: string, title: string): Promise<Track | null>;
```

Home playStub TODAY (src/routes/(app)/+page.svelte ~213):
```typescript
async function playStub(item: DiscoveryTrack) {
  const tr = await resolveStub(item.artist, item.title);
  if (tr) { player.setQueue([tr]); player.play(tr); }
  else { toast(t('home.unplayable')); }
}
```

Now-bar TODAY (src/routes/(app)/+layout.svelte ~40) — gated on `player.current && !player.expanded`,
reads player.current.title/artist/cover and already shows `player.loading` / `player.error` text.

Discovery endpoint reshape (src/routes/api/lastfm/discovery/+server.ts):
```typescript
export interface DiscoveryTrackItem { artist: string; title: string; image: string | null; }
export interface DiscoveryNamedItem { name: string; image: string | null; }
// reshapeTracks/reshapeNamed currently map upstream items → these shapes (no mbid).
// Upstream Last.fm items carry an `mbid` string field (often empty) on tracks/artists/albums.
```

DiscoveryTrack / DiscoveryArtist (src/lib/services/lastfm.ts):
```typescript
export interface DiscoveryTrack { artist: string; title: string; image: string | null; }
export interface DiscoveryArtist { name: string; image: string | null; }
```

Cover Art Archive contract (no User-Agent, no rate limit, browser-loadable as <img>):
- https://coverartarchive.org/release-group/{mbid}/front-250  → 307 redirect to image, or 404 when no art.
- A 404 must degrade gracefully (img onerror → hide → gradient shows). Confirmed: a missing release-group returns 404.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Player store — pendingTrack + optimistic resolve flow with dedupe + generation guard</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <read_first>
    - src/lib/stores/player.svelte.ts (full — note `current`, `loading`, `error`, `play`, `setQueue`, the `ms` SSR/feature guard, and the refreshGen-style generation idiom used on the home page)
    - src/lib/services/discovery.ts (resolveStub signature + never-throws contract)
    - src/lib/services/discovery.test.ts (mock idiom: vi.spyOn(catalog,'searchAll'); the `mk()` Track factory; afterEach restore)
  </read_first>
  <behavior>
    - playStub(artist, title, cover?): when no resolve for that pending key is in flight, sets pendingTrack to a lightweight {artist, title, cover} display object and loading=true SYNCHRONOUSLY (before awaiting resolveStub), so the now-bar can render immediately.
    - Pending key = `${artist}␟${title}` lowercased/trimmed. A second playStub with the SAME key while one is in flight is a NO-OP (no second resolveStub call).
    - A playStub with a DIFFERENT key supersedes the in-flight one: bump an internal generation counter; when the older resolve settles its generation != current → its result is discarded (never played, pendingTrack not touched).
    - On resolve success for the CURRENT generation: setQueue([track]) + play(track) (loading is then owned by play()), pendingTrack cleared once current is set.
    - On resolve miss (null) for the CURRENT generation: clear pendingTrack + loading, set a flag/return value the caller can use to toast (return the resolved Track | null so the page still owns its toast string).
    - playStub returns Promise<Track | null> (null = miss or superseded).
    - SSR/no-throw safe: resolveStub never throws; playStub must not either.
  </behavior>
  <action>
    Add to the Player class: a `pendingTrack` $state of a minimal display shape ({ artist: string; title: string; cover: string | null } | null) and a private `pendingKey` string + private `pendingGen` number counter. Add a public async `playStub(artist: string, title: string, cover?: string | null): Promise<Track | null>`.

    In playStub: compute `key = `${artist}␟${title}`.toLowerCase().trim()` (use the U+241F symbol the task specifies as the separator). If `key === this.pendingKey` AND a resolve is in flight (loading set by a previous playStub OR pendingTrack non-null) → return null immediately (dedupe same-song double tap). Otherwise: bump `const gen = ++this.pendingGen`; set `this.pendingKey = key`; set `this.pendingTrack = { artist, title, cover: cover ?? null }`; set `this.loading = true`; clear `this.error`. Then `const tr = await resolveStub(artist, title)`. After the await, FIRST check `if (gen !== this.pendingGen) return null` (superseded — discard silently, do NOT touch pendingTrack/loading; the newer call owns them). If still current: when `tr` is truthy → `this.pendingTrack = null` then `this.setQueue([tr]); void this.play(tr, { fresh: true }); return tr;` (play() takes over loading + current). When `tr` is null → `this.pendingTrack = null; this.loading = false; this.pendingKey = ''; return null;` (caller toasts).

    Also: in `play()`, when a real play starts, clear `this.pendingTrack = null` and reset `this.pendingKey = ''` at the top (so a direct play() call from elsewhere doesn't leave a stale pending overlay). Keep all existing play() behavior intact.

    No code blocks belong here — implement against the behavior block. Do NOT change the `ms`/Media Session logic, the queue/regen logic, or the existing `loading`/`error` semantics beyond the additions above.
  </action>
  <verify>
    <automated>pnpm exec vitest --run src/lib/stores/player.svelte.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - New test file src/lib/stores/player.svelte.test.ts covers: (1) same-key double tap → resolveStub/searchAll called once; (2) different-key tap supersedes → stale resolve's Track is NOT played (player.current stays the newer one / null), assert via spying resolveStub or catalog.searchAll with controllable resolution timing; (3) success → player plays the resolved Track + pendingTrack cleared; (4) miss → pendingTrack cleared, loading false, returns null; (5) playStub never throws when resolveStub rejects (mock catalog.searchAll reject).
    - Mock resolveStub by spying on catalog.searchAll (mirror discovery.test.ts), OR vi.mock('$lib/services/discovery') — whichever keeps the generation-timing test deterministic (use deferred promises to control settle order).
  </acceptance_criteria>
  <done>pnpm exec vitest runs player.svelte.test.ts green; pendingTrack + playStub exist with dedupe + generation guard; existing player behavior unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Wire optimistic now-bar — home + album tap, mini-bar loading render</name>
  <files>src/routes/(app)/+page.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/+layout.svelte, src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts</files>
  <read_first>
    - src/routes/(app)/+page.svelte (the current `playStub(item)` at ~213 and its callers in the four shelves + the fallback grid; the local `toast()` helper)
    - src/routes/(app)/album/[name]/+page.svelte (the current `playStub(stub)` at ~110 and its toast helper)
    - src/routes/(app)/+layout.svelte (the .nowbar block at ~40 — gated on `player.current && !player.expanded`; already renders player.loading/error)
    - src/lib/stores/player.svelte.ts (the new playStub + pendingTrack from Task 1)
    - src/lib/i18n/en.ts (home.* keys ~16-26; common.loading ~12)
  </read_first>
  <action>
    Home (src/routes/(app)/+page.svelte): replace the body of `playStub(item: DiscoveryTrack)` to call `const tr = await player.playStub(item.artist, item.title, item.image)`. player.playStub returns null for BOTH a genuine miss AND a supersede, so gate the toast: toast `t('home.unplayable')` ONLY when `tr === null && player.pendingTrack == null` — a supersede leaves pendingTrack pointing at the newer song (no toast), while a miss clears pendingTrack (toast). Verify this signal against Task 1's behavior and switch to a cleaner one if the executor finds it.

    The four shelf `onclick={() => playStub(item)}` callers stay as-is (they call the page-local playStub which now delegates to the store). The top-artists `goto` and the fallback-grid real-Track `player.play` paths are UNCHANGED.

    Album (src/routes/(app)/album/[name]/+page.svelte): same change to its `playStub(stub: AlbumStub)` — delegate to `player.playStub(stub.artist, stub.title)` (album stubs have no cover) and toast `t('album.unplayable')` on a genuine miss using the same gating.

    Mini-bar (src/routes/(app)/+layout.svelte): change the now-bar visibility gate from `player.current && !player.expanded` to `(player.current || player.pendingTrack) && !player.expanded`. Inside, when `player.current` is null but `player.pendingTrack` is set, render the pending stub's title/artist (use `names.dn(...)`) and its cover (`player.pendingTrack.cover ? url(...) : cover(...)`). Add a visible LOADING affordance: when `player.loading` show an indeterminate sliver. Reuse the existing `.np-prog > i` bar: when loading, give it a class (e.g. `.np-prog.indet`) that animates an indeterminate left-right sliver via a keyframe (CSS only), instead of the width-bound determinate fill. The play/pause button: when `player.loading` and no current, render a small spinner glyph or disable it (no audio yet). Do NOT touch src/routes/+layout.svelte (root). Keep all existing nowbar markup/styles otherwise intact; add the indeterminate keyframe + class in the component <style>.

    i18n: reuse the existing `common.loading` (already present in all three locales). Do NOT invent new keys unless the now-bar needs one; if you add one, add it to en.ts, zh-Hant.ts, AND zh-Hans.ts with the same key.
  </action>
  <verify>
    <automated>pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - Now-bar appears the instant a discovery tile is tapped (pendingTrack drives it) showing the tapped title+artist+cover-if-known with a visible indeterminate loading indicator.
    - A genuine miss shows the existing unplayable toast; a supersede (tapping another song mid-resolve) does NOT toast.
    - The fallback-grid real-Track tap path and top-artist goto are unchanged.
    - src/routes/+layout.svelte is NOT modified (only src/routes/(app)/+layout.svelte).
    - pnpm check is clean (TS strict, Svelte 5 runes).
  </acceptance_criteria>
  <done>pnpm check clean; tapping a tile shows the optimistic loading now-bar; home + album delegate to player.playStub; misses toast, supersedes don't; root layout untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Cover Art Archive tile covers — surface mbid + client CAA URL builder + graceful fallback</name>
  <files>src/routes/api/lastfm/discovery/+server.ts, src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts, src/lib/services/lastfm.ts, src/lib/services/cover-art.ts, src/lib/services/cover-art.test.ts, src/routes/(app)/+page.svelte</files>
  <read_first>
    - src/routes/api/lastfm/discovery/+server.ts (DiscoveryTrackItem/DiscoveryNamedItem, reshapeTracks/reshapeNamed, the LfmTrack/LfmNamed sub-shapes, safeImageUrl/pickImage — note image stays last.fm/fastly only)
    - src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts (payload fixtures + assertion idiom: the items[0] toEqual exact shape)
    - src/lib/services/lastfm.ts (DiscoveryTrack/DiscoveryArtist interfaces + the fetchList builders)
    - src/routes/(app)/+page.svelte (the four shelf tiles using `item.image ? url(item.image) : fallbackCover(...)` — note these are <span> background-image, NOT <img>)
  </read_first>
  <behavior>
    - caaReleaseGroupCover(mbid): returns `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250` for a non-empty mbid; returns null for empty/whitespace/undefined mbid.
    - The builder does NOT fetch — it only builds the URL. The browser <img> performs the request; a 404 (no art) is handled by onerror in the template (img hides → gradient shows).
    - Endpoint reshape surfaces `mbid: string | null` on each DiscoveryItem (track + named), reading the upstream item's `mbid` field; empty-string mbid → null.
  </behavior>
  <action>
    Endpoint (src/routes/api/lastfm/discovery/+server.ts): add `mbid: string | null` to DiscoveryTrackItem and DiscoveryNamedItem. Add `mbid?: string` to the LfmTrack and LfmNamed sub-shapes. In reshapeTracks and reshapeNamed, set `mbid: (t.mbid ?? '').trim() || null`. Leave image/safeImageUrl untouched — mbid is a plain ID string, not a URL, and is NOT interpolated into CSS, so no allowlist change is needed here. Do NOT add coverartarchive.org to safeImageUrl (CAA URLs are built client-side and never pass through this endpoint).

    Service (src/lib/services/lastfm.ts): add `mbid: string | null` to DiscoveryTrack and DiscoveryArtist interfaces (the fetchList builders pass items through unchanged, so mbid flows automatically — verify the generic <T> passthrough surfaces it).

    New client builder (src/lib/services/cover-art.ts): export `caaReleaseGroupCover(mbid: string | null | undefined): string | null` per the behavior block. Add a brief header comment: CAA is rate-limit-free, needs no User-Agent, 307→image or 404; URL built client-side so the last.fm/fastly safeImageUrl allowlist does not apply; the no-mbid / 404 case degrades to the existing gradient.

    Home tiles (src/routes/(app)/+page.svelte): for the THREE track shelves (topHits, tagShelves, countryShelves — NOT the artist shelf), prefer a real cover: compute a per-item cover URL = `item.image ?? caaReleaseGroupCover(item.mbid)`. Render it as an actual `<img>` element layered over the gradient — cleanest graceful path: an `<img class="al-cover-img" src={coverUrl} loading="lazy" alt="" onerror={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none'}} />` absolutely positioned over the gradient span; on 404 it hides → gradient shows. Keep using `fallbackCover(...)` as the gradient under it. If coverUrl is null, render no img (gradient only). Top-artist tiles do the same with `a.image ?? caaReleaseGroupCover(a.mbid)` (round). Do NOT eager-fetch — the <img> lazy-loads per visible tile (`loading="lazy"`), off the critical path.

    The optimistic cover passed into player.playStub from Task 2's home playStub uses `item.image` (real cover if any). No MusicBrainz edge endpoint in this plan — see Deferred.
  </action>
  <verify>
    <automated>pnpm exec vitest --run src/lib/services/cover-art.test.ts src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - New src/lib/services/cover-art.test.ts: caaReleaseGroupCover builds the release-group/front-250 URL for a real mbid (incl. encodeURIComponent of an mbid), returns null for '', '   ', undefined, null.
    - Extended lastfm-discovery-endpoint.test.ts: add a fixture item carrying `mbid` and assert items[0] now includes `mbid: '<value>'`; add a case where upstream mbid is '' → reshaped `mbid: null`. Update the existing exact `toEqual({ artist, title, image })` assertions to include `mbid` so they still pass (they will now have the extra field).
    - No-leak test still passes (mbid is not the key; nothing secret added).
    - Tiles render a real CAA/Last.fm cover when available; on 404/no-mbid the gradient block shows (never a broken-image icon).
    - safeImageUrl/pickImage unchanged; coverartarchive.org NOT added to the last.fm/fastly allowlist (CAA URLs are client-built only).
  </acceptance_criteria>
  <done>pnpm exec vitest green for cover-art.test.ts + the discovery endpoint test; mbid surfaced end-to-end; tiles show real covers with graceful gradient fallback; no allowlist widening.</done>
</task>

</tasks>

<deferred>
- MusicBrainz no-mbid fallback edge endpoint (`/api/cover?artist=&title=` → MB release search → release-group MBID → CAA): DEFERRED. MusicBrainz has a HARD 1 req/sec/IP limit (IP-block on breach) requiring a descriptive User-Agent + Cache API ~30d TTL + strict no-fan-out (lazy per-visible-tile, concurrency ≤1-2). The cheap mbid→CAA path (this plan) covers items that carry an mbid; items without an mbid keep the existing color gradient block (always graceful). Pull this in as its own scoped quick task only if the gradient-block rate proves too high in practice. If implemented later: descriptive UA `openmusic/1.0 ( https://openmusic.pages.dev )`, Cache API long TTL, NO Promise.all fan-out, mirror the /api/lastfm/discovery edge posture (absent-graceful, scoped CORS, never log), and IF any cover URL is returned through an edge endpoint, allow coverartarchive.org + archive.org hosts in that endpoint's safeImageUrl.
</deferred>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/lastfm/discovery | Untrusted query params already encodeURIComponent-passthrough; key injected edge-side, never returned |
| client → coverartarchive.org | Client-built CAA URL loaded as an <img>; CAA is a public read-only image host |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nza-01 | Information disclosure | mbid surfaced through /api/lastfm/discovery | accept | mbid is a public MusicBrainz identifier, not secret; no key/PII added; existing no-leak test still asserts the key is absent from the body |
| T-nza-02 | Tampering | CAA URL interpolation | mitigate | mbid is encodeURIComponent'd in caaReleaseGroupCover and the URL is set as an <img src> attribute (not CSS `url()`), so no CSS-injection surface; the last.fm/fastly safeImageUrl allowlist is deliberately NOT widened (CAA URLs never pass through the edge endpoint) |
| T-nza-03 | Denial of service | per-tile CAA <img> requests | accept | CAA has no rate limit and requires no User-Agent; covers lazy-load per visible tile (`loading="lazy"`), no fan-out; the MusicBrainz-search fallback (which DOES have a 1 req/s limit) is DEFERRED out of this plan |
| T-nza-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies introduced; nothing to install |
</threat_model>

<verification>
- pnpm check is clean (TS strict + Svelte 5 runes, no errors/warnings introduced).
- pnpm test is green: existing suite + new player.svelte.test.ts + cover-art.test.ts + the extended discovery-endpoint test.
- Manual smoke (Claude self-check via reasoning, no human checkpoint): tapping a discovery tile renders the optimistic loading now-bar before audio; same-song double tap does not double-resolve; different-song tap supersedes; miss toasts; tiles show real covers or the gradient (never a broken image).
- src/routes/+layout.svelte (root) is NOT in the diff.
</verification>

<success_criteria>
- FIX A: optimistic now-bar with loading on tap, same-song dedupe, different-song supersede (generation guard), success→play / miss→toast — all driven by player.pendingTrack + player.playStub.
- FIX B: discovery tiles show real Cover Art Archive covers via client-built mbid→CAA URLs, with graceful gradient fallback on 404/no-mbid; mbid surfaced through the discovery endpoint reshape; no allowlist widening; MB-search fallback deferred.
- pnpm check + pnpm test green; new unit tests for the pending-guard/dedupe, the CAA URL builder, and mbid surfacing.
- Committed on main (branching=none).
</success_criteria>

<output>
Create `.planning/quick/260606-nza-home-discovery-optimistic-tap-to-play-wi/260606-nza-SUMMARY.md` when done.
</output>
