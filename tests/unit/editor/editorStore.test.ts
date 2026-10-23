// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createEditor, type Editor } from '../../../src/editor/editorStore';
import { DRAFTS_KEY, newDraft, type Draft } from '../../../src/problems/drafts';
import { problemHash } from '../../../src/problems/hash';
import type { Problem } from '../../../src/problems/format';
import { createStore, type Store } from '../../../src/state/store';
import type { ObjSpec } from '../../../src/construction/types';
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

const point = (x: number, y: number) => ({ type: 'given-point' as const, pos: { x, y } });

const draft = (): Draft => newDraft(1000, () => 0.5);

/** Adds given points through the editor; returns their ids in order. */
function addPoints(ed: Editor, pts: [number, number][]): string[] {
  const ids: string[] = [];
  for (const [x, y] of pts) {
    const id = ed.allocId();
    ed.applySetup({
      type: 'add',
      specs: [{ id, def: point(x, y) }],
      labels: { [id]: ed.nextLabel() },
    });
    ids.push(id);
  }
  return ids;
}

/** Applies one add command in the game with fresh ids; returns the ids. */
function add(game: Store, defs: ObjSpec['def'][]): string[] {
  const objects = defs.map((def) => ({ id: game.construction().allocId(), def }));
  const r = game.apply({ type: 'add', objects });
  expect(r.ok).toBe(true);
  return objects.map((o) => o.id);
}

/** A,B then the perpendicular bisector construction in Solve; returns the ids. */
function buildBisector(ed: Editor, game: Store) {
  const [a, b] = addPoints(ed, [
    [-1, 0],
    [1, 0],
  ]) as [string, string];
  ed.enterSolve();
  const [c1] = add(game, [{ type: 'circle', center: a, through: b }]) as [string];
  const [c2] = add(game, [{ type: 'circle', center: b, through: a }]) as [string];
  const [p, q] = add(game, [
    { type: 'intersection', a: c1, b: c2, index: 0 },
    { type: 'intersection', a: c1, b: c2, index: 1 },
  ]) as [string, string];
  const [line] = add(game, [{ type: 'line', a: p, b: q }]) as [string];
  return { a, b, c1, c2, p, q, line };
}

const completeDetails = (ed: Editor) =>
  ed.setDetails({
    title: 'Bisector',
    goalText: 'Construct the perpendicular bisector of AB.',
  });

let game: Store;
let editors: Editor[] = [];
const make = (storage: Storage | null = null, d: Draft = draft(), now?: () => number) => {
  const ed = createEditor(game, storage, d, now);
  editors.push(ed);
  return ed;
};

beforeEach(() => {
  game = createStore(null);
  game.screen.value = 'editor';
});
afterEach(() => {
  for (const ed of editors) ed.dispose();
  editors = [];
  vi.useRealTimers();
});

