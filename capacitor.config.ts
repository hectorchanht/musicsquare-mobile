import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	// D-12 LOCKED appId. This is the Android package identity that Obtainium and the
	// Play/sideload update mechanism key on. It is intentionally com.openmusic.app
	// (NOT the com.hectorchanht.musicsquare placeholder from RESEARCH). Changing it
	// after the first signed release breaks update continuity (threat T-999.1-05).
	appId: 'com.openmusic.app',
	appName: 'MusicSquare',
	// adapter-static output (BUILD_TARGET=native pnpm build → build/index.html SPA fallback).
	webDir: 'build',
	android: {
		// Security V14 / T-999.1-04: no cleartext traffic in the WebView. All /api/*
		// metadata and CDN audio bytes go over https. server.androidScheme defaults to
		// 'https' → WebView origin https://localhost (allowlisted in Plan-01 CORS).
		allowMixedContent: false
	}
};

export default config;
