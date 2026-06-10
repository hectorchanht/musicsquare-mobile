---
phase: 17-up-next-sourcing-settings-plumbing
audited: 2026-06-11
asvs_level: default
block_on: default
threats_total: 16
threats_closed: 15
threats_open: 0
threats_accepted: 1
status: secure
register_authored_at_plan_time: true
---

# Phase 17 — Up-Next Sourcing + Settings Plumbing: Security Audit

Verification of the 16 declared threats across plans 01–04. Each `mitigate` threat
was checked by grepping/reading the cited mitigation location in the actual
implementation; `accept` was checked against the closed-union type + non-persistence
claim. Implementation files were treated as READ-ONLY.

## Verdict summary

- 15 CLOSED (14 mitigate-verified + 1 accept-verified)
- 0 OPEN. T-17-13 was found OPEN at initial audit (the declared "never long-cache a miss"
  mitigation was absent on two cache paths — WR-03/WR-04), then fixed and re-verified the
  same day via the code-review fix pass (commits `45987c0` client, `8ccf525` edge).
- 0 unregistered flags.

## Threat verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-17-01 | Tampering | mitigate | CLOSED | `settings.svelte.ts:220-227` — `upnextPerContext` object-&-not-array guard mirrors `enabledSources` (213-216), else `{}`; `upnextMode` validated `=== 'same-list' || 'generated'` else `UPNEXT_DEFAULTS.mode`. Wrapped in `try/catch` (273-275) → never throws. |
| T-17-02 | Tampering | accept | CLOSED (accepted) | `QueueContext` is a closed string union (`defaults.ts:94-103`); `setQueue(tracks, context: QueueContext = null)` (`player.svelte.ts:720`). Not in the persist serializer (`player.svelte.ts:246-253` omits `queueContext`) → reload starts `null`. Accepted-risk basis matches the register: compile-time type is the only boundary; documented here. |
| T-17-03 | DoS (memory) | mitigate | CLOSED | Queue-mutation paths `setQueue` (`player.svelte.ts:720-724`) only assign `this.queue` + `this.queueContext`; no `createObjectURL`. The 4 `URL.createObjectURL` calls (lines 342/398/970/1056) are pre-existing blob-cache in resolve/play, NOT introduced by Phase-17 queue mutation. |
| T-17-04 | DoS (UX) | mitigate | CLOSED | `swipeRemove.ts`: NO `setPointerCapture` in `down()` (64-67, with rationale comment); capture only after horizontal commit in `move()` (84-85); vertical-yields via `Math.abs(ddy) > Math.abs(ddx)` (78-81); sub-slop returns leaving the tap → `onclick` reachable (76); `pointercancel` wired to `up` (114). `touchAction='pan-y'` (47). Tested in `swipeRemove.test.ts`. |
| T-17-05 | DoS (memory) | mitigate | CLOSED | `removeFromQueue` (`player.svelte.ts:751-756`) and `clearQueue` (764-768) only mutate `this.queue` (`.filter` / `[current]`) and `Set`s (`removedUids.add`, `manualUids.delete/.clear`); no `createObjectURL`. |
| T-17-06 | Tampering (race) | mitigate | CLOSED | `removeFromQueue` re-reads `this.queue.filter(...)` (754); `clearQueue` re-reads `this.current`/`this.queue` (765); `regenerate` re-reads `this.queue.filter` at write time (1110) and is the single write path; no closed-over snapshot assigned. Fresh-play branch routes through `regenerate`/`ensureAhead` only (1079-1090). |
| T-17-07 | Tampering | mitigate | CLOSED | `color.ts:12` strict `/^#?([0-9a-f]{6})$/i` on trimmed input; no-match returns input unchanged (13, never throws); output reassembled as literal `#rrggbb` (19); consumed only via typed `r.style.setProperty('--color-primary-hover', darken(...))` (`settings.svelte.ts:343`). |
| T-17-08 | Tampering | mitigate | CLOSED | `FONT_SCALE_MIN=50` / `FONT_SCALE_MAX=200` (`settings.svelte.ts:57-58`); all five fontScale loads re-clamped via `clampInt(..., 50, 200, 100)` (230-234); `clampInt` (65-69) coerces non-finite/NaN → default 100. |
| T-17-09 | Info Disclosure | mitigate | CLOSED | `grep -v '^//' settings.svelte.ts \| grep -c 'import.*player'` = 0 — settings imports no player. `player.current` is read only in the appearance PAGE (`settings/appearance/+page.svelte` imports `{ player }`). Settings stays a leaf store. |
| T-17-10 | Tampering | mitigate | CLOSED | Both proxies reshape every field with `?? null` (artist `+server.ts:110-114`; album `+server.ts:132-142`, genres `.filter` guarded); `mergeEnrich*` (`enrich-merge.ts:86-124`) is pure and degrades null→all-empty; pages gate each stat `{#if merged.x != null}` (artist page 289-290) → section absent on null (D-14). |
| T-17-11 | Tampering (SSRF) | mitigate | CLOSED | `encodeURIComponent` on both upstream calls in BOTH routes: artist `+server.ts:100,107`; album `+server.ts:122,129`. Fixed hosts `https://api.deezer.com/...` consts (artist 20-21, album 19-20); host never user-supplied. |
| T-17-12 | Info Disclosure | mitigate | CLOSED | `grep -c api.deezer.com` in both page files = 0. Client always fetches own-origin `/api/deezer/artist` / `/album` (`deezer.ts:268,297`). `corsHeaders(origin)` + exported `OPTIONS` on both routes (artist 129-131; album 157-159). Deezer is keyless (no secret to leak). |
| T-17-13 | DoS (UX) | mitigate | CLOSED | Initially OPEN (mitigation absent on edge by-id step + client `cached()` factory). Fixed by `8ccf525` (edge: `!byIdRes.ok` and `dz?.id == null` return EMPTY with no `cache.put`/TTL, both routes) and `45987c0` (client: factories reject on failure inside `cached()`, sentinel `null` mapped via `.catch()` OUTSIDE the cache — failures never stored). Regression tests added; suite 543/543. See "Resolved threat" below. |
| T-17-14 | DoS (rate-limit) | mitigate | CLOSED | Edge long-TTL on success: `cache.put` with `max-age=86400` (artist `+server.ts:116-122`; album 144-150). Client second tier: `cached(..., TTL_ARTIST=7d, ...)` (`deezer.ts:39,267,294`). The success-path amplification dampening is present as declared. |
| T-17-SC | Tampering | mitigate | CLOSED | No `package.json` / `pnpm-lock.yaml` changes in the working tree or recent commits; new pure files (`color.ts`, `enrich-merge.ts`, `swipeRemove.ts`) import only existing internal modules. Zero new deps. |

