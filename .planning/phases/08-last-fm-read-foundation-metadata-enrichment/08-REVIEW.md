---
phase: 08-last-fm-read-foundation-metadata-enrichment
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/routes/api/lastfm/info/+server.ts
  - src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts
  - src/lib/services/match-key.ts
  - src/lib/services/match-key.test.ts
  - src/lib/services/lastfm.ts
  - src/lib/services/lastfm.test.ts
  - src/lib/sources/types.ts
  - src/lib/components/TagChips.svelte
  - src/lib/components/NowPlaying.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 8 delivers the Last.fm read-only enrichment pipeline: an edge proxy (`/api/lastfm/info`), a client enrichment service (`lastfm.ts`), the `matchKey` normalization primitive, tag-chip UI, and Last.fm data integration into `NowPlaying`, the artist page, and the album page. The implementation is generally well-structured with solid test coverage and correct absent-key degradation. The `LASTFM_KEY` is kept server-side and never reaches the client bundle or response body.

Two critical issues require fixes before shipping: an unvalidated `bioUrl` used as an `href` in anchor tags (potential XSS), and a mis-placed `import type { Track }` statement in the artist page that references the type before its import declaration. Four warnings around dead code, incorrect ARIA roles, a misleading cover-swap threshold, and `AbortSignal` reuse across retries also need attention.

---

## Critical Issues

### CR-01: `bioUrl` used as `href` without protocol validation — potential XSS

**File:** `src/routes/api/lastfm/info/+server.ts:140-141` and `src/routes/(app)/artist/[name]/+page.svelte:106`

