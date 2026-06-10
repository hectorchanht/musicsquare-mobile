# Phase 17: Up-Next Sourcing + Settings Plumbing - Research

**Researched:** 2026-06-10
**Domain:** Svelte 5 runes playback-store extension (per-context up-next sourcing), config/settings plumbing, horizontal swipe-to-remove gesture, Deezer artist/album edge-proxy enrichment — on an existing SvelteKit 2 / Cloudflare music PWA
**Confidence:** HIGH (all internal seams read directly against live code; Deezer API field names + rate limit live-verified; zero new dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Up-next sourcing & contexts**
- **D-01:** Full context set gets per-context sourcing overrides: liked / search / downloads / playlist / album / artist / home-discovery / history. Each is a `'same-list' | 'generated'` entry in `src/lib/config/defaults.ts` (k3y pattern), ALL defaulting to `'generated'` (roadmap-locked global default).
- **D-02:** Override UI lives in Settings → Playback ONLY — one selector row per context, following the existing grouped drill-in settings pattern. No queue-header chip.
- **D-03:** "Same list" = snapshot at tap: tapping a track queues the visible list as it was at that moment (today's `setQueue(results)` behavior); later list/search changes never mutate the queue. The Phase 16 auto-generate-on-exhaust engine still refills when the snapshot runs out.
- **D-04:** With `'generated'` (the default) the queue on a fresh play = tapped track + genre-similar generation (existing `regenerate`/`buildSimilarQueue` path); search results are NOT appended.
- **D-05:** Auto-expand fix: keep the `autoExpandOnPlay` setting (default off) but fire it ONLY on explicit user-initiated plays — never on auto-advance, failover skip, or queue progression. (Today it fires inside `play()` at player.svelte.ts:902, hence the track-change auto-expand bug.)

**Queue management (QUEUE-05)**
- **D-06:** Swipe-to-remove = full-row horizontal swipe, axis-locked: commit horizontal vs vertical after slop (same idiom as the Phase 20 cover-swipe rule — no `setPointerCapture` on `pointerdown`); the existing GripVertical drag stays vertical-reorder only.
- **D-07:** Swipe visual = slide + fade following the finger; past distance threshold OR a fast flick (existing `createVelocityTracker`) the row animates out and removes; below threshold it springs back. Reuse the dragClose/velocity idiom.
- **D-08:** Clear-all = visible "Clear" button in the Up-Next header. It wipes EVERYTHING including manual pins (`manualUids` resets) — only the currently-playing track survives (never-stop posture preserved).
- **D-09:** After clear, the queue stays empty until the current track nears its end — the existing ensureAhead/exhaust engine then generates more. No immediate refill; the user gets a window to build their own queue.
- **D-10:** Swipe-removed tracks are session-excluded from auto-generation: an in-memory removed-uid set that `buildSimilarQueue`/`ensureAhead` exclude, reset on session end or a fresh play.

**Settings: text-size + accent (UX-03, UX-07)**
- **D-11:** Widen `FONT_SCALE_MIN/MAX` to 50/200 for ALL five sliders (title, artist, lyrics, NP-title, NP-artist). Persisted values stay valid — the clamp only widens.
- **D-12:** Demo text under each slider reads "example {name}" sourced from the current/last-played track — title sliders preview the real song name, artist sliders the real artist name; static example fallback when nothing has played yet.
- **D-13:** Accent (UX-07) = full audit + fix: sweep for hardcoded `#7c5cff`, un-updated `--color-primary-hover`, and surfaces ignoring the variable; the picker must visibly recolor progress bars, active tabs, chips, buttons app-wide. Derive the hover shade from the chosen accent automatically (no second picker).

**Deezer enrichment (ENRICH-04)**
- **D-14:** Artist page: port everything useful Deezer provides (fan count, hi-res picture, related artists, albums/discography) — Claude decides exact fields + layout. Album page same posture (release date, fans, label, genres, hi-res cover, track count/duration). Everything degrades gracefully (section silently absent) when Deezer misses.
- **D-15:** Field precedence when Last.fm and Deezer overlap: best-quality wins, field-by-field — highest-resolution image wins regardless of source; counts shown side-by-side labeled by source only if both exist and differ meaningfully. Enrichment stays additive, never replaces good per-source data (Phase 8 rule).
- **D-16:** Add TWO new edge proxy routes, `/api/deezer/artist` + `/api/deezer/album`, following the existing own-origin Deezer proxy pattern (no key, never api.deezer.com from the client) with Cache API TTLs (long — artist/album data is stable).
- **D-17:** New Deezer sections get shape-matched skeletons while resolving (pre-aligns with Phase 23 UX-01 + the project's skeleton rules); skeleton disappears cleanly (no residue) on a Deezer miss.
- **D-18:** Deezer top-tracks do NOT become a second list — the playable artist top-tracks list stays the CN-source one; Deezer's ranking is used only as an ordering hint where titles match. No dead non-playable rows.

### Claude's Discretion
- Exact shape of the per-context setting object in defaults.ts and how the player learns its current context (the new context-tracking field design)
- Which Deezer fields earn a UI row and the exact artist/album layout (D-14 explicitly delegates "what and how")
- Hover-shade derivation math for the accent; swipe thresholds/constants (reuse existing velocity/slop values)
- Settings → Playback page ordering/grouping of the new per-context rows
- TTL values for the new Deezer routes (mirror existing discovery TTL posture)

### Deferred Ideas (OUT OF SCOPE)
- Queue-header quick toggle chip for sourcing (settings-only won this phase; revisit if discoverability suffers)
- Undo toast on clear/remove — skipped for i18n cost; revisit in Phase 23 UX audit if wanted
- Persistent (cross-session) removed-uid exclusion list — session-only for now
- Sleep timer (Phase 18), Remix track-menu action (Phase 19), nowbar horizontal swipe (Phase 20), row swipe-actions on main list surfaces (Phase 23), Last.fm auth (v1.3)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-01 | Playing a song from search builds up-next from genre-similar generation by default (search results NOT appended); nowbar does not auto-expand on track change | `regenerate`/`buildSimilarQueue` already exists; QUEUE-01 = make `generated` the global default + add a context arg to `setQueue` + remove the literal `setQueue(results)` append on search. Auto-expand fix = guard the `play()` line-902 `autoExpandOnPlay` fire behind a `fresh`-only flag (D-05). |
| QUEUE-02 | When up-next is exhausted, more tracks auto-generate from last played | Already shipped: `ensureAhead()` (player.svelte.ts:730) + `next()` end-of-queue branch (:1060). Phase 17 only verifies + threads the per-context `same-list` vs `generated` branch into the exhaust path. |
| QUEUE-03 | Per-context sourcing config: "same list" vs "genre-generated"; global default = generated; defaults in config file | New `UPNEXT_DEFAULTS` group in `config/defaults.ts` + Settings fields + new `queueContext` field on Player set by every play-entry call site. |
| QUEUE-05 | Swipe-to-remove a track from up-next + clear the whole queue | New `removeFromQueue(uid)` + `clearQueue()` methods on Player; new horizontal axis-locked swipe action in `NowPlaying.svelte` Up-Next list (:737); "Clear" button in the Up-Next subnav header (:728). |
| UX-03 | Text-size 50–200% with demo text "example {artist or song name}" | Widen `FONT_SCALE_MIN/MAX` 70/160 → 50/200 (settings.svelte.ts:52-53); replace static `.prev` demo strings (appearance/+page.svelte) with current-track-sourced text. |
| UX-07 | Accent color visibly applies (verify wiring; fix if dead) | ROOT CAUSE FOUND: `applyTheme()` sets `--color-primary` but NEVER `--color-primary-hover` (settings.svelte.ts:315) — the hover var is pinned at `#6a48f0` in app.css:10. Derive hover from accent + set it in `applyTheme()`. |
| ENRICH-04 | Artist/album pages enriched with Deezer info, degrading gracefully | Two new edge routes `/api/deezer/artist` + `/api/deezer/album` (mirror `related/+server.ts`); new `deezerArtist()`/`deezerAlbum()` client fns in `deezer.ts`; new sections on artist/album `+page.svelte` beside existing Last.fm enrich, with D-15 field-precedence merge. |
</phase_requirements>

## Summary

Phase 17 is almost entirely **wiring and policy on top of an already-mature engine**, plus one genuinely new UI gesture (horizontal swipe-remove) and two new edge proxy routes. The single biggest correction to the roadmap text is confirmed: **`queueContext` does NOT exist in `player.svelte.ts`** — Phase 16 shipped the never-stop engine, repeat 2-state, loop-guard, prefetch, and offline switch but never added playback-origin tracking. This phase introduces it. The second-biggest finding is the **root cause of the dead-accent bug (UX-07)**: `settings.applyTheme()` updates `--color-primary` from the chosen accent but never touches `--color-primary-hover`, which stays hard-pinned at `#6a48f0` in `app.css`. Components using the hover variable (currently only the `(app)/+layout.svelte` PWA-prompt button, but the variable is the documented hover token) therefore never recolor. The fix is a tiny hex-darken derivation set into `applyTheme()` — no new dependency.

Per-context sourcing (D-01..D-05) hooks cleanly into the existing `play({fresh})` → `regenerate` flow. The existing engine already has `regenerate(seed)` (generated path, preserves `manualUids`), `ensureAhead()` (exhaust grower), and `buildSimilarQueue`/`buildDiversePicks`. Phase 17 adds: (1) a `queueContext` `$state` field set by all 11 play-entry call sites; (2) a `UPNEXT_DEFAULTS` group resolving an effective mode per context; (3) a branch so `same-list` snapshots and appends the origin list remainder while `generated` runs today's similar-queue path. The auto-expand fix (D-05) is a one-line guard at `player.svelte.ts:902`. Swipe-remove (D-06/07) reuses the `createVelocityTracker` + slop-after-capture idiom from `dragClose.ts`, but adapted to the **horizontal** axis (current `dragClose` is vertical-only — `clientY`/`translateY`). Session-exclusion of removed uids (D-10) is a plain `Set<string>` on the player threaded into the `exclude` arg that `buildSimilarQueue`/`buildDiversePicks` already accept.

Deezer artist/album enrichment (ENRICH-04) is a direct clone of the existing `/api/deezer/related/+server.ts` two-call pattern (search-by-name → fetch-by-id), with field names **live-verified** against `api.deezer.com`: artist returns `picture_xl`/`nb_fan`/`nb_album`; album returns `cover_xl`/`release_date`/`nb_tracks`/`fans`/`label`/`genres.data[]`/`duration`. No auth, public GET, 50 req/5s rate limit (respected by the edge Cache-API TTLs the routes will set). **Zero new npm dependencies** for the entire phase.

**Primary recommendation:** Treat this as 5 thin work-streams that all touch a small, well-understood surface: (1) `queueContext` + per-context resolution on the player + `UPNEXT_DEFAULTS`; (2) auto-expand guard; (3) swipe-remove + clear-all in NowPlaying + two new player methods; (4) text-size widen + dynamic demo text + accent-hover derivation; (5) two Deezer edge routes + client fns + artist/album page sections. Order (1)→(2)→(3)→(4)→(5); (5) is fully independent and can run in parallel.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-context sourcing decision (same-list vs generated) | Store (player + settings) | — | The player owns queue mutation + `playGen` discipline; the decision must be co-located with the regenerate/ensureAhead engine. Settings store holds the persisted per-context map. |
| `queueContext` origin tracking | Store (player `$state`) | Route pages (set it via `setQueue`) | Player holds the current context; each list page declares its context at the play-entry call site. |
| Per-context defaults | Config (`config/defaults.ts`) | Settings store (reads on init + reset) | k3y single-source-of-truth pattern — the established home for all defaults. |
| Swipe-remove gesture | Client (Svelte action in NowPlaying) | Player (`removeFromQueue`) | DOM pointer arbitration is a client/browser concern; the mutation goes through one player method that honors `manualUids`. |
| Clear-all | Client (button in NowPlaying) | Player (`clearQueue`) | UI handler flips intent; player resets queue + `manualUids` preserving current track. |
| Removed-uid session exclusion | Store (player plain `Set`) | Services (`similar`/`picks` exclude arg) | In-memory, non-reactive, internal — mirrors `manualUids`; threaded into existing `exclude` params. |
| Text-size bounds + demo text | Settings store (bounds) + Client (appearance page) | Player (read current-track name for demo) | Bounds are a settings constant; demo text reads `player.current` (one-way page→player read, allowed). |
| Accent hover derivation | Settings store (`applyTheme`) | CSS (`--color-primary-hover` consumers) | The CSS-var application path is the single write site for theme tokens. |
| Deezer artist/album fetch | API / Edge (`/api/deezer/*` routes) | Client service (`deezer.ts`) + route pages | Must be own-origin proxy (CORS + no-key posture); the client never calls api.deezer.com directly. |
| Deezer ↔ Last.fm field merge | Client (artist/album `+page.svelte`) | Services (`deezer.ts`, `lastfm.ts`) | Presentation-layer field-by-field best-quality merge (D-15); both services stay additive + never-throw. |

## Standard Stack

### Core (all already present — zero new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.63.0 | App framework, edge routes (`+server.ts`), pages | `[VERIFIED: package.json]` Already the project framework |
| Svelte (runes) | 5.56.2 | `$state` singletons for player/settings | `[VERIFIED: package.json]` `$state` is the right home for `queueContext`, per-context map |
| @sveltejs/adapter-cloudflare | 7.2.8 | Edge runtime for the two new Deezer routes (Cache API) | `[VERIFIED: package.json]` Existing Deezer routes already run on it |
| @lucide/svelte | ^1.17.0 | Icons (Trash2/X for clear/remove, fan/disc icons for Deezer sections) | `[VERIFIED: package.json]` Only runtime dep; covers all new icons |

### Supporting (existing internal modules — reuse as-is or extend)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/gestures/velocity.ts` (`createVelocityTracker`) | Flick detection for swipe-remove | `[VERIFIED: code read]` D-07 flick threshold. NOTE: tracks `clientY` only — swipe-remove needs an X-axis variant or a parallel inline tracker. |
| `src/lib/actions/dragClose.ts` | Capture-after-slop, tap-preserving idiom | `[VERIFIED: code read]` Template for the new horizontal action — but it is VERTICAL only (`clientY`/`translateY`). The new action mirrors its structure on the X axis. |
| `src/lib/services/similar.ts` (`buildSimilarQueue`, `getSimilarArtists`) | Generated up-next; Last.fm→Deezer fallback | `[VERIFIED: code read]` Accepts an `excludeUids: Set<string>` — thread the removed-uid set here (D-10). |
| `src/lib/services/picks.ts` (`buildDiversePicks`) | Exhaust grower | `[VERIFIED: code read]` Called by `ensureAhead`; accepts a `have: Set<string>` exclude — thread removed-uids here too. |
| `src/lib/services/deezer.ts` | Own-origin Deezer client | `[VERIFIED: code read]` Add `deezerArtist()`/`deezerAlbum()` mirroring `deezerRelatedArtists()`. |
| `src/lib/services/lastfm.ts` (`EnrichResult`) | Existing artist/album enrichment | `[VERIFIED: code read]` Deezer sections render BESIDE this; D-15 merge is field-by-field at the page level. |
| `src/lib/config/defaults.ts` | k3y central defaults | `[VERIFIED: code read]` Add `UPNEXT_DEFAULTS`; register in `DEFAULTS`. |
| `src/lib/actions/marquee.ts` | Long-text scroll | `[VERIFIED: code read]` Any new Deezer text rows (label/long names) use `use:marquee` per MEMORY rule. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hex-darken inline math for accent hover | A color library (chroma-js/tinycolor) | REJECTED — violates zero-dep ethos. A 6-line clamp-and-darken of the parsed hex is sufficient and testable (D-13 says "no new deps" intent). |
| New horizontal-swipe action file | Inline pointer handlers in NowPlaying | A reusable `src/lib/actions/swipeRemove.ts` action is cleaner + unit-testable + reused by Phase 23 (UX-04 row swipe). Recommended over inline. |
| Storing `queueContext` on each Track | A single `$state` field on Player | REJECTED — Tracks stay clean (the codebase deliberately keeps origin OFF Track, e.g. `manualUids` is a side Set). One player field is correct. |

**Installation:** None. No `npm install` for this phase.

**Version verification:** N/A — no external packages added. All capabilities use web-platform APIs + existing internal modules. Confirmed against `package.json` (one runtime dep: `@lucide/svelte`).

## Package Legitimacy Audit

> This phase installs **no external packages**. No registry fetch, no slopcheck run required.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | No new packages |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Every capability in this phase is built from web-platform APIs (`pointer events`, `document.documentElement.style.setProperty`, `fetch`, Cache API) and existing in-repo modules. The Package Legitimacy Gate is satisfied trivially: there is nothing to verify.*

## Architecture Patterns

### System Architecture Diagram

```text
PER-CONTEXT SOURCING (QUEUE-01/02/03)
─────────────────────────────────────
 list page tap                       Settings → Playback
 (search/liked/album/...)            per-context selector rows
       │                                     │
       │ setQueue(tracks, context)           │ writes
       ▼                                     ▼
 player.queueContext ◄──────────  settings.upnextPerContext  ◄── UPNEXT_DEFAULTS
       │  (one $state field)                 (persisted map)        (config/defaults.ts)
       ▼
 play(track, {fresh})
       │
       ├─ effectiveMode(queueContext) ── 'same-list' → snapshot origin list, append remainder
       │                              └─ 'generated' → regenerate(seed) → buildSimilarQueue
       ▼
 ensureAhead() on exhaust ── same effectiveMode branch ── grows queue
       │
       └─ buildSimilarQueue / buildDiversePicks  ◄── exclude: manualUids ∪ removedUids(session)

AUTO-EXPAND FIX (QUEUE-01)
──────────────────────────
 play(track, {fresh})  ──  if (fresh && settings.autoExpandOnPlay) expanded = true
 next()/auto-advance/failover  ──  NEVER expands (fresh is absent/false)

SWIPE-REMOVE + CLEAR (QUEUE-05)
────────────────────────────────
 NowPlaying Up-Next row  ──use:swipeRemove──▶ axis-lock (slop) ─ horizontal? ─▶ player.removeFromQueue(uid)
       │                                                              │            └─ adds uid to removedUids(session)
       │                                                       vertical? → existing GripVertical reorder
 Up-Next header "Clear" button  ──▶ player.clearQueue()  ──▶ queue = [current], manualUids.clear()

DEEZER ENRICHMENT (ENRICH-04)
──────────────────────────────
 artist/[name]/+page  ──fetch──▶ /api/deezer/artist?name=  ──edge──▶ search/artist → artist/{id}
 album/[name]/+page   ──fetch──▶ /api/deezer/album?title=&artist=  ──edge──▶ search/album → album/{id}
       │                              (Cache API TTL, no key, never client→api.deezer.com)
       ▼
 field-by-field merge with existing Last.fm EnrichResult (D-15: best-quality image wins,
 counts side-by-side if both differ); section silently absent on miss (D-14); skeleton (D-17)
```

### Recommended Project Structure
```
src/lib/stores/player.svelte.ts        # MODIFY: queueContext $state, removeFromQueue, clearQueue,
                                        #   removedUids Set, per-context branch in play/ensureAhead,
                                        #   auto-expand guard at :902
src/lib/stores/settings.svelte.ts      # MODIFY: upnextPerContext field, FONT_SCALE_MIN/MAX 50/200,
                                        #   applyTheme() sets --color-primary-hover
src/lib/config/defaults.ts             # MODIFY: UPNEXT_DEFAULTS group + register in DEFAULTS
src/lib/actions/swipeRemove.ts         # NEW: horizontal axis-locked swipe action
src/lib/services/deezer.ts             # MODIFY: deezerArtist(), deezerAlbum() client fns
src/lib/services/color.ts              # NEW (small/pure): darken(hex, amount) for accent hover
src/routes/api/deezer/artist/+server.ts # NEW: edge proxy (mirror related/+server.ts)
src/routes/api/deezer/album/+server.ts  # NEW: edge proxy (mirror related/+server.ts)
src/routes/(app)/settings/playback/+page.svelte    # MODIFY: per-context selector rows
src/routes/(app)/settings/appearance/+page.svelte  # MODIFY: dynamic demo text, widened range
src/routes/(app)/artist/[name]/+page.svelte        # MODIFY: Deezer artist section + merge
src/routes/(app)/album/[name]/+page.svelte         # MODIFY: Deezer album section + merge
src/lib/components/NowPlaying.svelte   # MODIFY: swipe-remove on Up-Next rows, Clear button in header
src/lib/i18n/*.ts (×15)                # MODIFY: new keys in ALL 15 locales (parity-enforced)
```

### Pattern 1: queueContext field + per-context mode resolution
**What:** A single `$state` field records which surface started the queue; a settings map + defaults resolve the effective sourcing mode.
**When to use:** Set at every `setQueue` call site; read in `play({fresh})` and `ensureAhead`.
**Example:**
```typescript
// player.svelte.ts — new field + threaded into setQueue
export type QueueContext =
  'liked' | 'search' | 'downloads' | 'playlist' | 'album' | 'artist' | 'home-discovery' | 'history' | null;
queueContext = $state<QueueContext>(null);

setQueue(tracks: Track[], context: QueueContext = null) {
  this.queue = dedupeBest(tracks, settings.preferredSource);
  this.queueContext = context;
  this.persist();
}
// [ASSUMED] exact field shape is Claude's discretion (D-01 discretion note) — verify against
// the planner's chosen design; this mirrors ARCHITECTURE.md §2's recommendation.
```
```typescript
// settings.svelte.ts — effective mode (default generated)
// Reads UPNEXT_DEFAULTS.perContext[ctx] ?? UPNEXT_DEFAULTS.mode ('generated')
effectiveUpnextMode(ctx: QueueContext): 'same-list' | 'generated' {
  if (!ctx) return this.upnext.mode;                // global default = 'generated'
  return this.upnext.perContext[ctx] ?? this.upnext.mode;
}
```

### Pattern 2: auto-expand fired only on fresh user plays (D-05)
**What:** Move the `autoExpandOnPlay` fire behind the `fresh` flag so it never triggers on auto-advance/failover.
**When to use:** Replace the current unconditional fire at `player.svelte.ts:902`.
**Example:**
```typescript
// BEFORE (player.svelte.ts:902, fires on EVERY play() incl. next()/failover):
if (settings.autoExpandOnPlay) this.expanded = true;
// AFTER (D-05 — only explicit fresh plays):
if (opts?.fresh && settings.autoExpandOnPlay) this.expanded = true;
// Source: player.svelte.ts play() signature already carries opts.fresh (line 877).
```

### Pattern 3: horizontal axis-locked swipe-remove (D-06/07, Pitfall 7)
**What:** Mirror `dragClose.ts` on the X axis; commit axis only after slop; never `setPointerCapture` on `pointerdown`.
**When to use:** New `use:swipeRemove` action on Up-Next rows, sharing the row with the existing vertical GripVertical reorder.
**Example:**
```typescript
// swipeRemove.ts — structural mirror of dragClose, X-axis, axis-arbitration vs the grip
function down(e) { startX = e.clientX; startY = e.clientY; dragging = true; captured = false; /* NO capture here */ }
function move(e) {
  const dx = e.clientX - startX, dy = e.clientY - startY;
  if (!captured) {
    if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;   // below slop: still a tap
    if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; } // vertical wins → let grip/scroll run
    node.setPointerCapture(e.pointerId); captured = true;     // horizontal commit
  }
  node.style.transform = `translateX(${dx}px)`;
  node.style.opacity = String(1 - Math.min(1, Math.abs(dx) / FADE_DISTANCE));
}
function up() {
  const v = velX();                          // px/ms (X-axis tracker)
  if (Math.abs(dx) > THRESHOLD || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) onremove();
  else { /* spring back: transition transform→0, opacity→1 */ }
}
// touch-action: pan-y on the row so the browser keeps vertical scroll but yields horizontal.
// Source pattern: dragClose.ts (capture-after-slop, tap-preserving) + velocity.ts (flick).
```

### Pattern 4: Deezer artist/album edge route (mirror related/+server.ts)
**What:** Two-call own-origin proxy: resolve name→id via `search/artist|album`, then fetch `artist/{id}` | `album/{id}`; reshape to a clean client shape; Cache-API TTL.
**When to use:** `/api/deezer/artist` + `/api/deezer/album`.
**Example:**
```typescript
// /api/deezer/artist/+server.ts — VERIFIED field names (live api.deezer.com read)
const SEARCH = 'https://api.deezer.com/search/artist';
const ARTIST = 'https://api.deezer.com/artist';
// 1. search/artist?q=<name>&limit=1 → data[0].id
// 2. artist/{id} → { id, name, picture_xl, nb_fan, nb_album, radio }
// reshape → { picture: picture_xl, fans: nb_fan, albums: nb_album }  (null-safe)
// edgeCache().match/put keyed on the OWN-ORIGIN request (T-wv8-06), Cache-Control max-age=TTL.
// corsHeaders(origin) + OPTIONS handler exactly like related/+server.ts.
// Source: src/routes/api/deezer/related/+server.ts (proven 2-call pattern).
```

### Pattern 5: accent hover derivation in applyTheme (UX-07 root-cause fix)
**What:** `applyTheme()` derives a darker shade from the chosen accent and sets `--color-primary-hover`.
**When to use:** Add one line in `settings.svelte.ts:applyTheme()` after the `--color-primary` set.
**Example:**
```typescript
// settings.svelte.ts applyTheme() — AFTER r.style.setProperty('--color-primary', this.accent):
r.style.setProperty('--color-primary-hover', darken(this.accent, 0.12)); // ~12% darker
// darken() = pure parse #rrggbb → clamp each channel * (1-amount) → #rrggbb. New file color.ts.
// ROOT CAUSE: applyTheme never set the hover var, so it stayed pinned at app.css #6a48f0.
```

### Anti-Patterns to Avoid
- **Storing `queueContext`/origin on each Track object** — keep Tracks clean; one `$state` field on the player (mirrors the existing `manualUids` side-Set discipline).
- **A second/parallel queue-write path for `same-list` switching** — route every queue replacement through `setQueue`/the regenerate engine so `manualUids` + current-track pin survive (Pitfall 9).
- **`setPointerCapture` on `pointerdown` in swipe-remove** — retargets the trailing click; taps on the row stop firing (Pitfall 7, the exact bug `dragClose` documents).
- **Calling api.deezer.com from the client** — CORS-blocked + breaks the no-key posture; always go through `/api/deezer/*`.
- **Letting Deezer top-tracks become a playable second list** (D-18) — ordering hint only; no dead non-playable rows.
- **Adding a color library** for hover derivation — inline pure math; zero-dep ethos.
- **Reactive (`$state`) for `removedUids`** — it is an internal exclusion budget like `manualUids`/`playGen`; keep it a plain `Set` (Pitfall 9 / P-RUNES).
- **Firing `regenerate`/`ensureAhead` while clear left the queue empty** (D-09) — the exhaust engine refills only when the current track nears its end, not immediately on clear.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flick velocity for swipe-remove | A custom timestamp-delta calc | `createVelocityTracker` (velocity.ts) — but note it samples `clientY`; add a tiny X-axis sample or generalize | Already unit-tested, SSR-safe, FLICK_V tuned (0.5 px/ms in dragClose) |
| Capture-after-slop / tap-preserving pointer logic | A fresh pointer state machine | The `dragClose.ts` structure (down records only; capture in move after slop; pointercancel→up) | The exact tap-preservation + iOS pointercancel handling is already solved there |
| Deezer name→id→entity proxy | A new fetch+CORS+cache scaffold | Clone `related/+server.ts` (edgeCache, corsHeaders, fetchWithRetry, OPTIONS) | Proven 2-call pattern with edge caching + posture parity already in the repo |
| Generated up-next | A new recommender | `regenerate`/`buildSimilarQueue`/`buildDiversePicks` | Whole engine exists; this phase only routes the per-context branch into it |
| Per-context default storage | Ad-hoc constants scattered in code | `UPNEXT_DEFAULTS` in `config/defaults.ts` (k3y) | Auto-appears in reset; single source of truth |
| Color darkening | tinycolor/chroma-js | A 6-line pure `darken(hex, amt)` | No new dep; trivially testable |
| Removed-track exclusion | Filtering in 3 call sites | One `Set<string>` threaded into the existing `exclude`/`have` args | `buildSimilarQueue`/`buildDiversePicks` already take an exclude set |

**Key insight:** Every "new" capability in this phase is a small adapter onto an existing, tested seam. The only genuinely new code is the horizontal swipe action (structurally a fork of `dragClose`), two edge routes (structurally a fork of the Deezer related route), and a tiny pure color helper.

## Runtime State Inventory

> This phase touches persisted settings shape and player-state — included for completeness, though it is feature work, not a rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `openmusic:settings:v1` (localStorage) gains a new `upnextPerContext`/`upnext` field; `openmusic:player:v1` is UNCHANGED (queueContext is intentionally NOT persisted — a reload starts with `null` context, which resolves to the global `generated` default, the safe behavior). FONT_SCALE persisted values stay valid (D-11: widening only). | Code: add the field to settings `load()`/`save()` with a default; no migration needed (absent → default). Verify the appearance clamp widens (existing persisted 70–160 values remain valid). |
| Live service config | None — no external service stores any Phase-17 string. The two new Deezer routes are stateless edge proxies (Cache API only, auto-evicting via TTL). | None — verified: Deezer routes carry no persisted server state. |
| OS-registered state | None. | None — verified: no OS registration, task scheduler, or background process involved. |
| Secrets/env vars | None new. Deezer is keyless public API (no env var added). LASTFM_KEY stays edge-only (unchanged). | None — verified against existing `deezer.ts` posture (no secret crosses the boundary). |
| Build artifacts | None — no package install, no new compiled artifact. New `.ts`/`.svelte` files are part of the normal Vite build. | None. |

**Nothing found in categories OS-registered / Secrets / Live-service / Build:** confirmed by code read — this is in-app feature work with one additive localStorage field and stateless edge routes.

## Common Pitfalls

### Pitfall 1: queue mutation race — same-list switch / removeFromQueue clobbers manual pins or current-track (Pitfall 9 / P-UPNEXT)
**What goes wrong:** A new `same-list` switch or `removeFromQueue` that assigns `this.queue` directly can land between an async `ensureAhead`/`regenerate` build and its write-back, dropping a manual pin or the current-track pin.
**Why it happens:** Multiple async producers write the same `$state` array; last-writer-wins, and a stale async build may be the last writer.
**How to avoid:** Route every queue replacement through one method that re-reads `this.queue` at write-time and re-merges `manualUids` + the current track (exactly what `regenerate` does at :1041). `removeFromQueue(uid)` filters out the uid AND adds it to `removedUids`; `clearQueue()` resets to `[current]` and clears `manualUids` (D-08). Never assign `this.queue` from a closed-over snapshot.
**Warning signs:** a dragged/pinned track reverts; a removed track reappears via regen; the current track vanishes on clear.

### Pitfall 2: swipe-remove gesture collides with vertical reorder / page scroll / tap (Pitfall 7 / P-GESTURE)
**What goes wrong:** The horizontal swipe fights the existing GripVertical reorder drag and the panel's vertical scroll; a naive capture-on-pointerdown kills row taps (tap-to-play stops working).
**Why it happens:** The Up-Next row already hosts a vertical reorder grip + lives in a scrollable panel; an unguarded horizontal handler claims gestures it shouldn't.
**How to avoid:** Reuse the slop-threshold idiom: `pointerdown` records start only (no capture); in `pointermove` commit the axis once movement exceeds slop — horizontal-dominant → swipe-remove (`setPointerCapture` HERE, `stopPropagation`); vertical-dominant → stay passive so the grip/scroll runs. Set `touch-action: pan-y` on the swipe surface. Movement below slop (~8px) must reach the row's `onclick` (tap-to-play).
**Warning signs:** taps do nothing; diagonal swipes randomly reorder or remove; the panel won't scroll.

### Pitfall 3: recommendation loop — a swiped-removed song reappears via regeneration (D-10 / Pitfall 8)
**What goes wrong:** A user swipes a song out of up-next, but `buildSimilarQueue`/`ensureAhead` regenerate it right back (it's the #1 result for a similar artist), which "feels broken" (CONTEXT specifics).
**Why it happens:** The generator is deterministic (top-1-per-artist); the current `exclude` set only prevents in-queue dupes, not regeneration of a just-removed track.
**How to avoid:** Maintain an in-memory `removedUids: Set<string>` on the player; thread it (unioned with `manualUids`) into the `exclude` arg of `buildSimilarQueue` and the `have` arg of `buildDiversePicks`. Reset it on session end or a fresh user play (D-10 — session-scoped, NOT persisted per Deferred Ideas).
**Warning signs:** a swiped-away song re-enters up-next within the same session.

### Pitfall 4: i18n parity — new keys must exist in all 15 locales (Pitfall 14 / P-RUNES-adjacent)
**What goes wrong:** New strings (per-context labels, "Clear", text-size demo prefix, Deezer section headers like "Fans"/"Albums"/"Released") added to only `en.ts` → TypeScript build error (`Dict = Record<TranslationKey, string>` enforces parity) or a visible English fallback.
**Why it happens:** `TranslationKey = keyof typeof en` + `dicts: Record<AppLang, Dict>` makes every key mandatory in all 15 dictionaries: en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th.
**How to avoid:** Batch all Phase-17 keys; add each to all 15 locale files at once (English placeholder acceptable). MINIMIZE keys — reuse existing where possible (the 8 context labels map to existing surface names where they exist; numeric Deezer counts use a number + a single unit key, not 8 strings). CONTEXT D-01/code_context explicitly flags "keep per-context labels minimal/reused."
**Warning signs:** `svelte-check` / build fails with a missing-key type error; a label shows in English under a non-English UI.

### Pitfall 5: accent fix is half-done if only --color-primary is updated (UX-07)
**What goes wrong:** Setting only `--color-primary` from the accent leaves `--color-primary-hover` pinned at the old purple `#6a48f0` (app.css:10) — hover states across the app stay the wrong color, so the picker still "looks dead" on hover.
**Why it happens:** `applyTheme()` (settings.svelte.ts:315) sets `--color-primary` but never `--color-primary-hover`.
**How to avoid:** In `applyTheme()`, also `setProperty('--color-primary-hover', darken(accent, ~0.12))`. Audit ALL `--color-primary`/`--color-primary-hover` consumers (the grep is in Code Examples) to confirm none hardcode `#7c5cff` where they should use the variable (e.g. `Logo.svelte:10` stop-color is intentional brand art; the `(app)/+layout.svelte:246` fallback `#7c5cff` is a safe default but its hover should track the variable).
**Warning signs:** the accent picker recolors fills/chips but hover backgrounds stay purple.

### Pitfall 6: SSR / leaf-store discipline for the new settings field + player reads (P-RUNES)
**What goes wrong:** Reading `player.current` from the appearance settings page for demo text (D-12) could tempt a `settings → player` import, creating a cycle (settings is a LEAF store and must import nothing from player/library).
**Why it happens:** The demo-text source is the current track, which lives on the player.
**How to avoid:** Read `player.current` in the **page component** (`appearance/+page.svelte`), not inside the settings store — the page already imports both. Settings stays leaf. Mirror the established direction (pages compose stores; stores never import the player).
**Warning signs:** a circular-import warning; `settings.svelte.ts` importing from `player.svelte.ts`.

## Code Examples

Verified patterns from the live codebase + Deezer:

### Find all play-entry call sites that must declare a context (QUEUE-03)
```bash
# Source: grep run this session — these 11 sites set up a queue/play and must pass a context.
src/routes/(app)/+page.svelte:489   setQueue(picks)            # home-discovery (seedQueue)
src/routes/(app)/+page.svelte:572   setQueue([tr]); play(tr)   # home stub resolve
src/routes/(app)/+page.svelte:584   setQueue(cached.fallback)  # home-discovery
src/routes/(app)/+page.svelte:630   setQueue(fallbackSongs); play(track)  # home tile
src/routes/(app)/+page.svelte:734   play(track, { fresh:true })           # home album
src/routes/(app)/library/+page.svelte:115  setQueue(list); play(t)        # liked/playlist/downloads
src/routes/(app)/library/+page.svelte:120  setQueue(history.entries); play(track)  # history
src/routes/(app)/search/+page.svelte:384   setQueue(results); play(t)     # search  ← QUEUE-01 target
src/routes/(app)/album/[name]/+page.svelte:212  setQueue(all/[first])     # album
src/routes/(app)/artist/[name]/+page.svelte:109 setQueue([picked,...rest]); play(picked,{fresh:true})  # artist
src/routes/(app)/artist/[name]/+page.svelte:317 setQueue(songs); play(track)  # artist hit-songs
# Also: playStub() (home/album) internally calls setQueue([tr]) + play(tr,{fresh}) — its context
#   must be passed through playStub or set just before. NowPlaying:743/783 play({fresh}) = queue/related
#   re-tap (context unchanged, no setQueue).
```

### Accent audit grep (UX-07)
```bash
# --color-primary-hover has exactly ONE css declaration (app.css:10) + ZERO runtime updaters →
# the dead-wiring root cause. Only consumer is (app)/+layout.svelte:246 (fallback #7c5cff).
grep -rn "color-primary-hover" src/         # → app.css:10 only
grep -rn "#7c5cff\|#6a48f0" src/             # app.css, defaults.ts, settings.svelte.ts(×2),
                                             #   Logo.svelte:10 (brand art), +layout.svelte:246 (fallback)
# applyTheme() at settings.svelte.ts:315 sets --color-primary but NOT --color-primary-hover.
```

### Deezer artist/album fields (LIVE-VERIFIED this session)
```jsonc
// GET https://api.deezer.com/artist/27   (no auth) — [VERIFIED: live api.deezer.com read]
{ "id":27, "name":"Daft Punk", "picture_xl":"https://cdn-images.dzcdn.net/.../1000x1000-...jpg",
  "nb_album":36, "nb_fan":5160298, "radio":true, "tracklist":"https://api.deezer.com/artist/27/top?limit=50" }
// GET https://api.deezer.com/album/302127  (no auth) — [VERIFIED: live api.deezer.com read]
{ "id":302127, "title":"Discovery", "cover_xl":"https://cdn-images.dzcdn.net/.../1000x1000-...jpg",
  "release_date":"2001-03-07", "nb_tracks":14, "fans":333926, "duration":3662, "explicit_lyrics":false,
  "label":"Daft Life Ltd./ADA France", "record_type":"album",
  "genres":{ "data":[ { "id":106, "name":"Electro" } ] }, "artist":{ "id":27, "name":"Daft Punk", "picture_xl":"..." } }
// Name→id: GET /search/artist?q=<name>&limit=1 → data[0].id  (proven in related/+server.ts)
//          GET /search/album?q=<title artist>&limit=1 → data[0].id
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Search tap appends result list to queue (`setQueue(results)`) | Genre-generated default; search results NOT appended (QUEUE-01) | Phase 17 | The `search/+page.svelte:384` literal append is the behavior being replaced — context = `'search'` resolves to `generated` by global default. |
| `autoExpandOnPlay` fires on every `play()` (incl. auto-advance) | Fires only on `{fresh}` user plays (D-05) | Phase 17 | Fixes the track-change auto-expand bug at player.svelte.ts:902. |
| Repeat tri-state off/one/all | 2-state off/one (auto-generate is the repeat-all successor) | Phase 16 (shipped) | `queue` continuation is auto-generated; `next()` no longer wraps — Phase 17 layers per-context onto this. |
| No playback-origin tracking | `queueContext` `$state` field | Phase 17 | The roadmap's "queueContext field" wording was aspirational — Phase 16 did NOT ship it; Phase 17 introduces it. |
| `--color-primary-hover` static `#6a48f0` | Derived from chosen accent in `applyTheme()` | Phase 17 | Fixes dead-accent on hover surfaces (UX-07). |

**Deprecated/outdated:**
- The ARCHITECTURE.md note that `queueContext` is "NEW: queueContext state on Player" — still accurate; **confirmed not present** in the live file this session (verified: no `queueContext` token in player.svelte.ts).
- `removeFromQueue`/`clearQueue` referenced in CONTEXT code-seams at ~710/719 do **NOT exist** — those line numbers are `playNext`/`addToQueue`. The only `clearAll` in the repo is `library.clearAll()` (unrelated). These two methods are NET-NEW in Phase 17. `[VERIFIED: grep — no removeFromQueue/clearQueue in src/]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact `queueContext` field shape (single string field vs `{source, id}` object) is Claude's discretion; the single-string-union form is recommended | Pattern 1 | LOW — CONTEXT D-01 discretion explicitly delegates this; planner picks the final shape. |
| A2 | Deezer search-by-name for CJK artist/album names resolves reliably enough to enrich CN artists | Deezer section | MEDIUM — Deezer's Western catalog is stronger; a CN artist may miss → section silently absent (D-14 degradation makes a miss harmless, but enrichment coverage for CN content may be lower than for Western). The existing `/api/deezer/related` already relies on this path in production, so it is at least partially proven. |
| A3 | A ~12% hex-darken is a visually acceptable hover shade for arbitrary user-picked accents | Pattern 5 | LOW — cosmetic; planner/impl can tune. The original pair (`#7c5cff`→`#6a48f0`) is ~12% darker, so this matches today's relationship. |
| A4 | The horizontal swipe action can share a row with the vertical GripVertical reorder without a shared axis-arbiter beyond the slop check | Pattern 3 / Pitfall 2 | MEDIUM — the grip is a separate child button with its own pointer handlers + `stopPropagation` on click; the swipe action on the row and the grip should not both claim a gesture, but this needs live-device verification (iOS pointercancel). |
| A5 | Removed-uid exclusion threaded into `buildSimilarQueue(exclude)` + `buildDiversePicks(have)` is sufficient (no deeper generator change) | Pitfall 3 | LOW — both fns already accept and honor an exclude set (verified by code read). |
| A6 | Deezer 50 req/5s rate limit is comfortably under the edge-cached artist/album access pattern | Deezer section | LOW — artist/album data is long-TTL cached at the edge (D-16); a popular entity is fetched once per TTL window, not per user. Confirmed limit via two independent sources. |

## Open Questions

1. **Which Deezer fields earn a UI row, and the artist/album layout (D-14 delegates this)?**
   - What we know: live-verified fields available (artist: picture_xl, nb_fan, nb_album, radio; album: cover_xl, release_date, nb_tracks, fans, label, genres, duration, explicit_lyrics).
   - What's unclear: exact layout + which fields render vs. which merge silently into existing Last.fm sections (D-15).
   - Recommendation: planner specifies the field→row mapping per D-14/D-15; default to fan count + hi-res image + related artists (artist) and release date + label + genres + track count/duration (album), all degrading gracefully.

2. **Does `playStub` (home/album resolve-on-tap) need a context parameter, or is its context set just before the call?**
   - What we know: `playStub` internally calls `setQueue([tr])` + `play(tr,{fresh})` (player.svelte.ts:858-859).
   - What's unclear: cleanest threading — add a `context` arg to `playStub`, or have callers set `player.queueContext` before calling.
   - Recommendation: add an optional `context` arg to `playStub` so the single internal `setQueue` receives it (keeps the one-write-path discipline).

3. **Per-context label minimization vs. clarity (i18n cost)?**
   - What we know: 8 contexts × 1 label each + "Clear" + "same-list"/"generated" option labels = ~12 new keys × 15 locales = ~180 strings.
   - What's unclear: how many labels can reuse existing surface-name keys.
   - Recommendation: reuse existing nav/surface keys where they exist (liked/search/downloads/playlist/album/artist/history likely have tab/section keys already); add only the genuinely new ones. Planner audits `en.ts` for reusable keys first.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| api.deezer.com (public, no-auth) | ENRICH-04 artist/album enrichment | ✓ | live (artist + album + search verified this session) | Section silently absent (D-14) — no fallback needed |
| Cloudflare Cache API (edge) | New Deezer route TTL caching | ✓ | adapter-cloudflare 7.2.8 | In-memory `ttl-cache` on the client also caches; edge cache is the primary |
| /api/similar (LASTFM_KEY edge) | `getSimilarArtists` (generated up-next) | ✓ (degrades to Deezer related, then same-artist) | existing | Already has a 2-tier fallback (Deezer related → same-artist) |
| @lucide/svelte icons | Clear/remove + Deezer section icons | ✓ | ^1.17.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Deezer enrichment degrades to "section absent" on any miss (the entire ENRICH-04 design is graceful-degradation).

## Validation Architecture

> nyquist_validation: config not checked for an explicit `false`; treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3 `[VERIFIED: package.json]` |
| Config file | `vite.config.ts` (vitest config co-located) + existing `*.test.ts` siblings |
| Quick run command | `pnpm vitest run <file>` (or `npx vitest run <file>`) |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-01 | search context → generated default; no append; no auto-expand on non-fresh | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ (extend — player.svelte.test.ts exists) |
| QUEUE-03 | `effectiveUpnextMode(ctx)` resolves perContext ?? global generated | unit | `pnpm vitest run src/lib/stores/settings.test.ts` | ❌ Wave 0 (settings test file) |
| QUEUE-05 | `removeFromQueue` filters + adds to removedUids; `clearQueue` keeps current, clears manualUids | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ (extend) |
| QUEUE-05 | swipeRemove action: slop axis-lock, flick threshold, tap preserved | unit | `pnpm vitest run src/lib/actions/swipeRemove.test.ts` | ❌ Wave 0 (new action test — mirror dragReorder.test.ts) |
| D-10 | removed uid excluded from buildSimilarQueue/buildDiversePicks; reset on fresh play | unit | `pnpm vitest run src/lib/stores/player.svelte.test.ts` | ✅ (extend) |
| UX-03 | FONT_SCALE clamp widens to 50/200; persisted 70–160 stays valid | unit | `pnpm vitest run src/lib/stores/settings.test.ts` | ❌ Wave 0 |
| UX-07 | `darken(hex, amt)` pure correctness; applyTheme sets --color-primary-hover | unit | `pnpm vitest run src/lib/services/color.test.ts` | ❌ Wave 0 (new pure helper test) |
| ENRICH-04 | `deezerArtist`/`deezerAlbum` never throw; reshape null-safe; edge route reshape | unit | `pnpm vitest run src/lib/services/deezer.test.ts` | ❓ verify (deezer client may lack a test) |
| ENRICH-04 | field-precedence merge (D-15: hi-res image wins) | unit | page-level — consider extracting a pure `mergeEnrich()` helper to test | ❌ Wave 0 (extract pure merge fn) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched test file>`
- **Per wave merge:** `pnpm vitest run` (full suite) + `pnpm svelte-check`
- **Phase gate:** Full suite green + `svelte-check` clean (the `Dict` parity check catches missing i18n keys at type-check time) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/actions/swipeRemove.test.ts` — axis-lock / flick / tap-preserve (mirror `dragReorder.test.ts` + `dragScroll.test.ts` structure) — covers QUEUE-05 gesture
- [ ] `src/lib/services/color.test.ts` — pure `darken()` — covers UX-07
- [ ] `src/lib/stores/settings.test.ts` — verify it exists; if not, add for `effectiveUpnextMode` (QUEUE-03) + FONT_SCALE clamp (UX-03)
- [ ] Extract a pure `mergeEnrich(lastfm, deezer)` helper so D-15 precedence is unit-testable (ENRICH-04)
- [ ] Verify `src/lib/services/deezer.test.ts` exists; extend for `deezerArtist`/`deezerAlbum` never-throws
- [ ] Extend `src/lib/stores/player.svelte.test.ts` for queueContext/removeFromQueue/clearQueue/removedUids/auto-expand-guard

*(player.svelte.test.ts already covers play/playStub/generation-guard extensively — extend it, do not replace.)*

## Security Domain

> security_enforcement: not explicitly `false` in config — included. This phase adds no auth, no secrets, no PII.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in this phase (Last.fm auth is v1.3). |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No protected resources. |
| V5 Input Validation | yes | Edge routes validate/clamp `name`/`title`/`artist`/`limit` query params (mirror related/+server.ts: trim, `Math.min(25, Math.max(1, …))`); Deezer JSON is untrusted (all fields optional, null-safe reshape). |
| V6 Cryptography | no | No crypto; no secrets. Deezer is keyless public API. |

### Known Threat Patterns for {SvelteKit edge + client}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted upstream Deezer JSON (missing/wrong-typed fields) | Tampering | Treat every field optional; null-safe reshape (the related route's `DzArtistHit`/`DzSearchResp` interfaces do this). Never `JSON.parse` into a non-optional type. |
| Open-redirect / SSRF via query param into upstream URL | Tampering | `encodeURIComponent` the name/title (related/+server.ts already does); fixed upstream host (`api.deezer.com`), never a user-supplied host. |
| CORS bypass / token leak by client→api.deezer.com | Info Disclosure | Always proxy via `/api/deezer/*` (own-origin); no key crosses the boundary (Deezer is keyless — nothing to leak, but posture parity preserved). |
| Object-URL / blob leak (queue-mutation paths) | DoS (memory) | Phase 17 does NOT touch blob playback; `removeFromQueue`/`clearQueue` only mutate the `queue` array. Verify no new `createObjectURL` is introduced. |
| Cached failed/empty Deezer response pinned | DoS (UX) | Cache only successful reshapes with a bounded TTL (mirror related route's 24h); a miss returns the empty shape without long-caching a transient failure (the related route caches `{artists:[]}` — for artist/album, prefer NOT caching a hard-miss long, or cache with a shorter negative TTL). |

## Sources

### Primary (HIGH confidence)
- `src/lib/stores/player.svelte.ts` (full read) — confirmed NO `queueContext`; `setQueue`(:702), `playNext`/`addToQueue`(:708/:719), `ensureAhead`(:730), `prefetchNext`(:768), `manualUids`(:459), `regenerate`(:1041), `next`(:1060), `reorderQueue`(:1338), auto-expand fire (:902), `play({fresh})`(:877)
- `src/lib/stores/settings.svelte.ts` — `FONT_SCALE_MIN=70`/`MAX=160`(:52-53), `applyTheme` sets `--color-primary` only (:315), reset-group pattern, persisted shape
- `src/lib/config/defaults.ts` — k3y group pattern, `DEFAULT_ACCENT='#7c5cff'`, `DEFAULTS` aggregation
- `src/lib/services/similar.ts` — `buildSimilarQueue(track, excludeUids)`, Last.fm→Deezer-related→same-artist fallback
- `src/lib/services/deezer.ts` — own-origin proxy client, `deezerRelatedArtists` (template), never-throws posture
- `src/lib/services/lastfm.ts` — `EnrichResult` shape (tags/bio/lastfmArt/listeners/playcount) for D-15 merge
- `src/routes/api/deezer/related/+server.ts` — proven 2-call (search→by-id) edge proxy with edgeCache + corsHeaders + OPTIONS
- `src/lib/gestures/velocity.ts`, `src/lib/actions/dragClose.ts` — flick + capture-after-slop + tap-preserving idiom
- `src/lib/components/NowPlaying.svelte` (:700-790) — Up-Next list (:737), GripVertical reorder (:747), subnav header (:728)
- `src/routes/(app)/settings/{appearance,playback}/+page.svelte` — slider + segmented/chip row templates; static demo text (`Stargazing`/`Myles Smith`)
- `src/lib/i18n/index.ts` + locale dir — 15 locales (en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th); `Dict = Record<TranslationKey,string>` parity enforcement
- `app.css:9-10` — `--color-primary: #7c5cff`, `--color-primary-hover: #6a48f0` (the static hover var)
- `package.json` — one runtime dep (`@lucide/svelte`); Vitest ^4.1.3
- LIVE `api.deezer.com/artist/27` + `/album/302127` reads — verified field names + no-auth + values

### Secondary (MEDIUM confidence)
- Deezer rate limit "50 req / 5s" — confirmed by RapidAPI discussion + zaosoula deezer-public-api docs (two independent sources)
- Deezer public-GET no-auth — confirmed by Deezer FAQ + dacatdautrau guide ("public data without an access token")
- `.planning/research/{SUMMARY,PITFALLS,ARCHITECTURE}.md` — v1.2 synthesis (engine inventory, Pitfalls 7/8/9/14, integration §2/§9)
- `.planning/phases/16-playback-resilience-core/16-CONTEXT.md` — Phase-16 decisions this phase layers on

### Tertiary (LOW confidence — flagged for validation)
- Exact Deezer CJK-artist enrichment coverage (A2) — partially proven via the existing related route, not exhaustively tested for CN catalog
- iOS pointercancel behavior of the new horizontal swipe sharing a row with the vertical grip (A4) — needs live-device validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; every module read directly; versions from package.json
- Architecture: HIGH — all integration points (queueContext absence, auto-expand line, setQueue call sites, accent root cause) confirmed by direct reads + grep
- Pitfalls: HIGH — grounded in the v1.2 PITFALLS.md (Pitfalls 7/8/9/14) + live code; the queue-mutation/gesture/recommendation-loop traps are all documented against real seams
- Deezer specifics: HIGH on field names + no-auth + rate limit (live-verified + dual-source); MEDIUM on CN-catalog coverage

**Research date:** 2026-06-10
**Valid until:** ~2026-07-10 (stable internal codebase; Deezer public API field shapes are long-stable — 30 days)
