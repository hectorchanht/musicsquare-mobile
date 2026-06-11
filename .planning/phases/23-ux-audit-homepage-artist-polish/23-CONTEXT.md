# Phase 23: UX Audit & Homepage/Artist Polish - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The app reaches YT-Music/Spotify-grade polish across surfaces: every loading-text placeholder becomes a shape-matched skeleton (UX-01), action buttons toast on click and resist double-taps (UX-02), main vertical track lists support swipe-actions (queue / like) (UX-04), key actions give haptic feedback where supported (UX-05, Android only — iOS Safari ignores), an a11y pass adds `aria-pressed` / focus-traps / icon-button labels (UX-06), the homepage gains a per-section compact rows-of-4 mode with section-title navigation to dedicated chart pages or library tabs (HOME-02/03/04), and the artist page hides trackless albums (ART-01).

Depends on Phase 17 (settings plumbing for per-section density) and Phase 21 (cover/skeleton patterns settle first). Does NOT add new playback capabilities, redesign the now-playing sheet, or touch offline/SEO (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Row swipe-actions (UX-04)
- **D-01:** **Surfaces = all vertical track lists** — search results, library tabs, album tracklist, artist songs list. Horizontal home shelves are excluded (swipe fights the scroll gesture); the now-playing queue keeps its existing swipe-to-remove and gets no second swipe layer.
- **D-02:** **One action per direction, full-commit iOS-Mail style:** swipe right → queue, swipe left → like. Background icon reveals during the drag, past threshold = commit, row springs back (row is never removed). Reuses the `swipeRemove.ts` mechanics (8px slop, axis-lock, flick commit, tap-preserving).
- **D-03:** **"Queue" = add to end** — same semantics as TrackMenu `addQueue()` (appends after current up-next). Not play-next.
- **D-04:** **Swipe-left toggles like** — swiping an already-liked track unlikes it. The revealed background icon reflects the current state; the toast confirms which way it went. Matches TrackMenu `like()` toggle.

### Compact homepage mode (HOME-02/03)
- **D-05:** **Layout = YT-Music quick-picks pager:** each column is 4 stacked compact track-rows (small cover + title/artist + ⋮), horizontally scrollable between columns.
- **D-06:** **Column scrolling = CSS scroll-snap per column at ~90% viewport width** so the next column's edge peeks (signals scrollability).
- **D-07:** **ALL sections compact by DEFAULT** (user-locked: "all compact, update that on config"). Per-section override back to shelf mode lives in `/settings/home`, extending the existing section list (order/hidden) controls. The global `homeDensity` setting remains as the default for sections without an override.
- **D-08:** **All section types support compact** — including artist sections (Top Artists / Fav Artists), which get a compact list variant: small round avatar + name rows.
- **D-09:** **Compact row interactions:** track rows — tap = play, ⋮ option icon at row end = track menu, long-press = track menu (reuse existing `longpress` action + `TrackMenu`). Artist rows — tap = artist page, **no ⋮ icon** (no meaningful menu exists).
- **D-10:** **Item count reuses `homeShelfSize`**, rounded to a full column of 4 (e.g. 18 → nearest ×4). No new count setting.

### Section grid/chart nav (HOME-04)
- **D-11:** **Per-type routes** for dedicated chart pages: `/charts/tags/[tag]`, `/charts/countries/[country]`, and a top route for Top Hits / Top Artists (e.g. `/charts/top` or split — Claude's discretion on the exact top-level shape within the per-type convention).
- **D-12:** **Chart page = deep vertical list, ~50–100 track rows** — fetch a longer Last.fm chart than the homepage's shelf cap; reuse the standard row pattern so swipe-actions (D-01) and long-press menu come free.
- **D-13:** **Library-mirror sections redirect:** Liked / Downloads / History / Fav Artists → matching library tab; **per-playlist shelves go straight to that playlist's detail view** in library, not the generic Playlists tab.
- **D-14:** **Whole section-title row is the tap target** (title + chevron › as one element), YT-Music style. Chevron is the visual cue.

### Feedback layer (UX-02/05)
- **D-15:** **Global toast store** — one toast store + a single component mounted in the app layout; pages call `toast.show(msg)`. The 3 existing component-local toast copies (home, TrackMenu, NowPlaying `flash`) migrate to it.
- **D-16:** **Double-click guard = shared in-flight guard** (generalize TrackMenu's `inFlight` Set into a reusable helper/action): a button ignores taps while its async action runs, re-enables on settle. No arbitrary time debounce.
- **D-17:** **Haptics = commit-tier only:** short ~15ms `navigator.vibrate` tick on swipe-action commit, like toggle, queue add, long-press menu open, swipe-remove commit. Plain taps and navigation stay silent (YT-Music restraint). Must no-op safely where unsupported (iOS Safari).

### Trackless albums (ART-01)
- **D-18:** **Verify before render:** the artist page shows skeleton album cards until album track-counts are known, then renders only non-empty albums. Obvious stubs (empty name / placeholder) are dropped up front.
- **D-19:** **Research item (user-requested): evaluate Deezer as the artist-albums source.** Deezer's artist-albums endpoint returns `nb_tracks` natively — if viable (coverage/quality vs Last.fm top-albums), trackless filtering becomes free with zero per-album fetches. Deezer proxy + service already exist (`src/lib/services/deezer.ts`, `src/routes/api/deezer/search/+server.ts`). Researcher must compare data quality and recommend: replace, augment, or keep Last.fm + per-album verification.

### Claude's Discretion
- Skeleton audit specifics — which surfaces still show loading text (known: home randomize button; sweep all routes) and the exact skeleton shapes, following the locked project rule (match loaded count/size/length).
- A11y mechanics — focus-trap implementation (hand-rolled action vs tiny lib), full inventory of icon-only buttons needing `aria-label` and toggles needing `aria-pressed`.
- Compact-mode cover px sizes, row spacing, column gap.
- Swipe commit threshold basis (flat vs proportional per Phase 20 D-08 precedent), reveal colors/icons.
- Toast wording/i18n keys; toast queue/stacking behavior.
- Chart page pagination/load-more vs single fetch; Top Hits vs Top Artists route split under the per-type convention.
- Concurrency cap + caching for album track-count verification (if Last.fm path is kept after D-19 research).

</decisions>

<specifics>
## Specific Ideas

- Polish bar = **YouTube Music / Spotify** throughout (carried from Phases 20/22): quick-picks pager for compact sections, restrained commit-tier haptics, whole-title-row section nav.
- User explicitly wants **all homepage sections compact by default**, with settings as the escape hatch back to shelf mode per section.
- For ART-01 the user picked the stricter verify-before-render UX AND asked to "see if Deezer can produce better quality on album data" — the Deezer `nb_tracks` angle is the researcher's first stop.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs exist for this phase. Canonical references are in-repo requirements plus the load-bearing modules this work extends.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — UX-01/02/04/05/06 (### UX), HOME-02..04 (### Home), ART-01 (### Artist Page)
- `.planning/ROADMAP.md` — Phase 23 goal, Success Criteria 1–5, Research flag (LOW)

### Gestures & rows (MUST read)
- `src/lib/actions/swipeRemove.ts` — the horizontal swipe action D-02 generalizes (8px slop, axis-lock, flick commit, tap-preserving, vertical-yields)
- `src/lib/gestures/velocity.ts` — px/ms flick tracker the swipe reuses
- `src/lib/actions/longpress.ts` (or wherever `use:longpress` lives) — existing long-press → menu wiring D-09 reuses
- Row markup on the 4 swipe targets: `src/routes/(app)/search/+page.svelte`, `src/routes/(app)/library/+page.svelte`, `src/routes/(app)/album/[name]/+page.svelte`, `src/routes/(app)/artist/[name]/+page.svelte` (consistent `.row` button: art / meta / trailing icon)

### Feedback layer
- `src/lib/components/TrackMenu.svelte` — `toast()` local copy, `inFlight` Set (D-16 seed), `addQueue()`/`like()` semantics D-03/D-04 reuse, `aria-pressed` precedent on the Like button
- `src/routes/(app)/+page.svelte` — home `toast()` local copy (~217–223)
- `src/lib/components/NowPlaying.svelte` — `flash()` local copy (~37–43); transport toggles needing `aria-pressed` (repeat/shuffle)
- `src/app.css` — global `.sk` skeleton class (~330–360), `prefers-reduced-motion` handling

### Homepage & settings
- `src/routes/(app)/+page.svelte` — section snippets, `.subhead` titles (D-14 target), shelf render, long-press `tileMenu()`
- `src/lib/services/home-layout.ts` — `HOME_SECTIONS` ids + `resolveSectionOrder()` (D-07 per-section override extends this layer)
- `src/lib/stores/settings.svelte.ts` (~169–189) + `src/lib/config/defaults.ts` (~117–127) — Phase 17 plumbing pattern: add default → add field/load/reset → read via `settings.x`
- `src/routes/(app)/settings/home/+page.svelte` — where the per-section compact selector UI lands

### Chart pages & artist
- `src/lib/services/discovery.ts` (or the Last.fm service used by home) — chart fetchers the deep-list pages (D-12) extend
- `src/routes/(app)/artist/[name]/+page.svelte` — `getArtistTopAlbums` effect (~58–67), album render (~810–850) D-18 gates
- `src/lib/services/deezer.ts` + `src/routes/api/deezer/search/+server.ts` — existing Deezer plumbing for the D-19 research
- `src/routes/(app)/library/+page.svelte` — tab param handling for D-13 redirects (tab + playlist-detail deep-link)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`swipeRemove.ts`** — full horizontal swipe contract already solved (slop, axis-yield, flick, tap-preserving); D-02 parameterizes it into a generic swipe-action (direction → callback + reveal icon) instead of writing a new gesture.
- **`inFlight` Set in TrackMenu** — the exact double-tap-guard shape D-16 promotes to a shared helper.
- **3 local toast implementations** — same shape (msg + timeout + fly transition); trivial to consolidate into the D-15 global store.
- **`.sk` skeleton class + per-page skeleton precedents** (home shelf tiles, search `skeletonRows()` with 280ms dwell floor, album tracklist, TrackMenu header) — UX-01 extends these, no new system.
- **`longpress` action + `TrackMenu`** — compact-row ⋮ and long-press (D-09) are new callers of existing wiring.
- **Phase 17 settings plumbing** — per-section compact override (D-07) is a defaults.ts + settings.svelte.ts + /settings/home UI change, all patterned.
- **`aria-pressed` precedent** — TrackMenu Like button already does it; UX-06 replicates across toggles.

### Established Patterns
- **Gesture invariants (Phases 15/20):** no `setPointerCapture` on pointerdown; claim axis in pointermove after slop; sub-slop movement still reaches `onclick`. Swipe-actions must coexist with row tap-to-play and long-press menu.
- **Skeleton rule (project memory):** skeletons match loaded count/size/length; long text uses `use:marquee` — compact rows and chart pages must follow.
- **Never-throw resolver posture + race guards** (`sig.aborted` checks) — chart-page fetches and album verification inherit.
- **`mapWithConcurrency` CAP idiom** — album track-count verification (if kept) must cap fan-out.
- **localStorage settings via `openmusic:settings:v1`** — per-section compact map persists there like every other setting.

### Integration Points
- **Row markup on search/library/album/artist** — where the swipe-action attaches alongside `use:longpress` + `onclick`.
- **Home section snippets + `.subhead`** — where compact pager render branch and title-row nav (D-14) land; `home-layout.ts` carries the per-section mode resolution.
- **`/settings/home`** — per-section mode selector next to existing order/hide controls.
- **App layout (`src/routes/(app)/+layout.svelte`)** — global toast component mount point.
- **`player` store + `library` store** — queue add and like toggle the swipe actions call (same paths TrackMenu uses).
- **Artist page album effect** — D-18 skeleton gate + D-19 source swap decision point.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 23-ux-audit-homepage-artist-polish*
*Context gathered: 2026-06-12*
