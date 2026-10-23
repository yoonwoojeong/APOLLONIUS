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

export function loadProgress(storage: Pick<Storage, 'getItem'> | null): Progress {
  if (!storage) return freshProgress();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return freshProgress();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1
    ) {
      const p = parsed as Progress;
      if (typeof p.levels === 'object' && p.levels !== null && Array.isArray(p.unlockedTools)) {
        return p;
      }
    }
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
