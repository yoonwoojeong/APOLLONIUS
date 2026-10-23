import { expect, test } from 'vitest';
import { LEVELS } from '../../../src/levels';
import { createStore } from '../../../src/state/store';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { playReferenceInto } from '../helpers';

const memStorage = () => {
  const m = new Map<string, string>();
  return {
    m,
    storage: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as unknown as Storage,
  };
};

test('storage that throws on get/set → game still works in memory', () => {
  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  } as unknown as Storage;
  const s = createStore(throwing);
  s.openLevel('equilateral');
  playReferenceInto(s);
  expect(s.completion.value).not.toBeNull();
  expect(s.progress.value.levels.equilateral?.stars[0]).toBe(true);
});

test('completing midpoint unlocks perp-bisector and persists it', () => {
  const { storage, m } = memStorage();
  const s = createStore(storage);
  s.openLevel('midpoint');
  expect(s.availableTools()).not.toContain('perp-bisector');
  playReferenceInto(s);
  expect(s.completion.value?.unlocked).toBe('perp-bisector');
  expect(s.progress.value.unlockedTools).toContain('perp-bisector');
  expect(JSON.parse(m.get(STORAGE_KEY) as string).unlockedTools).toContain('perp-bisector');
  expect(createStore(storage).progress.value.unlockedTools).toContain('perp-bisector');
  s.openLevel('perpendicular');
  expect(s.availableTools()).toContain('perp-bisector');
  s.selectTool('perp-bisector');
  expect(s.tool.value).toBe('perp-bisector');
});

test('selectTool ignores tools not available', () => {
  const s = createStore(null);
  s.openLevel('equilateral');
  s.selectTool('perp-bisector');
  expect(s.tool.value).toBe('point');
  s.selectTool('circle');
  expect(s.tool.value).toBe('circle');
});

test('stars merge across attempts', () => {
  const { storage } = memStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      levels: { equilateral: { stars: [false, false, true], hintsUsed: 3 } },
      unlockedTools: [],
    }),
  );
  const s = createStore(storage);
  s.openLevel('equilateral');
  playReferenceInto(s);
  expect(s.progress.value.levels.equilateral).toEqual({
    stars: [true, true, true],
    hintsUsed: 3,
  });
});

test('coincidental solution never completes', () => {
  const s = createStore(null);
  s.openLevel('midpoint');
  s.apply({
    type: 'add',
    objects: [{ id: 'p', def: { type: 'free-point', pos: { x: 0, y: 0 } } }],
  });
  expect(s.construction().scene().objects.some((o) => o.id === 'p')).toBe(true);
  expect(s.completion.value).toBeNull();
  expect(s.progress.value.levels.midpoint).toBeUndefined();
});

test('hintTier caps at 3 and resets when the target step changes', () => {
  const s = createStore(null);
  s.openLevel('equilateral');
  const step = s.hint.value?.stepIndex;
  for (let i = 0; i < 5; i++) s.requestHint();
  expect(s.hintTier.value).toBe(3);
  const first = LEVELS[0]!.reference[0]!;
  s.apply({ type: 'add', objects: first.objects });
  expect(s.hint.value?.stepIndex).not.toBe(step);
  expect(s.hintTier.value).toBe(0);
});

test('hintsUsed records the tier in force at completion', () => {
  const s = createStore(null);
  s.openLevel('equilateral');
  const steps = LEVELS[0]!.reference;
  for (const step of steps.slice(0, -1)) s.apply({ type: 'add', objects: step.objects });
  s.requestHint();
  s.requestHint();
  s.apply({ type: 'add', objects: steps[steps.length - 1]!.objects });
  expect(s.progress.value.levels.equilateral?.hintsUsed).toBe(2);
});

test('level 2 locked until level 1 completed', () => {
  const s = createStore(null);
  expect(s.isUnlocked('equilateral')).toBe(true);
  expect(s.isUnlocked('perp-bisector')).toBe(false);
  s.openLevel('equilateral');
  playReferenceInto(s);
  expect(s.isUnlocked('perp-bisector')).toBe(true);
});

test('resumeLevel returns first unsolved unlocked level', () => {
  const s = createStore(null);
  expect(s.resumeLevel()).toBe('equilateral');
  s.openLevel('equilateral');
  playReferenceInto(s);
  expect(s.resumeLevel()).toBe('perp-bisector');
});

test('undo/redo/reset bump revision; nextLevel and goToMap navigate', () => {
  const s = createStore(null);
  s.openLevel('equilateral');
  const r0 = s.revision.value;
  s.apply({ type: 'add', objects: LEVELS[0]!.reference[0]!.objects });
  s.undo();
  s.redo();
  s.reset();
  expect(s.revision.value).toBe(r0 + 4);
  playReferenceInto(s);
  s.nextLevel();
  expect(s.levelId.value).toBe('perp-bisector');
  expect(s.completion.value).toBeNull();
  s.goToMap();
  expect(s.screen.value).toBe('map');
});

test('setTheme persists', () => {
  const { storage } = memStorage();
  const s = createStore(storage);
  s.setTheme('dark');
  expect(createStore(storage).progress.value.theme).toBe('dark');
});
