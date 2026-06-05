# Feature Research

**Domain:** Last.fm integration for an existing multi-source music-player PWA (MusicSquare Mobile v1.1)
**Researched:** 2026-06-06
**Confidence:** HIGH (Last.fm API 2.0 official docs + verified scrobbling rules; discovery-UX patterns MEDIUM from Spotify/YT Music writeups)

> Scope note: v1.0 already ships `/api/similar` (`artist.getSimilar`), the player/library/catalog/picks stores, the source registry, and a similar-seeded Up-Next queue. This file covers ONLY the four NEW Last.fm feature areas: (1) metadata enrichment, (2) optional auth + two-way sync, (3) discovery/hot-picks tabs, (4) a Last.fm-searchable playback source. Each feature notes the exact Last.fm method(s), auth/signed flags, and which existing module it plugs into. (Prior v1.0 mobile-UX feature research is preserved in git history.)

---

## Last.fm API 2.0 method reference (the contract for these features)

Base endpoint: `https://ws.audioscrobbler.com/2.0/` — always pass `&format=json`. All key/secret usage stays **server-side** (Worker), mirroring `JOOX_TOKEN` (PROJECT decision T-01-04). The client only ever sees clean shapes like `{ artists: string[] }` (the `similar.ts` posture — threat T-5ug-01).

**Legend:** Auth = needs a user session key (`sk`). Signed = needs `api_sig` (md5 of ASCII-sorted `name+value` pairs concatenated, then the shared secret appended, then md5). Method = HTTP verb.

### Read / metadata (unauthenticated GET, NOT signed)

| Method | Key params | Returns (essentials) |
|--------|-----------|----------------------|
| `track.getInfo` | `artist`+`track` (or `mbid`); optional `username`, `autocorrect=1` | `duration` (ms), `listeners`, `playcount`, `userplaycount`, `userloved` (0/1, only if `username`), `toptags[]`, embedded `album` w/ image array, `wiki.summary` |
| `artist.getInfo` | `artist` (or `mbid`); optional `username`, `autocorrect=1`, `lang` | `stats.listeners`/`playcount`, `similar[]`, `tags[]`, `bio.summary`+`bio.content`, image array (**often placeholder — see Image Handling**) |
| `album.getInfo` | `artist`+`album` (or `mbid`); optional `username`, `autocorrect=1`, `lang` | `tracks[]`, `tags[]`, `wiki`, image array (most-reliable real cover art; `small/medium/large` documented, `extralarge`/`mega` commonly present) |
| `track.getTopTags` | `artist`+`track` (or `mbid`), `autocorrect=1` | tag list with `count` (0–100 weight) |
| `track.getTags` | `artist`+`track`, `user` | the named user's own tags for that track |
| `artist.getTopTags` | `artist` (or `mbid`) | tag list with weights — the "genre/mood" chips for an artist |
| `artist.getTopTracks` | `artist` (or `mbid`), `limit`, `page` | the artist's most-played tracks (used by the new source + discovery) |

### Charts / geo / tag discovery (unauthenticated GET, NOT signed)

| Method | Key params | Returns |
|--------|-----------|---------|
| `chart.getTopTracks` | `page`, `limit` | global most-popular tracks (name, artist, playcount, listeners) |
| `chart.getTopArtists` | `page`, `limit` | global most-popular artists |
| `chart.getTopTags` | `page`, `limit` | currently-hot tags (drives the "moods/vibes" tab) |
| `geo.getTopTracks` | `country` (ISO 3166-1 **name**, e.g. `United States`), `limit`, `page` | per-country chart |
| `geo.getTopArtists` | `country`, `limit`, `page` | per-country top artists |
| `tag.getTopTracks` | `tag`, `limit`, `page` | top tracks for a mood/genre tag |
| `tag.getTopArtists` | `tag`, `limit`, `page` | top artists for a tag |
| `tag.getTopAlbums` | `tag`, `limit`, `page` | top albums for a tag |
| `tag.getInfo` | `tag`, optional `lang` | `reach`, `taggings`, `wiki` — header copy for a tag landing page |
| `track.search` | `track`, optional `artist`, `limit`, `page` | fuzzy track results (name, artist, listeners) — feeds the new source |

