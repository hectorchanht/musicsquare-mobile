---
phase: 23-ux-audit-homepage-artist-polish
title: UX Audit & Homepage/Artist Polish — UI Design Contract
status: draft
design_system: existing (vanilla SvelteKit + CSS custom properties; NO shadcn/Tailwind)
created: 2026-06-12
sources:
  - 23-CONTEXT.md (locked decisions D-01..D-19)
  - REQUIREMENTS.md (UX-01/02/04/05/06, HOME-02/03/04, ART-01)
  - src/app.css (tokens, .sk skeleton, marquee)
  - src/lib/stores/settings.svelte.ts + src/lib/config/defaults.ts (Phase 17 plumbing)
  - src/lib/services/home-layout.ts (section ids, resolvers)
  - src/lib/actions/swipeRemove.ts + longpress.ts + gestures/velocity.ts
  - src/lib/components/TrackMenu.svelte (toast/inFlight/aria-pressed precedent)
---

# Phase 23 — UI Design Contract

**Posture:** This phase is **polish over an established design system**, NOT a redesign. The app already
ships a complete token set, a `.sk` skeleton primitive, a `use:marquee` long-text rule, a row pattern
(`.row` → `.art` / `.meta` / trailing icon), a 15-locale i18n dictionary, and three local toast copies.
Every contract below **extends or consolidates** what exists. Do not invent new tokens, new fonts, new
color ramps, or new skeleton mechanics.

`design_system: none` for shadcn — the project has no `components.json`, no Tailwind, no registry. The
shadcn gate is **not applicable** (vanilla SvelteKit). Registry safety gate: not applicable.

---

## 1. Design Tokens (existing — source of truth, do not redefine)

All tokens live in `src/app.css :root` and are overridden by `:root[data-theme='light']`. Reuse via
`var(--token)`. **Adding a hard-coded hex anywhere in this phase is a contract violation.**

### Color (60 / 30 / 10)

| Role | Token | Value (dark) | Used for |
|------|-------|--------------|----------|
| 60% dominant surface | `--color-bg` | `#0b0b0f` | page background |
| 30% secondary | `--color-surface` | `#16161d` | cards, rows on hover, sheets |
| 30% secondary (raised) | `--color-surface-2` | `#1d1d27` | nested cards, chips, pager columns |
| 10% accent | `--color-primary` | `#7c5cff` (user-overridable) | **reserved for:** primary CTA fill, active toggle state (`aria-pressed=true`), focus ring, active nav/tab, swipe-**queue** reveal background |
| accent hover | `--color-primary-hover` | derived (~12% darken) | hover/active of accent surfaces |
| text | `--color-text` | `#f4f4f6` | titles, body |
| muted text | `--color-text-muted` | `#a0a0ad` | subtitles, artist names, secondary labels |
| border | `--color-border` | `#888888` | hairlines, dividers |

**Second semantic color (destructive / like):** there is no dedicated `--color-destructive` token. The
**swipe-left like** reveal uses the existing brand red `--src-netease` (`#c20c0c`) for the unlike→neutral
and a filled-heart accent for like; like is NOT destructive so it does not need a confirm. The only truly
destructive action in scope (delete playlist) already lives in library and is **out of this phase**.

Per-source brand colors (`--src-netease/qq/kuwo/joox/fivesing/jamendo`) stay reserved for source pills only.

### Spacing (8-point scale, already in use)

Use multiples of 4: **4, 8, 12, 16, 24, 32**. Existing rows pad `8px` and gap `12px`; section headers
margin `14px 0 8px`. Phase-23 additions follow the same scale. Exceptions allowed:

- **Touch targets:** every interactive control (swipe-action zones, ⋮ option icon, section-title row,
  compact rows) must be **≥ 44px** in the touch dimension even when the visual is smaller (pad to reach it).
- Compact-row vertical rhythm is `8px` row gap (see §4).

### Radius (existing)

