---
phase: quick-260611-gln
plan: 01
subsystem: sharing / metadata / playback-persistence
tags: [share, og, seo, i18n, player, lifecycle, svelte5]
requires: []
provides:
  - GLN-1-share-continuity
  - GLN-2-share-queue
  - GLN-3-share-slug
  - GLN-4-og-metadata
  - GLN-5-clearqueue-menu
  - GLN-6-android-persist
affects:
  - src/lib/services/share.ts
  - src/routes/(app)/+page.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.ts
  - src/routes/+layout.svelte
tech-stack:
  added: []
  patterns:
    - "universal +page.ts load → SSR <svelte:head> OG (crawler-correct)"
    - "page-lifecycle (visibilitychange/pagehide/freeze) immediate localStorage flush"
key-files:
  created:
    - src/lib/services/share.test.ts
    - src/routes/(app)/+page.ts
    - src/routes/(app)/artist/[name]/+page.ts
    - src/routes/(app)/album/[name]/+page.ts
    - src/lib/components/PageOg.svelte
  modified:
    - src/lib/services/share.ts
    - src/routes/(app)/+page.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/+layout.svelte
    - "src/routes/(app)/artist/[name]/+page.svelte"
    - "src/routes/(app)/album/[name]/+page.svelte"
    - "src/lib/i18n/*.ts (15 dict files)"
decisions:
  - "Kept the /?play= query entry + added a human-readable ?t=<slug> companion param (no new route); authoritative decode reads the opaque play payload."
  - "Share payload bumped to v2 {v,c,q}; decodeShare also accepts legacy v1 bare-stub tokens → {current, queue:[current]}."
  - "OG cover derivation is server-safe: surface current.cover only when it is an absolute https URL, else fall back to static /og.svg. Did NOT call the deezer cover proxy from server load (its module-global fetch + relative own-origin URL cannot resolve server-side)."
metrics:
  duration: ~16 min
  completed: 2026-06-11
---

# Quick 260611-gln: Sharing, Metadata & Persistence Bundle Summary

Six independent commits: humanized + queue-carrying share links, shared-link continuity/prefetch, crawler-correct SSR OG for shared-song/artist/album, clear-queue relocated to the options menu, and immediate flush-on-hide playback persistence (Android restore-to-0 fix).

## Per-task changes

### Task 1 — Humanized share slug + queue-carrying token (`fd40765`)
- `src/lib/services/share.ts`: added `slugify(title, artist)` (CJK-safe — preserves CJK codepoints, collapses ASCII punctuation/space to `-`, caps ~60). New v2 payload `{ v:2, c:Stub, q:Stub[] }` (queue capped at 30). `encodeShare(current, queue)` / `decodeShare(token)` (accepts legacy v1 bare-stub tokens → `{current, queue:[current]}`; malformed → `{current:null, queue:[]}`). `decodeTrack` delegates to `decodeShare`. `shareUrl(current, queue?)` emits `/?t=<slug>&play=<payload>`. Added pure `buildOg`/`isHttpsUrl` helper (used by Task 5).
- `src/lib/services/share.test.ts`: 20 tests — slugify ASCII+CJK, v2 round-trip (current + capped queue), legacy v1 decode, empty/1-item queue, shareUrl, buildOg/isHttpsUrl.

### Task 2 — Shared-link continuity + queue restore + prefetch (`970288f`)
- `src/routes/(app)/+page.svelte`: `?play=` onMount handler now decodes via `decodeShare`; installs the multi-item shared queue (or seeds `[current]`), then `player.play(current, { fresh: true })` so shared playback runs the same regenerate/ensureAhead + prefetchNext continuity path and auto-advances at end. Params cleared via `window.history.replaceState`. Discovery seed still suppressed when a token is present.

### Task 3 — Carry up-next queue when sharing (`4c8093d`)
- `src/lib/components/TrackMenu.svelte`: `doShare()` calls `shareUrl(track, player.queue)` so the generated link carries the up-next list; empty-queue case unchanged.

### Task 4 — Move clear-queue into the options menu (`2ff7397`)
- `TrackMenu.svelte`: added gated `Clear queue` item (`Trash2`, `{#if player.queue.length > 1}`) next to `Shuffle queue`, wired to `player.clearQueue()`.
- `NowPlaying.svelte`: removed the standalone subnav Clear button, its `.clear` CSS, and the now-unused `Trash2` import.
- `src/lib/i18n/*.ts` (all 15): added `menu.clearQueue` with real zh-Hant (`清除佇列`) / zh-Hans (`清除队列`) + 12 other localizations + en (`Clear queue`). i18n parity + no-blank tests pass.

### Task 5 — Crawler-correct OG via universal load (`fb73238`)
- New `(app)/+page.ts` (decode `?play` → OG from current track), `artist/[name]/+page.ts`, `album/[name]/+page.ts` (per-entity OG title/description) — universal loads run on the server during SSR so values land in the rendered HTML.
- New `src/lib/components/PageOg.svelte`: renders one `og:*`/`twitter:*` set into `<svelte:head>` (escaped `content={…}` bindings, `/og.svg` fallback when no https cover).
- Wired `data.og` into home/artist/album pages; gated the root layout `+layout.svelte` OG behind `{#if !page.data?.og}` so a page-supplied OG is the sole set.

