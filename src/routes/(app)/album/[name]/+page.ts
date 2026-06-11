// Universal load (SSR + client nav). Derives crawler-facing album OG data from the route param +
// `?artist=` query so it lands in the SSR-rendered <svelte:head> (GLN-4 / item 4). The album cover
// is resolved client-side (enrichAlbum/deezerAlbum), so the SSR cover is null and the page/layout
// falls back to the static /og.svg — crawlers still get a page-specific title + description. Plain
// strings (NOT t()) since load runs server-side where the reactive i18n lookup is unsafe.
import { buildOg } from '$lib/services/share';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
	const name = decodeURIComponent(params.name ?? '');
	const artist = url.searchParams.get('artist') ?? '';
	const og = buildOg({ title: `${name} · openmusic`, cover: null });
	og.description = artist
		? `${name} by ${artist} on openmusic — full tracklist. Fast mobile-first music streaming.`
		: `${name} on openmusic — full tracklist. Fast mobile-first music streaming.`;
	return { og };
};
