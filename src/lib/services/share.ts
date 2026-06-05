// Encode a track into a base64url share token so a link can re-open + play the
// same song. The token carries a lightweight stub; ensureTrackDetails re-resolves
// the (expiring) audio URL on play, so we never embed a stale stream URL.
import type { Track } from '$lib/sources/types';

type Stub = Pick<Track, 'uid' | 'source' | 'songid' | 'title' | 'artist' | 'album' | 'cover'>;

export function encodeTrack(t: Track): string {
	const stub: Stub = {
		uid: t.uid,
		source: t.source,
		songid: t.songid,
		title: t.title,
		artist: t.artist,
		album: t.album,
		cover: t.cover
	};
	const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(stub))));
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeTrack(token: string): Track | null {
	try {
		const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
		const json = decodeURIComponent(escape(atob(b64)));
		const v = JSON.parse(json) as Stub;
		if (!v.uid || !v.source) return null;
		return {
			...v,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: v.title,
			displayIndex: 1
		};
	} catch {
		return null;
	}
}

export function shareUrl(t: Track): string {
	const base = typeof location !== 'undefined' ? location.origin : '';
	return `${base}/?play=${encodeTrack(t)}`;
}