describe('solve sync', () => {
  test('steps come from game commands; a nudge survives undo/redo of a later step', () => {
    const ed = make();
    buildBisector(ed, game);
    expect(ed.mode.value).toBe('solve');
    expect(ed.solution.value).toHaveLength(4);
    expect(ed.solution.value[2]!.objects).toHaveLength(2);
    expect(game.screen.value).toBe('editor');
    expect(game.availableTools()).toEqual(['point', 'line', 'circle', 'perp-bisector']);

    ed.setNudge(1, 'Swap the roles of A and B.');
    game.undo();
    expect(ed.solution.value).toHaveLength(3);
    expect(ed.solution.value[1]!.nudge).toBe('Swap the roles of A and B.');
    game.redo();
    expect(ed.solution.value).toHaveLength(4);
    expect(ed.solution.value[1]!.nudge).toBe('Swap the roles of A and B.');
    expect(ed.broken.value).toBeNull();
  });

  test('re-entering Solve replays the saved steps with their own ids and nudges', () => {
    const ed = make();
    const ids = buildBisector(ed, game);
    ed.setNudge(0, 'Start with a circle.');
    ed.setMode('setup');
    ed.enterSolve();
    expect(game.construction().steps()).toHaveLength(4);
    expect(game.construction().steps()[3]![0]!.id).toBe(ids.line);
    expect(ed.solution.value).toHaveLength(4);
    expect(ed.solution.value[0]!.nudge).toBe('Start with a circle.');
    add(game, [{ type: 'line', a: ids.a, b: ids.b }]);
    expect(ed.solution.value).toHaveLength(5);
    expect(new Set(ed.solution.value.flatMap((s) => s.objects.map((o) => o.id))).size).toBe(6);
  });

  test('deleting A breaks every step; they are kept until removeFrom', () => {
    const ed = make();
    const { a } = buildBisector(ed, game);
    ed.setMode('setup');
    ed.applySetup({ type: 'delete', ids: [a] });
    expect(ed.broken.value).toBe(0);
    expect(ed.solution.value).toHaveLength(4);

    // In Solve the broken tail is shown after the (empty) valid prefix.
    ed.enterSolve();
    expect(game.construction().steps()).toHaveLength(0);
    expect(ed.solution.value).toHaveLength(4);
    expect(ed.broken.value).toBe(0);

    ed.removeFrom(0);
    expect(ed.solution.value).toEqual([]);
    expect(ed.broken.value).toBeNull();
  });

  test('a new step in Solve never takes the id of a kept broken step', () => {
    const ed = make();
    const ids = buildBisector(ed, game);
    ed.toggleTarget(ids.line);
    ed.setMode('setup');
    ed.applySetup({ type: 'delete', ids: [ids.a] });
    const [c] = addPoints(ed, [[-1, 0]]) as [string];
    ed.enterSolve();
    add(game, [{ type: 'circle', center: c, through: ids.b }]);
    const all = ed.solution.value.flatMap((s) => s.objects.map((o) => o.id));
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
    expect(ed.broken.value).toBe(1);
    // The target follows its (renamed) object in the tail.
    const tailLine = ed.solution.value[4]!.objects[0]!;
    expect(tailLine.def.type).toBe('line');
    expect(ed.targets.value).toEqual([tailLine.id]);
  });

  test('moving a point so two circles no longer meet flags the intersection step', () => {
    const ed = make();
    const [a, b, c, d] = addPoints(ed, [
      [-1, 0],
      [0, 0],
      [1, 0],
      [2.5, 0],
    ]) as [string, string, string, string];
    ed.enterSolve();
    const [k1] = add(game, [{ type: 'circle', center: a, through: b }]) as [string];
    const [k2] = add(game, [{ type: 'circle', center: c, through: d }]) as [string];
    add(game, [{ type: 'intersection', a: k1, b: k2, index: 0 }]);
    expect(ed.broken.value).toBeNull();
    ed.setMode('setup');
    ed.applySetup({ type: 'move', id: b, pos: { x: -0.8, y: 0 } });
    expect(ed.broken.value).toBe(2);
    expect(ed.solution.value).toHaveLength(3);
  });

  test('removeFrom inside Solve trims the game construction too', () => {
    const ed = make();
    buildBisector(ed, game);
    ed.removeFrom(2);
    expect(ed.solution.value).toHaveLength(2);
    expect(game.construction().steps()).toHaveLength(2);
  });
});

