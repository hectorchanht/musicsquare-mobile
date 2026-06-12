<script lang="ts">
	// Single mounted toast renderer (D-15). Reads the global toast store and renders the one
	// visible message; mounted ONCE in the app layout alongside NowPlaying/SleepTimerSheet so
	// every page shares this host instead of carrying its own copy. The message is rendered as
	// text content only ({toast.msg} auto-escapes) — never {@html} (T-23-01). The `.toast` style
	// + fly transition are copied byte-identical from TrackMenu's local copy; its grandfathered
	// pill values (env safe-area top, 999px radius) are exempt from the 8pt scale per UI-SPEC §1.
	import { fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast.svelte';
</script>

{#if toast.msg}<div class="toast" role="status" aria-live="polite" transition:fly={{ y: -20, duration: 180 }}>{toast.msg}</div>{/if}

<style>
	.toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 14px); z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
</style>
