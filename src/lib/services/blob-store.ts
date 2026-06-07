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

const DB_NAME = 'openmusic-blobs';
const STORE = 'tracks';
const VERSION = 1;

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
