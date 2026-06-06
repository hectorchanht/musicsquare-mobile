# SECURITY.md — Phase 8: Last.fm Read Foundation + Metadata Enrichment

**Audit date:** 2026-06-06
**Audit type:** First audit (State B — no prior SECURITY.md)
**ASVS Level:** 2
**block_on:** high
**Register authored at plan time:** yes (verify-existing mode — no new-threat scan)
**Result:** SECURED — 15/15 threats CLOSED, 0 OPEN

Implementation files are READ-ONLY for this audit; none were modified. Only this SECURITY.md was created.

---

## Trust Boundaries (Phase 8)

| Boundary | Description |
|----------|-------------|
| client → edge (`/api/lastfm/info`) | Untrusted client params (method/artist/track/album) cross here; `LASTFM_KEY` lives only on the edge |
| edge → Last.fm (`ws.audioscrobbler.com`) | `LASTFM_KEY` injected into the upstream URL on the edge; response reshaped + URL-validated before returning |
| client bundle / network responses | `LASTFM_KEY` must never appear in any client-facing artifact (body, header, log, bundle) |
| rendered bio HTML / attribution link | Last.fm bio is HTML-stripped server-side; bioUrl is https/last.fm-validated server-side; rendered as Svelte text + `rel="noopener noreferrer"` link |
| Last.fm image URL | Cover/hero URL is host+scheme+CSS-char validated on the edge before becoming a CSS `background-image` |

---

## Threat Verification (15/15 CLOSED)

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-08-01 | Information Disclosure (LASTFM_KEY leak) | mitigate | CLOSED | `+server.ts:248` key read via `platform?.env`; `:265` `api_key=encodeURIComponent(key)` injected edge-side only; `:272` comment "NEVER log the key"; no `console.*` in file. No-leak test `lastfm-info-endpoint.test.ts:85-92` asserts FAKE_KEY in captured upstream URL but absent from body AND `[...res.headers.entries()]`, with `周杰伦` encoded (`:87`). Test passes. |
| T-08-02 | Denial of Service (absent-key availability) | mitigate | CLOSED | `+server.ts:252` `if (!key) return jsonInfo(EMPTY, origin)` — 200, no throw, no fetch. Absent-key test `lastfm-info-endpoint.test.ts:102-126` asserts 200 all-empty shape, `fetchSpy` NOT called, and no `api_key=undefined`. Test passes. |
| T-08-03 | Tampering / Injection (params → upstream) | mitigate | CLOSED | `+server.ts:25` `ALLOWED_METHODS` allow-list; `:255` out-of-list method → empty shape, no fetch; `:267-269` every client param `encodeURIComponent`'d passthrough. Allow-list test `lastfm-info-endpoint.test.ts:166-179` (`user.getlovedtracks` → empty, no fetch). Test passes. |
| T-08-04 | DoS-of-UX (playback critical path) | mitigate | CLOSED | `+server.ts:273` `fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2)`; `http.ts:48-74` bounded retry on the caller-supplied native timeout signal. Client `lastfm.ts:75-103` `enrichTrack` wrapped in try/catch → all-empty, never throws. Consumer `NowPlaying.svelte:188` `void enrichTrack(cur)` — void-fired, never awaited before audio. |
| T-08-05 | Spoofing (CORS relay) | mitigate | CLOSED | `+server.ts:58` GET responses use `corsHeaders(origin)`; `:288` OPTIONS → 204 with `corsHeaders(...)`. `http.ts:26-36` corsHeaders never emits `*` — only echoes an allow-listed origin (`ALLOWED_ORIGIN_PATTERNS`, `:10-15`). OPTIONS test `lastfm-info-endpoint.test.ts:393-405` asserts 204 + scoped origin + never `*`. Test passes. |
| T-08-06 | Information Disclosure (placeholder art UX regression) | mitigate | CLOSED | `+server.ts:22` `GREY_STAR_HASH`; `:133` `pickImage` skips any `#text` containing the hash, `:130-131` skips empty. Consumer keeps source cover when `lastfmArt` null: `NowPlaying.svelte:231` `effectiveCover = swappedCover ?? player.current?.cover ?? null`. Placeholder test `lastfm-info-endpoint.test.ts:181-209` asserts grey-star → `image: null`. Test passes. |
| T-08-07 | Information Disclosure (enrichArtist → endpoint) | mitigate | CLOSED | Inherits T-08-01. Client `lastfm.ts:122-128` `enrichArtist` calls `fetchInfo` → `/api/lastfm/info` only; never references `platform` (asserted by module invariant `lastfm.ts:8`, grep confirms no `platform.env` reference). |
| T-08-08 | Tampering (XSS via bio HTML) | mitigate | CLOSED | Bio HTML-stripped server-side `+server.ts:156-161` (`stripHtml`) → `:200-201`. Rendered as Svelte text interpolation `artist/[name]/+page.svelte:121` `{enrich.bio}` — grep confirms ZERO `{@html}` in any Phase-8 consumer. Hardening beyond plan: bioUrl is https/last.fm-validated edge-side (`+server.ts:180-191` `safeLastfmUrl`), tested against `javascript:`/`data:`/off-domain/`http:` (`lastfm-info-endpoint.test.ts:248-280`). Tests pass. |
| T-08-09 | Spoofing (reverse-tabnabbing) | mitigate | CLOSED | `artist/[name]/+page.svelte:122` attribution `<a href={enrich.bioUrl} target="_blank" rel="noopener noreferrer">`. Bio block gated on `bio && bioUrl` (`:118`) so attribution is never orphaned. |
| T-08-10 | DoS-of-UX (enrichArtist load) | mitigate | CLOSED | `artist/[name]/+page.svelte:79-88` SEPARATE `$effect` keyed on `name` with own `enrichedFor` guard, `void enrichArtist(n)` never awaited; the existing `searchAll` effect (`:64-75`) is untouched. `enrichArtist` never throws (`lastfm.ts:122-128`). |
| T-08-11 | Information Disclosure (hero image UX regression) | mitigate | CLOSED | `artist/[name]/+page.svelte:62` `heroImg = $derived(enrich?.lastfmArt ?? hero)` — falls back to derived cover when `lastfmArt` null; placeholder already filtered upstream (T-08-06). |
| T-08-12 | Information Disclosure (enrichAlbum → endpoint) | mitigate | CLOSED | Inherits T-08-01. Client `lastfm.ts:131-137` `enrichAlbum` → `/api/lastfm/info` only; client service never references `platform` (grep confirmed). |
| T-08-13 | DoS-of-UX (enrichAlbum load) | mitigate | CLOSED | `album/[name]/+page.svelte:92-103` SEPARATE `$effect` keyed on `name`+`albumArtist`, gated on non-empty artist, `void enrichAlbum(...)` never awaited; tracklist load effect (`:63-88`) is separate. `enrichAlbum` never throws (`lastfm.ts:131-137`). |
| T-08-14 | Information Disclosure (album cover UX regression) | mitigate | CLOSED | `album/[name]/+page.svelte:46` `heroImg = $derived(enrich?.lastfmArt ?? null)` over upstream-placeholder-filtered art; listeners/playcount line gated on presence (`:126`). No regression: stubs carry no source cover, so a null candidate yields the synthetic gradient, never a placeholder. |
| T-08-SC | Tampering (supply chain / npm installs) | accept | CLOSED | Accept basis verified: per-commit `git diff-tree` over ALL 7 Phase-8 commits (288b0e0, 49cb11a, 5864394, d663dec, 537b696, 7bafea9, d4930de) shows 0 changes to `package.json` / `pnpm-lock.yaml`. Enrichment reuses native `fetch` + existing `http.ts`. SUMMARY `tech-stack.added: []` in all 3 plans. No new dependency → no legitimacy checkpoint required. Logged as accepted (no-new-deps) below. |

