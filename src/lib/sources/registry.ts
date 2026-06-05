// The ONLY place client source adapters are enumerated (DATA-04). Aggregation and
// dispatch code resolve adapters through SOURCES / getEnabledAdapters — they never
// name a source. Adding a source = a new adapter file + one import line here.
import type { SourceAdapter, SourceId } from './types';
import { netease } from './netease';
import { qq } from './qq';
import { kuwo } from './kuwo';
import { joox } from './joox';

export const SOURCES: Record<SourceId, SourceAdapter> = { netease, qq, kuwo, joox };

/**
 * The enabled adapters for a search fan-out. `prefs` overrides each adapter's
 * `enabledByDefault` (explicit true/false wins; absent falls back to the default).
 * Ported from the monolith's enabled-source loop (legacy:2235-2241), generalized to
 * iterate the registry instead of a hard-coded string ladder.
 */
export const getEnabledAdapters = (
	prefs: Partial<Record<SourceId, boolean>> = {}
): SourceAdapter[] => Object.values(SOURCES).filter((a) => prefs[a.id] ?? a.enabledByDefault);
