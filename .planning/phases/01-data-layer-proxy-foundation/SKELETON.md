# Walking Skeleton — MusicSquare Mobile

**Phase:** 1 (Data Layer + Proxy Foundation)
**Generated:** 2026-06-05

## Capability Proven End-to-End

A user visiting the deployed `openmusic.pages.dev/spike` can run a live keyword search that fans out through the same-origin `/api/*` metadata proxy to a real music source, tap the top result to resolve its audio URL + lyrics, and hear it play in a browser `<audio>` element streaming browser-direct from the source CDN — proving the metadata-proxy + browser-direct-audio architecture works on a real Cloudflare edge with the JOOX token hidden server-side.

> Skeleton minimum (Plan 01) lights up **Netease** end-to-end. The remaining three sources (QQ, Kuwo, JOOX) and the full `allSettled` aggregation thicken the same skeleton in Plans 01-02 / 01-03 / 01-04 without altering any architectural decision below.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 + Vite 8 at repo root (D-01) | Smooth app-like UX + first-class Cloudflare deploy; `+server.ts` gives the metadata proxy for free |
| Build / package manager | pnpm (D-03); TypeScript `~5.9` strict (D-11; NOT 6.x — stack-compat unverified) | Typed module contract the phase goal requires; pinned to dodge the TS-6 drift |
| Test runner | Vitest (SvelteKit default via `sv create`) | Fixture-backed per-adapter unit tests + proxy integration test; <30s feedback |
| Metadata transport | Same-origin SvelteKit `+server.ts` thin pass-through proxy at `/api/[source]/[...path]` (D-09) | Zero CORS by construction; one deploy artifact; client adapter normalizes upstream JSON to Track |
| Audio transport | Browser → source CDN **direct** (`<audio src>`, not CORS-gated per MDN); Worker proxies metadata only (D-07) | Preserves the geo/IP context China-centric CDNs expect; avoids Worker free-tier CPU limit; the spike confirms per-source |
| Secret handling | JOOX token in `platform.env.JOOX_TOKEN`, injected upstream server-side; `.dev.vars` local, `wrangler secret`/dashboard prod | Token absent from client bundle (DATA-02 / criterion #2); proven by build-grep |
| Source extensibility | Two-sided adapter registry: client `SourceAdapter` + server `ProxyAdapter`, both keyed by `SourceId`; `SOURCES`/`PROXIES` are the only enumerations | Adding a source = new client file + new proxy file + one import per registry; aggregation names no source (DATA-04) |
| Track identity / dedup | Canonical uid `${source}:${songid}` colon form (D-10); detail resolution keys off stable id, never list position | JOOX returns the selected track after reorder/paginate (criterion #4); fixes the position-index trap |
| Failure isolation | `Promise.allSettled` fan-out with typed `SettledSourceResult` per source | One dead source never blanks the result set (DATA-03 / criterion #1) |
| Deployment target | Cloudflare Pages/Workers project `openmusic` (D-06) on account `f1868a071996e836eae6da2b65f37929` (D-05); CI/Pages-via-Git preferred for the real-edge deploy | Edge egress IP (the spike variable) differs from dev IP; D-08 access RESOLVED |
| Directory layout | `legacy/index.html` (porting reference, out of build); `src/lib/sources/*` (client adapters + registry + types), `src/lib/services/*` (catalog + lrc), `src/lib/proxy/*` (proxy adapters + registry + http helper), `src/routes/api/[source]/[...path]/+server.ts`, `src/routes/spike/+page.svelte`, `src/app.d.ts` | Mirrors RESEARCH §Recommended Project Structure; clean extraction seam from the monolith |

## Stack Touched in Phase 1

- [x] Project scaffold — SvelteKit + Vite + adapter-cloudflare + TypeScript strict + Vitest (Plan 01 Task 1)
- [x] Routing — `/api/[source]/[...path]/+server.ts` metadata proxy + `/spike` harness route (Plan 01 Task 3)
- [x] Real data read — live keyword search through `/api/netease/search` returning canonical Track[] (Plan 01 Task 3); all 4 sources by Plan 01-04
- [x] UI interaction wired to the API — `/spike` taps a result → resolves audioUrl → plays `<audio>` browser-direct (Plan 01 Task 3 shell; full 4-source matrix Plan 01-04 Task 2)
- [x] Deployment — `openmusic` deployed to the real Cloudflare edge; egress spike run from a deployed visit (Plan 01-04 Task 3 checkpoint)

> "Real DB read/write" from the generic template maps here to **a real network read through the proxy + a real audio play** — this project is local-first with no server database (persistence is Phase 3 localStorage/IndexedDB). The skeleton's "real read" is the live source search; its "real write" analog is the audio playback proving the end-to-end transport.

## Out of Scope (Deferred to Later Slices)

- Audio engine / playback wiring, single app-scoped `<audio>` singleton, MediaSession, transport/seek/play-modes — **Phase 2** (Phase 1 only resolves URLs + runs the spike)
- Library persistence (`pikachu-music-library-v1` localStorage continuity, `idb` migration), favorites/playlists, import/export — **Phase 3**
- Any production UI (bottom nav, mini-player, now-playing overlay, lyrics view, zh/en toggle) — **Phase 4** (the `/spike` page is a throwaway/debug harness, not product UI)
- PWA / service worker / install — **Phase 5**
- Background audio / lock-screen controls / iOS device validation — **Phase 6**
- New sources (Kugou/Migu), explicit queue model, drag/swipe gestures — **Phase 7**
- Server-side response normalization for *new* sources (the existing 4 stay D-09 passthrough) — **Phase 7**
- Custom domain beyond `openmusic.pages.dev`; JOOX token rotation
- Worker audio stream-passthrough fallback — built ONLY if the spike shows a source fails browser-direct

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2:** A user (via stores) taps a track and hears it play on a single long-lived `<audio>` element that survives navigation; transport, seek, play modes, auto-advance; browser-direct streaming with graceful failure.
- **Phase 3:** Favorites + playlists persist across sessions (localStorage parity + `idb` migration path); JSON import/export.
- **Phase 4:** Mobile UI shell — bottom nav, persistent mini-player, expandable now-playing, synced lyrics, error/loading UX, responsive layout, zh/en toggle.
- **Phase 5:** Installable PWA with app-shell precache; `/api/*` + audio bypassed (network-only); offline state.
- **Phase 6:** Background audio + MediaSession lock-screen controls; real-device iOS validation.
- **Phase 7:** Kugou + Migu via the adapter registry (touching only new files — the DATA-04 abstraction acceptance test at scale); explicit Up-Next queue model; drag-to-reorder + swipe-to-change-track gestures.