---

## Accepted Risks Log

| ID | Risk | Disposition | Basis | Verified |
|----|------|-------------|-------|----------|
| T-08-SC | Supply-chain tampering via new npm packages | accept | No new packages installed this phase — enrichment reuses native `fetch` + existing `src/lib/proxy/http.ts`. | Per-commit manifest diff over all 7 Phase-8 commits = 0 changes; SUMMARY `tech-stack.added: []` (all 3 plans). |

---

## Unregistered Flags

None. All three plan SUMMARYs (`08-01`, `08-02`, `08-03`) declare `## Threat Flags: None`, and every new attack surface (the `/api/lastfm/info` endpoint, the three enrichment fetches, the bio/cover render surfaces) maps to a registered threat ID (T-08-01..14, T-08-SC). No new surface appeared during implementation without a threat mapping.

### Note on out-of-phase code (informational, not a flag)

`src/lib/services/lastfm.ts` additionally contains Phase-9 discovery builders (`getChartTopTracks`, `getTagTopTracks`, `getGeoTopTracks`, `getArtistTopAlbums`, `getAlbumTracklist`) and `+server.ts`/its test cover a Phase-9 album-tracklist field + a CR-01 image-URL validator. These are NOT part of the Phase-8 threat register and are flagged here only for the Phase-9 audit. They do not weaken any Phase-8 mitigation (they reuse the same edge-only key, allow-list, and URL-validation posture); the CR-01 `safeImageUrl`/`safeLastfmUrl` validators are net-positive hardening over the Phase-8 plan.

---

## Verification Method Summary

- **mitigate (14 threats):** grep + line-level read of cited implementation files, cross-checked against the actual `pnpm test` run (52/52 Phase-8 tests pass, including no-leak, absent-key, allow-list, placeholder, CORS, and bioUrl-XSS assertions).
- **accept (1 threat, T-08-SC):** per-commit `git diff-tree` over all 7 Phase-8 commits confirming zero dependency-manifest changes; logged in Accepted Risks Log above.

**Executable proof:** `pnpm test lastfm-info-endpoint match-key lastfm` → 4 files, 52 tests, all passing.
