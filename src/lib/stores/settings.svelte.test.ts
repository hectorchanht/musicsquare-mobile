import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from './settings.svelte';
import { UPNEXT_DEFAULTS } from '$lib/config/defaults';

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

// Phase 17 (QUEUE-03) — per-context up-next sourcing resolver + reset wiring.
// load() is browser-guarded (no-op under the node project), so the malformed/absent
// parse cases are exercised against the same defensive logic via resetPlayback() +
// direct field assignment (the shapes the load() guard produces).
describe('settings.effectiveUpnextMode (Phase 17 QUEUE-03)', () => {
	beforeEach(() => {
		// Restore Phase-17 fields to defaults before each case (shared singleton).
		settings.upnextMode = UPNEXT_DEFAULTS.mode;
		settings.upnextPerContext = {};
	});

	it("effectiveUpnextMode(null) returns the global default 'generated'", () => {
		expect(settings.effectiveUpnextMode(null)).toBe('generated');
	});

	it("effectiveUpnextMode('search') with no override returns 'generated'", () => {
		expect(settings.effectiveUpnextMode('search')).toBe('generated');
	});

	it("effectiveUpnextMode('liked') returns 'same-list' after a per-context override", () => {
		settings.upnextPerContext = { ...settings.upnextPerContext, liked: 'same-list' };
		expect(settings.effectiveUpnextMode('liked')).toBe('same-list');
	});

	it('a context with no perContext key falls back to the global upnextMode', () => {
		settings.upnextMode = 'same-list';
		settings.upnextPerContext = { liked: 'generated' };
		// 'album' has no override → falls back to the (mutated) global mode
		expect(settings.effectiveUpnextMode('album')).toBe('same-list');
		// 'liked' override still wins
		expect(settings.effectiveUpnextMode('liked')).toBe('generated');
	});

	it('resetPlayback() restores upnextPerContext to {} and upnextMode to generated', () => {
		settings.upnextMode = 'same-list';
		settings.upnextPerContext = { liked: 'same-list', search: 'same-list' };
		settings.resetPlayback();
		expect(settings.upnextPerContext).toEqual({});
		expect(settings.upnextMode).toBe('generated');
	});

	it('a malformed (array/non-object) perContext shape defensively resolves to {} → global', () => {
		// Mirror the load() guard outcome: a malformed value becomes {}.
		const malformed = [] as unknown;
		settings.upnextPerContext =
			malformed && typeof malformed === 'object' && !Array.isArray(malformed)
				? (malformed as Record<string, never>)
				: {};
		expect(settings.upnextPerContext).toEqual({});
		expect(settings.effectiveUpnextMode('liked')).toBe('generated');
	});

	it('an absent perContext leaves it {} (no migration needed) → global default', () => {
		// Absent on a fresh load → the $state initializer keeps {}.
		expect(settings.upnextPerContext).toEqual({});
		expect(settings.effectiveUpnextMode('downloads')).toBe('generated');
	});
});
