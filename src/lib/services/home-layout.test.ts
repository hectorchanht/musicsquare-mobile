import { describe, it, expect } from 'vitest';
import {
	HOME_SECTIONS,
	DEFAULT_SECTION_ORDER,
	resolveSectionOrder,
	resolveSubset,
	clampShelfSize,
	SHELF_MIN,
	SHELF_MAX,
	SHELF_DEFAULT,
	LANDING_PATHS
} from './home-layout';

// home-layout.ts is a PURE config-resolution module (no runes, no browser, runs in the
// node Vitest project alongside discovery.test.ts). It guards the home render against a
// corrupt/old persisted config (quick-260606-w87 — threats T-w87-01/02/03/05): a poisoned
// shelf size, an unknown section id, or a tag no longer in the pool must NEVER break the
// render — they clamp / drop / fall back to defaults. These tests are fully deterministic.

describe('HOME_SECTIONS / DEFAULT_SECTION_ORDER', () => {
	it('is the eight home group ids in canonical order (hhd: liked/downloads pin first, library blocks last)', () => {
		expect(HOME_SECTIONS).toEqual([
			'liked',
			'downloads',
			'top-hits',
			'top-artists',
			'tags',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('DEFAULT_SECTION_ORDER deep-equals HOME_SECTIONS (preserves today fixed order)', () => {
		expect(DEFAULT_SECTION_ORDER).toEqual(HOME_SECTIONS);
	});

	it('DEFAULT_SECTION_ORDER is a distinct array (not the same ref — safe to spread)', () => {
		expect(DEFAULT_SECTION_ORDER).not.toBe(HOME_SECTIONS);
	});
});

describe('resolveSectionOrder', () => {
	it('undefined → DEFAULT_SECTION_ORDER (deep-equal, new array)', () => {
		const r = resolveSectionOrder(undefined);
		expect(r).toEqual(DEFAULT_SECTION_ORDER);
		expect(r).not.toBe(DEFAULT_SECTION_ORDER);
	});

	it('empty → DEFAULT_SECTION_ORDER (deep-equal, new array)', () => {
		const r = resolveSectionOrder([]);
		expect(r).toEqual(DEFAULT_SECTION_ORDER);
		expect(r).not.toBe(DEFAULT_SECTION_ORDER);
	});

	it('corrupt (non-array) → DEFAULT_SECTION_ORDER', () => {
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSectionOrder('bogus')).toEqual(DEFAULT_SECTION_ORDER);
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSectionOrder(42)).toEqual(DEFAULT_SECTION_ORDER);
	});

	it('keeps the saved order then appends any missing known ids (permutation-superset)', () => {
		expect(resolveSectionOrder(['countries', 'top-hits'])).toEqual([
			'countries',
			'top-hits',
			// missing ids appended in canonical (HOME_SECTIONS) order
			'liked',
			'downloads',
			'top-artists',
			'tags',
			'playlists',
			'history'
		]);
	});

	it('drops ids not in HOME_SECTIONS (unknown/old ids ignored) and still covers every id', () => {
		expect(resolveSectionOrder(['bogus', 'tags'])).toEqual([
			'tags',
			'liked',
			'downloads',
			'top-hits',
			'top-artists',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('de-dupes a repeated saved id (a known id appears at most once)', () => {
		expect(resolveSectionOrder(['tags', 'tags', 'top-hits'])).toEqual([
			'tags',
			'top-hits',
			'liked',
			'downloads',
			'top-artists',
			'countries',
			'playlists',
			'history'
		]);
	});

	it('a full valid permutation is returned as-is', () => {
		const order = [
			'tags',
			'countries',
			'top-artists',
			'top-hits',
			'liked',
			'downloads',
			'playlists',
			'history'
		];
		expect(resolveSectionOrder(order)).toEqual(order);
	});
});

describe('resolveSubset', () => {
	const POOL = ['pop', 'rock', 'electronic', 'jazz'];

	it('undefined → the full pool (default = everything, preserves today)', () => {
		expect(resolveSubset(undefined, POOL)).toEqual(POOL);
	});

	it('empty selection → the full pool (fall-back-to-full rule)', () => {
		expect(resolveSubset([], POOL)).toEqual(POOL);
	});

	it('all selections invalid → the full pool (never a blank surface)', () => {
		expect(resolveSubset(['bogus', 'nope'], POOL)).toEqual(POOL);
	});

	it('filters to pool members, dropping ones not in the pool', () => {
		expect(resolveSubset(['rock', 'bogus'], POOL)).toEqual(['rock']);
	});

	it('result order follows SELECTION order (drives home shelf order), de-duped', () => {
		expect(resolveSubset(['jazz', 'pop'], POOL)).toEqual(['jazz', 'pop']);
		expect(resolveSubset(['pop', 'jazz', 'pop'], POOL)).toEqual(['pop', 'jazz']);
	});

	it('corrupt (non-array) selection → the full pool', () => {
		// @ts-expect-error — deliberately passing a corrupt persisted value
		expect(resolveSubset('rock', POOL)).toEqual(POOL);
	});

	it('does not mutate the pool', () => {
		const pool = [...POOL];
		resolveSubset(['rock'], pool);
		expect(pool).toEqual(POOL);
	});
});

describe('clampShelfSize', () => {
	it('clamps a too-large value down to SHELF_MAX', () => {
		expect(clampShelfSize(100)).toBe(SHELF_MAX);
		expect(clampShelfSize(100)).toBe(24);
	});

	it('clamps a too-small value up to SHELF_MIN', () => {
		expect(clampShelfSize(2)).toBe(SHELF_MIN);
		expect(clampShelfSize(2)).toBe(6);
	});

	it('passes a valid value through', () => {
		expect(clampShelfSize(18)).toBe(18);
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(18);
	});

	it('floors a fractional value', () => {
		expect(clampShelfSize(12.7)).toBe(12);
	});

	it('non-number / NaN / undefined → SHELF_DEFAULT', () => {
		// clampShelfSize takes `unknown`, so a corrupt string is a runtime concern, not a type one.
		expect(clampShelfSize('x')).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(undefined)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(NaN)).toBe(SHELF_DEFAULT);
		expect(clampShelfSize(SHELF_DEFAULT)).toBe(18);
	});

	it('a negative value clamps up to SHELF_MIN (never a NaN / negative page size)', () => {
		expect(clampShelfSize(-5)).toBe(SHELF_MIN);
	});
});

describe('LANDING_PATHS', () => {
	it('maps every landing tab to a fixed in-app path (no open-redirect)', () => {
		expect(LANDING_PATHS.home).toBe('/');
		expect(LANDING_PATHS.search).toBe('/search');
		expect(LANDING_PATHS.library).toBe('/library');
	});
});
