import { describe, it, expect } from 'vitest';
import { isOverflowing } from './marquee';

// marquee is an overflow-detecting, reduced-motion-aware bounce Svelte action
// (quick-260606-rvy FIX-C). Only the pure overflow predicate is unit-tested here (the
// ResizeObserver / matchMedia DOM wiring is exercised manually). isOverflowing decides
// whether a label's text is wider than its clipping box (→ marquee-bounce) or fits
// (→ static ellipsis). Node-runnable, mirroring velocity.test.ts.
describe('isOverflowing — label overflow detection (FIX-C)', () => {
	it('content wider than the box overflows → marquee', () => {
		expect(isOverflowing(100, 80)).toBe(true);
	});

	it('content narrower than the box fits → static ellipsis', () => {
		expect(isOverflowing(80, 100)).toBe(false);
	});

	it('content exactly equal to the box fits (no marquee for an exact fit)', () => {
		expect(isOverflowing(80, 80)).toBe(false);
	});
});