`--radius-sm 6px` (skeleton bars, chips) · `--radius-md 12px` · `--radius-lg 18px` · `--radius-full 9999px`
(toast, pills, avatars). Row art uses `8px`; compact row art uses `6px` (see §4).

### Typography (existing — DO NOT add sizes)

Single family: `'Inter', system-ui, -apple-system, sans-serif`. All sizes already declared; the phase uses
**only these existing roles** (each multiplied by its appearance-scale var):

| Role | Size | Weight | Line-height | Used for |
|------|------|--------|-------------|----------|
| Section title (`.subhead`) | `0.95rem × --fs-title` | 700 | 1.2 | section headers + new title-nav row |
| Row title (`.r-title`) | `14px × --fs-title` | 600 | 1.3 | row + compact-row track title |
| Row subtitle (`.r-sub`/`.r-artist`) | `12px × --fs-artist` | 400 | 1.3 | artist/subtitle |
| Toast | `13px` | 400 | 1.3 | global toast text |

Two weights only: **400 (regular)** and **600/700 (semibold/bold)**. Long text in titles/subtitles MUST use
`use:marquee` + `.marquee-inner` (project memory rule) — never static ellipsis on a marquee-eligible label.
Skeleton bars never marquee.

---

## 2. Skeleton Contract (UX-01)

**Rule (locked, project memory):** every loading-text placeholder is replaced by a skeleton that matches the
**shape, count, and size** of the loaded content. Reuse the existing `.sk` class (`app.css`) and the search
page's `.skel` row precedent. No new skeleton system, no new shimmer keyframes.

### Audit sweep — surfaces that must skeleton (not show loading text)

| Surface | Current state | Required skeleton |
|---------|---------------|-------------------|
| Album page tracklist | `aria-label={t('album.loading')}` placeholder | N rows matching `.row` (art 48px + 2 bars), N = expected tracklist length cap |
| Artist page — albums grid | `albumsLoading` flag | **album-card skeletons** (cover + title bar), count = `getArtistTopAlbums` limit (see ART-01 §6) |
| Artist page — Hit songs | existing | row skeletons matching the loaded row shape |
| Now-playing related | already skeletoned (reference shape) | — (canonical reference; match it elsewhere) |
| Home shelves (comfortable + **compact**) | tile skeletons exist | compact mode needs **compact-row skeletons** (small art 40px + 2 bars) ×4 per column, columns = shelf width |
| Home library shelves (liked/downloads/history/playlists/fav-artists) | render-on-data | skeleton until store hydrates if a visible loading gap exists |
| Chart pages (new, HOME-04) | n/a | deep list of `.row` skeletons (~12 visible before first paint) |
| Search results / load-more | already uses `skeletonRows()` with 280ms dwell floor | unchanged — reuse as the dwell-floor reference |

### Skeleton invariants

- **Count match:** show the same number of placeholder items the loaded data will occupy (cap to viewport
  if the real count is unknown — e.g. ~12 chart rows, 4 compact rows per column).
- **Size match:** placeholder art/bars match the real element's px dimensions (search `.skel .art` = 48px
  mirrors `.row .art`; compact skeleton art = 40px mirrors compact-row art).
- **Bar widths:** title bar ~62% width, subtitle bar ~40% width (search precedent).
- **Dwell floor:** where a fetch can resolve in <300ms, keep the search page's ~280ms minimum dwell so the
  skeleton never flickers in-and-out.
- **Reduced motion:** shimmer auto-disables via the existing `@media (prefers-reduced-motion)` + the app's
  `[data-reduce-motion]` rule — the grey block remains. No extra work; just use `.sk`/`.skel`.

---

## 3. Feedback Layer — Toast, Double-Click Guard, Haptics (UX-02 / UX-05)

### 3.1 Global toast store (D-15)

Consolidate the **three local toast copies** (`+page.svelte` ~217, `TrackMenu.svelte` ~30, `NowPlaying`
`flash()` ~39) into one store + one component.

