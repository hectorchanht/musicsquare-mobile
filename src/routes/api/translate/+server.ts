// Lyrics translation proxy (NEW feature endpoint — not part of the music data layer).
// POST { lines: string[], to: LyricsLang } -> { translated: string[] }.
// Server-side calls an unofficial Google translate endpoint (no key), batches the
// lines in one request, and falls back to the originals on any failure. Same-origin
// only (the app fetches its own /api/translate), so no CORS handling needed.
import type { RequestHandler } from './$types';

const LANG_MAP: Record<string, string> = {
	'zh-Hant': 'zh-TW',
	'zh-Hans': 'zh-CN',
	en: 'en',
	ja: 'ja',
	ko: 'ko'
};

const SENTINEL = '\n';

function reply(translated: string[]): Response {
	return new Response(JSON.stringify({ translated }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' }
	});
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { lines?: unknown; to?: unknown };
	try {
		body = await request.json();
	} catch {
		return reply([]);
	}
	const lines = Array.isArray(body.lines) ? body.lines.map((x) => String(x)) : [];
	const to = typeof body.to === 'string' ? LANG_MAP[body.to] : undefined;
	if (!lines.length || !to) return reply(lines);

	const text = lines.join(SENTINEL);
	try {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return reply(lines);
		// shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
		const data = (await res.json()) as [Array<[string, string]>];
		const joined = (data?.[0] ?? []).map((seg) => seg?.[0] ?? '').join('');
		const out = joined.split(SENTINEL);
		// Only trust a clean 1:1 alignment; otherwise show the originals.
		return reply(out.length === lines.length ? out : lines);
	} catch {
		return reply(lines);
	}
};
