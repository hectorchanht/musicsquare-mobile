// Netease client adapter — real port (Task 3) of searchNetease (legacy:1986-2038) +
// fetchNeteaseDetails (legacy:2268-2308).
//
// Differences from the monolith (intentional):
//   - calls the SAME-ORIGIN proxy /api/netease/... instead of api.qijieya.cn directly
//     (token-free for Netease, but uniform with the proxy boundary for all sources)
//   - emits the canonical COLON-form uid `netease:<songid>` (D-10), not the hyphen form
//   - pickQueryParam drops `new URL(rawUrl, window.location.href)` — no `window`
//     server-side; uses an absolute-or-regex parse instead
//   - on contract drift (non-array body) it THROWS so catalog's Promise.allSettled
//     records a typed per-source error, instead of the monolith's swallow-and-return-0
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';

// Netease search row shape from the Meting proxy (fields we read).
interface NeteaseSearchItem {
	name?: string;
	artist?: string;
	url?: string; // audio URL — carries the songid as ?id=
	pic?: string; // cover
	lrc?: string; // lyric URL
}

/** Extract a query param from a (possibly relative) URL string without `window`. */
function pickQueryParam(rawUrl: string | undefined | null, key: string): string {
	if (!rawUrl) return '';
	try {
		// Absolute URLs parse directly; relative ones get a dummy base so URL() works
		// server-side (the monolith used window.location.href here — unavailable in SSR).
		return new URL(rawUrl, 'https://x.invalid/').searchParams.get(key) || '';
	} catch {
		const m = String(rawUrl).match(new RegExp('[?&]' + key + '=([^&]+)'));
		return m ? decodeURIComponent(m[1]) : '';
	}
}

export const netease: SourceAdapter = {
	id: 'netease',
	label: '网易云音乐',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Pagination by limit-multiplication, not a real page param (preserve legacy:1987).
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		const url = `/api/netease/search?id=${encodeURIComponent(keyword)}&limit=${encodeURIComponent(
			requestLimit
		)}`;

		const res = await fetch(url, { signal });
		const json: unknown = await res.json();
		// Contract-drift guard: Netease must return an array. Throw (not return 0) so the
		// fan-out records a typed per-source error.
		if (!Array.isArray(json)) {
			throw new Error('netease: contract-drift (expected array search body)');
		}

		const tracks: Track[] = [];
		(json as NeteaseSearchItem[]).forEach((it, idx) => {
			const songId = pickQueryParam(it.url, 'id') || `${keyword}-${idx + 1}`;
			tracks.push({
				uid: makeUid('netease', songId),
				source: 'netease',
				songid: songId,
				title: it.name || '',
				artist: it.artist || '',
				album: '',
				cover: it.pic || null,
				audioUrl: it.url || null, // Netease returns the audio URL at search time
				lrc: null,
				lrcUrl: it.lrc || null, // and the lyric URL
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// Build type=url / type=lrc proxy URLs only when the cached track lacks them
		// (ports legacy:2269-2276).
		if (track.songid) {
			if (!track.audioUrl) {
				track.audioUrl = `/api/netease/url?id=${encodeURIComponent(track.songid)}`;
			}
			if (!track.lrcUrl) {
				track.lrcUrl = `/api/netease/lrc?id=${encodeURIComponent(track.songid)}`;
			}
		}

		if (track.audioUrl) {
			const q = inferQualityFromUrl(track.audioUrl);
			track.quality = q.tag;
			track.qualityLabel = q.label;
		}

		// Fetch + content-type-sniff the LRC (json-wrapped vs plain text) — legacy:2284-2304.
		if (!track.lrc && track.lrcUrl) {
			try {
				const lr = await fetch(track.lrcUrl, { signal });
				const contentType = (lr.headers.get('content-type') || '').toLowerCase();
				if (contentType.includes('json')) {
					const lj: unknown = await lr.json();
					track.lrc = extractLrcFromJson(lj) ?? track.lrc ?? null;
				} else {
					track.lrc = await lr.text();
				}
			} catch {
				// Lyric fetch is best-effort; audio still plays without it (legacy logs + continues).
			}
		}

		track.detailsLoaded = true;
		return track;
	}
};

/** Mirror the monolith's lenient LRC extraction from a JSON-wrapped lyric response. */
function extractLrcFromJson(lj: unknown): string | null {
	if (typeof lj === 'string') return lj;
	if (lj && typeof lj === 'object') {
		const o = lj as Record<string, unknown>;
		const data = o.data as Record<string, unknown> | string | undefined;
		return (
			(typeof o.lrc === 'string' ? o.lrc : null) ||
			(typeof o.lyric === 'string' ? o.lyric : null) ||
			(data && typeof data === 'object' && typeof data.lrc === 'string' ? data.lrc : null) ||
			(data && typeof data === 'object' && typeof data.lyric === 'string' ? data.lyric : null) ||
			(typeof data === 'string' ? data : null)
		);
	}
	return null;
}
