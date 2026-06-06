# Security Audit — Phase 9: Discovery / Hot Picks Tab

**Audited:** 2026-06-06
**ASVS Level:** 2
**Block-on:** high
**Verdict:** SECURED — 15/15 threats CLOSED
**Register source:** PLAN.md `<threat_model>` blocks (09-01, 09-02, 09-03), authored at plan time.

This audit verifies that every declared mitigation in the Phase-9 threat register is present in the
implemented code. Implementation files were read-only; no implementation was modified.

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-09-01 | Information Disclosure (LASTFM_KEY) | mitigate | CLOSED | `src/routes/api/lastfm/discovery/+server.ts:221-226` key read only from `platform?.env`; `:243` injected into upstream URL; never in body/headers/logs. No-leak test `lastfm-discovery-endpoint.test.ts:82-125` (FAKE_KEY in captured upstream URL with 周杰伦, ABSENT from body + `[...res.headers.entries()]`). |
| T-09-02 | Denial of Service (absent-key) | mitigate | CLOSED | `+server.ts:226` absent `LASTFM_KEY` → `jsonList([], origin)` 200 with NO fetch. Test `:148-165` asserts `fetchSpy` NOT called and no `api_key=undefined`. |
| T-09-03 | Tampering/Injection (method + params) | mitigate | CLOSED | `+server.ts:37-43` `ALLOWED_METHODS` Set of the 5 discovery methods; `:229` out-of-list → empty list, no fetch; `:243-249` all client params `encodeURIComponent` passthrough only (no command construction). Tests `:167-180` (allow-list, no fetch), `:127-144` (non-ASCII tag encoded). |
| T-09-04 | Denial of Service (rate-limit code 29 / fan-out) | mitigate | CLOSED | `+server.ts:274` `data.error` (incl. 29) → empty list, never throws; `:271` `fetchWithRetry(..., 2)` backs off 429/5xx (`http.ts:38,57-62`); `:257-267` Cache API serves repeat browses from `caches.default` hit. Tests `:182-201` (error-29), `:388-422` (cache-hit short-circuits 2nd fetch). |
| T-09-05 | Information Disclosure (cache key) | mitigate | CLOSED | `+server.ts:255` cache key = `new Request(url.toString())` (OWN-origin discovery URL, never the secret-bearing upstream URL); `:101` `Cache-Control: public` only set on the public list response. Test `:424-445` asserts cache key contains neither `FAKE_KEY` nor `ws.audioscrobbler.com`. |
| T-09-06 | Spoofing / CORS | mitigate | CLOSED | `+server.ts:292-294` `OPTIONS` → 204 with `corsHeaders(origin)`; `http.ts:26-36` `corsHeaders` scoped to own-origin allow-list, never `*` (`:32-34` emits ACAO only for an allow-listed origin). Test `:448-459` asserts scoped ACAO, never `*`. |
| T-09-07 | Denial of Service (home shelf fan-out) | mitigate | CLOSED | `+page.svelte:196-201` tag + country fan-out via `mapWithConcurrency(_, FANOUT_CAP=4, _)` (≤4 in-flight); `discovery.ts:99-124` index-claiming worker pool caps in-flight at `cap`. Shelves cached to localStorage `+page.svelte:149-175` (instant re-open, no re-fetch); edge Cache API (T-09-04) absorbs repeats. |
| T-09-08 | Denial of Service (resolveStub on tap) | mitigate | CLOSED | `+page.svelte:272-275` resolve is per-tile-onclick (`:351,380,395`) — one tap → one resolve, never eager over a shelf. Delegates to `player.playStub` (`player.svelte.ts:314-352`) which wraps `resolveStub` in try/catch (`:328-332`, never rejects), clears `pendingTrack` + `loading` on miss (`:347-351`) and returns `null` → caller toasts. `resolveStub` (`discovery.ts:32-54`) returns null on empty/throw, never throws. |
| T-09-09 | Information Disclosure (home discovery data) | accept | CLOSED | Accept basis holds: all home discovery data is public, key-only (no user data, no `sk`). Rendered as text/`<img>` only; `LASTFM_KEY` stays edge-only (verified under T-09-01). See "Accepted Risks" below. |
| T-09-10 | Availability (absent-key / empty discovery) | mitigate | CLOSED | `+page.svelte:133-146` `hasAnyDiscovery`; `:232-256` D-06 branch runs `buildDiversePicks(PICK_COUNT)` when key absent / all shelves empty, sets `useFallback`; `:330-344` renders the fallback grid so home is never blank. |
| T-09-11 | Tampering/Injection (?artist param → getAlbumTracklist) | mitigate | CLOSED | `album/[name]/+page.svelte:24` `?artist` read via `page.url.searchParams.get('artist')`; `:77` passed to `getAlbumTracklist(n, artist)` → `lastfm.ts:249` `fetchInfo({method:'album.getinfo', album, artist})` → `:49-50` `URLSearchParams(...).toString()` then `/api/lastfm/info` (edge `encodeURIComponent` passthrough, read-only getInfo). Rendered via `names.dnTitle`/`names.dnArtist` text bindings (`:143`, Svelte auto-escape), never `innerHTML`; row art uses only the local `fallbackCover` gradient (`:142`), no user data in CSS `url()`. |
| T-09-12 | Denial of Service (album tracklist resolution) | mitigate | CLOSED | `album/[name]/+page.svelte:140` each row onclick `playStub(track)` — `:110-113` resolves ONLY the tapped stub (one tap → one resolve), never eager over the tracklist. Same `player.playStub`/`resolveStub` null-on-miss/never-throws path as T-09-08. |
| T-09-13 | Availability (absent-key / no Last.fm match) | mitigate | CLOSED | `lastfm.ts:178-187` `fetchList` and `:47-56` `fetchInfo` return `{items:[]}`/`{}` on any failure (never throw); builders `:190-251` return `[]`. Artist page `artist/[name]/+page.svelte:127` `{#if albums.length}` hides the section on `[]`; album page `:149-153` renders `openFromArtist`/`noTracks` empty states. Heros (`enrichArtist`/`enrichAlbum`) still render. |
| T-09-14 | Information Disclosure (artist/album discovery data) | accept | CLOSED | Accept basis holds: public, key-only data; rendered as text/gradient only; `LASTFM_KEY` edge-only (T-09-01). See "Accepted Risks" below. |
| T-09-SC | Tampering (supply chain) | accept | CLOSED | No new package installs across all three plans. All three SUMMARYs report `tech-stack.added: []`. Cache API + `crypto` are runtime built-ins; all imports are existing repo modules (`catalog`, `dedupe`, `picks`, `player`, `i18n`, `@lucide/svelte`). See "Accepted Risks" below. |

