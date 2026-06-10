// Pure colour math — no `browser` reads, no DOM, no store imports. Kept dependency-free
// and side-effect-free so settings.applyTheme() can import it without breaking leaf-store
// discipline, and so it is trivially unit-testable under the node Vitest project.

/** Darken a `#rrggbb` (leading `#` optional) hex by `amount` (0..1). Parses each channel,
 *  scales by `(1 - amount)`, clamps to 0..255 and rounds, then reassembles. Malformed input
 *  (named colours, 3-digit shorthand, empty) returns the input unchanged — never throws
 *  (T-17-07: hostile/malformed input is passed through, output is always a literal `#rrggbb`
 *  or the original string). Used by settings.applyTheme() to derive `--color-primary-hover`
 *  from the chosen accent. */
export function darken(hex: string, amount: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
	const r = f(n >> 16);
	const g = f((n >> 8) & 0xff);
	const b = f(n & 0xff);
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
