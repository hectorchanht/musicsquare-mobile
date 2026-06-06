---
phase: 09-discovery-hot-picks-tab
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/routes/api/lastfm/discovery/+server.ts
  - src/routes/api/lastfm/discovery/lastfm-discovery-endpoint.test.ts
  - src/routes/api/lastfm/info/+server.ts
  - src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts
  - src/lib/services/discovery.ts
  - src/lib/services/discovery.test.ts
  - src/lib/services/lastfm.ts
  - src/lib/services/lastfm.test.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 9 introduces the Last.fm discovery layer: a new `/api/lastfm/discovery` edge proxy, the `resolveStub` / `mapWithConcurrency` helpers in `discovery.ts`, client-side list builders in `lastfm.ts`, and three updated Svelte pages (home, artist, album). The key-security and absent-key-graceful posture are faithfully ported from Phase 8, and `mapWithConcurrency` correctly caps fan-out. However, one security gap was found in the discovery endpoint (missing HTTPS validation on image URLs, creating a CSS-injection/tracker sink), one cache correctness bug (CORS headers baked into cached responses without the incoming origin), one logic bug (background revalidation disables the Randomize button), and two minor quality issues.

---

## Critical Issues

### CR-01: Image URLs from Last.fm are not HTTPS-validated — CSS background-image injection sink

**File:** `src/routes/api/lastfm/discovery/+server.ts:124`
**Issue:** `pickImage()` filters the grey-star placeholder hash but does NOT validate the URL protocol or domain. The image value is then returned in the JSON body and used by all three Svelte pages as `style:background-image={item.image ? \`url(${item.image})\` : fallback}`. Svelte's `style:` directive sets the CSS property verbatim; it does not sanitize. A Last.fm image URL containing a closing parenthesis and a second `url()` fragment — e.g. `https://cdn.last.fm/img.png) url(https://evil.com/pixel.gif` — would produce `background-image: url(https://cdn.last.fm/img.png) url(https://evil.com/pixel.gif)`, causing the browser to fetch the attacker-controlled URL as a second background layer (covert tracking pixel / data exfiltration). The same gap exists in the sibling `pickImage` in `/api/lastfm/info/+server.ts` for the `image` field (though Phase 8 already applied `safeLastfmUrl` to `bioUrl`).

Note: Last.fm's CDN (`lastfm.freetls.fastly.net`) does not currently emit URLs with `)` characters, so exploitation requires either a compromised Last.fm response or a future API change. This is nonetheless a defense-in-depth failure at the same class-of-threat as CR-01 in Phase 8's bio href.

