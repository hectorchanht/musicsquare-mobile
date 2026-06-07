<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Type, LayoutGrid } from '@lucide/svelte';
	import {
		settings,
		FONT_SCALE_MIN,
		FONT_SCALE_MAX,
		COVER_SCALE_MIN,
		COVER_SCALE_MAX,
		GRID_COLS_MIN,
		GRID_COLS_MAX
	} from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';

	onMount(() => settings.load());

	// Each slider writes the store + persists; applyTheme() (called inside save) pushes the new
	// CSS custom properties to <html> so every surface re-sizes live.
	function setTitle(v: number) { settings.fontScaleTitle = v; settings.save(); }
	function setArtist(v: number) { settings.fontScaleArtist = v; settings.save(); }
	function setLyrics(v: number) { settings.fontScaleLyrics = v; settings.save(); }
	function setNpTitle(v: number) { settings.fontScaleNpTitle = v; settings.save(); }
	function setNpArtist(v: number) { settings.fontScaleNpArtist = v; settings.save(); }
	function setCover(v: number) { settings.coverScale = v; settings.save(); }
	function setCols(v: number) { settings.homeGridCols = v; settings.save(); }
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupAppearance')}</h1>
	<button class="reset" onclick={() => { if (confirm(t('settings.resetConfirm'))) { settings.resetAppearance(); } }}>{t('settings.resetGroup')}</button>
</header>

<section>
	<h2><Type size={15} /> {t('settings.appearanceText')}</h2>

	<div class="ctl">
		<div class="lab"><span>{t('settings.fontSizeTitle')}</span><span class="val">{settings.fontScaleTitle}%</span></div>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleTitle} oninput={(e) => setTitle(num(e))} />
		<span class="prev" style:font-size={`${1.05 * settings.fontScaleTitle / 100}rem`}>Stargazing</span>
	</div>

	<div class="ctl">
		<div class="lab"><span>{t('settings.fontSizeArtist')}</span><span class="val">{settings.fontScaleArtist}%</span></div>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleArtist} oninput={(e) => setArtist(num(e))} />
		<span class="prev muted" style:font-size={`${0.9 * settings.fontScaleArtist / 100}rem`}>Myles Smith</span>
	</div>

	<div class="ctl">
		<div class="lab"><span>{t('settings.fontSizeLyrics')}</span><span class="val">{settings.fontScaleLyrics}%</span></div>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleLyrics} oninput={(e) => setLyrics(num(e))} />
		<span class="prev muted" style:font-size={`${1 * settings.fontScaleLyrics / 100}rem`}>You and I stargazing</span>
	</div>

	<div class="ctl">
		<div class="lab"><span>{t('settings.fontSizeNpTitle')}</span><span class="val">{settings.fontScaleNpTitle}%</span></div>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleNpTitle} oninput={(e) => setNpTitle(num(e))} />
		<span class="prev" style:font-size={`${1.5 * settings.fontScaleNpTitle / 100}rem`}>Stargazing</span>
	</div>

	<div class="ctl">
		<div class="lab"><span>{t('settings.fontSizeNpArtist')}</span><span class="val">{settings.fontScaleNpArtist}%</span></div>
		<input type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5" value={settings.fontScaleNpArtist} oninput={(e) => setNpArtist(num(e))} />
		<span class="prev muted" style:font-size={`${1 * settings.fontScaleNpArtist / 100}rem`}>Myles Smith</span>
	</div>
</section>

<section>
	<h2><LayoutGrid size={15} /> {t('settings.appearanceLayout')}</h2>

	<div class="ctl">
		<div class="lab"><span>{t('settings.coverSize')}</span><span class="val">{settings.coverScale}%</span></div>
		<input type="range" min={COVER_SCALE_MIN} max={COVER_SCALE_MAX} step="5" value={settings.coverScale} oninput={(e) => setCover(num(e))} />
	</div>

	<div class="ctl">
		<div class="lab"><span>{t('settings.gridColumns')}</span><span class="val">{settings.homeGridCols}</span></div>
		<input type="range" min={GRID_COLS_MIN} max={GRID_COLS_MAX} step="1" value={settings.homeGridCols} oninput={(e) => setCols(num(e))} />
	</div>

	<p class="note">{t('settings.appearanceNote')}</p>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.head h1 { flex: 1; }
	.reset { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
	.reset:hover { color: var(--color-text); }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 14px; }
	.ctl { margin: 0 0 18px; }
	.lab { display: flex; align-items: baseline; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
	.val { color: var(--color-primary); font-variant-numeric: tabular-nums; font-size: 13px; }
	input[type='range'] { width: 100%; accent-color: var(--color-primary); }
	.prev { display: inline-block; margin-top: 8px; font-weight: 700; line-height: 1.2; }
	.prev.muted { color: var(--color-text-muted); font-weight: 600; }
	.note { color: var(--color-text-muted); font-size: 12px; margin: 4px 0 0; }
</style>
