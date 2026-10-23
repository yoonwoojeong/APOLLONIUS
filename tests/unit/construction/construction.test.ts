import { describe as suite, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import { evaluate } from '../../../src/construction/evaluate';
import type { Command, ObjDef, ObjSpec } from '../../../src/construction/types';

const givens: ObjSpec[] = [
  { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
  { id: 'B', def: { type: 'given-point', pos: { x: 2, y: 0 } } },
];
const mk = () => new Construction(givens, { A: 'A', B: 'B' }, 10);
const addCircle = (center: string, through: string, id = 'k'): Command => ({
  type: 'add',
  objects: [{ id, def: { type: 'circle', center, through } }],
});
const addLine = (a: string, b: string, id = 'l'): Command => ({
  type: 'add',
  objects: [{ id, def: { type: 'line', a, b } }],
});
const addPerp = (a: string, b: string): Command => ({
  type: 'add',
  objects: [{ id: 'p', def: { type: 'perp-bisector', a, b } }],
});

suite('Construction', () => {
  test('adding a circle counts 1L 1E', () => {
    const c = mk();
    expect(c.apply(addCircle('A', 'B'))).toEqual({ ok: true, ids: ['k'] });
    expect(c.moves()).toEqual({ L: 1, E: 1 });
  });

  test('perp-bisector counts 1L 3E', () => {
    const c = mk();
    c.apply(addPerp('A', 'B'));
    expect(c.moves()).toEqual({ L: 1, E: 3 });
  });

  test('points and intersections are free', () => {
    const c = mk();
    c.apply(addCircle('A', 'B', 'k1'));
    c.apply(addCircle('B', 'A', 'k2'));
    const r = c.apply({
      type: 'add',
      objects: [
        { id: 'x', def: { type: 'intersection', a: 'k1', b: 'k2', index: 0 } },
        { id: 'f', def: { type: 'free-point', pos: { x: 1, y: 1 } } },
        { id: 'oc', def: { type: 'on-curve', curve: 'k1', t: 1 } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(c.moves()).toEqual({ L: 2, E: 2 });
  });

  test('undo removes the last command; redo restores it', () => {
    const c = mk();
    c.apply(addCircle('A', 'B'));
    expect(c.undo()).toBe(true);
    expect(c.scene().byId.has('k')).toBe(false);
    expect(c.moves()).toEqual({ L: 0, E: 0 });
    expect(c.canRedo()).toBe(true);
    expect(c.redo()).toBe(true);
    expect(c.scene().byId.has('k')).toBe(true);
    expect(c.undo() && c.undo()).toBe(false);
    expect(c.canUndo()).toBe(false);
    expect(c.redo()).toBe(true);
    expect(c.redo()).toBe(false);
  });

  test('apply after undo truncates the redo tail', () => {
    const c = mk();
    c.apply(addCircle('A', 'B'));
    c.undo();
    c.apply(addCircle('B', 'A'));
    expect(c.canRedo()).toBe(false);
  });

  test('reset clears non-givens and is itself undoable', () => {
    const c = mk();
    c.apply(addCircle('A', 'B'));
    c.apply({ type: 'reset' });
    expect(c.scene().objects.map((o) => o.id)).toEqual(['A', 'B']);
    expect(c.moves()).toEqual({ L: 0, E: 0 });
    c.undo();
    expect(c.scene().byId.has('k')).toBe(true);
    expect(c.moves()).toEqual({ L: 1, E: 1 });
    c.redo();
    expect(c.scene().byId.has('k')).toBe(false);
  });

  test('duplicate circle is rejected with existingId and no move is counted', () => {
    const c = mk();
    c.apply(addCircle('A', 'B', 'k1'));
    expect(c.apply(addCircle('A', 'B', 'k2'))).toEqual({
      ok: false,
      reason: 'duplicate',
      existingId: 'k1',
    });
    expect(c.moves()).toEqual({ L: 1, E: 1 });
    expect(c.canRedo()).toBe(false);
    expect(c.scene().byId.has('k2')).toBe(false);
  });

  test('line A->A is degenerate', () => {
    expect(mk().apply(addLine('A', 'A'))).toEqual({ ok: false, reason: 'degenerate' });
  });

  test('player points are labelled C, D, E ... skipping given labels', () => {
    const c = new Construction(givens, { A: 'A', B: 'B' }, 10);
    c.apply({
      type: 'add',
      objects: [
        { id: 'p1', def: { type: 'free-point', pos: { x: 1, y: 1 } } },
        { id: 'p2', def: { type: 'free-point', pos: { x: 2, y: 2 } } },
      ],
    });
    expect(c.scene().byId.get('p1')?.label).toBe('C');
    expect(c.scene().byId.get('p2')?.label).toBe('D');
    expect(c.scene().byId.get('A')?.label).toBe('A');
    const d = new Construction(givens, { A: 'C', B: 'D' }, 10);
    d.apply(addCircle('A', 'B'));
    d.apply({ type: 'add', objects: [{ id: 'q', def: { type: 'free-point', pos: { x: 1, y: 1 } } }] });
    expect(d.scene().byId.get('q')?.label).toBe('E');
    expect(d.scene().byId.get('k')?.label).toBeUndefined();
    d.undo();
    d.apply({ type: 'add', objects: [{ id: 'r', def: { type: 'free-point', pos: { x: 3, y: 1 } } }] });
    expect(d.scene().byId.get('r')?.label).toBe('E');
  });

  test('evaluate with overrides recomputes dependants', () => {
    const c = mk();
    c.apply(addCircle('A', 'B'));
    const over = new Map<string, ObjDef>([['B', { type: 'given-point', pos: { x: 5, y: 0 } }]]);
    const s = evaluate(c.specs(), 10, over);
    expect(s.byId.get('k')?.value).toMatchObject({ kind: 'circle', r: 5 });
  });

  test('dependant of a null value is null', () => {
    const specs: ObjSpec[] = [
      ...givens,
      { id: 'k', def: { type: 'circle', center: 'A', through: 'B' } },
      { id: 'k2', def: { type: 'circle', center: 'B', through: 'A' } },
      { id: 'x', def: { type: 'intersection', a: 'k', b: 'k2', index: 1 } },
      { id: 'y', def: { type: 'intersection', a: 'k', b: 'k', index: 1 } },
      { id: 'z', def: { type: 'line', a: 'y', b: 'A' } },
      { id: 'w', def: { type: 'on-curve', curve: 'z', t: 1 } },
    ];
    const s = evaluate(specs, 10);
    expect(s.byId.get('x')?.value).not.toBeNull();
    expect(s.byId.get('y')?.value).toBeNull();
    expect(s.byId.get('z')?.value).toBeNull();
    expect(s.byId.get('w')?.value).toBeNull();
  });

  test('lastChange reports added/removed ids and whether it was an apply, undo or redo', () => {
    const c = mk();
    c.apply(addCircle('A', 'B'));
    expect(c.lastChange()).toEqual({ added: ['k'], removed: [], kind: 'apply' });
    c.undo();
    expect(c.lastChange()).toEqual({ added: [], removed: ['k'], kind: 'undo' });
    c.redo();
    expect(c.lastChange()).toEqual({ added: ['k'], removed: [], kind: 'redo' });
  });

  test('allocId yields o1, o2 and specs lists givens then objects', () => {
    const c = mk();
    expect(c.allocId()).toBe('o1');
    expect(c.allocId()).toBe('o2');
    c.apply(addCircle('A', 'B'));
    expect(c.specs().map((s) => s.id)).toEqual(['A', 'B', 'k']);
  });
});
