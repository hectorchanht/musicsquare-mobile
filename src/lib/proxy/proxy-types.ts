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
