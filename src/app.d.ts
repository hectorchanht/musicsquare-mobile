// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces.
//
// App.Platform.env is the Cloudflare-adapter runtime path for bindings/secrets
// (svelte.dev/docs/kit/adapter-cloudflare). The JOOX token lives ONLY here —
// it is injected into the upstream URL on the edge and never reaches the client
// bundle (Phase 1 success criterion #2 / threat T-01-04).
declare global {
	namespace App {
		interface Platform {
			env: {
				JOOX_TOKEN: string;
				// OPTIONAL Last.fm key for /api/similar — server-side only, never on the
				// client bundle (threat T-5ug-01, parity with JOOX_TOKEN / T-01-04).
				LASTFM_KEY?: string;
			};
			// ctx?: ExecutionContext;  // add if waitUntil() is needed for caching later
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
