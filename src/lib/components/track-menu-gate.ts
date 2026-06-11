import type { Track } from '$lib/sources/types';

// track-menu-gate — the two PURE decisions behind TrackMenu's gated resolve-then-act
// (Phase 19, MENU-01 / D-01..D-03). Lifted out of the component so they are unit-testable
// under the node-only Vitest project, mirroring marquee.ts's `isOverflowing` and
// longpress.ts's `shouldSuppressClickAfterLongpress`. Both are PURE — no DOM, no `$state`.
// The reassign-for-reactivity discipline (`new Set(inFlight)` on add/delete) belongs in the
// COMPONENT (19-02), not here; these helpers only DECIDE.

/**
 * Pure helper: is a gated action (Download / Detail / Remix) ready to run on `track` right now?
 * The literal `detailsLoaded && uid && audioUrl` readiness test — mirrors the `ensureTrackDetails`
 * short-circuit at catalog.ts:186 (`track.detailsLoaded && track.audioUrl && …`). true → run
 * immediately (the action needs a resolved `audioUrl`/details and the track already has them);
 * false → resolve first (resolve-then-act). A `null` track (no menu open) is never ready.
 * Exported for unit testing in isolation.
 */
export function isGatedReady(track: Track | null): boolean {
	return !!(track && track.detailsLoaded && track.uid && track.audioUrl);
}

/**
 * Pure helper: should a fresh resolve be started for `key`, given the set of currently in-flight
 * action keys? `!inFlight.has(key)` — D-03 dedupe: a second tap while the SAME action key is
 * already resolving is a no-op, and per-action keys are independent (a Download in flight does
 * not block a Remix). Because the component clears the key in its `finally` (on resolve OR
 * failure), a cleared key resolves to true again — so a failed resolve is never a stuck spinner.
 * Exported for unit testing in isolation.
 */
export function shouldStartResolve(inFlight: Set<string>, key: string): boolean {
	return !inFlight.has(key);
}