### Per-user reads (GET, NOT signed — public data; pass `user`)

| Method | Key params | Returns |
|--------|-----------|---------|
| `user.getRecentTracks` | `user`, `limit` (≤200), `page`, `from`/`to`, `extended=1` | listening history; **the now-playing item has `@attr nowplaying="true"` and NO `date`**; `extended=1` adds per-track `loved` + full artist objects |
| `user.getLovedTracks` | `user`, `limit`, `page` | the user's loved tracks (artist+track+date) |
| `user.getTopArtists` | `user`, `period` (`overall`/`7day`/`1month`/`3month`/`6month`/`12month`), `limit`, `page` | the user's top artists |
| `user.getTopTracks` | `user`, `period`, `limit`, `page` | the user's top tracks |
| `user.getTopAlbums` | `user`, `period`, `limit`, `page` | the user's top albums |
| `library.getArtists` | `user`, `limit`, `page` | all artists in the user's library (heavier; optional) |

### Auth + writes (require `sk`, **signed**)

| Method | Verb | Signed | Params | Notes |
|--------|------|--------|--------|-------|
| `auth.getToken` | GET | **yes** | `api_key`, `api_sig` | returns a request token valid **60 min**, single-use |
| (browser step) | — | — | `https://www.last.fm/api/auth/?api_key=…&token=…` | user logs in + grants; then returns to app |
| `auth.getSession` | GET | **yes** | `token`, `api_key`, `api_sig` | exchanges token → `sk` + `name` (username) + `subscriber`. **Session key never expires.** Token consumed on use |
| `track.updateNowPlaying` | **POST** | **yes** | `artist`, `track`, optional `album`/`duration`/`mbid` + `sk` | sets the "now scrobbling" badge on the profile; **does not** affect charts/playcount |
| `track.scrobble` | **POST** | **yes** | `artist[i]`, `track[i]`, `timestamp[i]` (UTC unix, **when the track STARTED**), optional `album[i]`/`duration[i]`/`mbid[i]`/`chosenByUser[i]` + `sk` | records a completed play. Batch indices `0..49` → **max 50 per request** |
| `track.love` / `track.unlove` | **POST** | **yes** | `artist`, `track` + `sk` | marks/unmarks a loved track |

---

## Scrobbling rules (state these precisely — they are testable requirements)

A play counts as a scrobble (call `track.scrobble`) **only when ALL hold** (Last.fm official rules):

1. **Track length > 30 seconds.** Shorter tracks never scrobble.
2. **Played for ≥ 50% of its duration, OR ≥ 4 minutes (240 s), whichever comes first.** Hit either threshold → eligible.
3. **`timestamp` = UTC unix time the track STARTED playing** (not when the threshold was reached, not "now"). Timestamps too far in past/future are filtered (ignore codes 3/4).

