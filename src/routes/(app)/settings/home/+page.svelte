<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		ChevronLeft,
		GripVertical,
		LayoutGrid,
		Tags,
		Globe,
		SlidersHorizontal,
		Compass,
		LayoutList,
		ToggleRight
	} from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import {
		resolveSectionOrder,
		resolveSubset,
		SHELF_MIN,
		SHELF_MAX,
		type HomeSectionId,
		type HomeDensity,
		type HomeLandingTab
	} from '$lib/services/home-layout';
	import { DISCOVERY_TAGS, DISCOVERY_COUNTRIES } from '$lib/services/discovery';
	import { dragReorder } from '$lib/actions/dragReorder';
	import { t, type TranslationKey } from '$lib/i18n';

	onMount(() => settings.load());

	// Section id → i18n label key. Iterate the RESOLVED order so a corrupt saved order still
	// renders (resolveSectionOrder drops unknown ids + appends missing known ones).
	const sectionLabel: Record<HomeSectionId, TranslationKey> = {
		'top-hits': 'settings.homeSectionTopHits',
		'top-artists': 'settings.homeSectionTopArtists',
		tags: 'settings.homeSectionTags',
		countries: 'settings.homeSectionCountries'
	};

	const order = $derived(resolveSectionOrder(settings.homeSectionOrder));

	// dragReorder fires (from,to) as indices into `order`. Splice on a COPY, persist.
	function onReorder(from: number, to: number) {
		const next = [...order];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		settings.homeSectionOrder = next;
		settings.save();
	}

	function toggleHidden(id: string) {
		settings.homeHidden = settings.homeHidden.includes(id)
			? settings.homeHidden.filter((x) => x !== id)
			: [...settings.homeHidden, id];
		settings.save();
	}

	// Tag/country multiselect: toggle membership, persist. resolveSubset handles the
	// empty-selection → full-pool fallback at render time on the home page.
	function toggleTag(tag: string) {
		settings.homeTags = settings.homeTags.includes(tag)
			? settings.homeTags.filter((x) => x !== tag)
			: [...settings.homeTags, tag];
		settings.save();
	}
	function toggleCountry(c: string) {
		settings.homeCountries = settings.homeCountries.includes(c)
			? settings.homeCountries.filter((x) => x !== c)
			: [...settings.homeCountries, c];
		settings.save();
	}

	function setShelfSize(e: Event) {
		settings.homeShelfSize = Number((e.currentTarget as HTMLInputElement).value);
		settings.save();
	}
	function setLanding(v: HomeLandingTab) {
		settings.homeLandingTab = v;
		settings.save();
	}
	function setDensity(v: HomeDensity) {
		settings.homeDensity = v;
		settings.save();
	}
	function toggleSearchPill() {
		settings.homeShowSearchPill = !settings.homeShowSearchPill;
		settings.save();
	}
	function toggleRandomize() {
		settings.homeShowRandomize = !settings.homeShowRandomize;
		settings.save();
	}

	const landings: { v: HomeLandingTab; key: TranslationKey }[] = [
		{ v: 'home', key: 'settings.landingHome' },
		{ v: 'search', key: 'settings.landingSearch' },
		{ v: 'library', key: 'settings.landingLibrary' }
	];
	const densities: { v: HomeDensity; key: TranslationKey }[] = [
		{ v: 'comfortable', key: 'settings.densityComfortable' },
		{ v: 'compact', key: 'settings.densityCompact' }
	];

	// Empty (or all-invalid) selection → home shows the FULL pool; surface that hint.
	const tagsShowingAll = $derived(resolveSubset(settings.homeTags, DISCOVERY_TAGS).length === DISCOVERY_TAGS.length && settings.homeTags.length === 0);
	const countriesShowingAll = $derived(resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES).length === DISCOVERY_COUNTRIES.length && settings.homeCountries.length === 0);
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupHome')}</h1>
</header>

