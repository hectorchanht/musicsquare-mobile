// Server-side proxy-adapter contract (Phase 1, DATA-02 / D-09).
//
// A ProxyAdapter runs on the Cloudflare edge inside the /api/[source]/[...path]
// route. Its ONLY job (thin passthrough, D-09) is to turn an incoming /api request
// into the real upstream URL — injecting the JOOX secret from `env` where needed.
// The client SourceAdapter does all normalization.

import type { SourceId } from '../sources/types';

/** Server-only environment bindings (Cloudflare `platform.env`). Never reaches the client bundle. */
export interface Env {
	JOOX_TOKEN: string;
	// OPTIONAL Last.fm key for /api/similar (artist.getSimilar). Server-side only —
	// injected into the upstream URL on the edge, never echoed to the client
	// (threat parity with JOOX_TOKEN / T-01-04, T-5ug-01). Absent key is a SUPPORTED
	// state: /api/similar returns { artists: [] } so the service falls back to same-artist.
	LASTFM_KEY?: string;
	// OPTIONAL Last.fm shared secret for SIGNED calls (auth.getSession, track.love,
	// track.scrobble). Used ONLY to compute the md5 api_sig on the edge — never echoed
	// to the client (same threat class as LASTFM_KEY / JOOX_TOKEN). Absent = auth/scrobble
	// endpoints unavailable; read-only Last.fm features still work.
	LASTFM_SECRET?: string;
}

export interface ProxyAdapter {
	id: SourceId;
	/**
	 * Build the real upstream URL from the incoming proxy path + query.
	 * `env` is `platform?.env` and may be undefined outside the CF runtime;
	 * only the JOOX adapter reads it (to inject the token).
	 */
	buildUrl(path: string, searchParams: URLSearchParams, env: Env | undefined): string;
}
