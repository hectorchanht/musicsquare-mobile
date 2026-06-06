<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Info } from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';

	onMount(() => settings.load());
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.about')}</h1>
</header>

<section>
	<div class="item static"><Info size={18} /> {t('settings.aboutLine')}</div>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; text-align: left; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 13px; }
</style>
