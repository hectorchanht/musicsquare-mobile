import { describe, it, expect } from 'vitest';
import { nearestChipIndex } from './chipReorder';

describe('nearestChipIndex', () => {
	const centers = [
		{ index: 0, cx: 10, cy: 10 },
		{ index: 1, cx: 50, cy: 10 },
		{ index: 2, cx: 90, cy: 10 },
		{ index: 3, cx: 10, cy: 50 } // wrapped to the next row
	];

	it('returns the index of the chip whose center is nearest the pointer', () => {
		expect(nearestChipIndex(52, 12, centers, 0)).toBe(1);
		expect(nearestChipIndex(88, 8, centers, 0)).toBe(2);
	});

	it('is wrap-aware (picks a chip on a different row when nearer in 2D)', () => {
		expect(nearestChipIndex(12, 48, centers, 0)).toBe(3);
	});

	it('falls back to fromIndex when there are no candidates', () => {
		expect(nearestChipIndex(100, 100, [], 2)).toBe(2);
	});

	it('can resolve to the same position when the pointer is over its own slot', () => {
		// self is excluded by the caller; here every candidate is far → nearest is index 0
		expect(nearestChipIndex(11, 9, centers, 3)).toBe(0);
	});
});
