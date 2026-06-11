import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiUrl, apiFetch } from './api-base';
import { netease } from '../sources/netease';
import type { Track } from '../sources/types';

// api-base.ts (D-03) is the single fetch seam: apiUrl() prefixes own-origin /api/* paths with
// VITE_API_BASE (empty on web → same-origin relative; the deployed Pages origin on native).
// These tests pin the two apiUrl branches, the single-fetch apiFetch funnel, and — the
// Pitfall-3 correctness proof — that a resolved Netease track.audioUrl is ABSOLUTE when a base
// is set (the URL is consumed directly by <audio>.src, so a relative URL would 404 in the APK).
// All node-runnable via vi.stubEnv / vi.stubGlobal — NO live network.

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('apiUrl — VITE_API_BASE branch', () => {
	it('returns the path unchanged when VITE_API_BASE is unset/empty (web: same-origin relative)', () => {
		vi.stubEnv('VITE_API_BASE', '');
		expect(apiUrl('/api/x')).toBe('/api/x');
	});

	it('prepends the base when VITE_API_BASE is set (native: absolute cross-origin)', () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		expect(apiUrl('/api/x')).toBe('https://base.example/api/x');
	});
});

describe('apiFetch — single fetch funnel through apiUrl', () => {
	it('calls global fetch exactly once with the apiUrl()-prefixed URL and the passed init', async () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		const spy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', spy);

		const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' } };
		await apiFetch('/api/x', init);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('https://base.example/api/x');
		expect(spy.mock.calls[0][1]).toBe(init);
	});

	it('uses the same-origin relative URL when the base is empty', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		const spy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', spy);

		await apiFetch('/api/x');

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('/api/x');
	});
});

describe('Pitfall 3 — Netease audio/lrc URL is absolute when a base is set', () => {
	function stubTrack(): Track {
		return {
			uid: 'netease:509781655',
			source: 'netease',
			songid: '509781655',
			title: '想你就写信',
			artist: '周杰伦',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1
		};
	}

	it('resolves track.audioUrl/lrcUrl to absolute https://base.example/api/... URLs', async () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		// LRC fetch is best-effort; stub a plain-text body so resolve() completes.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('[00:01.00]line one', {
						status: 200,
						headers: { 'content-type': 'text/plain' }
					})
			)
		);

		const out = await netease.resolve(stubTrack(), new AbortController().signal);

		expect(out.audioUrl).toBe('https://base.example/api/netease/url?id=509781655');
		expect(out.lrcUrl).toBe('https://base.example/api/netease/lrc?id=509781655');
		expect(out.audioUrl!.startsWith('https://base.example')).toBe(true);
	});
});