---

## Accepted Risks Log

| Threat ID | Accepted Risk | Basis |
|-----------|---------------|-------|
| T-09-09 | Home discovery responses (chart/tag/geo top tracks + top artists) are rendered client-side. | Data is public, key-only Last.fm data with no user data and no session key (`sk`). Rendering leaks nothing. `LASTFM_KEY` is injected and consumed edge-only (verified T-09-01); the key never reaches the client. |
| T-09-14 | Artist top-albums + album tracklist discovery data rendered client-side. | Same basis: public, key-only data; no user data; key stays edge-only. |
| T-09-SC | No supply-chain legitimacy checkpoint performed. | No new dependencies were added in any Phase-9 plan (`tech-stack.added: []` in all three SUMMARYs). Only runtime built-ins (Cloudflare Cache API) and pre-existing repo modules are used. |

---

## Threat Flags (from SUMMARY.md `## Threat Flags`)

All three Phase-9 SUMMARYs (09-01, 09-02, 09-03) explicitly report **No Threat Flags** — no new
attack surface beyond the per-plan threat models was detected at Phase-9 execution time.

**No unregistered flags against Phase 9.**

### Note on later-added surface (informational — NOT a Phase-9 gap)

During verification, the implemented files were observed to contain surface beyond the Phase-9
register: per-item `mbid` fields and Cover Art Archive `<img src>` covers (`safeImageUrl`,
`caaReleaseGroupCover`, `getCachedCover`, `backfillCovers`), an optimistic `player.playStub`
now-bar, and `dragScroll`/`marquee` actions. This was introduced by **post-phase quick tasks**
(`.planning/quick/260606-nza-*`, `260606-rvy-*`, `260606-tmh-*`) that ran AFTER the three Phase-9
plans, and each carries its OWN STRIDE threat register in its quick-PLAN (e.g. `T-nza-01`
mbid-disclosure → accept; `T-nza-02` CAA URL interpolation → mitigate via `encodeURIComponent` +
`<img src>` attribute, NOT CSS `url()`, with the edge `safeImageUrl` last.fm/fastly allow-list
deliberately not widened; `T-nza-03` no-fan-out lazy `<img>`; `rvy` backfill capped ≤3 in-flight).

This surface is therefore **registered and dispositioned in its own planning artifacts**, not
orphaned. It is out of scope for the Phase-9 register this audit covers and does not constitute an
unregistered flag against Phase 9. It is noted here only for traceability; a dedicated audit of the
quick-task registers (`T-nza-*`, `rvy`, `tmh`) should be run against those plans if not already done.

Incidentally, the implemented edge endpoint also adds a `safeImageUrl` guard (`+server.ts:137-149`,
referenced as `CR-01`) that rejects non-https / off-domain / CSS-breaking Last.fm image URLs before
they leave the edge — strictly hardening beyond the Phase-9 register (the artist page interpolates
`al.image` into CSS `background-image: url(...)` at `artist/[name]/+page.svelte:133`, and this guard
constrains that value to safe last.fm/fastly https URLs). This is additional defense-in-depth, not a
gap.

---

## Verification Method

- `mitigate` threats: located the declared mitigation pattern in the cited implementation file and
  confirmed it applies to ALL entry points (every shelf onclick, every album row, the endpoint
  GET + OPTIONS handlers). Cross-checked against the matching test assertions in
  `lastfm-discovery-endpoint.test.ts`.
- `accept` threats: confirmed the accept basis (public key-only data / no new deps) holds in the
  code and logged each in the Accepted Risks Log above.
- Threat flags: checked each SUMMARY `## Threat Flags` section — all report "No Threat Flags".

**Files audited (read-only):**
`src/routes/api/lastfm/discovery/+server.ts`, `.../lastfm-discovery-endpoint.test.ts`,
`src/lib/services/discovery.ts`, `src/lib/services/lastfm.ts`, `src/lib/proxy/http.ts`,
`src/lib/stores/player.svelte.ts`, `src/lib/services/cover-art.ts`,
`src/routes/(app)/+page.svelte`, `src/routes/(app)/artist/[name]/+page.svelte`,
`src/routes/(app)/album/[name]/+page.svelte`.
