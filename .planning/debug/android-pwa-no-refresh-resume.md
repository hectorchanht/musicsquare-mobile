---
gsd_debug_version: 1.0
slug: android-pwa-no-refresh-resume
status: resolved
trigger: "In Android, if the app is exit, go back to the app from recent app panel won't refresh the page, but if the app is open by clicking app icon, it refreshes."
created: 2026-06-11T08:05:20Z
updated: 2026-06-11T10:35:00Z
reopened: 2026-06-11T09:32:45Z
---

# Debug Session: android-pwa-no-refresh-resume

## Symptoms

- **Clarified desired behavior (user, verbatim):** "the goal is never refresh unless the app is killed by os. why should it be refreshed in your opinion? music should be a background app that plays music all the time and user can always go back to without any interruption."
  - Recent-apps warm resume → resume in place, NO refresh, NO interruption. (App ALREADY does this — leave alone.)
  - Icon launch → should ALSO resume without reloading, EXCEPT when the OS actually killed the app (a cold start then is unavoidable and acceptable).
  - Overarching goal: the player is a persistent BACKGROUND app — music keeps playing, user can always return without interruption.
- **Actual behavior:**
  - **Recent-apps panel:** page does NOT refresh — resumes prior state. (DESIRED — correct.)
  - **App icon launch:** page DOES refresh (reloads/restarts).
  - **NEW (reopen):** plain Chrome TAB never reloads on re-entry, but the INSTALLED / home-screen PWA refreshes EVERY TIME it is opened from the icon.
  - **CHECKPOINT-CONFIRMED (reopen):** the reload happens EVEN WHILE AUDIO IS ACTIVELY PLAYING, within SECONDS of backgrounding, on a Samsung (One UI) device. This invalidates the "no-playing-audio → expected aggressive reclamation" branch.
- **Environment:** Android, installed PWA (standalone WebAPK), confirmed by user. Samsung One UI. Physical device — dev env cannot reproduce the WebAPK recent-apps-vs-icon distinction.

## Likely Location

PWA lifecycle / WebAPK launch semantics / install posture:
- Web app manifest (`static/manifest.webmanifest`) — **launch_handler** (Web App Launch Handler API) controls whether an icon tap focuses the running client vs spins up a fresh client/navigates start_url (= reload). Manifest had NO `launch_handler` → default `auto`.
- WebAPK launch semantics: whether an icon tap forces a fresh navigation to `start_url` / a new client even when the activity exists.
- Background-audio behavior in the player store — confirmed robust (audio keeps playing when backgrounded). Not the cause.
- Media Session API wiring — confirmed fully populated. Not the cause.
- App self-triggered reload on re-entry — confirmed NONE.

## Hypothesis Seed

The icon-launch "refresh" is NOT a memory-pressure OS kill (audio was playing, reopened within seconds, task alive). The strongest app-controllable hypothesis is the **Web App Launch Handler**: with no `launch_handler` the default `auto` resolution lets the WebAPK open a NEW client / perform a fresh navigation to `start_url` on each icon tap instead of focusing the already-running client. `"launch_handler": { "client_mode": "focus-existing" }` (Chrome 102+) is the manifest-only lever to make an icon tap RESUME the running instance.

## Current Focus

- hypothesis (CONFIRMED by research): The icon-launch reload is the **Web App Launch Handler** default-`auto` behavior, NOT a memory-pressure kill. With no `launch_handler` member, the WebAPK is permitted to open a fresh navigation context to `start_url` on each icon tap → a full document reload. Setting `"launch_handler": { "client_mode": "focus-existing" }` makes the icon tap focus the running instance without navigating it.
- test: research the launch_handler spec + apply the manifest-only fix + re-validate JSON.
- expecting: focus-existing is the correct resume semantics for a music player; takes effect only after PWA reinstall / WebAPK re-mint; on-device confirmation owed.
- next_action: DONE — fix applied. On-device confirmation owed (Samsung physical device, reinstalled PWA). Service-worker cold-start seamlessness recommended as a routed feature.

## Evidence

- timestamp: 2026-06-11T08:12:00Z
  observation: Web app manifest uses `display: standalone`, `start_url: /`, `scope: /`. Standalone is what makes Android treat the PWA as a WebAPK with its own task — recent-apps restores the existing task (no navigation, no reload) while a fresh icon launch can cold-start `start_url`.
  source: static/manifest.webmanifest:5-7

