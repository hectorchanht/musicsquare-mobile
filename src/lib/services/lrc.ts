// Pure lyric + quality utilities ported VERBATIM from the monolith (DATA-01).
//   parseLRC          ← legacy/index.html:2517-2533
//   inferQualityFromUrl ← legacy/index.html:1747-1758
// The legacy neteaseQualityToTag / kuwoQualityToTag helpers are intentionally NOT
// ported (marked 暂时保留不再使用 / "kept but unused" in the monolith).

export interface LyricLine {
	time: number;
	text: string;
}

export interface QualityInfo {
	tag: string | null;
	label: string;
}

/**
 * Parse `[mm:ss.xxx]` LRC text into a time-sorted `{time,text}[]` (seconds).
 * Blank lines and lines with no timestamp are dropped. Ported verbatim from
 * legacy/index.html:2517-2533.
 */
export function parseLRC(txt: string): LyricLine[] {
	if (!txt) return [];
	const lines = txt.split(/\r?\n/);
	const reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/;
	const out: LyricLine[] = [];
	for (const line of lines) {
		const m = reg.exec(line);
		if (!m) continue;
		const min = parseInt(m[1], 10) || 0;
		const sec = parseInt(m[2], 10) || 0;
		const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
		const time = min * 60 + sec + ms / 1000;
		const text = line.replace(reg, '').trim();
		if (text) out.push({ time, text });
	}
	out.sort((a, b) => a.time - b.time);
	return out;
}

/**
 * Infer a quality tag/label from an audio URL's file extension. Lossless extensions
 * → LOSSLESS; everything else → 320K. Ported verbatim from legacy/index.html:1747-1758.
 */
export function inferQualityFromUrl(url: string | null): QualityInfo {
	if (!url) return { tag: null, label: '' };
	const base = url.split('?')[0].toLowerCase();
	const m = base.match(/\.([a-z0-9]+)$/);
	const ext = m ? m[1] : '';
	const losslessExts = ['flac', 'wav', 'ape', 'alac', 'aiff'];
	if (losslessExts.includes(ext)) {
		return { tag: 'lossless', label: 'LOSSLESS' };
	}
	// 其他一律当作 320K 显示 — everything else displays as 320K.
	return { tag: '320k', label: '320K' };
}
