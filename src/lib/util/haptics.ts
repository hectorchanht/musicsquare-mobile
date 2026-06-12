// Commit-tier haptic feedback (D-17). A leaf util — zero imports, no DOM beyond the optional
// `navigator.vibrate`, SSR-safe and exception-safe. iOS Safari has no `navigator.vibrate`, so the
// call is optional-chained AND wrapped in try/catch: tick() must NEVER throw and must no-op
// silently where unsupported. 15ms is the locked commit-tier duration (D-17).

/** Fire a ~15ms commit-tier vibrate where supported; no-op (never throws) where it is not. */
export function tick(): void {
	try {
		navigator.vibrate?.(15);
	} catch {
		/* unsupported / blocked — silently no-op (iOS Safari, denied permission) */
	}
}
