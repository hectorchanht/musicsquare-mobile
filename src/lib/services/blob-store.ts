// Offline blob cache for downloaded tracks (quick-260607-kyf, P1 of the ju0-deferred items).
//
// IndexedDB-backed: when a user clicks Download in TrackMenu, the fetched audio Blob is also
// persisted here keyed by track uid. Later `player.play()` checks this store before falling
// back to the upstream CDN — a downloaded song plays from the local blob (no network).
//
// Posture (matches the rest of the lib/services NEVER-THROWS pattern):
//  - Every method is SSR-guarded: on the server / unavailable IDB the API resolves to a
//    no-op / null. Callers always see a plain Promise — they cannot fail because IDB is
//    missing. A miss → null → caller uses the CDN URL transparently.
//  - The DB open is lazy + cached. A failed open caches the failure and resolves to null for
//    every subsequent call (no perpetual reconnect loop).
//  - The Blob payload is opaque to this module: it stores and returns the Blob the caller
//    handed it; URL.createObjectURL/revokeObjectURL lifecycle is the caller's responsibility
//    (player owns the URL alongside its `<audio>` element).
//  - One object store, one key path: `tracks` keyed by the track uid string. Schema v1.

import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import write_blob from 'capacitor-blob-writer';

const DB_NAME = 'openmusic-blobs';
const STORE = 'tracks';
const VERSION = 1;

// --- Native (Capacitor) filesystem backend (999.1-03, D-10) ---------------------------------
//
// On native (Capacitor.isNativePlatform()) the downloaded audio Blob is written to an
// app-private directory (`Directory.Data` — app-scoped, no runtime permissions, works on every
// Android version) via `capacitor-blob-writer` (streams the Blob straight to disk WITHOUT a
// base64 round-trip — @capacitor/filesystem.writeFile would base64-encode it: +33% bloat and a
// memory spike for large lossless files). Reads/deletes go through @capacitor/filesystem.
//
// TODO(999.1-06): route into public Music/ via the Kotlin MediaStore bridge (D-11 resolved
// public-music-mediastore 2026-06-12); writing app-private here as a staged step — plan 06
// upgrades THIS write target to MediaStore.Audio.Media (RELATIVE_PATH Music/OpenMusic, IS_PENDING).
//
// The three native functions mirror the web branch's never-throws contract EXACTLY: every path
// resolves false / null / void and NEVER rejects, so a failed download degrades to CDN playback
// (T-999.1-09) — parity with the IDB branch.

const NATIVE_DIR = Directory.Data;

/** Filesystem-safe, collision-free path for a uid (uids are `<source>-<id>`, e.g. `netease-123`). */
function nativePath(uid: string): string {
	return `downloads/${uid.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

async function nativePut(uid: string, blob: Blob): Promise<boolean> {
	try {
		// TODO(999.1-06): swap this app-private write for the public Music/ MediaStore bridge.
		await write_blob({ path: nativePath(uid), directory: NATIVE_DIR, blob, recursive: true });
		return true;
	} catch {
		return false;
	}
}

async function nativeGet(uid: string): Promise<Blob | null> {
	try {
		// Binary read returns base64 (no Encoding passed). Convert back to a Blob; the web shim of
		// Filesystem may hand back a Blob directly, so handle both shapes.
		const res = await Filesystem.readFile({ path: nativePath(uid), directory: NATIVE_DIR });
		const data = res.data;
		if (data instanceof Blob) return data;
		if (typeof data !== 'string') return null;
		const binary = atob(data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new Blob([bytes]);
	} catch {
		return null;
	}
}

async function nativeDel(uid: string): Promise<void> {
	try {
		await Filesystem.deleteFile({ path: nativePath(uid), directory: NATIVE_DIR });
	} catch {
		// not-found / any failure: swallow — parity with the IDB del() never-throws posture.
	}
}

let openPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (!browser) return Promise.resolve(null);
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	if (openPromise) return openPromise;
	openPromise = new Promise<IDBDatabase | null>((resolve) => {
		try {
			const req = indexedDB.open(DB_NAME, VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.createObjectStore(STORE);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
			req.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return openPromise;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
	return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * Persist a Blob under `uid`. Resolves silently on success or any failure (never throws).
 * Returns true if the write landed, false otherwise.
 */
export async function put(uid: string, blob: Blob): Promise<boolean> {
	if (!uid) return false;
	if (Capacitor.isNativePlatform()) return nativePut(uid, blob);
	const db = await openDb();
	if (!db) return false;
	return new Promise<boolean>((resolve) => {
		try {
			const req = txStore(db, 'readwrite').put(blob, uid);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}

/**
 * Read the Blob for `uid`. Resolves to the Blob (cache hit), null (miss), or null on any
 * error. Never throws.
 */
export async function get(uid: string): Promise<Blob | null> {
	if (!uid) return null;
	if (Capacitor.isNativePlatform()) return nativeGet(uid);
	const db = await openDb();
	if (!db) return null;
	return new Promise<Blob | null>((resolve) => {
		try {
			const req = txStore(db, 'readonly').get(uid);
			req.onsuccess = () => {
				const v = req.result as Blob | undefined;
				resolve(v instanceof Blob ? v : null);
			};
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/**
 * Delete the entry for `uid`. Resolves silently on success / miss / failure. Never throws.
 */
export async function del(uid: string): Promise<void> {
	if (!uid) return;
	if (Capacitor.isNativePlatform()) return nativeDel(uid);
	const db = await openDb();
	if (!db) return;
	await new Promise<void>((resolve) => {
		try {
			const req = txStore(db, 'readwrite').delete(uid);
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
		} catch {
			resolve();
		}
	});
}

/** Bundled namespace export so callers can `import { blobStore } from '$lib/services/blob-store'`. */
export const blobStore = { put, get, del };
