<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { player } from '$lib/stores/player.svelte';

	let { children } = $props();
	let audioEl: HTMLAudioElement;

	// The single app-wide <audio> lives at the ROOT layout so it is mounted ONCE
	// and never torn down by client-side navigation between routes/route-groups —
	// playback persists across page changes (incl. into /spike). The visible
	// now-playing bar + overlay live in (app)/+layout and read the same singleton.
	$effect(() => {
		if (audioEl) player.attach(audioEl);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<audio bind:this={audioEl} style="display:none"></audio>