<!-- 1. SECTION ORDER + VISIBILITY -->
<section>
	<h2><LayoutGrid size={15} /> {t('settings.homeSections')}</h2>
	<ul class="reorder" use:dragReorder={{ onReorder }}>
		{#each order as id, i (id)}
			<li class="rrow" data-reorder-index={i}>
				<span class="grip" data-reorder-handle aria-label={t('settings.dragToReorder')}><GripVertical size={18} /></span>
				<span class="rlabel">{t(sectionLabel[id])}</span>
				<button class="sw" class:on={!settings.homeHidden.includes(id)} aria-label={t(sectionLabel[id])} onclick={() => toggleHidden(id)}></button>
			</li>
		{/each}
	</ul>
	<p class="muted">{t('settings.dragToReorder')}</p>
</section>

<!-- 2. GENRE TAGS -->
<section>
	<h2><Tags size={15} /> {t('settings.homeGenres')}</h2>
	<div class="chips">
		{#each DISCOVERY_TAGS as tag (tag)}
			<button class="chip" class:on={settings.homeTags.includes(tag)} onclick={() => toggleTag(tag)}>{tag}</button>
		{/each}
	</div>
	{#if tagsShowingAll}<p class="muted">{t('settings.homeShowingAll')}</p>{/if}
</section>

<!-- 3. COUNTRIES -->
<section>
	<h2><Globe size={15} /> {t('settings.homeCountriesLabel')}</h2>
	<div class="chips">
		{#each DISCOVERY_COUNTRIES as c (c)}
			<button class="chip" class:on={settings.homeCountries.includes(c)} onclick={() => toggleCountry(c)}>{c}</button>
		{/each}
	</div>
	{#if countriesShowingAll}<p class="muted">{t('settings.homeShowingAll')}</p>{/if}
</section>

<!-- 4. ITEMS PER SHELF -->
<section>
	<h2><SlidersHorizontal size={15} /> {t('settings.itemsPerShelf', { n: settings.homeShelfSize })}</h2>
	<input class="range" type="range" min={SHELF_MIN} max={SHELF_MAX} step="1" value={settings.homeShelfSize} oninput={setShelfSize} aria-label={t('settings.itemsPerShelf', { n: settings.homeShelfSize })} />
</section>

<!-- 5. DEFAULT LANDING TAB -->
<section>
	<h2><Compass size={15} /> {t('settings.defaultLandingTab')}</h2>
	<div class="seg">
		{#each landings as l (l.v)}
			<button class:on={settings.homeLandingTab === l.v} onclick={() => setLanding(l.v)}>{t(l.key)}</button>
		{/each}
	</div>
</section>

<!-- 6. TILE DENSITY -->
<section>
	<h2><LayoutList size={15} /> {t('settings.tileDensity')}</h2>
	<div class="seg">
		{#each densities as d (d.v)}
			<button class:on={settings.homeDensity === d.v} onclick={() => setDensity(d.v)}>{t(d.key)}</button>
		{/each}
	</div>
</section>

<!-- 7. HOME CHROME -->
<section>
	<h2><ToggleRight size={15} /> {t('settings.homeChrome')}</h2>
	<button class="row-toggle" onclick={toggleSearchPill}>
		<span>{t('settings.showSearchPill')}</span>
		<span class="sw" class:on={settings.homeShowSearchPill}></span>
	</button>
	<button class="row-toggle" onclick={toggleRandomize}>
		<span>{t('settings.showRandomize')}</span>
		<span class="sw" class:on={settings.homeShowRandomize}></span>
	</button>
</section>

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	/* Reorder list */
	.reorder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.rrow { display: flex; align-items: center; gap: 10px; background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 11px 12px; border-radius: 12px; }
	/* The grip OWNS the vertical gesture (touch-action:none) so a drag reorders, not scrolls. */
	.grip { display: grid; place-items: center; color: var(--color-text-muted); cursor: grab; touch-action: none; flex: none; }
	.grip:active { cursor: grabbing; }
	.rlabel { flex: 1; min-width: 0; font-size: 14px; }
	/* Chips (multiselect) */
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	/* Range slider */
	.range { width: 100%; accent-color: var(--color-primary); }
	/* Segmented control */
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	/* Toggle rows */
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin-bottom: 8px; }
	.row-toggle span:first-child { display: inline-flex; align-items: center; gap: 10px; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; border: none; cursor: pointer; padding: 0; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
</style>
