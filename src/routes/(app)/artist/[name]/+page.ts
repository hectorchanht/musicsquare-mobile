// Universal load (SSR + client nav). Derives crawler-facing artist OG data from the route param so
// it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). The hi-res hero cover is resolved
// client-side (enrichArtist/deezerArtistCover), so the SSR cover is null here and the page/layout
// falls back to the static /og.svg — crawlers still get a page-specific title + description. We use
// a plain string (NOT t()) since load runs server-side where the reactive i18n lookup is unsafe.
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const name = decodeURIComponent(params.name ?? '');
	const og = buildOg({ title: `${name} · openmusic`, cover: null });
	og.description = `${name} on openmusic — hit songs, albums and similar artists. Fast mobile-first music streaming.`;
	return { og };
};
