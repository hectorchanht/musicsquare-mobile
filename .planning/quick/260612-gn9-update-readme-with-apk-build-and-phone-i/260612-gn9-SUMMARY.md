---
quick_id: 260612-gn9
description: update README with APK build and phone install instructions
completed: 2026-06-12
status: complete
files_modified:
  - README.md
commits:
  - 0b33339: docs(quick-260612-gn9) document Android APK build + install
---

# Quick 260612-gn9: Android APK build & install docs — Summary

Added an **"Android APK (build & install)"** section to `README.md` documenting the verified phase-999.1 Capacitor native build pipeline, inserted between **Getting started** and **Deployment** to match the README's existing tone/structure.

## What was done

The new section covers all four required sub-parts from the plan, transcribed faithfully from the verified phase-999.1 build facts:

1. **Prerequisites** — Node 22 (nvm), pnpm, JDK 21 (`brew install openjdk@21`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21`; JDK ≤20 fails with `invalid source release: 21`), Android SDK (`ANDROID_HOME=$HOME/Library/Android/sdk`, platform 36 auto-downloads). Notes `android/local.properties` is gitignored and must never be committed.
2. **Build the APK** — `pnpm install` → `pnpm build:native` → `npx cap sync android` → `cd android && ./gradlew assembleDebug`. Output path: `android/app/build/outputs/apk/debug/app-debug.apk`.
3. **Install to a phone** — Developer options + USB debugging + RSA prompt, `adb install -r --user 0 ...` (with the Samsung Secure Folder / dual-app `--user 0` note), launch via `adb shell am start -n com.openmusic.app/.MainActivity`.
4. **Important: server must be current** — APK loads UI locally but calls `https://openmusic.lol/api/*` cross-origin; deployed app needs the current CORS hook or API calls fail. Manual deploy: `pnpm build && npx wrangler pages deploy .svelte-kit/cloudflare --project-name openmusic`.

## Verification

- `build:native` script confirmed present in `package.json` line 12 (`BUILD_TARGET=native VITE_API_BASE=https://openmusic.lol vite build`) — matches the documented build command.
- No `local.properties` content leaked into the README.
- Markdown structure matches existing README conventions (h2 section, h3 sub-headers, fenced code blocks with inline notes).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: README.md (Android APK section present)
- FOUND: commit 0b33339