**Store contract** (`src/lib/stores/toast.svelte.ts`, new):
- `toast.show(msg: string)` — sets the message, auto-clears after **2000ms** (matches all three existing copies).
- A new `show()` while one is visible **replaces** the current message and resets the timer (no stacking —
  YT-Music restraint; single transient line). One message at a time.
- SSR-guarded; in-memory only (no persistence).

**Component contract** (`ToastHost.svelte`, mounted once in `src/routes/(app)/+layout.svelte`):
- Position/style is **byte-identical to the existing home `.toast`**:
  `position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top,0px) + 14px);
  z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px;
  box-shadow: var(--shadow-lg);`
- Enter/exit: `transition:fly={{ y: -20, duration: 180 }}` (existing). Honors reduce-motion via the global rule.
- `role="status"` `aria-live="polite"` so screen readers announce it (a11y, UX-06).

All callers migrate to `toast.show(t('...'))`. The 2000ms timeout + fly transition are removed from the three
call sites.

### 3.2 Double-click guard (D-16)

Generalize TrackMenu's `inFlight` Set into a reusable helper.

**Helper contract** (`src/lib/actions/inflightGuard.ts` or a small store helper, new):
- Wraps an async action so the button **ignores taps while its action is running** and re-enables on settle
  (resolve OR throw). **No time-based debounce** — purely in-flight gated (matches `shouldStartResolve`
  semantics in `track-menu-gate.ts`).
- While in-flight the button sets `aria-busy={true}` and may show the existing `.row-spinner`
  (TrackMenu precedent at lines 254/262/273). Plain (non-async) action buttons that still need
  double-tap resistance use a one-shot synchronous latch released on the next tick.
- The existing `shouldStartResolve(inFlight, key)` pure helper is the canonical seed; keep it node-testable.

### 3.3 Haptics — commit-tier only (D-17)

**Helper contract** (`src/lib/util/haptics.ts`, new — there is currently NO `navigator.vibrate` usage in the codebase):
- `tick()` → `navigator.vibrate?.(15)` wrapped in a feature/try guard so it **no-ops safely** where
  unsupported (iOS Safari ignores `vibrate`; never throws, never logs).
- **Fires on exactly these commit events** (and nowhere else):
  1. Swipe-action commit (queue) — past threshold
  2. Swipe-action commit (like toggle) — past threshold
  3. Queue-add commit (TrackMenu `addQueue`)
  4. Like toggle commit (TrackMenu / NowPlaying / row)
  5. Long-press menu open (the moment `longpress` fires)
  6. Swipe-remove commit (existing Up-Next swipe — `swipeRemove` `onremove`)
- **Silent (no haptic):** plain taps, navigation, play/pause, seek, scroll, sub-threshold spring-back.
- Must respect the same restraint as YT-Music: a single short tick, never a pattern.

---

## 4. Compact Homepage Mode (HOME-02 / HOME-03)

### 4.1 Layout — quick-picks pager (D-05, D-06, D-08)

Each compact section renders a **horizontally-scrollable pager**; each **column = 4 stacked compact rows**.

- **Column width:** `~90vw` so the next column's edge **peeks** (signals scrollability) (D-06).
- **Scroll-snap:** `scroll-snap-type: x mandatory` on the track; each column `scroll-snap-align: start`.
- **Column gap:** `12px`.
- **Columns:** `ceil(itemCount / 4)`. Item count = `homeShelfSize` rounded to the nearest full ×4 (D-10).