- timestamp: 2026-06-11T08:13:00Z
  observation: NO service worker exists anywhere (src, build output, deps). Re-confirmed. Not relevant to audio continuity regardless — a SW cannot keep an `<audio>` element alive across a reload.
  source: find/grep across src, .svelte-kit, package.json (no matches)

- timestamp: 2026-06-11T08:14:00Z
  observation: NO app-level reload/revalidation: no `location.reload()`, no `invalidate`/`invalidateAll`, no `updated` store, no `kit.version.pollInterval`. The app NEVER self-triggers a reload on any lifecycle event.
  source: grep across src + svelte.config.js (no matches)

- timestamp: 2026-06-11T08:53:00Z
  observation: BACKGROUND AUDIO IS ROBUST. The ONLY `pause()` calls in player.svelte.ts are user/transport-initiated (toggle, MediaSession 'pause' handler), the sleep-timer expiry (intentional), and explicit stop/teardown. The `visibilitychange`/`freeze`/`pagehide` listeners ONLY call `flushPersist()` — they do NOT pause audio. So when the app is backgrounded or the screen locks, audio KEEPS PLAYING.
  source: src/lib/stores/player.svelte.ts:692-707 (lifecycle listeners flush only), 884-885 (pause handler), grep of all .pause() sites

- timestamp: 2026-06-11T08:56:00Z
  observation: MEDIA SESSION IS FULLY WIRED. `attach()` registers play/pause/previoustrack/nexttrack/seekbackward/seekforward/seekto handlers ONCE. Both play paths set `ms.metadata` + `ms.playbackState = 'playing'`; `timeupdate` → `setPositionState()`.
  source: src/lib/stores/player.svelte.ts:520-547, 708-745, 746-766, 877-906, 1220-1289

- timestamp: 2026-06-11T08:58:00Z
  observation: INSTALL POSTURE GAP (since addressed). Manifest originally shipped SVG-ONLY icons and no `categories`.
  source: static/manifest.webmanifest:10-13, src/app.html:7-13

- timestamp: 2026-06-11T09:00:00Z
  observation: FIX APPLIED (prior). Added `"categories": ["music", "entertainment"]` to the manifest.
  source: static/manifest.webmanifest:8 (categories added)

- timestamp: 2026-06-11T10:00:00Z
  observation: RE-INVESTIGATION (every-time lens) — manifest now has 6 icons (2 SVG + 4 PNG raster incl. maskable 192/512). PNG follow-up DONE (commit b3b7935); files exist on disk. Install posture is now strong; removes the prior "SVG-only / weak WebAPK mint" concern as the dominant lever.
  source: static/manifest.webmanifest:11-18, ls static/icons/, git log b3b7935

- timestamp: 2026-06-11T10:01:00Z
  observation: RE-VERIFIED — NO forced fresh navigation in app code. `src/app.html` has NO `<meta http-equiv="refresh">`, no cache-busting query param on start_url; only extra <head> script is a `defer` Cloudflare analytics beacon. svelte.config.js uses adapter-cloudflare with default kit config (no version.pollInterval). The icon-launch reload is NOT app-initiated and NOT a forced-navigation defect.
  source: src/app.html (full), svelte.config.js, grep across src

- timestamp: 2026-06-11T10:03:00Z
  observation: SESSION-RESTORE ALREADY EXISTS. player.svelte.ts has a full `restore()` (localStorage key `openmusic:player:v1`) called once from the root layout onMount (rebuilds currentTrack + queue + progress + shuffle/repeat on fresh load; does not autoplay — browser policy). `flushPersist()` fires on visibilitychange(hidden)/freeze/pagehide to persist the EXACT position before eviction.
  source: src/lib/stores/player.svelte.ts:243-345 (persist/restore), :686-707 (lifecycle flush), src/routes/+layout.svelte:21-25

- timestamp: 2026-06-11T10:04:00Z
  observation: SCOPE FINDING — a service worker is NOT out-of-scope feature creep. PROJECT.md already lists offline playback of downloaded tracks as a v1.2 requirement (lines 25, 70) and names "service worker" as part of "Full PWA + background audio" (line 103, Pending). A cache-first app-shell SW serves BOTH the "make cold-start seamless" goal AND the committed v1.2 offline requirement → route to /gsd:quick or a dedicated phase, not inline.
  source: .planning/PROJECT.md:25,70,103