describe('targets, details and validation', () => {
  test('toggleTarget on the line makes a complete problem valid; par clamps up', () => {
    const ed = make();
    const { line } = buildBisector(ed, game);
    completeDetails(ed);
    expect(ed.validation.value.ok).toBe(false);
    ed.toggleTarget(line);
    expect(ed.targets.value).toEqual([line]);
    const v = ed.validation.value;
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(ed.problem.value.par).toEqual({ L: 3, E: 3 });

    ed.setDetails({ par: { L: 1, E: 9 } });
    expect(ed.details.value.par).toEqual({ L: 3, E: 9 });
    expect(ed.problem.value.par).toEqual({ L: 3, E: 9 });
    ed.toggleTarget(line);
    expect(ed.targets.value).toEqual([]);
  });

  test('text is trimmed in the problem but kept raw in the fields', () => {
    const ed = make();
    ed.setDetails({ title: ' Bisector ', goalText: 'Do it. ', explain: '  ', author: ' ada ' });
    expect(ed.details.value.title).toBe(' Bisector ');
    expect(ed.problem.value.title).toBe('Bisector');
    expect(ed.problem.value.goalText).toBe('Do it.');
    expect(ed.problem.value.author).toBe('ada');
    expect('explain' in ed.problem.value).toBe(false);
    const { line } = buildBisector(ed, game);
    ed.setNudge(0, ' hint ');
    expect(ed.solution.value[0]!.nudge).toBe(' hint ');
    expect(ed.problem.value.solution![0]!.nudge).toBe('hint');
    ed.toggleTarget(line);
    const v = ed.validation.value;
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  test('perp-bisector toggle sets the tools', () => {
    const ed = make();
    expect(ed.problem.value.tools).toEqual(['point', 'line', 'circle']);
    ed.setDetails({ perpBisector: true });
    expect(ed.problem.value.tools).toEqual(['point', 'line', 'circle', 'perp-bisector']);
  });

  test('modeDone reflects each part', () => {
    const ed = make();
    expect(ed.modeDone.value).toEqual({ setup: false, solve: false, details: false, test: false });
    const { line } = buildBisector(ed, game);
    ed.toggleTarget(line);
    completeDetails(ed);
    expect(ed.modeDone.value).toEqual({ setup: true, solve: true, details: true, test: false });
  });
});

describe('test mode', () => {
  test('startTest is blocked while invalid; solving marks tested; any edit clears it', () => {
    const { storage, m } = memStorage();
    const ed = make(storage);
    const { line, b } = buildBisector(ed, game);
    expect(ed.startTest()).toBe(false);
    expect(game.currentLevel.value.id).toBe(`problem:${ed.localId}`);
    expect(game.isCustom.value).toBe(true);
    ed.toggleTarget(line);
    completeDetails(ed);
    expect(ed.startTest()).toBe(true);
    expect(ed.mode.value).toBe('test');
    expect(game.screen.value).toBe('level');
    expect(game.currentLevel.value.title).toBe('Bisector');
    playReferenceInto(game);
    expect(game.completion.value).not.toBeNull();
    expect(ed.tested.value).toBe(true);
    expect(ed.modeDone.value.test).toBe(true);

    game.exitCustomLevel();
    expect(game.screen.value).toBe('editor');
    expect(ed.mode.value).toBe('test');
    ed.exit();
    const saved = JSON.parse(m.get(DRAFTS_KEY)!);
    expect(saved.drafts[0].testedHash).toBe(problemHash(ed.problem.value as Problem));
    expect(saved.drafts[0].stars).toEqual([true, true, true]);

    ed.applySetup({ type: 'move', id: b, pos: { x: 1.2, y: 0 } });
    expect(ed.tested.value).toBe(false);
  });

  test('the test level does not share arrays with the editor', () => {
    const ed = make();
    const { line } = buildBisector(ed, game);
    ed.toggleTarget(line);
    completeDetails(ed);
    ed.startTest();
    const level = game.currentLevel.value;
    expect(level.givens).not.toBe(ed.problem.value.givens);
    expect(level.givens).toEqual(ed.problem.value.givens);
  });
});

describe('setup history', () => {
  test('allocId gives fresh g ids and nextLabel successive labels within a gesture', () => {
    const ed = make();
    expect([ed.allocId(), ed.allocId()]).toEqual(['g1', 'g2']);
    expect([ed.nextLabel(), ed.nextLabel()]).toEqual(['A', 'B']);
    ed.applySetup({ type: 'add', specs: [{ id: 'g1', def: point(0, 0) }], labels: { g1: 'A' } });
    ed.beginSetupGesture();
    expect(ed.nextLabel()).toBe('B');
    expect(ed.allocId()).toBe('g3');
  });

  test('undo/redo of edits', () => {
    const ed = make();
    const [a] = addPoints(ed, [[0, 0]]) as [string];
    addPoints(ed, [[1, 0]]);
    ed.undoSetup();
    expect(ed.setup.value.givens.map((g) => g.id)).toEqual([a]);
    ed.redoSetup();
    expect(ed.setup.value.givens).toHaveLength(2);
    ed.undoSetup();
    ed.undoSetup();
    expect(ed.setup.value.givens).toEqual([]);
    expect(ed.canUndoSetup.value).toBe(false);
  });

  test('a drag is one undo entry; positions are clamped', () => {
    const ed = make();
    const [a] = addPoints(ed, [[0, 0]]) as [string];
    ed.beginSetupGesture();
    ed.applySetup({ type: 'move', id: a, pos: { x: 1, y: 1 } });
    ed.applySetup({ type: 'move', id: a, pos: { x: 2, y: 2 } });
    ed.applySetup({ type: 'move', id: a, pos: { x: 500, y: -300 } });
    ed.endSetupGesture();
    expect(ed.setup.value.givens[0]!.def).toEqual(point(100, -100));
    ed.undoSetup();
    expect(ed.setup.value.givens[0]!.def).toEqual(point(0, 0));
    ed.redoSetup();
    expect(ed.setup.value.givens[0]!.def).toEqual(point(100, -100));
  });

  test('cancelling a drag restores the snapshot and records nothing', () => {
    const ed = make();
    const [a] = addPoints(ed, [[0, 0]]) as [string];
    ed.beginSetupGesture();
    ed.applySetup({ type: 'move', id: a, pos: { x: 3, y: 3 } });
    ed.cancelSetupGesture();
    expect(ed.setup.value.givens[0]!.def).toEqual(point(0, 0));
    ed.undoSetup();
    expect(ed.setup.value.givens).toEqual([]);
  });
});

describe('opening drafts', () => {
  test('a weird draft is normalised instead of crashing', () => {
    const d = draft();
    d.problem = {
      format: 'apollonius-problem',
      version: 1,
      title: 42,
      goalText: null,
      explain: ['x'],
      tools: 'all',
      givens: [null, 7, { id: 'A', def: point(0, 0) }, { id: 'B' }],
      labels: ['oops'],
      solution: { objects: [] },
      targets: 'r5',
      par: 'none',
    } as unknown as Draft['problem'];
    const ed = make(null, d);
    expect(ed.setup.value).toEqual({ givens: [{ id: 'A', def: point(0, 0) }], labels: {} });
    expect(ed.solution.value).toEqual([]);
    expect(ed.targets.value).toEqual([]);
    expect(ed.details.value).toEqual({
      title: '',
      goalText: '',
      explain: '',
      author: '',
      perpBisector: false,
      par: null,
    });
    expect(ed.validation.value.ok).toBe(false);
    expect(ed.broken.value).toBeNull();
  });

  test('labels with prototype keys are stored as own data only', () => {
    const d = draft();
    d.problem.givens = [{ id: '__proto__', def: point(0, 0) }];
    d.problem.labels = JSON.parse('{"__proto__":"A","B":5}');
    const ed = make(null, d);
    expect(Object.getPrototypeOf(ed.setup.value.labels)).toBe(Object.prototype);
    expect(Object.hasOwn(ed.setup.value.labels, '__proto__')).toBe(true);
    expect(ed.setup.value.labels).not.toHaveProperty('B');
  });

  test('a saved valid problem opens with its steps, nudges, targets and auto par', () => {
    const d = draft();
    const ed1 = make(null, d);
    const { line } = buildBisector(ed1, game);
    ed1.toggleTarget(line);
    ed1.setNudge(3, 'Join the crossings.');
    d.problem = ed1.problem.value;
    const ed2 = make(null, d);
    expect(ed2.solution.value).toEqual(ed1.solution.value);
    expect(ed2.targets.value).toEqual([line]);
    expect(ed2.details.value.par).toBeNull();
    expect(ed2.allocId()).toBe('g3');
  });
});

describe('autosave', () => {
  test('writes after 500 ms of quiet, exit flushes immediately', () => {
    vi.useFakeTimers();
    const { storage, m } = memStorage();
    let t = 5000;
    const ed = make(storage, draft(), () => t);
    addPoints(ed, [[0, 0]]);
    vi.advanceTimersByTime(499);
    expect(m.get(DRAFTS_KEY)).toBeUndefined();
    vi.advanceTimersByTime(1);
    const saved = JSON.parse(m.get(DRAFTS_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.drafts).toHaveLength(1);
    expect(saved.drafts[0].localId).toBe(ed.localId);
    expect(saved.drafts[0].updatedAt).toBe(5000);
    expect(saved.drafts[0].problem.givens).toHaveLength(1);

    t = 6000;
    ed.setDetails({ title: 'T' });
    ed.exit();
    const again = JSON.parse(m.get(DRAFTS_KEY)!);
    expect(again.drafts[0].problem.title).toBe('T');
    expect(again.drafts[0].updatedAt).toBe(6000);
    expect(game.screen.value).toBe('problems');
  });

  test('keeps other drafts in storage', () => {
    vi.useFakeTimers();
    const { storage, m } = memStorage();
    const other = newDraft(1, () => 0.1);
    m.set(DRAFTS_KEY, JSON.stringify({ version: 1, drafts: [other] }));
    const ed = make(storage);
    ed.setDetails({ title: 'X' });
    vi.advanceTimersByTime(500);
    const saved = JSON.parse(m.get(DRAFTS_KEY)!);
    expect(saved.drafts.map((d: Draft) => d.localId)).toEqual([other.localId, ed.localId]);
  });

  test('visibilitychange to hidden flushes', () => {
    vi.useFakeTimers();
    const { storage, m } = memStorage();
    const ed = make(storage);
    ed.setDetails({ title: 'X' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(m.get(DRAFTS_KEY)).toBeDefined();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  test('a throwing storage sets saveFailed and keeps the state', () => {
    vi.useFakeTimers();
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    const ed = make(throwing);
    addPoints(ed, [[0, 0]]);
    vi.advanceTimersByTime(500);
    expect(ed.saveFailed.value).toBe(true);
    expect(ed.setup.value.givens).toHaveLength(1);
  });

  test('nothing is saved just for opening', () => {
    vi.useFakeTimers();
    const { storage, m } = memStorage();
    make(storage);
    vi.advanceTimersByTime(2000);
    expect(m.get(DRAFTS_KEY)).toBeUndefined();
  });
});

describe('fix round 1', () => {
  test('a nudge survives undo/redo of its own step', () => {
    const ed = make();
    buildBisector(ed, game);
    ed.setNudge(3, 'Join the crossings.');
    game.undo();
    expect(ed.solution.value).toHaveLength(3);
    game.redo();
    expect(ed.solution.value[3]!.nudge).toBe('Join the crossings.');
  });

  test('Reset then Undo in Solve restores every nudge', () => {
    const ed = make();
    buildBisector(ed, game);
    ['one', 'two', 'three', 'four'].forEach((t, i) => ed.setNudge(i, t));
    game.reset();
    expect(ed.solution.value).toEqual([]);
    game.undo();
    expect(ed.solution.value.map((s) => s.nudge)).toEqual(['one', 'two', 'three', 'four']);
  });

  test("the game's Back in Solve returns to the editor in Setup", () => {
    const ed = make();
    buildBisector(ed, game);
    game.exitCustomLevel();
    expect(ed.mode.value).toBe('setup');
    expect(game.screen.value).toBe('editor');
    expect(game.isCustom.value).toBe(false);
    expect(ed.solution.value).toHaveLength(4);
  });

  test('an undone target is not inherited by a new object, and returns with its own', () => {
    const ed = make();
    const ids = buildBisector(ed, game);
    ed.toggleTarget(ids.line);
    const original = game.construction().steps()[3]!;
    game.undo();
    expect(ed.targets.value).toEqual([]);
    game.redo();
    expect(ed.targets.value).toEqual([ids.line]);

    game.undo();
    const [other] = add(game, [{ type: 'line', a: ids.a, b: ids.b }]) as [string];
    expect(ed.targets.value).toEqual([]);
    expect(ed.problem.value.targets).toEqual([]);
    game.undo();
    expect(game.apply({ type: 'add', objects: original }).ok).toBe(true);
    expect(ed.targets.value).toEqual([ids.line]);
    expect(ed.targets.value).not.toContain(other);
  });

  test('a target on a removed step is pruned', () => {
    const ed = make();
    const ids = buildBisector(ed, game);
    ed.toggleTarget(ids.line);
    ed.removeFrom(3);
    expect(ed.targets.value).toEqual([]);
    ed.toggleTarget('nope');
    expect(ed.targets.value).toEqual([]);
  });

  test('after reopening, a new point never takes an id a broken step refers to', () => {
    const d = draft();
    const ed1 = make(null, d);
    const { a } = buildBisector(ed1, game);
    ed1.setMode('setup');
    ed1.applySetup({ type: 'delete', ids: [a] });
    expect(ed1.broken.value).toBe(0);
    d.problem = ed1.problem.value;
    const ed2 = make(null, d);
    const [fresh] = addPoints(ed2, [[-1, 0]]) as [string];
    expect(fresh).not.toBe(a);
    expect(ed2.broken.value).toBe(0);
    expect(ed2.solution.value).toHaveLength(4);
  });

  test('dispose saves a pending edit', () => {
    vi.useFakeTimers();
    const { storage, m } = memStorage();
    const ed = make(storage);
    ed.setDetails({ title: 'Pending' });
    ed.dispose();
    expect(JSON.parse(m.get(DRAFTS_KEY)!).drafts[0].problem.title).toBe('Pending');
  });

  test('leaving Solve closes the sandbox so game input cannot reach it', () => {
    const ed = make();
    buildBisector(ed, game);
    ed.setMode('details');
    expect(game.isCustom.value).toBe(false);
    expect(game.screen.value).toBe('editor');
    const before = ed.solution.value;
    game.undo();
    expect(ed.solution.value).toBe(before);
    expect(game.construction().steps()).toEqual([]);
  });

  test('a Setup edit during Solve closes the sandbox too', () => {
    const ed = make();
    const { b } = buildBisector(ed, game);
    ed.applySetup({ type: 'move', id: b, pos: { x: 1.1, y: 0 } });
    expect(ed.mode.value).toBe('setup');
    expect(game.isCustom.value).toBe(false);
  });
});
