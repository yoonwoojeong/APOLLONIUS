import { afterEach, expect, test, vi } from 'vitest';
import { loadProgress, safeStorage, saveProgress, type Progress } from '../../../src/state/persistence';

afterEach(() => vi.restoreAllMocks());

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

test('round-trips progress', () => {
  const s = mem();
  const p: Progress = {
    version: 1,
    levels: { equilateral: { stars: [true, false, true], hintsUsed: 2 } },
    unlockedTools: ['perp-bisector'],
    theme: 'dark',
  };
  saveProgress(s, p);
  expect(loadProgress(s)).toEqual(p);
});

test('empty storage and null storage give fresh progress', () => {
  expect(loadProgress(mem())).toEqual({ version: 1, levels: {}, unlockedTools: [] });
  expect(loadProgress(null)).toEqual({ version: 1, levels: {}, unlockedTools: [] });
});

test('corrupt JSON → fresh progress and console.warn', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const p = loadProgress({ getItem: () => '{not json' });
  expect(p).toEqual({ version: 1, levels: {}, unlockedTools: [] });
  expect(warn).toHaveBeenCalled();
});

test('unknown version → fresh progress', () => {
  const p = loadProgress({ getItem: () => JSON.stringify({ version: 2, levels: {}, unlockedTools: ['x'] }) });
  expect(p).toEqual({ version: 1, levels: {}, unlockedTools: [] });
});

test('throwing storage is tolerated', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const bad = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  expect(loadProgress(bad).levels).toEqual({});
  expect(() => saveProgress(bad, loadProgress(null))).not.toThrow();
});

test('safeStorage returns null without a browser', () => {
  expect(safeStorage()).toBeNull();
});
