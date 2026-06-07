<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Languages, Replace } from '@lucide/svelte';
	import { settings, type LyricsLang, type SourceLang, type TranslateMode } from '$lib/stores/settings.svelte';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// `off` + language endonyms are literal; only 'Off' is chrome → resolved in the template.
	const langs: { v: LyricsLang; label: string }[] = [
		{ v: 'off', label: 'Off' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'en', label: 'English' },
		{ v: 'ja', label: '日本語' },
		{ v: 'ko', label: '한국어' },
		{ v: 'es', label: 'Español' },
		{ v: 'fr', label: 'Français' },
		{ v: 'de', label: 'Deutsch' },
		{ v: 'pt', label: 'Português' },
		{ v: 'it', label: 'Italiano' },
		{ v: 'ru', label: 'Русский' },
		{ v: 'tr', label: 'Türkçe' },
		{ v: 'ar', label: 'العربية' },
		{ v: 'hi', label: 'हिन्दी' },
		{ v: 'id', label: 'Bahasa Indonesia' },
		{ v: 'vi', label: 'Tiếng Việt' },
		{ v: 'th', label: 'ไทย' }
	];
	// Source-language tags for the skip whitelist (no 'off' — endonym labels are literal).
	const sources: { v: SourceLang; label: string }[] = [
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'en', label: 'English' },
		{ v: 'ja', label: '日本語' },
		{ v: 'ko', label: '한국어' },
		{ v: 'es', label: 'Español' },
		{ v: 'fr', label: 'Français' },
		{ v: 'de', label: 'Deutsch' },
		{ v: 'pt', label: 'Português' },
		{ v: 'it', label: 'Italiano' },
		{ v: 'ru', label: 'Русский' },
		{ v: 'tr', label: 'Türkçe' },
		{ v: 'ar', label: 'العربية' },
		{ v: 'hi', label: 'हिन्दी' },
		{ v: 'id', label: 'Bahasa Indonesia' },
		{ v: 'vi', label: 'Tiếng Việt' },
		{ v: 'th', label: 'ไทย' }
	];
	const modes: { v: TranslateMode; key: string }[] = [
		{ v: 'replace', key: 'settings.optReplace' },
		{ v: 'below', key: 'settings.optShowBelow' }
	];

	type PartKey = 'artist' | 'title' | 'lyrics' | 'lastfm';
	const TARGET: Record<PartKey, () => LyricsLang> = {
		artist: () => settings.artistLang,
		title: () => settings.titleLang,
		lyrics: () => settings.lyricsLang,
		lastfm: () => settings.lastfmLang
	};
	const SKIP: Record<PartKey, () => SourceLang[]> = {
		artist: () => settings.artistSkip,
		title: () => settings.titleSkip,
		lyrics: () => settings.lyricsSkip,
		lastfm: () => settings.lastfmSkip
	};

	function setTarget(part: PartKey, v: LyricsLang) {
		if (part === 'artist') settings.artistLang = v;
		else if (part === 'title') settings.titleLang = v;
		else if (part === 'lyrics') settings.lyricsLang = v;
		else settings.lastfmLang = v;
		settings.save();
	}
	function toggleSkip(part: PartKey, v: SourceLang) {
		const cur = SKIP[part]();
		const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
		if (part === 'artist') settings.artistSkip = next;
		else if (part === 'title') settings.titleSkip = next;
		else if (part === 'lyrics') settings.lyricsSkip = next;
		else settings.lastfmSkip = next;
		settings.save();
	}
	function setMode(v: TranslateMode) { settings.translateMode = v; settings.save(); }

	// Bio info (quick-260607-f4y) is NOT a per-part picker — it auto-translates to the app
	// language, so it renders as a read-only note section below instead of in this list.
	const parts: { key: PartKey; headingKey: TranslationKey; noteKey: TranslationKey }[] = [
		{ key: 'artist', headingKey: 'settings.translateArtist', noteKey: 'settings.translateArtistNote' },
		{ key: 'title', headingKey: 'settings.translateTitle', noteKey: 'settings.translateTitleNote' },
		{ key: 'lyrics', headingKey: 'settings.lyricsTranslation', noteKey: 'settings.translateLyricsNote' }
	];
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupTranslation')}</h1>
</header>

{#each parts as part (part.key)}
	<section>
		<h2><Languages size={15} /> {t(part.headingKey)}</h2>
		<div class="chips">
			{#each langs as l (l.v)}
				<button class="chip" class:on={TARGET[part.key]() === l.v} onclick={() => setTarget(part.key, l.v)}>{l.v === 'off' ? t('settings.optOff') : l.label}</button>
			{/each}
		</div>
		<p class="muted">{t(part.noteKey)}</p>
		<div class="skip" class:disabled={TARGET[part.key]() === 'off'}>
			<p class="sublabel">{t('settings.skipLanguages')}</p>
			<div class="chips">
				{#each sources as s (s.v)}
					<button class="chip skipchip" class:on={SKIP[part.key]().includes(s.v)} disabled={TARGET[part.key]() === 'off'} onclick={() => toggleSkip(part.key, s.v)}>{s.label}</button>
				{/each}
			</div>
			<p class="muted">{t('settings.skipLanguagesNote')}</p>
		</div>
	</section>
{/each}

<section>
	<h2><Languages size={15} /> {t('settings.translateLastfm')}</h2>
	<p class="muted">{t('settings.translateLastfmNote')}</p>
</section>

<section>
	<h2><Replace size={15} /> {t('settings.translateMode')}</h2>
	<div class="seg" class:disabled={settings.lyricsLang === 'off'}>
		{#each modes as m (m.v)}
			<button class:on={settings.translateMode === m.v} disabled={settings.lyricsLang === 'off'} onclick={() => setMode(m.v)}>{t(m.key as TranslationKey)}</button>
		{/each}
	</div>
	<p class="muted">{settings.lyricsLang === 'off' ? t('settings.translateModeOffNote') : t('settings.translateModeOnNote')}</p>
</section>

<section>
	<h2><Languages size={15} /> {t('settings.appLanguage')}</h2>
	<button class="link" onclick={() => goto('/settings/general')}>{t('settings.appLanguage')} →</button>
	<p class="muted">{t('settings.groupGeneralDesc')}</p>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.chip:disabled { cursor: default; }
	.skip { margin-top: 12px; }
	.skip.disabled { opacity: 0.45; pointer-events: none; }
	.sublabel { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 8px; }
	.skipchip.on { background: var(--color-surface); color: var(--color-primary); border-color: var(--color-primary); }
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg.disabled { opacity: 0.5; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	.link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 14px; padding: 0; }
</style>
