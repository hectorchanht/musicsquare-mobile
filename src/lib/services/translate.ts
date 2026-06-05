// Client helper for lyric translation. Calls /api/translate with in-memory +
// localStorage caching so switching tabs / re-opening a song doesn't refetch.
import { browser } from '$app/environment';

const mem = new Map<string, string[]>();

function hash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

export async function translateLines(lines: string[], to: string): Promise<string[]> {
	if (to === 'off' || !lines.length) return lines;
	const key = `openmusic:lyrics-tr:${to}:${hash(lines.join('|'))}`;
	if (mem.has(key)) return mem.get(key) as string[];
	if (browser) {
		try {
			const c = localStorage.getItem(key);
			if (c) {
				const v = JSON.parse(c) as string[];
				mem.set(key, v);
				return v;
			}
		} catch {
			/* ignore */
		}
	}
	try {
		const res = await fetch('/api/translate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lines, to })
		});
		const data = (await res.json()) as { translated?: unknown };
		const out =
			Array.isArray(data.translated) && data.translated.length === lines.length
				? data.translated.map((x) => String(x))
				: lines;
		mem.set(key, out);
		if (browser) {
			try {
				localStorage.setItem(key, JSON.stringify(out));
			} catch {
				/* quota */
			}
		}
		return out;
	} catch {
		return lines;
	}
}
