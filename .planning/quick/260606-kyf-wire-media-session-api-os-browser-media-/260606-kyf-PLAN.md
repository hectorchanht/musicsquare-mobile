---
phase: quick-260606-kyf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/media-session.ts
  - src/lib/services/media-session.test.ts
  - src/lib/stores/player.svelte.ts
autonomous: false
requirements: [MS-01, MS-02, MS-03, MS-04, MS-05]
user_setup: []

must_haves:
  truths:
    - "On play / track change the OS/browser media UI shows the current track's title, artist, album and cover artwork (not the page title + Chrome icon)"
    - "OS media transport buttons (play, pause, previous, next) control playback"
    - "OS media seek controls (±10s skip + scrubber) move playback position"
    - "The OS media UI play/pause state stays in sync with actual playback"
    - "The OS media UI scrubber position tracks the real playback position"
    - "When playback stops / the track is cleared, the OS media metadata is cleared and state shows 'none'"
    - "App does not crash under SSR or on browsers without the Media Session API"
  artifacts:
    - path: "src/lib/services/media-session.ts"
      provides: "Pure (no-runes, no-SSR-import) helpers: artwork array builder, safe position-state builder, playback-state mapper"
      contains: "export function"
    - path: "src/lib/services/media-session.test.ts"
      provides: "Node-Vitest unit tests for the pure media-session helpers"
      contains: "describe("
    - path: "src/lib/stores/player.svelte.ts"
      provides: "Media Session wiring in attach() + play() + stop/clear, guarded for SSR and feature detection"
      contains: "mediaSession"
  key_links:
    - from: "src/lib/stores/player.svelte.ts"
      to: "src/lib/services/media-session.ts"
      via: "import of pure helpers (buildArtwork / safePositionState / playbackStateFor)"
      pattern: "from '\\$lib/services/media-session'"
    - from: "src/lib/stores/player.svelte.ts attach()"
      to: "navigator.mediaSession.setActionHandler"
      via: "register transport + seek handlers once on attach"
      pattern: "setActionHandler"
    - from: "src/lib/stores/player.svelte.ts play()"
      to: "navigator.mediaSession.metadata"
      via: "new MediaMetadata built from the RESOLVED track"
      pattern: "new MediaMetadata"
    - from: "src/lib/stores/player.svelte.ts (timeupdate/durationchange)"
      to: "navigator.mediaSession.setPositionState"
      via: "guarded position-state sync"
      pattern: "setPositionState"
---

<objective>
Wire the W3C Media Session API so the OS/browser media surfaces (Chrome media hub, macOS Now Playing, Android/iOS lock-screen) show the current track's title / artist / album / cover and offer working transport + ±10s skip + scrubber — instead of the page title and the Chrome icon.

Purpose: Deliver the "keeps playing when the screen locks, with a native-app-like media UI" promise from the project's core value. This pulls the MediaSession slice forward from the Phase 2/6/7 audio-engine work (per the existing `player.svelte.ts` header note).

Output:
- A pure, node-testable `media-session.ts` helper module (artwork array, safe position-state, playback-state mapper) — keeps the throw-prone logic out of the runes store and unit-tested.
- Media Session wiring inside the existing `player.svelte.ts` singleton: metadata on play/track-change, action handlers registered once in `attach()`, playbackState + positionState synced off the existing audio event listeners, and a clear-on-stop path. Everything SSR-guarded and feature-detected.

This is a UI/playback-layer change only. It REUSES the existing `toggle()` / `next()` / `prev()` / `seekFraction()` methods and the existing `<audio>` element. It does NOT touch the data/fetch/source backend and does NOT duplicate playback or queue logic.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@./CLAUDE.md

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase — use directly, no exploration needed. -->

Track shape — from src/lib/sources/types.ts (the resolved track passed to MediaMetadata):
```typescript
export interface Track {
  uid: string;
  source: SourceId;
  songid: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;        // PRIMARY artwork URL; may be null until resolved
  audioUrl: string | null;     // null until resolve()
  // ...other fields omitted
}
```

Player singleton — from src/lib/stores/player.svelte.ts (reactive state + methods to REUSE):
```typescript
class Player {
  current = $state<Track | null>(null);
  playing = $state(false);
  currentTime = $state(0);
  duration = $state(0);          // 0 until loadedmetadata; never NaN
  private audio: HTMLAudioElement | null = null;

  attach(el: HTMLAudioElement)   // ~line 47 — registers play/pause/timeupdate/loadedmetadata/durationchange/ended/error listeners. Called ONCE from the root +layout.svelte $effect.
  async play(track, opts?)        // ~line 120 — sets this.current=track, resolves details → this.current=resolved (~132), sets this.audio.src (~141)
  toggle()                        // ~line 175 — play/pause via this.audio
  next()                          // ~line 181
  prev()                          // ~line 194
  seekFraction(frac: number)      // ~line 223 — clamps [0,1] * audio.duration → audio.currentTime
}
export const player = new Player();
```

