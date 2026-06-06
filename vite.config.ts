import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Includes `*.svelte.test.ts` too: the sveltekit Vite plugin transforms `$state`
					// runes for node, and the player store's runes-backed logic (playStub dedupe +
					// generation guard, FIX-A) is pure enough to unit-test headless here. No jsdom
					// client project exists, so a `.svelte.test.ts` must run under this node project.
					include: ['src/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