**Compact track-row (D-09):**
- `display: flex; align-items: center; gap: 8px;` min height **44px** (touch target), row gap `8px`.
- Art: **40×40px**, `border-radius: 6px`, lazy-cover + fallback gradient (reuse `use:lazyCover`).
- Meta: `.r-title` (14px/600) + `.r-sub` (12px/400 muted), both `min-width:0`, long text `use:marquee`.
- Trailing **⋮ option icon** (`MoreVertical size={18}`), `≥44px` tap target, `aria-label={t('menu.options')}`.
- Interactions: **tap row = play**, **tap ⋮ = open TrackMenu**, **long-press row = open TrackMenu**
  (reuse `use:longpress` + the existing `(e.currentTarget)?.blur()` MENU-03 guard).

**Compact artist-row (D-08, D-09):**
- Same row geometry but art = **round avatar** (`border-radius: var(--radius-full)`, 40px).
- Meta: artist name only (single line, `use:marquee`).
- Interactions: **tap = artist page**. **No ⋮ icon** (no meaningful artist menu) — and no long-press menu.

**Compact-row skeleton:** 40px art block + 2 bars (62% / 40% width), 4 per column, columns matching the
pager width. Reuse `.sk`.

### 4.2 Per-section density setting (D-07)

- **Default = ALL sections compact** (user-locked "all compact, update that on config").
- The per-section override lives in `/settings/home`, extending the existing section list (order/hidden) UI
  with a per-row mode control (e.g. a comfortable/compact toggle next to each section).
- Resolution layer: extend `home-layout.ts` with a pure resolver (e.g. `resolveSectionDensity(sectionId,
  perSectionMap, globalDefault)`) returning `'comfortable' | 'compact'`, mirroring `resolveSectionOrder`'s
  corrupt-input posture (unknown id / garbage → fall back to the global default; never blank the render).
- Settings plumbing follows the Phase 17 pattern exactly: add default → add field + load-guard + reset in
  `settings.svelte.ts` → persist in `openmusic:settings:v1`. New field e.g.
  `homeSectionDensity: Partial<Record<HomeSectionId,'comfortable'|'compact'>>` (object-not-array load guard
  like `enabledSources`). The existing global `homeDensity` stays as the default for sections without an
  override. **Phase intent:** ship the compact default by setting the resolver's global default to `'compact'`
  for home sections while leaving the persisted `homeDensity` field semantics intact (planner decides whether
  to flip the stored default or special-case the resolver — either satisfies D-07).

---

## 5. Section-Title Navigation + Chart Pages (HOME-04)

### 5.1 Title-row nav (D-14)

- The **whole section-title row is one tap target** (title + trailing chevron `›` as a single element),
  YT-Music style. The chevron (`ChevronRight size={18}`, muted) is the visual cue.
- Replace the static `.subhead` `<div>` with a `<button class="subhead-nav">` (full-width, left-aligned text,
  trailing chevron pushed right via `margin-left:auto`). `≥44px` height. `aria-label` = section title + "see all".
- Keep `.subhead` typography (0.95rem/700).

### 5.2 Redirect targets (D-11, D-13)

| Section | Tap target |
|---------|-----------|
| Top Hits | `/charts/top` (top hits) |
| Top Artists | `/charts/top` artists view OR a sibling route — **Claude's discretion** on the exact top-level split, kept under the per-type convention |
| Per-tag shelf | `/charts/tags/[tag]` |
| Per-country shelf | `/charts/countries/[country]` |
| Liked | library `liked` tab |
| Downloads | library `downloads` tab |
| History | library `history` tab |
| Fav Artists | library `fav-artists` tab |
| Per-playlist shelf | **that playlist's detail view** in library (deep-link), NOT the generic Playlists tab |

Library redirects use the existing `/library` tab param handling (`src/routes/(app)/library/+page.svelte`).
Playlist deep-link navigates straight to the playlist detail.

### 5.3 Chart page contract (D-11, D-12)

- Per-type routes: `/charts/tags/[tag]`, `/charts/countries/[country]`, `/charts/top`.
- **Layout = deep vertical list** of the standard `.row` pattern, **~50–100 rows** (fetch a longer Last.fm
  chart than the home shelf cap). Reusing the standard row gives **swipe-actions (D-01) and long-press menu
  for free** — they MUST be wired here too (these are "main vertical track lists" per D-01).