`track.updateNowPlaying` is a separate, fire-and-forget call made **at play start** (no timestamp, doesn't affect charts) purely to show the profile "now playing" badge. The two are independent: NowPlaying on play; Scrobble once the threshold is crossed.

**Batch limit: 50 scrobbles per `track.scrobble` request.** Queue offline/failed scrobbles client-side and flush in batches of ≤50 (the standard offline-scrobble pattern). Response returns `accepted` / `ignored` counts with per-item `ignoredMessage` codes — surface failures, don't silently drop.

Mapping to the existing player store: hook `player.svelte.ts` — fire `updateNowPlaying` inside `play()` after `audioUrl` resolves; track elapsed via the existing `currentTime`/`duration` runes and fire `scrobble` once the 50%/4-min rule trips (one-shot per play, guard against re-fire on seek/pause). Duration is already available; capture the timestamp at play start.

---

## Loved-tracks ↔ local-favorites reconciliation

The app's local "liked" list lives in `library.svelte.ts` (`library.liked: Track[]`, `toggleLike`, `isLiked`, persisted to `openmusic:library:v1`). Last.fm "loved" is the cloud equivalent. Expected behavior:

- **Signed-out (default):** loved == local `liked`, unchanged. No Last.fm calls. Local-first must keep working (PROJECT boundary).
- **Toggle while signed-in:** `toggleLike(t)` ALSO calls `track.love`/`track.unlove` (POST, signed) using `t.artist` + `t.title`. Best-effort, non-blocking — local state stays the UI source of truth; a failed write is queued/retried, never blocks the heart animation.
- **Sign-in reconciliation (MERGE, never destructive):** on first sign-in, fetch `user.getLovedTracks` (paged) and **union** with local `liked`. Matching is fuzzy — Last.fm gives only `{artist, track}` strings while local tracks carry a source-prefixed `uid` (`netease:123`):
  - Last.fm-loved that maps to an existing local track (normalized artist+title match) → mark liked locally, no duplicate.
  - Last.fm-loved with no local match → store as a lightweight liked entry (artist+title; `audioUrl`/`uid` resolved lazily on first play via the new source, like search stubs already do).
  - Local-liked not on Last.fm → push up via `track.love` so the cloud catches up.
- **Conflict stance:** union (additive) is the safe default — never auto-unlove on the server because a track is locally absent (the user may have loved it from another Last.fm client). Only `track.unlove` on an explicit user un-heart.

Complexity: MEDIUM. The hard part is normalized artist+title matching (`autocorrect=1` helps) while keeping `library.svelte.ts` the local source of truth with an optional sync side-effect layered on.

---

## Image / cover-art handling (the placeholder-star trap)

Last.fm returns an `image` array of `{ "#text": url, size }` for `small/medium/large/extralarge/mega`. The well-known failure: **`artist.getInfo` and `track.getInfo` image arrays very frequently return only the grey star placeholder** (hash `2a96cbd8b46e442fc41c2b86b821562f`, e.g. `…/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png`) because Last.fm stripped most artist imagery years ago. Rules:

- **Detect and discard** any image URL containing the placeholder hash — treat it as "no art."
- **Prefer `album.getInfo` art** (and the `album.image` embedded in `track.getInfo`) — album covers are the most reliably populated.
- **Fall back to the existing per-source cover** (Netease/QQ/etc. already provide `cover` on the `Track`). Last.fm art is an *enhancement*, never a replacement — placeholder → keep the source cover.
- Pick the **largest non-placeholder size** for the now-playing view (`extralarge`/`mega`), smaller sizes for list rows.

Complexity: LOW, but the placeholder filter is mandatory or the UI fills with grey stars.

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / module |
|---------|--------------|------------|-------|
| **Metadata enrichment on now-playing** (tags/genres, bio snippet, listener/playcount, higher-res cover) | Spotify/YT Music show rich track context; a bare title feels unfinished | LOW–MEDIUM | `track.getInfo`+`artist.getInfo`+`album.getInfo` behind a Worker route; lazy on play. New `lastfm.ts` service enriching the `Track` consumed by `player.svelte.ts`. Apply placeholder filter |
| **Higher-res / fallback cover art** | Crisp art on the full-screen player is baseline polish | LOW | `album.getInfo` image, placeholder-filtered, fallback to source `cover` |
| **Charts tab (global + by country)** | "What's hot" is a standard discovery surface | LOW–MEDIUM | `chart.getTopTracks/Artists` + `geo.getTopTracks/Artists`. New tab; reuses a `picks.ts`-style builder + the source registry to resolve playable audio |
| **Optional Last.fm sign-in** | The whole point of v1.1's cloud-sync; users expect "connect account" | MEDIUM | `auth.getToken`→browser grant→`auth.getSession`, all signed server-side. New `auth.svelte.ts` store holding `{ sessionKey, username }`, persisted, restorable on return. Signed-out path untouched |
| **Scrobbling** | Last.fm users connect *specifically* to scrobble; not scrobbling defeats sign-in | MEDIUM | `updateNowPlaying`+`scrobble` (POST, signed). Hooks `player.svelte.ts` play/timeupdate. Must implement the 50%/4-min rule + start-timestamp + ≤50 batch exactly |
| **Loved-tracks two-way sync** | A signed-in user expects their hearts to match Last.fm | MEDIUM | `track.love/unlove` + `user.getLovedTracks` merge into `library.svelte.ts`. See reconciliation section |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes / module |
|---------|-------------------|------------|-------|
| **Vibe/mood + genre tag browsing** | Tag-driven discovery (e.g. "lo-fi", "city pop", "90s") is a genuinely engaging surface few aggregators offer | MEDIUM | `chart.getTopTags`→tag grid; `tag.getTopTracks/Artists/Albums` for a tag page; `tag.getInfo` for header. Resolve to playable audio via registry |
| **Last.fm-searchable source** (YouTube-style: discover on Last.fm → resolve audio via existing CN proxies) | Bridges Last.fm's huge Western catalog to actual playback — the unlock that makes charts/tags playable | MEDIUM–HIGH | New adapter in `src/lib/sources/registry`. `track.search`/`artist.getTopTracks` returns name+artist stubs; `resolve()` runs `searchAll(name+artist)` and picks the best `dedupeBest` match. Follows the existing stub→resolve pattern; NOT a stream provider itself |
| **Listening history surface** (recent tracks, top artists/tracks/albums over periods) | "Your month/year in music" style recaps drive engagement and re-opens | LOW–MEDIUM | `user.getRecentTracks` (handle the `nowplaying` item w/ no date), `user.getTopArtists/Tracks/Albums` with `period`. Read-only; profile/stats tab |
| **Similar-seed queue upgraded with metadata** | Existing Up-Next already uses `artist.getSimilar`; enriching its entries with tags/art tightens the "vibe" feel | LOW | Layers `track.getInfo` tags onto `buildSimilarQueue` output in `similar.ts` (already the Last.fm consumer) |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Treat Last.fm as a stream/audio source** | "It's a music service" | Last.fm is metadata/social ONLY — it serves no audio (and 30s previews are gone). Designing playback around it dead-ends | Discover on Last.fm, resolve audio via the CN-source registry (the new-source differentiator) |
| **Storing `LASTFM_KEY`/`LASTFM_SECRET` or `sk` client-side** | Simpler signing in the browser | Shared secret = account-takeover; `sk` never expires so leakage is permanent (T-01-04) | Sign all `auth`/`scrobble`/`love` calls in the Worker; client passes only the action |
| **Auto-unlove on the server to mirror local removals** | "Keep them perfectly in sync" | Destroys loves the user made in other Last.fm clients | Additive union on sign-in; `track.unlove` only on explicit user un-heart |
| **Scrobble every track immediately / on every seek** | "Count all my plays" | Violates the 50%/4-min rule → ignored or flagged as spam; double-counts on seek | One-shot scrobble per play once the threshold trips; guard re-fire |
| **Requiring sign-in to use the app** | "Accounts unlock features" | Breaks the local-first PROJECT boundary; most users won't have Last.fm | Sign-in strictly optional/additive; every feature degrades gracefully signed-out (the `similar.ts` no-key fallback precedent) |
| **`user.getRecentTracks` polling for "live now playing"** | Real-time presence | Wastes Worker calls; the app already knows what it's playing locally | Use local player state for the app's own now-playing; recent-tracks only for the history tab |
| **Per-track user `track.getTags` + custom tagging UI** | "Let me tag songs" | Niche power-user feature; write-tag UX is heavy for marginal value | Show read-only `toptags`; defer personal tagging |

## Feature Dependencies

```
Last.fm sign-in (auth.getToken → auth.getSession, signed)
    ├──enables──> Scrobbling (updateNowPlaying / scrobble)
    ├──enables──> Loved-tracks WRITE (track.love / unlove)
    ├──enables──> Loved-tracks merge-on-sign-in (user.getLovedTracks)
    └──enables──> Listening history + top stats (user.get*)

Worker proxy for Last.fm (server-side key/secret + api_sig signing)
    └──required by──> EVERY Last.fm feature (read and write)

Last.fm-searchable source (registry adapter: track.search/artist.getTopTracks → searchAll resolve)
    ├──required by──> Charts tab being PLAYABLE
    └──required by──> Tags/moods tab being PLAYABLE

Metadata enrichment (track/artist/album.getInfo)
    ──enhances──> now-playing view, similar queue, discovery cards

Image placeholder filter ──required by──> all art-displaying features
```

### Dependency Notes

- **Everything requires the Worker proxy first.** The `api_sig` signing and secret live server-side; no Last.fm call (even unauthenticated reads, to hide the key) should originate in the browser. Build/extend the Worker route layer before any feature.
- **Discovery tabs need the new source to be useful.** A charts/tags list that can't play is a dead end. The Last.fm-searchable adapter (resolve name+artist via `searchAll`) is the bridge — sequence it alongside or before the discovery tabs.
- **Sign-in gates all write + personal-read features.** Scrobbling, love-write, and `user.*` stats are meaningless without `sk`. Auth is the prerequisite phase for sync.
- **Scrobbling enhances loved-sync timing but is independent** — they share the player hook and the auth store but can ship separately.

## MVP Definition

### Launch With (v1.1 core)

- [ ] **Worker-side Last.fm proxy + signing** — the security + plumbing foundation; nothing works without it
- [ ] **Metadata enrichment** (`track/artist/album.getInfo` + placeholder-filtered art) — visible value with zero auth, lowest risk
- [ ] **Charts + tags discovery tabs** (`chart.*`, `geo.*`, `tag.*`) — the discovery payoff, no auth needed
- [ ] **Last.fm-searchable source** — makes discovery playable; reuses the registry + `searchAll`
- [ ] **Optional sign-in** (`auth.getToken`/`getSession`) + auth store — gateway to sync
- [ ] **Scrobbling** (`updateNowPlaying`/`scrobble` with exact 50%/4-min + ≤50-batch rules) — the headline reason Last.fm users connect
- [ ] **Loved-tracks two-way sync** (`track.love/unlove` + `user.getLovedTracks` merge) — likes feel connected

### Add After Validation (v1.x)

- [ ] **Listening-history tab** (`user.getRecentTracks`, handle `nowplaying`) — trigger: sign-in adoption proves users care about their profile
- [ ] **Top artists/tracks/albums over periods** (`user.getTop*`) — trigger: history-tab engagement
- [ ] **Offline scrobble queue with batched flush** — trigger: real-world scrobble-loss reports
- [ ] **Enriching the similar-queue entries with tags/art** — trigger: discovery feels "samey"

### Future Consideration (v2+)

- [ ] **`library.getArtists` full-library import** — heavy, niche
- [ ] **Personal track tagging UI** (`track.getTags` + write) — power-user, defer until tag browsing proves popular

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Worker Last.fm proxy + signing | HIGH (enabler) | MEDIUM | P1 |
| Metadata enrichment + art filter | HIGH | LOW | P1 |
| Charts + tags discovery tabs | HIGH | MEDIUM | P1 |
| Last.fm-searchable source | HIGH | MEDIUM-HIGH | P1 |
| Optional sign-in (auth flow) | MEDIUM (enabler) | MEDIUM | P1 |
| Scrobbling | HIGH (signed-in) | MEDIUM | P1 |
| Loved-tracks two-way sync | HIGH (signed-in) | MEDIUM | P1 |
| Listening history (recent tracks) | MEDIUM | LOW-MEDIUM | P2 |
| Top artists/tracks/albums (periods) | MEDIUM | LOW-MEDIUM | P2 |
| Offline scrobble queue | MEDIUM | MEDIUM | P2 |
| Personal tagging UI | LOW | MEDIUM | P3 |
| `library.getArtists` import | LOW | MEDIUM | P3 |

**Priority key:** P1 = must have for v1.1 launch; P2 = should have, add when possible; P3 = future.

## Competitor Feature Analysis (discovery-surface UX patterns)

| Surface | Spotify | YouTube Music | Last.fm (web) | Our approach |
|---------|---------|---------------|---------------|--------------|
| **Home** | "Made for you" + recently played + new releases | Usage-based: top artists, mixes, radio, new releases | Recent scrobbles + recommended | Keep existing home grid (top picks/Randomize from `picks.ts`); add a "From your Last.fm" rail only when signed in |
| **Charts** | Browse → Charts: Top 50 + Viral 50, per-country | Explore → Charts/Trending | Global + country charts | A **Charts tab** (global toggle + country picker) → `chart.*`/`geo.*`; cards play via the new source |
| **Genres & Moods** | Browse → Genres & Moods: category tiles → playlists | Explore → mood/genre filters | Tag pages with reach/wiki | A **Tags/Moods tab**: hot-tag grid (`chart.getTopTags`) → tag page (`tag.getInfo` header + `tag.getTopTracks/Artists/Albums`) |
| **Your stats** | Wrapped / top artists (year-end) | History + top charts | Library + top artists/tracks (`overall`/`7day`…`12month`) | A signed-in **Profile/Stats tab**: `user.getTop*` with a period switcher + `user.getRecentTracks` history |
| **Tab vs combined** | Separate Browse hub with sub-tabs | Home (personal) vs Explore (editorial) split | Flat pages | Mirror the **Home (personal) / Explore (charts+tags) split**; bottom-nav fits this cleanly. Explore is anonymous-friendly; personal rails appear in Home only when signed in |

**UX takeaways for requirements:**
- Two discovery clusters: **Explore** (anonymous — charts, country, tags/moods) and **Home/Profile personal rails** (signed-in — your top + recent). This matches the optional-auth boundary exactly: Explore needs no sign-in; personal surfaces light up after.
- Every discovery card must be **playable in one tap** → mandates the Last.fm-searchable source resolving name+artist → CN audio.
- Tag pages benefit from a short `tag.getInfo` wiki blurb as header copy (cheap polish).

## Sources

- [Last.fm API: Scrobbling rules](https://www.last.fm/api/scrobbling) — 30s min, 50%/4-min threshold, 50-per-batch, start timestamp (HIGH)
- [Last.fm API: track.scrobble](https://www.last.fm/api/show/track.scrobble) — POST, signed, `sk`, array `[0..49]`, accepted/ignored response (HIGH)
- [Last.fm API: Desktop/web auth](https://www.last.fm/api/desktopauth) — getToken (60-min, signed), browser grant, getSession (returns sk+name, never expires) (HIGH)
- [Last.fm API: track.getInfo](https://www.last.fm/api/show/track.getInfo) — unauthenticated GET, `username` adds userloved/userplaycount, toptags, embedded album image (HIGH)
- [Last.fm API: album.getInfo](https://www.last.fm/api/show/album.getInfo) — unauthenticated GET, most-reliable cover art source (HIGH)
- [Last.fm API: track.love](https://www.last.fm/api/show/track.love) — POST, signed, `sk` (HIGH)
- [Last.fm API: user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks) — GET, `nowplaying="true"` item has no date, `extended=1` adds loved flag, limit ≤200 (HIGH)
- [Last.fm API: chart.getTopArtists](https://www.last.fm/api/show/chart.getTopArtists) — unauthenticated GET, page/limit (HIGH)
- [Last.fm Support: artist.getInfo placeholder images](https://support.last.fm/t/last-fm-api-artist-getinfo-only-returns-placeholder-images-for-artists/117821) — confirms the grey-star placeholder issue (HIGH)
- [pylast issue #317: cover image returns default star](https://github.com/pylast/pylast/issues/317) — placeholder hash corroboration (MEDIUM)
- [Digital Trends: YouTube Music vs Spotify](https://www.digitaltrends.com/phones/spotify-vs-youtube-music/) — Home-personal vs Explore-editorial split (MEDIUM)
- [Chosic: Spotify Browse structure (Charts / Genres & Moods / New Releases)](https://www.chosic.com/spotify-listening-stats/) — discovery sub-tab taxonomy (MEDIUM)
- Existing code reviewed: `src/lib/services/similar.ts` (no-key fallback + server-proxy posture), `src/lib/stores/library.svelte.ts` (liked model), `src/lib/stores/player.svelte.ts` (play/currentTime/duration scrobble hook points), `src/lib/services/catalog.ts` + `picks.ts` (registry `searchAll` + builder pattern to extend)

---
*Feature research for: Last.fm integration (MusicSquare Mobile v1.1)*
*Researched: 2026-06-06*
