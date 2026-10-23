import type { LevelId, ToolId } from '../levels/types';
import type { Stars } from '../reasoning/stars';

export interface Progress {
  version: 1;
  levels: Partial<Record<LevelId, { stars: Stars; hintsUsed: number }>>;
  unlockedTools: ToolId[];
  theme?: 'light' | 'dark';
}

export const STORAGE_KEY = 'apollonius:v1';

export const freshProgress = (): Progress => ({ version: 1, levels: {}, unlockedTools: [] });

const TOOLS: readonly string[] = ['point', 'line', 'circle', 'perp-bisector'];

function validLevel(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { stars, hintsUsed } = e as { stars?: unknown; hintsUsed?: unknown };
  return (
    Array.isArray(stars) &&
    stars.length === 3 &&
    stars.every((x) => typeof x === 'boolean') &&
    typeof hintsUsed === 'number' &&
    Number.isFinite(hintsUsed)
  );
}

function validProgress(p: unknown): p is Progress {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.levels !== 'object' || o.levels === null || Array.isArray(o.levels)) return false;
  if (!Object.values(o.levels).every(validLevel)) return false;
  if (!Array.isArray(o.unlockedTools) || !o.unlockedTools.every((t) => TOOLS.includes(t))) {
    return false;
  }
  return o.theme === undefined || o.theme === 'light' || o.theme === 'dark';
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | null): Progress {
  if (!storage) return freshProgress();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return freshProgress();
    const parsed: unknown = JSON.parse(raw);
    if (validProgress(parsed)) return parsed;
    console.warn('apollonius: saved progress has an unknown version or shape, starting fresh');
    return freshProgress();
  } catch (e) {
    console.warn('apollonius: could not read saved progress, starting fresh', e);
    return freshProgress();
  }
}

export function saveProgress(storage: Pick<Storage, 'setItem'> | null, p: Progress): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable or full: progress stays in memory only.
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