- timestamp: 2026-06-11T10:05:00Z
  observation: NOTED (not a cause). src/routes/(app)/+layout.svelte:106-112 has a guarded onMount landing-tab redirect (fires ONCE, only when path is exactly '/', no ?play= token, configured landing tab not 'home'). Client-side route change, NOT a document reload.
  source: src/routes/(app)/+layout.svelte:98-112

- timestamp: 2026-06-11T10:15:00Z
  observation: CHECKPOINT ANSWERS COLLECTED (orchestrator). User-supplied facts (data only):
    - Audio state when it reloaded: "Playing, still reloaded" — music was ACTIVELY PLAYING and the installed PWA STILL refreshed/restarted on icon-launch.
    - Background duration before refresh: "Seconds" — reopened within seconds and it still reloaded.
    - Device: "Samsung (One UI)".
  IMPLICATION: GENUINE-INVESTIGATION branch. A live, audio-playing WebAPK reloading after only seconds is NOT a memory-pressure kill (a reclaimed task could not keep playing audio). The task was alive yet the icon tap still produced a reload → WebAPK LAUNCH SEMANTICS (launch_handler), not task reclamation.
  source: orchestrator-collected checkpoint (user responses, treated as data)

- timestamp: 2026-06-11T10:30:00Z
  observation: RESEARCH — Web App Launch Handler API (`launch_handler.client_mode`). The member controls what happens when an installed PWA is launched (icon tap / OS app-launch) while an instance may already be running. Valid `client_mode` values and their effect:
    - `auto` (DEFAULT when the member is absent) — user agent decides; on Chrome/Android WebAPK this in practice resolves toward creating a fresh navigation context (navigate-new-like), i.e. it can produce a full reload of `start_url`. THIS is the current openmusic state (no launch_handler member).
    - `navigate-new` — always creates a new client and navigates it to the launch URL (reload-like).
    - `navigate-existing` — navigates the most-recently-used existing client to the launch URL (still a start_url navigation/reload of the running page).
    - `focus-existing` — focuses the most-recently-used existing client WITHOUT navigating it; the running document is preserved and receives a `LaunchParams` via the Launch Queue. This is RESUME semantics.
  Support: shipped in Chromium-based browsers from Chrome 102+, including Android WebAPKs (which use the installed Chrome as the launch engine), so Samsung One UI WebAPKs minted via Chrome honor it. For a background music player whose goal is "icon tap resumes, never reloads," `focus-existing` is the correct, intended client_mode (we want resume, NOT deep-link navigation).
  classification: RESEARCH (spec/Chromium behavior). The real-world effect on this specific Samsung device is NEEDS-ON-DEVICE-CONFIRMATION.
  source: Web App Launch Handler API spec + Chromium/web.dev launch_handler documentation (knowledge as of 2026-01)

- timestamp: 2026-06-11T10:32:00Z
  observation: FIX APPLIED. Added `"launch_handler": { "client_mode": "focus-existing" }` to static/manifest.webmanifest (after `display`, before `categories`). JSON re-validated via `JSON.parse` (node v22.22.0) — VALID; `client_mode = focus-existing`; all 11 keys present. This is a static asset served verbatim by adapter-cloudflare — no TypeScript/build coupling, no typecheck/build change required. CAVEAT: a manifest change only takes effect after the PWA is reinstalled / the WebAPK is re-minted by the OS; the running installed instance must be removed and re-added from the home screen to pick it up. Effect can ONLY be confirmed on the physical Samsung device after reinstall.
  classification: VERIFIED-BY-STATIC-ANALYSIS (fix is in place, JSON valid) / NEEDS-ON-DEVICE-CONFIRMATION (resume-instead-of-reload behavior, post-reinstall, Samsung One UI).
  source: static/manifest.webmanifest:8 (launch_handler), node JSON.parse validation

## Eliminated