### Task 6 — Android background persistence (`323209c`)
- `src/lib/stores/player.svelte.ts`: added private `flushPersist()` (sync `currentTime` from the element + cancel any pending throttled timer + immediate `persist()`). `attach()` registers `visibilitychange`(hidden) / `pagehide` / `freeze` → `flushPersist` (bypasses the 2s throttle), and `pageshow`(persisted) → re-sync `currentTime`/`playing` from the element (no autoplay). SSR-guarded (`typeof document/window`).
- `player.svelte.test.ts`: 8 new tests proving immediate exact-position localStorage write on hide/freeze/pagehide + pageshow re-sync.

## Verification

- `pnpm run check`: **0 errors / 0 warnings** after every task (final: 4098 files, 0/0).
- `pnpm test` (full suite): **614 passed (50 files)** — was 606 before Task 1+6 added share.test.ts (20) and 8 player-lifecycle tests; i18n parity + no-blank pass with `menu.clearQueue` in all 15 dicts.
- No new dependencies (no `package.json` change).

## Deviations from Plan

- **[Invocation only] `pnpm test` flag.** The plan's verify commands use `pnpm test -- --run <file>`, but the `test` npm script already bakes in `--run` (`"test": "vitest --run"`), so `--run` was passed twice and vitest errored (`Expected a single value for option "--run"`). Ran `pnpm test -- <file>` (and bare `pnpm test`) instead. No behavior change — same suite, same `--run`.
- **[Rule 3 - server-safe OG cover] Skipped the server-side deezer cover lookup in `+page.ts`.** The plan marked the deezer cover upgrade "optional / best-effort / on any miss leave null". The deezer helpers use the module-global `fetch` with a RELATIVE own-origin URL (`/api/deezer/search`), which does not resolve server-side without the SvelteKit load `fetch`, so the lookup would silently miss under SSR anyway. OG image instead uses `current.cover` when it is an absolute https URL, else the static `/og.svg` fallback (matches threat T-gln-04). Crawler-correct title + description are always present; the cover is best-effort exactly as specified.
- **[Factoring] `PageOg.svelte` component.** The plan suggested inline `<svelte:head>` per page; extracted a small `PageOg.svelte` so the three pages share one identical, escaped OG block (DRY + guaranteed single-property parity). `buildOg` was factored into `share.ts` (plan-recommended) and unit-tested.

## Consolidated human-check / device-dependent verification list

These are ADVISORY for the orchestrator's later verification (the executor implemented + committed all 6 tasks):

1. **Task 2 (device-independent):** On `pnpm dev`, copy a multi-track share URL, open in a fresh tab, tap play — confirm (a) it plays the shared song, (b) Up Next shows the shared queue, (c) at end it auto-advances to the next queued song instead of stopping.
2. **Task 4 (device-independent):** Play a track with a 2+ song up-next, open now-playing options (kebab) → confirm a `Clear queue` item appears (absent when queue is just the current track); tap it → Up Next collapses to the current track only; confirm the old subnav Clear button is gone.
3. **Task 5 (device-independent):** `pnpm build` then `pnpm preview` (wrangler pages dev); with `curl` (no JS) fetch the SSR HTML and confirm page-specific OG is in the SERVER response, e.g. `curl -s "http://127.0.0.1:4173/artist/Jay%20Chou" | grep -i 'og:title\|twitter:card'` shows the artist name (not just the site default); same for `/album/...?artist=...` and a `/?play=<token>` URL. Confirm exactly one `og:title` (no layout duplicate). Optionally validate a deployed URL in a card validator.
4. **Task 6 — DESKTOP-verifiable (device-independent):** On `pnpm dev`, play a track ~30s in, toggle the tab hidden (or switch tabs), inspect localStorage `openmusic:player:v1` — `currentTime` must be ~30 (exact position, written immediately, not the last 2s-throttled value). Reload → confirm the player restores to ~30s.
5. **Task 6 — DEVICE-DEPENDENT (NOT verifiable in this environment):** On a real Android phone PWA, play a song, background the app for a while, return — confirm it resumes at the saved position instead of restarting at 0, and the progress knob no longer jumps to the beginning on first interaction.

## Commit hashes

| Task | Commit | Scope |
|------|--------|-------|
| 1 | `fd40765` | share.ts slug + v2 token + buildOg + share.test.ts |
| 2 | `970288f` | (app)/+page.svelte ?play continuity + queue restore |
| 3 | `4c8093d` | TrackMenu doShare carries player.queue |
| 4 | `2ff7397` | clear-queue → options menu + 15 i18n dicts |
| 5 | `fb73238` | universal +page.ts OG loads + PageOg + layout gate |
| 6 | `323209c` | flushPersist + lifecycle listeners + 8 tests |

## Self-Check: PASSED

- All 5 created files exist on disk.
- All 6 task commits exist in git history (`fd40765`, `970288f`, `4c8093d`, `2ff7397`, `fb73238`, `323209c`).
- `.planning/HANDOFF.json` left untouched (still unstaged `M`), per the non-worktree execution-mode constraint.