**Issue:** `pickBio` extracts an `href` value from Last.fm's HTML summary using a regex (`/<a\b[^>]*href=["']([^"']+)["']/i`) and returns it as `bioUrl` without any protocol or domain validation. The artist page then renders this directly as `href={enrich.bioUrl}` in an `<a>` tag. Svelte 5 does not sanitize `href` attribute bindings. If Last.fm's content ever includes a `javascript:` URL (malicious content, XSS in Last.fm's API, or a compromised CDN), this propagates a clickable XSS vector to every artist page.

Reproducing the concern:
```js
const raw = 'bio text <a href="javascript:alert(1)">Read more</a>';
const hrefMatch = raw.match(/<a\b[^>]*href=["']([^"']+)["']/i);
// hrefMatch[1] === "javascript:alert(1)" — returned as bioUrl
```

**Fix:** Validate the extracted URL server-side before returning it. The Last.fm attribution link is always on `last.fm`, so an `https://` prefix + `last.fm` domain check is sufficient and reliable:

```ts
// In pickBio(), after extracting hrefMatch:
const rawBioUrl = hrefMatch ? hrefMatch[1] : null;
// Only allow https://last.fm/... attribution links — reject any other protocol/domain
const bioUrl =
  rawBioUrl && /^https:\/\/([a-z0-9-]+\.)*last\.fm\//i.test(rawBioUrl)
    ? rawBioUrl
    : null;
```

This ensures that even if upstream content is unexpectedly malicious, a `javascript:`, `data:`, or off-domain URL is never forwarded to the client.

---

### CR-02: `import type { Track }` declared after its first use in artist page

**File:** `src/routes/(app)/artist/[name]/+page.svelte:18,20`

**Issue:** The `import type { Track }` statement appears on line 20, AFTER `menuTrack` is already declared with type `Track | null` on line 18. While TypeScript hoists type-only imports in `.ts` files, this pattern in a Svelte `<script lang="ts">` block is processed by the Svelte compiler before TypeScript — the Svelte compiler may process declarations in source order. This has already caused issues in some Svelte 5 compiler versions where the type is unavailable at the point of use and produces a compile error or incorrect type inference. Even when it happens to compile, it is a clear defect in import ordering that violates the TypeScript/Svelte convention.

```svelte
// lines 18-20 as written:
let menuTrack = $state<Track | null>(null);   // line 18 — uses Track
let menuOpen = $state(false);                  // line 19
import type { Track } from '$lib/sources/types'; // line 20 — declares Track
```

**Fix:** Move the `import type { Track }` statement to the top of the `<script>` block with the other imports (before any `$state` declarations):

```svelte
<script lang="ts">
  import { page } from '$app/state';
  // ... other imports ...
  import type { Track } from '$lib/sources/types'; // move here, before any usage
  import { enrichArtist, type EnrichResult } from '$lib/services/lastfm';

  let menuTrack = $state<Track | null>(null);
  let menuOpen = $state(false);
  // ...
```

---

## Warnings

### WR-01: `matchKey` imported but result is immediately voided — drift guard is unimplemented dead code

**File:** `src/lib/services/lastfm.ts:17,74-75`

**Issue:** `matchKey` is imported from `match-key.ts` and called in `enrichTrack` to compute `wanted`, but the result is immediately discarded via `void wanted`. The comment says the drift guard is "best-effort" but the implementation is a no-op stub: no comparison with the returned Last.fm data is ever performed, no candidate is ever discarded. The import increases bundle size and creates a false sense of security in code review (the comment suggests the guard exists when it does not). Any drift from Last.fm autocorrect (e.g., getting Jay-Z data back when searching "周杰伦") will silently pollute the UI.

```ts
// lastfm.ts lines 74-75:
const wanted = matchKey(track.artist, track.title);
void wanted; // ← entire drift guard is this: compute and discard
```

**Fix:** Either implement the drift guard now, or remove the dead import and comment to make it clear this is unimplemented until Phase 13. If deferring:

```ts
// Remove the import:
// import { matchKey } from '$lib/services/match-key';

// Remove lines 74-75 entirely — Phase 13 will add the real guard
```

If implementing now (preferred for correctness):
```ts
const wanted = matchKey(track.artist, track.title);
const returned = matchKey(
  data.artist?.name ?? track.artist,
  data.track?.name ?? track.title
);
if (returned !== wanted) {
  // Last.fm autocorrected to a different track — discard tags/art from this call
  return { ...EMPTY };
}
```

---

### WR-02: ARIA role hierarchy is invalid when `onTagClick` is provided in `TagChips`

**File:** `src/lib/components/TagChips.svelte:21-29`

**Issue:** The container `<div>` has `role="list"`. When `onTagClick` is provided, each chip renders as a `<button>`. The combination `role="list"` with `<button>` children violates the ARIA specification — the only allowed children of `role="list"` are elements with `role="listitem"`. Screen readers will either ignore the list role or misreport the structure. The interactive `<button>` variant lacks a `role="listitem"` wrapper, so it also loses the list-item semantic.

```svelte
<!-- Current (broken for interactive variant) -->
<div class="chips" role="list" aria-label={t('nowplaying.lastfmTags')}>
  {#if onTagClick}
    <button class="chip" ...>{tag}</button>  <!-- NOT role="listitem" — invalid -->
  {:else}
    <span class="chip" role="listitem" ...>{tag}</span>
  {/if}
</div>
```

**Fix:** Wrap `<button>` chips in a `<li role="listitem">`, consistent with the non-interactive path:

```svelte
<ul class="chips" aria-label={t('nowplaying.lastfmTags')}>
  {#each shown as tag (tag)}
    <li>
      {#if onTagClick}
        <button class="chip" type="button" aria-label={tag} onclick={() => onTagClick?.(tag)}>{tag}</button>
      {:else}
        <span class="chip">{tag}</span>
      {/if}
    </li>
  {/each}
</ul>
```

Or keep `<div role="list">` with explicit `<span role="listitem">` wrappers around the buttons.

---

### WR-03: Cover-swap `hiRes` threshold (`naturalWidth >= 300`) allows same-size or lower-resolution swaps

**File:** `src/lib/components/NowPlaying.svelte:147`

**Issue:** The comment says "strictly larger" but the guard `img.naturalWidth >= 300` allows swapping a source cover of (for example) 400×400 for a Last.fm `extralarge` image of exactly 300×300. Chinese music source APIs (Netease, QQ) often provide 500×500 or 640×640 covers; swapping one of those for Last.fm's 300×300 constitutes a quality regression contrary to the stated D-04 intent of "never downgrade a good source cover."

```ts
// NowPlaying.svelte line 147:
const hiRes = img.naturalWidth >= 300; // "strictly larger" claim in comment — incorrect
if (sourceMissing || hiRes) swappedCover = art;
```

**Fix:** The swap should only happen when the source cover is missing OR the Last.fm image is strictly larger than the source cover's known dimensions. Since `naturalWidth` of the source cover is not available at this point, a conservative approach is to require the Last.fm image to be meaningfully larger (e.g., ≥ 500px) before swapping, or only swap when source cover is absent:

```ts
// Conservative: only swap when source is absent (safest for D-04 correctness)
if (sourceMissing) swappedCover = art;

// OR: more permissive but requiring a genuinely hi-res candidate
const hiRes = img.naturalWidth >= 500;
if (sourceMissing || hiRes) swappedCover = art;
```

---

### WR-04: `AbortSignal.timeout(8000)` is shared across all retry attempts — retries on timeout are no-ops

**File:** `src/routes/api/lastfm/info/+server.ts:194` (consuming `fetchWithRetry`)

**Issue:** `AbortSignal.timeout(8000)` creates a single signal object that is passed via `init` to every retry attempt inside `fetchWithRetry`. Once the first attempt times out and the signal fires as aborted, every subsequent retry attempt with the same signal rejects immediately (fetch with an already-aborted signal throws synchronously). The backoff delays add latency without any benefit. The effective behavior is: if the upstream times out once, the caller gets the `AbortError` after `8000ms + backoff(0) + ~0ms + backoff(1) + ~0ms`, not after `3 × 8000ms`. While this does not cause incorrect behavior (the error is caught and EMPTY is returned), the retry budget is misleadingly described and provides no resilience against transient Last.fm timeouts.

**Fix:** Either pass `AbortSignal.timeout` per-attempt inside `fetchWithRetry`, or document that the shared signal makes retries no-ops for the timeout case. The simplest correct fix for the endpoint:

```ts
// In +server.ts, pass a per-attempt timeout by not sharing the signal across retries.
// Either: give fetchWithRetry its own per-attempt timeout logic, or
// use a total-budget signal only for network errors:
const res = await fetchWithRetry(upstream, {}, 2);
// And let fetchWithRetry's own AbortSignal handle per-attempt timeout internally.
```

Or document the known behavior in `fetchWithRetry`:

```ts
// NOTE: if init.signal is an AbortSignal.timeout(), retries are effectively no-ops
// once the signal fires. This is acceptable for the Last.fm proxy (all errors → EMPTY).
```

---

## Info

### IN-01: `firstSentences` splits on `.` in abbreviations like "Last.fm", truncating bio text

**File:** `src/routes/api/lastfm/info/+server.ts:127-133`

**Issue:** The sentence-boundary regex `[^.!?。！？]+[.!?。！？]?` splits on every `.`, including abbreviations and domain names. In practice, Last.fm's summary text ends with "Read more on Last.fm" — after HTML-stripping, this becomes a sentence fragment ending with "Last." followed by "fm." as a second fragment. With `max=3`, this results in bio text truncated to "...Read more on Last." — cosmetically incorrect. This only affects the display bio text; it does not affect the `bioUrl` attribution link.

**Fix:** For the specific Last.fm use case, pre-strip the "Read more on Last.fm" attribution suffix before running `firstSentences`, since `bioUrl` already captures the link:

```ts
function pickBio(wiki?: LfmWiki): { bio: string | null; bioUrl: string | null } {
  const raw = wiki?.summary ?? wiki?.content;
  if (!raw) return { bio: null, bioUrl: null };
  const hrefMatch = raw.match(/<a\b[^>]*href=["']([^"']+)["']/i);
  const bioUrl = /* validated url */ hrefMatch ? hrefMatch[1] : null;
  // Strip the entire <a>...</a> attribution block before further processing
  const withoutAttribution = raw.replace(/<a\b[^>]*>.*?<\/a>/gi, '');
  const stripped = stripHtml(withoutAttribution);
  const bio = stripped ? firstSentences(stripped) : null;
  return { bio: bio || null, bioUrl };
}
```

---

### IN-02: Variable `t` (translation function) is shadowed by local `const t = player.current` in two `$effect` blocks

**File:** `src/lib/components/NowPlaying.svelte:81,99`

**Issue:** The module-level `t` imported from `'$lib/i18n'` (the translation function) is shadowed inside two `$effect` closures by `const t = player.current`. While neither `$effect` body needs to call `t()` for translation, the naming collision is a maintenance trap: any future author adding a `t(...)` call inside these effects will silently call the Track object as a function and get a cryptic runtime error instead of a translation string.

**Fix:** Rename the local variable to avoid the shadow:

```ts
// Translation effect (line 81):
const cur = player.current;  // was: const t = player.current

// Related effect (line 99):
const cur = player.current;  // was: const t = player.current
```

---

### IN-03: `norm()` in `match-key.ts` has a redundant `.trim()` call

**File:** `src/lib/services/match-key.ts:28-29`

**Issue:** The `.trim()` at the end of `norm()` is unreachable dead code. The preceding `.replace(/[^\p{L}\p{N}]+/gu, '')` removes ALL non-letter and non-digit characters including spaces, hyphens, and any potential leading/trailing whitespace — by the time `.trim()` runs, there is no whitespace left to trim. This causes no incorrect behavior but clutters the function and suggests incomplete understanding of the regex chain.

**Fix:** Remove the trailing `.trim()`:

```ts
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[)）\]】]/g, ' ')
    .replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');  // trim() removed — nothing to trim after this
}
```

---

_Reviewed: 2026-06-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