- Skeleton: deep `.row` skeleton list (~12 visible) until first paint; dwell-floor as on search.
- Pagination/load-more vs single fetch is **Claude's discretion** (reuse the search infinite-scroll sentinel
  pattern if load-more is chosen).
- Header: page title (the tag/country/"Top hits" name) using the existing page-heading style.

---

## 6. Row Swipe-Actions (UX-04)

**Surfaces (D-01):** all vertical track lists — search results, library tabs (liked/downloads/history/
playlist-detail), album tracklist, artist songs list, **and the new chart pages**. Horizontal home shelves
are **excluded** (swipe fights the scroll). The now-playing queue keeps its existing swipe-to-remove and gets
**no second swipe layer**.

**Mechanics:** generalize `swipeRemove.ts` into a directional `swipeAction` action (do not write a new
gesture). Inherit verbatim: 8px slop, axis-lock (`touch-action: pan-y`, vertical yields), flick commit
(`FLICK_V` from `velocity.ts`), capture-only-after-horizontal-commit, the WR-01 trailing-click suppressor.
**Must coexist** with the row's `onclick` (tap-to-play) and `use:longpress` (menu) — the tap contract is
load-bearing (Phase 15/20 invariant).

**Interaction (D-02, full-commit iOS-Mail style — row springs back, never removed):**

| Direction | Action | Reveal | Commit |
|-----------|--------|--------|--------|
| Swipe **right** | Add to queue (append to end — D-03, TrackMenu `addQueue` semantics) | queue icon (`ListEnd`) on `--color-primary` background | past threshold → `player.addToQueue(track)` + toast + haptic tick; row springs back |
| Swipe **left** | Toggle like (D-04) | heart icon reflecting **current** state on a like/neutral background; if already liked, reveal shows "unlike" | past threshold → `library` like toggle + toast (direction-correct) + haptic tick; row springs back |

- **Reveal:** the action icon + colored background reveal **behind** the row during the drag (the row
  translateX slides to expose it). Use `--color-primary` for queue; for like use a filled heart on a
  neutral/red field (reuse `--src-netease` for the unlike affordance). Reveal colors/icons exact choice is
  Claude's discretion within these tokens.
- **Threshold basis:** Claude's discretion (flat px vs proportional, per Phase 20 D-08 precedent). Default to
  the existing `96px` flat threshold + flick unless a proportional basis reads better on narrow rows.
- **Toast copy:** swipe-queue → `toast.addedToQueue`; swipe-like → `toast.liked` / `toast.unliked` (existing
  keys, reused).
- **No removal:** unlike Up-Next swipe, these rows are NEVER removed on commit — the action fires and the row
  springs back to `translateX(0)`.

---

## 7. Accessibility Pass (UX-06)

### 7.1 `aria-pressed` on toggle buttons

Precedent: TrackMenu Like button (`aria-pressed={liked}`). Replicate on **every stateful toggle**:

| Control | Location | `aria-pressed` reflects |
|---------|----------|-------------------------|
| Like (row / compact-row swipe target's menu, TrackMenu, NowPlaying transport) | multiple | liked state |
| Repeat toggle | NowPlaying (~879) | `repeatMode !== 'off'` |
| Shuffle / play-mode toggles (if present) | NowPlaying / player controls | active state |
| Per-section density toggle | `/settings/home` | compact vs comfortable |
| Library tab buttons (already icon `aria-label`'d) | library (~158–162) | add `aria-pressed`/`aria-current` for the active tab |

### 7.2 Icon-only button labels (`aria-label`)

Every icon-only button MUST have an `aria-label` (most already do — this is an audit-and-fill, not a rewrite).
**Newly-introduced** icon buttons that MUST carry labels:
- Compact-row ⋮ option icon → `aria-label={t('menu.options')}`.
- Section-title nav row → `aria-label` = "{title}, see all".
- Swipe-action reveal targets are gesture-driven (not focusable buttons), so the equivalent action stays
  reachable via the TrackMenu (keyboard/SR users use the ⋮ menu — swipe is an enhancement, not the only path).

Full inventory mechanics (which existing buttons still lack labels) is Claude's discretion during execution —
sweep search/library/album/artist/home/NowPlaying/TrackMenu/settings.

### 7.3 Focus-trap on sheets / menus

- Sheets/menus that open over the page (TrackMenu, SleepTimerSheet, picker sub-sheets, any new overlay) must
  **trap focus** while open and **restore focus** to the trigger on close.
- Implementation: a hand-rolled `use:focusTrap` Svelte action (no new dependency — consistent with the
  project's hand-rolled action posture: `longpress`, `swipeRemove`, `dragScroll`). Contract:
  - On mount: focus the first focusable element (or the sheet container).
  - Tab/Shift+Tab cycle within the sheet; Escape closes (where the sheet supports dismissal).
  - On destroy: return focus to the previously-focused element.
  - Coexists with the existing overlay `$effect` history invariant (Phase 19) — the action manages focus only,
    never the open/close state.
- The existing scrim buttons already carry `aria-label` (e.g. `t('menu.close')`) — keep them.

---

## 8. Trackless Albums on Artist Page (ART-01)

### 8.1 Render contract (D-18 — verify before render)

- The artist page shows **album-card skeletons** (cover + title bar; count = the album-list fetch limit)
  until album track-counts are known, then renders **only non-empty albums**.
- Obvious stubs (empty `name`, placeholder names) are dropped up-front before any verification.
- Reuse the existing `albumsLoading` flag + the race-guarded `albumsFor` effect; the skeleton replaces any
  loading text. Skeleton card shape matches the loaded album card (`~810–850` render block).

### 8.2 Data source — Deezer evaluation (D-19) — RESEARCH FINDING

**Finding:** the Deezer plumbing that exists today is **per-album lookup only**. `src/lib/services/deezer.ts`
`deezerAlbum(title, artist)` returns a single album's `nb_tracks` via `/api/deezer/album` (a search-then-getInfo
on ONE album). There is **no artist-albums-LIST endpoint** — `/api/deezer/artist` returns `{ picture, fans,
albums:count }`, not the album list. Last.fm's `getArtistTopAlbums` is the only call that returns the artist's
**album list** today, and `DiscoveryAlbum` carries only `{ name, image }` — **no track count**.

**Recommendation: AUGMENT, do not replace.**
- **Keep Last.fm `getArtistTopAlbums`** as the artist album-LIST source (it is the only list source; Deezer
  has no proxied equivalent yet).
- **Best path (planner's choice, recommended):** add a thin new Deezer proxy `artist/{id}/albums` →
  `/api/deezer/artist-albums` returning each album's `nb_tracks` natively. Deezer's `artist/{id}/albums`
  endpoint returns `nb_tracks` per album, so **trackless filtering becomes free with zero per-album fetches**
  — matching the D-19 intent. This mirrors the existing never-throws + cached + own-origin-proxy posture in
  `deezer.ts`. If adopted, Deezer becomes the album-list source for artists it covers (strong Western, decent
  CN), with Last.fm as the graceful fallback.
- **Fallback path (if the new proxy is descoped):** keep Last.fm list + verify each album's track count via
  the existing `deezerAlbum()` (returns `nb_tracks`) OR Last.fm `album.getInfo` tracklist, **capped** with the
  established `mapWithConcurrency` CAP idiom (≤ ~3–4 in-flight, never-throw, `sig.aborted` race guards),
  results cached. An album that resolves to 0 tracks (or fails verification) is hidden.
- Either way the **UX is identical** (skeleton → only non-empty albums); this is a data-source decision for the
  planner, not a visual one.

---

## 9. Copywriting Contract (i18n)

All user-facing strings are i18n keys across **15 locales** (`src/lib/i18n/*.ts`). Reuse existing keys; new
keys must be added to **all 15 dicts** (the i18n parity test enforces this — Phase 19 widened it to all locales).

### Reused toast keys (no new key needed)

| Event | Key | EN copy |
|-------|-----|---------|
| Queue add (menu + swipe) | `toast.addedToQueue` | "Added to queue" |
| Like (menu + swipe + transport) | `toast.liked` | (existing past-tense) |
| Unlike | `toast.unliked` | (existing) |
| Play next | `toast.playingNext` | "Playing next" |
| No audio | `toast.noAudio` | "No audio available" |

### New keys required (add to all 15 locales)

| Key | EN copy | Where |
|-----|---------|-------|
| `menu.options` | "Options" | compact-row ⋮ aria-label (reuse `nowplaying.options` value if preferred — Claude's discretion) |
| `home.seeAll` | "See all" | section-title nav aria-label suffix |
| `charts.topTitle` | "Top hits" | `/charts/top` heading |
| `charts.tagTitle` | "{tag}" / "Top {tag}" | `/charts/tags/[tag]` heading |
| `charts.countryTitle` | "{country}" | `/charts/countries/[country]` heading |
| `settings.homeSectionDensity` | "Layout" (or "Compact") | per-section density control label in `/settings/home` |
| `settings.densityCompact` / `settings.densityComfortable` | "Compact" / "Comfortable" | density toggle options |

Exact wording/keys for new strings are Claude's discretion (must stay consistent across all 15 dicts and pass
the parity test). Empty/error states: chart pages and artist albums show **skeletons then content** (no
loading text); a genuinely empty result hides the section (existing posture, `[] → section hides`).

### State copy

- **Empty state (chart page / section with no data):** section/page hides rather than showing an empty shell
  (matches existing `[] → hides` posture). No new "nothing here" copy needed for hidden sections.
- **Error state (fetch failure):** never-throw resolvers return empty → the section hides; user-visible failure
  for *playback* still uses the existing `toast.noAudio` / `home.unplayable` toasts.
- **Destructive actions:** none new in this phase. Swipe-like unlike is reversible (re-swipe) and confirmed by
  toast — no confirmation dialog.

---

## 10. Registry / Component Library

- **shadcn:** not used (no `components.json`, no Tailwind). Gate not applicable.
- **Third-party registries:** none. Registry safety/vetting gate: not applicable.
- **Icons:** existing icon set in use (lucide-style imports — `MoreVertical`, `ChevronRight`, `ListEnd`,
  `Heart`, etc. already imported across components). No new icon library.

---

## 11. Definition of Done (per success criterion)

1. **UX-01/02** — Every audited loading surface (§2 table) shows a count/size/shape-matched `.sk`/`.skel`
   skeleton; action buttons call `toast.show()` (global store, §3.1) and are in-flight-guarded (§3.2).
2. **UX-04/05** — All §6 vertical lists wire the generalized `swipeAction` (right=queue, left=like-toggle,
   spring-back); commit-tier `haptics.tick()` fires on the 6 §3.3 events and no-ops on iOS.
3. **UX-06** — `aria-pressed` on every §7.1 toggle; `aria-label` on every icon-only button incl. new ones;
   `use:focusTrap` on all sheets/menus with focus restore.
4. **HOME-02/03** — All home sections compact by default (quick-picks pager, 4 rows/column, 90vw snap);
   per-section override in `/settings/home`; compact track-row ⋮ + long-press open TrackMenu; artist rows tap
   to artist page with no ⋮.
5. **HOME-04 / ART-01** — Each section title is a full-row nav target with chevron → per-type chart page
   (deep `.row` list, swipe + long-press inherited) or library tab / playlist detail; artist page skeletons
   albums then renders only non-empty ones (Deezer augment per §8.2).