- "Add a `visibilitychange` → `invalidateAll()` refresh hook" (the PRIOR recommendation) — REVERSED and RULED OUT. The user's clarified intent is the OPPOSITE: never refresh.
- App self-triggered reload firing inconsistently — RULED OUT. No `location.reload()`/`invalidateAll()`/version-poll/`http-equiv=refresh`/start_url cache-bust anywhere.
- App pausing audio when backgrounded — RULED OUT. No pause-on-hidden code; audio keeps playing in the background.
- A bug in player/queue/Media Session wiring — RULED OUT. Media Session metadata, handlers, playbackState, and position are all correctly populated.
- Weak install posture (SVG-only icons) as the dominant lever — NO LONGER APPLICABLE. PNG 192/512 + maskable PNGs now shipped (b3b7935); WebAPK mint signal is strong.
- Memory-pressure / aggressive-OEM task reclamation as the ROOT CAUSE — RULED OUT BY CHECKPOINT. Audio was playing (task alive) and reopened within seconds, yet it still reloaded. A reclaimed task could not keep playing audio. The reload is a launch-semantics behavior, not a kill. (One UI background-app sleeping remains a secondary USER-SIDE mitigation, not the cause.)
- Service worker as an AUDIO-continuity fix — RULED OUT (a SW cannot keep `<audio>` alive across a reload). Re-scoped: a SW IS the right lever for COLD-START SEAMLESSNESS (separate goal), aligned with committed v1.2 offline scope.

## Resolution

**Root cause:** The installed-PWA "refresh every time on icon tap" is the Web App Launch Handler default behavior. With NO `launch_handler` member in the manifest, the `client_mode` defaults to `auto`, which on Chrome/Android WebAPKs permits opening a fresh navigation context to `start_url` on each icon launch — a full document reload that destroys the running `<audio>` and document. The task itself was NOT being killed (checkpoint: audio was actively playing and reopened within seconds), so this is launch-semantics, not memory-pressure reclamation. A plain Chrome tab never reloads because tab re-entry is not a PWA "launch" event at all.

**Fix applied:** Added `"launch_handler": { "client_mode": "focus-existing" }` to `static/manifest.webmanifest`. `focus-existing` focuses the already-running client WITHOUT navigating/reloading it — exactly the resume semantics a background music player needs. JSON re-validated (valid). This is a manifest-only, low-risk change.

**Important caveats:**
- The change takes effect only AFTER the PWA is reinstalled / the WebAPK is re-minted (remove from home screen, re-add). The currently-installed instance will keep the old behavior until then.
- Effect is RESEARCH-supported but NEEDS-ON-DEVICE-CONFIRMATION on the physical Samsung One UI device post-reinstall.

**Prior fixes retained (install-posture hardening, still valid):** `"categories": ["music", "entertainment"]` + PNG maskable icons 192/512 (b3b7935). They strengthen WebAPK mint / media-app classification but do NOT control launch semantics — the launch_handler is the lever for the reload symptom.

**Recommended follow-ups (route, do NOT inline here):**
- Cache-first app-shell SERVICE WORKER → makes any genuinely-unavoidable cold-start network-free and near-instant, so even a real OS kill is perceived as a fast resume (combined with the existing `restore()`). Aligns with committed v1.2 offline scope. Real feature (cache versioning, stale-shell risk, update-prompt flow) → route to `/gsd:quick` or a dedicated phase.
- USER-SIDE mitigation (document for the user): Samsung One UI aggressively sleeps/kills background apps. The user should disable battery optimization / "Put app to sleep" / "Deep sleeping apps" for openmusic to maximize task survival. Not app-controllable; secondary to the launch_handler fix.

## REOPENED — 2026-06-11T09:32:45Z (new evidence contradicted prior resolution)

- **New symptom (user, verbatim):** "if i am using the app in chrome, opening the chrome wont refresh the app, but if i install the app or add it to home screen, it will refresh itself everytime it is opened from app icon."
- **Why this reopened it:** the prior resolution claimed the icon-launch reload happens ONLY on a genuine OS kill (rare). The user reported it reloads EVERY TIME the installed/home-screen PWA is opened from the icon, while a plain Chrome tab never reloads.
- **Outcome:** Checkpoint answers (audio playing, seconds, Samsung One UI) ruled out memory-pressure reclamation and pointed at WebAPK launch semantics. Root cause corrected to the missing `launch_handler` (default `auto`); fix = `focus-existing`. See Resolution.