## Resolved threat (was BLOCKER at initial audit)

### T-17-13 — Failed/empty Deezer responses were long-cached, contradicting the declared mitigation

**Disposition:** mitigate. **Declared mitigation (plan 04):** "Cache ONLY successful
reshapes with bounded TTL; a hard miss returns the empty shape WITHOUT a long TTL."

The mitigation is correctly implemented at ONE of three cache decisions but absent at two:

1. **Edge proxy by-id step — absent (WR-04, confirmed).**
   `artist/+server.ts:106-122` and `album/+server.ts:128-150` fetch the `artist/{id}` /
   `album/{id}` body but never check `byIdRes.ok` and never validate that the parsed body
   is a real entity (`dz.id != null`). Deezer signals quota/rate-limit as **HTTP 200** with
   `{"error":{...}}`; that body parses fine, every field nullish-coalesces to `null`, and the
   all-null reshape is treated as a "successful reshape" — written to the edge cache with
   `Cache-Control: public, max-age=86400`. A quota blip during a traffic spike pins an empty
   artist/album section for 24h per name. (The search-step miss guard at artist `:104` /
   album `:126` is correct and does NOT long-cache — only the by-id step is unguarded.)

2. **Client `cached()` factory — absent (WR-03, confirmed).**
   `ttl-cache.ts:27-37` caches the RESOLVED value. `deezerArtist` / `deezerAlbum`
   (`deezer.ts:267-277,294-306`) are never-throws INSIDE the factory: a non-ok response,
   6s timeout, or caller-initiated abort all `return null`, so `null` is cached under the
   7-day `TTL_ARTIST` key. A single transient failure (or a routine navigation abort) pins
   the Deezer section absent for the rest of the session — the same failure mode the route's
   own T-17-13 comment says must not be cached.

**Impact:** UX DoS — a transient upstream failure (quota 200-body, timeout, abort) is pinned
as a permanent "no Deezer info" state (24h edge / 7d client) for the affected entity. This is
exactly the harm T-17-13 is declared to prevent. Net effect is bounded to a graceful
degradation (section absent, never a crash — services never throw), so it is a UX/availability
defect, not a confidentiality/integrity breach.

**Required fix (one of):**
- Edge: after the by-id fetch, `if (!byIdRes.ok) return jsonResult(EMPTY, origin);` and
  `if (dz?.id == null) return jsonResult(EMPTY, origin);` BEFORE the `cache.put` (no `max-age`
  on the empty shape) — mirroring the existing search-step miss guard.
- Client: let the factory REJECT on non-ok/abort (`throw`) and `.catch(() => null)` OUTSIDE
  `cached()`, or run the abort/non-ok check outside the factory, so a sentinel `null` never
  reaches the cache.

This was independently captured by the code review (17-REVIEW.md WR-03 / WR-04);
the initial audit confirmed both against source.

**Resolution (2026-06-11, same day):** Both required fixes landed via the code-review fix pass:
- `8ccf525` — edge: both routes now return EMPTY (no `cache.put`, no long TTL) on `!byIdRes.ok`
  or `dz?.id == null` (catches Deezer's HTTP-200 quota-error body), mirroring the search-step
  miss guard.
- `45987c0` — client: all 7 Deezer client fns reject inside the `cached()` factory on
  non-ok/timeout/abort; the `null` sentinel is mapped via `.catch()` outside the cache, so
  failures are never stored under the 7-day TTL.
Regression tests added (3 client-cache tests); full suite 543/543 green. T-17-13 re-verified
CLOSED.

## Security Audit 2026-06-11

| Metric | Count |
|--------|-------|
| Threats found | 16 |
| Closed | 15 (incl. T-17-13 after same-day fix) |
| Accepted | 1 (T-17-02) |
| Open | 0 |

## Unregistered flags

None. No new attack surface appeared outside the threat register. (17-REVIEW.md raises
additional functional findings — CR-01 current-track-removable, WR-01 trailing-click,
WR-02 Clear-button grip, WR-05..WR-10, IN-01..IN-05 — but those are correctness/UX defects
outside the declared STRIDE register, not new trust boundaries. IN-01 narrows T-17-01:
`upnextPerContext` VALUES are not validated on load, but the declared T-17-01 mitigation only
promised the object-shape guard, which is present — so T-17-01 stays CLOSED with IN-01 noted
as hardening debt.)

## Accepted risks log

- **T-17-02 (Tampering — queueContext injected by call site):** `QueueContext` is a
  compile-time closed union; an invalid value fails svelte-check. `queueContext` is not
  persisted (omitted from the persist serializer, `player.svelte.ts:246-253`), so a reload
  resets it to `null` → global `'generated'` default. No runtime trust boundary beyond the
  type system. Accepted as documented in plan 01.
