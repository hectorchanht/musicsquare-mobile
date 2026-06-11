import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// blob-store.ts (999.1-03, D-10) is the platform-switched offline-blob backend. On web
// (Capacitor.isNativePlatform() === false) it keeps the EXISTING IndexedDB store byte-for-byte
// (SSR-guarded never-throws). On native it routes put/get/del to capacitor-blob-writer +
// @capacitor/filesystem (app-private Directory.Data — public Music/ bridge lands in plan 06),
// preserving the SAME put/get/del signatures and the SAME never-throws posture (resolve
// false/null/void, never reject). These tests pin: (1) native put/get/del hit the FS backend,
// (2) every native error path returns the sentinel, and (3) the web branch (browser false in
// the node test env → openDb null → put false) is reached when isNativePlatform() is false —
// all node-runnable via vi.mock (NO real browser / IDB / device).

// --- platform switch: controlled per-test via the isNativePlatform mock ---
const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: () => isNativePlatform()
	}
}));

// --- native write backend (capacitor-blob-writer default export) ---
const writeBlob = vi.fn(async () => 'file:///data/downloads/x');
vi.mock('capacitor-blob-writer', () => ({ default: (opts: unknown) => writeBlob(opts) }));

// --- native read/delete backend (@capacitor/filesystem) ---
const readFile = vi.fn();
const deleteFile = vi.fn();
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: {
		readFile: (opts: unknown) => readFile(opts),
		deleteFile: (opts: unknown) => deleteFile(opts)
	},
	Directory: { Data: 'DATA', External: 'EXTERNAL' }
}));

import { blobStore, put, get, del } from './blob-store';

beforeEach(() => {
	isNativePlatform.mockReturnValue(false);
	writeBlob.mockReset().mockResolvedValue('file:///data/downloads/x');
	readFile.mockReset();
	deleteFile.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('blob-store — namespace export shape (consumers must keep compiling)', () => {
	it('exports blobStore = { put, get, del } with the three functions intact', () => {
		expect(typeof blobStore.put).toBe('function');
		expect(typeof blobStore.get).toBe('function');
		expect(typeof blobStore.del).toBe('function');
		expect(blobStore.put).toBe(put);
		expect(blobStore.get).toBe(get);
		expect(blobStore.del).toBe(del);
	});
});

describe('blob-store — web branch (isNativePlatform false)', () => {
	it('put falls through to the IDB path (browser false in node → openDb null → false), NEVER the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		const ok = await put('netease-1', new Blob(['a']));
		// In the node test env `browser` is false so openDb resolves null and put returns false.
		expect(ok).toBe(false);
		// Critically, the native write backend was NOT touched on the web branch.
		expect(writeBlob).not.toHaveBeenCalled();
	});

	it('get falls through to the IDB path (returns null), not the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		const v = await get('netease-1');
		expect(v).toBeNull();
		expect(readFile).not.toHaveBeenCalled();
	});

	it('del falls through to the IDB path (resolves void), not the native backend', async () => {
		isNativePlatform.mockReturnValue(false);
		await expect(del('netease-1')).resolves.toBeUndefined();
		expect(deleteFile).not.toHaveBeenCalled();
	});
});

describe('blob-store — native branch put (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('put writes the Blob via capacitor-blob-writer and resolves true on success', async () => {
		const blob = new Blob(['audio-bytes']);
		const ok = await put('netease-123', blob);
		expect(ok).toBe(true);
		expect(writeBlob).toHaveBeenCalledTimes(1);
		const opts = writeBlob.mock.calls[0][0] as { path: string; blob: Blob; directory: string; recursive: boolean };
		expect(opts.blob).toBe(blob);
		expect(opts.path).toContain('netease-123');
		expect(opts.recursive).toBe(true);
		// app-private dir (Directory.Data) — public Music/ bridge is plan 06
		expect(opts.directory).toBe('DATA');
	});

	it('put returns false on empty uid without touching the backend', async () => {
		const ok = await put('', new Blob(['a']));
		expect(ok).toBe(false);
		expect(writeBlob).not.toHaveBeenCalled();
	});

	it('put resolves false (never rejects) when the write backend throws', async () => {
		writeBlob.mockRejectedValue(new Error('disk full'));
		await expect(put('netease-1', new Blob(['a']))).resolves.toBe(false);
	});
});

describe('blob-store — native branch get (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('get reads the file back and returns a Blob on a hit', async () => {
		// Filesystem.readFile returns base64 for binary reads.
		readFile.mockResolvedValue({ data: btoa('audio-bytes') });
		const v = await get('netease-123');
		expect(readFile).toHaveBeenCalledTimes(1);
		expect(v).toBeInstanceOf(Blob);
		expect(await (v as Blob).text()).toBe('audio-bytes');
	});

	it('get returns null on empty uid without touching the backend', async () => {
		const v = await get('');
		expect(v).toBeNull();
		expect(readFile).not.toHaveBeenCalled();
	});

	it('get resolves null (never rejects) on a miss / read error', async () => {
		readFile.mockRejectedValue(new Error('File does not exist'));
		await expect(get('netease-missing')).resolves.toBeNull();
	});
});

describe('blob-store — native branch del (isNativePlatform true)', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('del deletes the file and resolves void', async () => {
		await expect(del('netease-123')).resolves.toBeUndefined();
		expect(deleteFile).toHaveBeenCalledTimes(1);
		const opts = deleteFile.mock.calls[0][0] as { path: string };
		expect(opts.path).toContain('netease-123');
	});

	it('del resolves void on empty uid without touching the backend', async () => {
		await expect(del('')).resolves.toBeUndefined();
		expect(deleteFile).not.toHaveBeenCalled();
	});

	it('del resolves void (never rejects) when the file is absent / delete throws', async () => {
		deleteFile.mockRejectedValue(new Error('File does not exist'));
		await expect(del('netease-absent')).resolves.toBeUndefined();
	});
});
