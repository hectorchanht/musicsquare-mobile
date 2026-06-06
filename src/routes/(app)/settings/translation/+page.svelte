<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Languages, Replace } from '@lucide/svelte';
	import { settings, type LyricsLang, type TranslateMode } from '$lib/stores/settings.svelte';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// `off` + language endonyms are literal; only 'Off' is chrome → resolved in the template.
	const langs: { v: LyricsLang; label: string }[] = [
		{ v: 'off', label: 'Off' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'en', label: 'English' },
		{ v: 'ja', label: '日本語' },
		{ v: 'ko', label: '한국어' }
	];
	const modes: { v: TranslateMode; key: string }[] = [
		{ v: 'below', key: 'settings.optShowBelow' },
		{ v: 'replace', key: 'settings.optReplace' }
	];

	function setLang(v: LyricsLang) { settings.lyricsLang = v; settings.save(); }
	function setNameLang(v: LyricsLang) { settings.nameLang = v; settings.save(); }
	function setMode(v: TranslateMode) { settings.translateMode = v; settings.save(); }
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupTranslation')}</h1>
</header>

<section>
	<h2><Languages size={15} /> {t('settings.lyricsTranslation')}</h2>
	<div class="chips">
		{#each langs as l (l.v)}
			<button class="chip" class:on={settings.lyricsLang === l.v} onclick={() => setLang(l.v)}>{l.v === 'off' ? t('settings.optOff') : l.label}</button>
		{/each}
	</div>
</section>

<section>
	<h2><Languages size={15} /> {t('settings.translateNames')}</h2>
	<div class="chips">
		{#each langs as l (l.v)}
			<button class="chip" class:on={settings.nameLang === l.v} onclick={() => setNameLang(l.v)}>{l.v === 'off' ? t('settings.optOff') : l.label}</button>
		{/each}
	</div>
	<p class="muted">{t('settings.translateNamesNote')}</p>
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
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg.disabled { opacity: 0.5; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
</style>
