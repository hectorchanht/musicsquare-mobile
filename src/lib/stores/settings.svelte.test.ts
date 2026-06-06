import { describe, it, expect } from 'vitest';
import { settings } from './settings.svelte';

// Headless runes (node project) — mirrors player.svelte.test.ts style. Under the node
// project `browser` is false, so settings.load() is a no-op and the $state initializers
// hold. We assert the D-03 default WITHOUT mutating it first.
describe('settings (D-03 defaultQuality default)', () => {
	it("defaults defaultQuality to '128' (D-03)", () => {
		expect(settings.defaultQuality).toBe('128');
	});

	it('exposes a preferredSource getter that is undefined when defaultSource is auto', () => {
		// defaultSource defaults to 'auto' → no preference
		expect(settings.preferredSource).toBeUndefined();
	});
});
