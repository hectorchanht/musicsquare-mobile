import { describe, it, expect } from 'vitest';
import { shouldSuppressClickAfterLongpress } from './longpress';

// longpress is a hold-to-fire Svelte action (quick-260606-tmh). After the ~450ms hold it
// dispatches a `longpress` CustomEvent, but the OS still emits a trailing native `click` once
// the finger lifts — and at every call site that click runs an `onclick` that starts playback,
// so the menu opens AND a song plays (it looks like "the menu didn't open"). The fix arms a
// one-shot capture-phase click suppressor when the longpress fires. Only the pure decision
// helper is unit-tested here (the DOM capture-phase flow is verified manually — the node vitest
// project has no jsdom). Mirrors dragScroll.test.ts's shouldSuppressClick style.
describe('shouldSuppressClickAfterLongpress — longpress-fired vs short-tap (quick-260606-tmh)', () => {
	it('a fired longpress suppresses the trailing click (so play does not also fire)', () => {
		expect(shouldSuppressClickAfterLongpress(true)).toBe(true);
	});

	it('a short tap (no longpress) lets the click through (tap-to-play preserved)', () => {
		expect(shouldSuppressClickAfterLongpress(false)).toBe(false);
	});
});