**Fix:** Apply the same protocol+domain guard to image URLs that `safeLastfmUrl` applies to `bioUrl`. Add a `safeImageUrl` helper (can share the `new URL()` parse path; allow any `*.last.fm` or `*.fastly.net` `https:` URL to match Last.fm's CDN):

```typescript
// In both +server.ts files, alongside safeLastfmUrl / pickImage:
const IMAGE_HOST_RE = /(?:^|^[a-z0-9-]+\.)(?:last\.fm|fastly\.net)$/i;

function safeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!IMAGE_HOST_RE.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}
```

Then in `pickImage`, replace `return best ? best.url : null` with `return best ? safeImageUrl(best.url) : null`.

---

## Warnings

### WR-01: Cache hit returns CORS headers baked for the original request origin — Vary: Origin is ineffective because the cache-lookup Request has no Origin header

**File:** `src/routes/api/lastfm/discovery/+server.ts:217-221`
**Issue:** The cache key request is `new Request(url.toString())`, which has **no `Origin` header**. The stored response carries `Vary: Origin` (from `corsHeaders()`) and an `Access-Control-Allow-Origin` value scoped to the first requesting origin (e.g. `https://openmusic.pages.dev`). When a subsequent request arrives from a different allowed origin (e.g. a CF preview deploy `https://abc.openmusic.pages.dev`), `cache.match(cacheReq)` may return the stored response (because the lookup request has no `Origin` to vary on), and the response's `ACAO` header will name the wrong origin. The browser will block the response due to CORS mismatch. This only affects multi-origin deployments (preview deploys vs. production), but the Vary mechanism is supposed to prevent exactly this case.

**Fix:** Include the incoming `Origin` in the cache-lookup Request so `Vary: Origin` can function correctly:

```typescript
// Replace:
const cacheReq = new Request(url.toString());

// With:
const cacheReq = new Request(url.toString(), {
  headers: origin ? { Origin: origin } : {}
});
```

This ensures the Cloudflare Cache API creates per-origin cache entries and returns the matching one, consistent with the stored `Vary: Origin` response header.

### WR-02: Background revalidation sets `loading = true`, disabling the Randomize button while cached content is already visible

**File:** `src/routes/(app)/+page.svelte:126-127` and `233-235`
**Issue:** `onMount` applies the localStorage cache (`loading = false` at line 233), then immediately fires `void refresh(false)` (line 235). `refresh()` begins unconditionally with `loading = true` (line 127). Because the loading template condition (`loading && !topHits.length && ...`) is guarded by data presence, the skeleton does NOT reappear (good), but the Randomize button is `disabled={loading}` (line 255) and its label switches to "Loading..." for the entire duration of the background network round-trip. A user who opens the home page and immediately tries to tap Randomize will find it disabled and see the wrong label, with no visual explanation.

**Fix:** Introduce a separate `revalidating` boolean for background fetches:

```typescript
let revalidating = $state(false);

async function refresh(seedQueue = true, background = false) {
  if (background) {
    revalidating = true;
  } else {
    loading = true;
  }
  error = null;
  try {
    // ... existing body unchanged ...
  } finally {
    loading = false;
    revalidating = false;
  }
}
// onMount:
void refresh(false, /*background=*/true);
```

And in the template:
```svelte
<button ... disabled={loading || revalidating}>
  {loading ? t('home.loadingPicks') : t('home.randomize')}
</button>
```

### WR-03: Album page back button always navigates to `/` (home) — skips the originating artist page

**File:** `src/routes/(app)/album/[name]/+page.svelte:124`
**Issue:** The album page is always reached by tapping an album card on the artist page (which adds `?artist=…` to the URL). The back button is hard-coded as `onclick={() => goto('/')}`, which drops the user at the home page rather than back to the artist they came from. The `albumArtist` param is already available in `page.url.searchParams`, so the correct back destination is known.

**Fix:**
```svelte
<button class="back" aria-label={t('album.back')}
  onclick={() => albumArtist ? goto('/artist/' + encodeURIComponent(albumArtist)) : goto('/')}>
  <ChevronLeft size={22} />
</button>
```

If history-based back is preferred (handles browser forward/back symmetry better): `onclick={() => history.back()}`. The `albumArtist` approach is more predictable for SPA navigation.

### WR-04: Concurrent `refresh()` calls are not guarded — a background revalidate started by `onMount` can race with a manual Randomize tap

**File:** `src/routes/(app)/+page.svelte:126`
**Issue:** Two concurrent invocations of `refresh()` can exist: the background revalidate fired by `onMount` (line 235) and a manual "Randomize" tap (line 255). Both mutate the same `$state` variables (`topHits`, `topArtists`, `tagShelves`, `countryShelves`, `useFallback`, `fallbackSongs`, `loading`). Because the shelf builders return cached data from the Cloudflare Cache API, the race rarely causes visible inconsistency — both calls would get the same data. However, if the Randomize click fires mid-flight of the background call, the background call's `finally` block will set `loading = false` AFTER the Randomize call already set it, potentially leaving `loading` in an incorrect state or producing a double-write. More concretely: if the user taps Randomize just as the background revalidate's `Promise.all` resolves but before its `finally` runs, the Randomize call updates state and sets `loading = false`; the background call's `finally` then sets `loading = false` again (harmless but sloppy) or, worse, it can overwrite `topHits` with the background's stale data if the background fetch returns after the Randomize fetch.

**Fix:** Add an in-flight guard:

```typescript
let refreshAbort: AbortController | null = null;

async function refresh(seedQueue = true) {
  refreshAbort?.abort();
  const ctrl = new AbortController();
  refreshAbort = ctrl;
  loading = true;
  error = null;
  try {
    // pass ctrl.signal down into getChartTopTracks etc., or just check ctrl.signal.aborted after await
    const [hits, artists, tagRows, countryRows] = await Promise.all([...]);
    if (ctrl.signal.aborted) return;
    // rest of the update logic
  } catch (e) {
    if (ctrl.signal.aborted) return;
    error = ...;
  } finally {
    if (!ctrl.signal.aborted) loading = false;
  }
}
```

---

## Info

### IN-01: Album page tracklist uses index `i` as `#each` key instead of a stable track identity

**File:** `src/routes/(app)/album/[name]/+page.svelte:143`
**Issue:** `{#each tracks as track, i (i)}` keys list items by position. If the tracklist is ever replaced (different album loaded without remounting the component), Svelte reuses existing DOM nodes by position rather than by track identity. This is benign for the current navigation pattern (album page remounts when navigating artist → album → back → different album), but it is fragile: if the route is ever reused in-place for different albums, transitions and animations would apply to wrong items. Using a stable key is a correctness best-practice for `#each` blocks.

**Fix:**
```svelte
{#each tracks as track, i (`${track.artist}||${track.title}||${i}`)}
```
Including `i` as a tiebreaker handles the edge case of duplicate track entries (albums with repeated titles, bonus tracks, etc.).

### IN-02: `enrichedFor` key in album page uses space separator (`${n} ${artist}`) while `loadedFor` uses pipe (`${n}|${artist}`) — inconsistent and collision-prone

**File:** `src/routes/(app)/album/[name]/+page.svelte:96`
**Issue:** The tracklist effect keys on `${n}|${artist}` (pipe, less common in album/artist names). The enrichment effect keys on `${n} ${artist}` (space), which can collide if album name ends with a word that is also the start of the artist name: `"foo" + " " + "bar baz"` == `"foo bar" + " " + "baz"`. This causes the enrichment effect to skip a re-fetch when navigating between such albums. The impact is cosmetic (stale enrichment data shown briefly), but it contradicts the defensive race-guard pattern applied everywhere else in the codebase.

**Fix:** Use the same pipe separator for both effects:
```typescript
const key = `${n}|${artist}`;
if (n && artist && enrichedFor !== key) {
```

---

_Reviewed: 2026-06-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