Display-name translation — from src/lib/stores/names.svelte.ts (importable into the store; SSR returns input unchanged):
```typescript
export const names: { dn(text: string): string };  // returns translated title/artist if cached, else original
```

Manifest icons — from static/manifest.webmanifest (NO raster PNG exists; SVG only):
```json
"icons": [
  { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" },
  { "src": "/icon-maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
]
```

DOM types: `MediaMetadata`, `MediaImage`, `MediaPositionState`, `MediaSessionAction`, `MediaSessionPlaybackState`, and `navigator.mediaSession` are all provided by lib.dom.d.ts (DOM lib is in the generated svelte-kit tsconfig). Do NOT hand-roll these types.
</interfaces>

PURE-MODULE EXTRACTION IDIOM (follow exactly — this is how `history-logic.ts` / `history.svelte.ts` are split):
- The Vitest config (vite.config.ts) has ONE `node` project that includes `src/**/*.{test,spec}.ts` but EXCLUDES `src/**/*.svelte.{test,spec}.ts`. Runes (`$state`) cannot compile in that project. Therefore the throw-prone, branchy logic goes in a NON-runes module (`media-session.ts`) and is tested there; the runes store merely calls it.
- `test.expect.requireAssertions` is `true` — every `it()` MUST contain at least one assertion.
- `Track` is imported types-only (`import type`) in the pure module — zero runtime coupling to the source layer.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure media-session helpers + node tests, then wire into the player store</name>
  <files>src/lib/services/media-session.ts, src/lib/services/media-session.test.ts, src/lib/stores/player.svelte.ts</files>

  <behavior>
  Pure helpers in src/lib/services/media-session.ts (no runes, no `$app/environment`, `import type { Track }` only):

  - `buildArtwork(cover: string | null): MediaImage[]` (MS-01)
    - Test: a cover URL → an array of `{ src, sizes, type: '' }` entries at sizes 96x96/128x128/256x256/384x384/512x512, every `src` equal to the cover URL. (Remote raster type is unknown, so `type` is left empty — the browser sniffs it.)
    - Test: `null` cover → the FALLBACK array, every entry `src === '/favicon.svg'` and `type === 'image/svg+xml'`, sizes including `'any'`. (Matches the only raster-less assets the manifest ships; graceful SVG degradation accepted.)
    - Test: empty-string cover is treated as no-cover → falls back to `/favicon.svg`.

  - `safePositionState(duration: number, position: number): MediaPositionState | null` (MS-04)
    - Test: finite duration > 0 with 0 <= position <= duration → `{ duration, position, playbackRate: 1 }`.
    - Test: `duration` NaN → `null`. duration `0` → `null`. duration `Infinity` → `null`. duration negative → `null`.
    - Test: position > duration → clamps position to duration (returns a valid object, NOT null) so `setPositionState` never throws on a late timeupdate.
    - Test: position NaN or negative → position coerced to 0 (valid object).

  - `playbackStateFor(hasTrack: boolean, playing: boolean): MediaSessionPlaybackState` (MS-02)
    - Test: no track → `'none'`. has track + playing → `'playing'`. has track + not playing → `'paused'`.
  </behavior>

  <action>
  Create src/lib/services/media-session.ts as a PURE module mirroring the history-logic.ts idiom (file-top comment explaining it is the node-Vitest-testable core that the runes player store wraps; `import type { Track }` only). Export three functions:

  - `buildArtwork(cover)` — when `cover` is a non-empty string, return MediaImage entries for the standard size ladder (96/128/256/384/512, plus you may include 'any') all pointing at the cover URL with an empty `type` (browser content-sniffs remote raster). When `cover` is null/empty, return the fallback array pointing at `/favicon.svg` with `type: 'image/svg+xml'` and `sizes: 'any'`. Reference `/favicon.svg` per the manifest (no raster PNG exists in static/ — confirmed; graceful degradation on platforms that don't render SVG media-art is accepted, do NOT author a binary PNG).
  - `safePositionState(duration, position)` — return null unless `Number.isFinite(duration) && duration > 0`. Otherwise clamp position into `[0, duration]` and return `{ duration, position, playbackRate: 1 }`. This is the guard that keeps `setPositionState` from throwing on NaN/0/position>duration (MS-04).
  - `playbackStateFor(hasTrack, playing)` — `'none'` when no track, else `'playing'`/`'paused'`.

  Create src/lib/services/media-session.test.ts following history-logic.test.ts conventions (`import { describe, it, expect } from 'vitest'`, import only the pure module, one assertion minimum per `it` for requireAssertions). Cover every case listed in <behavior>. Run the node project and confirm RED first if you scaffold tests before implementation, then GREEN.

  Then wire src/lib/stores/player.svelte.ts (REUSE existing methods — add NO new playback/queue logic):

  - Add a private guard helper, e.g. `private get ms(): MediaSession | null { return (typeof navigator !== 'undefined' && 'mediaSession' in navigator) ? navigator.mediaSession : null; }`. This single accessor enforces BOTH the SSR guard (`typeof navigator !== 'undefined'`) and feature detection (`'mediaSession' in navigator`) (MS-05). Every Media Session call goes through `this.ms` and early-returns when it is null.
  - In `attach(el)` (after the existing listeners): register action handlers ONCE via `ms.setActionHandler` (MS-03): `play` → `this.audio?.play().catch(()=>{})` (or `this.toggle()`), `pause` → `this.audio?.pause()`, `previoustrack` → `this.prev()`, `nexttrack` → `this.next()`, `seekbackward` → move `el.currentTime` back by `details.seekOffset ?? 10` (clamped >= 0), `seekforward` → move forward by `details.seekOffset ?? 10` (clamped <= duration), `seekto` → if `details.seekTime` is a finite number set `el.currentTime = details.seekTime` (or `this.seekFraction(details.seekTime / el.duration)` when duration is finite). Wrap each handler body in a try/catch-free but null-safe form (handlers only fire client-side, but keep `this.audio?` optional access).
  - Still in `attach()`, augment the EXISTING listeners (do not add duplicate listeners — extend the existing `play`/`pause` handlers and the `syncDur`/`timeupdate` handlers, plus `ended`/`error`): after each, set `ms.playbackState = playbackStateFor(!!this.current, this.playing)` and call a private `syncPosition()` that does `const st = safePositionState(el.duration, el.currentTime); if (st) ms.setPositionState(st);` guarded by `this.ms`. Call `syncPosition()` from the timeupdate, durationchange, and loadedmetadata paths (MS-04). Set `ms.playbackState` on play/pause/ended (MS-02).
  - In `play(track, opts)`: after `this.current = resolved` (~line 132), set `ms.metadata = new MediaMetadata({ title: names.dn(resolved.title), artist: names.dn(resolved.artist), album: resolved.album, artwork: buildArtwork(resolved.cover) })` and `ms.playbackState = 'playing'` (use the RESOLVED track so album/cover are populated) (MS-01). Import `names` from `$lib/stores/names.svelte` (it is a browser-safe store; `dn` returns the original under SSR/off). Build artwork via the pure helper.
  - Add a private `clearMedia()` (or inline) that sets `ms.metadata = null` and `ms.playbackState = 'none'`; call it from the `error` listener and add it to a sensible "stopped/cleared" path (e.g. when `play()` resolves with no `audioUrl` and sets `this.error`). This satisfies "clear metadata + 'none' when playback stops/track cleared" (MS-05/MS-02).

  Do NOT touch any source/fetch/catalog code. Do NOT change `next`/`prev`/`toggle`/`seekFraction` signatures or queue behavior — only call them. Match existing comment density and the `no-referrer` / runes idioms already in the file.
  </action>

  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && npm run check && npm test</automated>
  </verify>

  <done>
  - `npm run check` reports 0 errors / 0 warnings.
  - `npm test` passes, including the new media-session.test.ts (node project) with every case from <behavior> green.
  - `src/lib/services/media-session.ts` exports `buildArtwork`, `safePositionState`, `playbackStateFor`; it is a pure module (no `$state`, no `$app/environment`).
  - `player.svelte.ts` imports those helpers + `names`, registers all 7 action handlers once in `attach()`, sets `MediaMetadata` from the resolved track in `play()`, syncs `playbackState` + `setPositionState` (guarded) off the existing listeners, and clears metadata + sets `'none'` on stop/clear — all behind the `this.ms` SSR+feature guard.
  - Manual (checkpoint follows): play a track → Chrome media hub / macOS Now Playing shows title + artist + album + cover; play/pause/prev/next, ±10s, and the scrubber all work and stay in sync; SSR build/check does not crash.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
  Media Session wiring: the OS/browser media UI now reflects the current track and its controls drive the existing player. Automated checks (`npm run check` 0/0, `npm test` green) already passed in Task 1; this verifies the integration on a real media surface (which cannot be asserted in a unit test).
  </what-built>
  <how-to-verify>
  1. Run `npm run dev` and open the app in Chrome (desktop) and/or a mobile browser.
  2. Search a song and tap it to play.
  3. Open the OS/browser media surface:
     - Chrome desktop: click the media-control icon in the toolbar (the "media hub"), OR check macOS Control Center → Now Playing.
     - Android Chrome: lock the screen / pull down the notification shade.
     - iOS Safari: lock screen / Control Center (SVG fallback art may degrade — acceptable).
  4. Confirm it shows the track TITLE, ARTIST, ALBUM, and COVER artwork (NOT "openmusic — stream music…" + the Chrome icon).
  5. Tap the media-surface PLAY/PAUSE — playback toggles and the displayed state matches.
  6. Tap NEXT and PREVIOUS — the track changes and metadata/art update.
  7. Use the ±10s skip buttons and drag the SCRUBBER — playback position moves accordingly, and the scrubber tracks real position during playback.
  8. Stop / clear playback — the media surface no longer shows an active track (state 'none').
  </how-to-verify>
  <resume-signal>Type "approved" if the OS media UI shows correct metadata and all controls (transport + ±10s + scrubber) work, or describe what's wrong.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| OS/browser media surface → app | Media Session action handlers receive `MediaSessionActionDetails` (e.g. `seekTime`, `seekOffset`) from the user agent. Treated as untrusted numeric input. |
| Remote CDN → artwork `src` | The track `cover` is a remote URL placed into `MediaMetadata.artwork`; rendered by the OS, not interpolated into the DOM. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kyf-01 | Tampering | `seekto`/`seekbackward`/`seekforward` handlers reading `details.seekTime` / `details.seekOffset` | mitigate | Treat as untrusted: only act when `Number.isFinite`, clamp into `[0, duration]` before assigning `audio.currentTime` (reuses the same clamping the pure `safePositionState` enforces). |
| T-kyf-02 | Denial of Service | `setPositionState` throwing on NaN/0/position>duration → unhandled exception in a hot timeupdate path | mitigate | All position updates go through pure `safePositionState`, which returns `null` for invalid duration and clamps position; the store only calls `setPositionState` on a non-null result. Covered by unit tests. |
| T-kyf-03 | Denial of Service | Media Session calls on a server (SSR) or unsupported browser | mitigate | Single `this.ms` accessor enforces `typeof navigator !== 'undefined'` + `'mediaSession' in navigator`; every call early-returns when unsupported. |
| T-kyf-04 | Information Disclosure | Artwork `src` is a remote CDN URL surfaced to the OS media UI | accept | Same-origin-policy-irrelevant (image fetch by the UA); no PII; the cover URL is already public track metadata rendered elsewhere in the app. |
| T-kyf-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies are added (Media Session is a native browser API; DOM types ship with TypeScript's lib.dom). No package-manager install task exists in this plan. |
</threat_model>

<verification>
- `npm run check` → 0 errors, 0 warnings (svelte-check + tsc over the new pure module and the modified store).
- `npm test` → all suites pass, including `src/lib/services/media-session.test.ts` in the node project.
- Pure module contains no runes / no `$app/environment` import (so it compiles in the node Vitest project).
- Manual integration checkpoint confirms the OS media UI shows correct metadata and all controls work.
</verification>

<success_criteria>
- Playing a track sets `navigator.mediaSession.metadata` from the RESOLVED track (title/artist via `names.dn`, album, artwork array), so the OS/browser media UI shows the song instead of the page title + Chrome icon (MS-01).
- `playbackState` is `'playing'`/`'paused'`/`'none'` and stays synced with the audio play/pause/ended events and the absence of a current track (MS-02).
- All seven action handlers (play, pause, previoustrack, nexttrack, seekbackward, seekforward, seekto) are registered once in `attach()` and drive the existing player methods / audio element; ±10s default offset for seek±, `seekTime` for seekto (MS-03).
- `setPositionState({ duration, position, playbackRate: 1 })` is kept current on timeupdate/durationchange/loadedmetadata and only ever called with a guarded, finite, in-range state (MS-04).
- All Media Session access is SSR-guarded and feature-detected; metadata is cleared (null) and state set to `'none'` when playback stops / the track is cleared; nothing crashes under SSR or on browsers lacking the API (MS-05).
- No new dependencies; no changes to the data/fetch/source backend; no duplication of playback/queue logic.
</success_criteria>

<output>
Create `.planning/quick/260606-kyf-wire-media-session-api-os-browser-media-/260606-kyf-SUMMARY.md` when done.
</output>
