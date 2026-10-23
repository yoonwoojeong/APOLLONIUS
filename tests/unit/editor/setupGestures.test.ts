import { describe, expect, it } from 'vitest';
import { TAP_SLOP_PX } from '../../../src/canvas/gestures';
import {
  applyEdit,
  dependants,
  setupReducer,
  type SetupEdit,
  type SetupEvent,
  type SetupGestureState,
  type SetupModel,
  type SetupTarget,
  type SetupTool,
} from '../../../src/editor/setupGestures';

const v = (x: number, y: number) => ({ x, y });
const empty = (x: number, y: number): SetupTarget => ({ kind: 'empty', pos: v(x, y) });
const pt = (id: string, x: number, y: number): SetupTarget => ({
  kind: 'point',
  id,
  pos: v(x, y),
});
const down = (t: SetupTarget | null, x: number, y: number): SetupEvent => ({
  type: 'down',
  target: t,
  screen: v(x, y),
  world: v(x, y),
});
const move = (t: SetupTarget | null, x: number, y: number): SetupEvent => ({
  type: 'move',
  target: t,
  screen: v(x, y),
  world: v(x, y),
});
const up = (t: SetupTarget | null, x: number, y: number): SetupEvent => ({
  type: 'up',
  target: t,
  screen: v(x, y),
  world: v(x, y),
});

const IDLE: SetupGestureState = { mode: 'idle' };
const EMPTY_MODEL: SetupModel = { givens: [], labels: {} };

/** Runs events, applying edits to the model as the editor would (live). */
function run(
  tool: SetupTool,
  events: SetupEvent[],
  model: SetupModel = EMPTY_MODEL,
  hideCentre = false,
) {
  let state = IDLE;
  let m = model;
  let n = 0;
  const used = () => new Set(Object.values(m.labels));
  const pending = new Set<string>();
  const allocId = () => {
    do n++;
    while (m.givens.some((g) => g.id === `g${n}`));
    return `g${n}`;
  };
  const nextLabel = () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (!used().has(c) && !pending.has(c)) {
        pending.add(c);
        return c;
      }
    }
    return 'Z';
  };
  const edits: SetupEdit[] = [];
  let preview: ReturnType<typeof setupReducer>['preview'] = null;
  for (const ev of events) {
    const r = setupReducer(state, ev, { tool, hideCentre, model: m, allocId, nextLabel });
    state = r.state;
    preview = r.preview;
    for (const e of r.edits) {
      m = applyEdit(m, e);
      edits.push(e);
    }
    pending.clear();
  }
  return { state, model: m, edits, preview };
}

const tap = (t: SetupTarget, x: number, y: number): SetupEvent[] => [down(t, x, y), up(t, x, y)];

const withAB = (): SetupModel =>
  run('point', [...tap(empty(0, 0), 0, 0), ...tap(empty(100, 0), 100, 0)]).model;

describe('point tool', () => {
  it('tap places A then B with ids g1, g2', () => {
    const r = run('point', [...tap(empty(0, 0), 0, 0), ...tap(empty(100, 0), 100, 0)]);
    expect(r.model.givens).toEqual([
      { id: 'g1', def: { type: 'given-point', pos: v(0, 0) } },
      { id: 'g2', def: { type: 'given-point', pos: v(100, 0) } },
    ]);
    expect(r.model.labels).toEqual({ g1: 'A', g2: 'B' });
  });

  it('skips used labels', () => {
    const m: SetupModel = {
      givens: [{ id: 'g1', def: { type: 'given-point', pos: v(0, 0) } }],
      labels: { g1: 'A' },
    };
    const r = run('point', tap(empty(5, 5), 5, 5), m);
    expect(Object.values(r.model.labels)).toEqual(['A', 'B']);
  });

  it('a drag from empty space adds nothing', () => {
    const r = run('point', [
      down(empty(0, 0), 0, 0),
      move(empty(50, 0), 50, 0),
      up(empty(50, 0), 50, 0),
    ]);
    expect(r.edits).toEqual([]);
  });

  it('a tap on an existing point adds nothing', () => {
    const m = withAB();
    expect(run('point', tap(pt('g1', 0, 0), 0, 0), m).edits).toEqual([]);
  });

  it('dragging A beyond slop emits live move edits with the world pos', () => {
    const m = withAB();
    const r = run(
      'point',
      [
        down(pt('g1', 0, 0), 0, 0),
        move(pt('g1', 0, 0), TAP_SLOP_PX - 1, 0),
        move(empty(20, 30), 20, 30),
        move(empty(40, 30), 40, 30),
        up(empty(40, 30), 40, 30),
      ],
      m,
    );
    expect(r.edits).toEqual([
      { type: 'move', id: 'g1', pos: v(20, 30) },
      { type: 'move', id: 'g1', pos: v(40, 30) },
    ]);
    expect(r.model.givens[0]?.def).toEqual({ type: 'given-point', pos: v(40, 30) });
    expect(r.state).toEqual(IDLE);
  });

  it('never snaps a moving point onto another point: uses the raw world pos', () => {
    const m = withAB();
    const ev: SetupEvent = {
      type: 'move',
      target: pt('g2', 100, 0),
      screen: v(97, 2),
      world: v(97, 2),
    };
    const r = run('point', [down(pt('g1', 0, 0), 0, 0), ev], m);
    expect(r.edits).toEqual([{ type: 'move', id: 'g1', pos: v(97, 2) }]);
  });

  it('stays moving after leaving and re-entering the slop', () => {
    const m = withAB();
    const r = run(
      'point',
      [down(pt('g1', 0, 0), 0, 0), move(empty(30, 0), 30, 0), move(empty(1, 0), 1, 0)],
      m,
    );
    expect(r.edits).toHaveLength(2);
  });

  it('cancel and tool events return to idle without edits', () => {
    const m = withAB();
    const r = run(
      'point',
      [down(pt('g1', 0, 0), 0, 0), move(empty(30, 0), 30, 0), { type: 'cancel' }],
      m,
    );
    expect(r.state).toEqual(IDLE);
    const r2 = run('point', [down(pt('g1', 0, 0), 0, 0), { type: 'tool', tool: 'line' }], m);
    expect(r2.state).toEqual(IDLE);
  });
});

describe('line tools', () => {
  it('segment drag between A and B makes given-line extent segment', () => {
    const m = withAB();
    const r = run(
      'segment',
      [down(pt('g1', 0, 0), 0, 0), move(pt('g2', 100, 0), 100, 0), up(pt('g2', 100, 0), 100, 0)],
      m,
    );
    expect(r.edits).toEqual([
      {
        type: 'add',
        specs: [{ id: 'g3', def: { type: 'given-line', a: 'g1', b: 'g2', extent: 'segment' } }],
        labels: {},
      },
    ]);
  });

  it.each(['ray', 'line'] as const)('%s tool sets the extent', (tool) => {
    const m = withAB();
    const r = run(tool, [down(pt('g1', 0, 0), 0, 0), up(pt('g2', 100, 0), 100, 0)], m);
    const spec = r.model.givens[2];
    expect(spec?.def).toEqual({ type: 'given-line', a: 'g1', b: 'g2', extent: tool });
  });

  it('segment drag from empty to empty creates two points and the segment', () => {
    const r = run('segment', [
      down(empty(0, 0), 0, 0),
      move(empty(60, 0), 60, 0),
      up(empty(60, 0), 60, 0),
    ]);
    expect(r.model.givens).toEqual([
      { id: 'g1', def: { type: 'given-point', pos: v(0, 0) } },
      { id: 'g2', def: { type: 'given-point', pos: v(60, 0) } },
      { id: 'g3', def: { type: 'given-line', a: 'g1', b: 'g2', extent: 'segment' } },
    ]);
    expect(r.model.labels).toEqual({ g1: 'A', g2: 'B' });
    expect(r.edits).toHaveLength(1);
  });

  it('mixed ends reuse the existing point and create the other', () => {
    const m = withAB();
    const r = run('line', [down(pt('g1', 0, 0), 0, 0), up(empty(0, 80), 0, 80)], m);
    expect(r.model.givens.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(r.model.givens[3]?.def).toEqual({
      type: 'given-line',
      a: 'g1',
      b: 'g3',
      extent: 'line',
    });
    expect(r.model.labels.g3).toBe('C');
  });

  it('reports a preview while dragging and none after', () => {
    const m = withAB();
    const r = run('ray', [down(pt('g1', 0, 0), 0, 0), move(empty(50, 20), 50, 20)], m);
    expect(r.preview).toEqual({ kind: 'ray', from: v(0, 0), to: v(50, 20) });
    const r2 = run(
      'ray',
      [down(pt('g1', 0, 0), 0, 0), move(empty(50, 20), 50, 20), up(empty(50, 20), 50, 20)],
      m,
    );
    expect(r2.preview).toBeNull();
  });

  it('a tap, or ending on the starting point, adds nothing', () => {
    const m = withAB();
    expect(run('segment', tap(pt('g1', 0, 0), 0, 0), m).edits).toEqual([]);
    expect(run('segment', tap(empty(9, 9), 9, 9), m).edits).toEqual([]);
    const loop = [down(pt('g1', 0, 0), 0, 0), move(empty(50, 0), 50, 0), up(pt('g1', 0, 0), 0, 0)];
    expect(run('segment', loop, m).edits).toEqual([]);
  });

  it('handle presses are ignored outside the point tool', () => {
    const h: SetupTarget = { kind: 'handle', id: 'g1', which: 'centre', pos: v(0, 0) };
    expect(
      run('segment', [down(h, 0, 0), move(empty(50, 0), 50, 0), up(empty(50, 0), 50, 0)]).edits,
    ).toEqual([]);
  });
});

describe('circle tool', () => {
  it('visible: centre point, through point and a circle def', () => {
    const r = run('circle', [
      down(empty(0, 0), 0, 0),
      move(empty(30, 40), 30, 40),
      up(empty(30, 40), 30, 40),
    ]);
    expect(r.model.givens).toEqual([
      { id: 'g1', def: { type: 'given-point', pos: v(0, 0) } },
      { id: 'g2', def: { type: 'given-point', pos: v(30, 40) } },
      { id: 'g3', def: { type: 'circle', center: 'g1', through: 'g2' } },
    ]);
    expect(r.model.labels).toEqual({ g1: 'A', g2: 'B' });
  });

  it('hidden centre: one given-circle and no point', () => {
    const r = run(
      'circle',
      [down(empty(0, 0), 0, 0), move(empty(30, 40), 30, 40), up(empty(30, 40), 30, 40)],
      EMPTY_MODEL,
      true,
    );
    expect(r.model.givens).toEqual([
      { id: 'g1', def: { type: 'given-circle', c: v(0, 0), r: 50 } },
    ]);
    expect(r.model.labels).toEqual({});
  });

  it('hidden centre snapped to an existing point uses its position', () => {
    const m = withAB();
    const r = run('circle', [down(pt('g2', 100, 0), 100, 0), up(empty(100, 25), 100, 25)], m, true);
    expect(r.model.givens[2]?.def).toEqual({ type: 'given-circle', c: v(100, 0), r: 25 });
    expect(r.model.givens).toHaveLength(3);
  });

  it('visible circle reuses existing centre and through points', () => {
    const m = withAB();
    const r = run('circle', [down(pt('g1', 0, 0), 0, 0), up(pt('g2', 100, 0), 100, 0)], m);
    expect(r.model.givens).toHaveLength(3);
    expect(r.model.givens[2]?.def).toEqual({ type: 'circle', center: 'g1', through: 'g2' });
  });

  it('previews a circle', () => {
    const r = run('circle', [down(empty(0, 0), 0, 0), move(empty(30, 40), 30, 40)]);
    expect(r.preview).toEqual({ kind: 'circle', from: v(0, 0), to: v(30, 40) });
  });
});

describe('hidden circle handles', () => {
  const hidden = (): SetupModel =>
    run('circle', [down(empty(0, 0), 0, 0), up(empty(50, 0), 50, 0)], EMPTY_MODEL, true).model;

  it('dragging the centre handle emits move-circle c', () => {
    const m = hidden();
    const h: SetupTarget = { kind: 'handle', id: 'g1', which: 'centre', pos: v(0, 0) };
    const r = run(
      'point',
      [down(h, 0, 0), move(empty(10, 10), 10, 10), up(empty(10, 10), 10, 10)],
      m,
    );
    expect(r.edits).toEqual([{ type: 'move-circle', id: 'g1', c: v(10, 10) }]);
    expect(r.model.givens[0]?.def).toEqual({ type: 'given-circle', c: v(10, 10), r: 50 });
  });

  it('dragging the rim handle emits move-circle r from the live centre', () => {
    const m = hidden();
    const h: SetupTarget = { kind: 'handle', id: 'g1', which: 'rim', pos: v(50, 0) };
    const r = run('point', [down(h, 50, 0), move(empty(0, 70), 0, 70)], m);
    expect(r.edits).toEqual([{ type: 'move-circle', id: 'g1', r: 70 }]);
  });

  it('a tap on a handle does nothing', () => {
    const m = hidden();
    const h: SetupTarget = { kind: 'handle', id: 'g1', which: 'rim', pos: v(50, 0) };
    expect(run('point', tap(h, 50, 0), m).edits).toEqual([]);
  });
});

describe('dependants and delete', () => {
  /** A(g1), B(g2), segment AB (g3), circle centred at A through B (g4), segment on nothing else. */
  const model = (): SetupModel => {
    const a = withAB();
    const s = run('segment', [down(pt('g1', 0, 0), 0, 0), up(pt('g2', 100, 0), 100, 0)], a).model;
    return run('circle', [down(pt('g1', 0, 0), 0, 0), up(pt('g2', 100, 0), 100, 0)], s).model;
  };

  it('dependants(A) includes the segment and the circle centred at A, not A itself', () => {
    expect(dependants(model(), 'g1')).toEqual(['g3', 'g4']);
  });

  it('is transitive and in model order', () => {
    const m: SetupModel = {
      givens: [
        { id: 'p', def: { type: 'given-point', pos: v(0, 0) } },
        { id: 'q', def: { type: 'given-point', pos: v(1, 1) } },
        { id: 'c', def: { type: 'circle', center: 'p', through: 'q' } },
        { id: 'z', def: { type: 'given-point', pos: v(5, 5) } },
        { id: 'l', def: { type: 'given-line', a: 'c', b: 'z', extent: 'line' } },
      ],
      labels: {},
    };
    expect(dependants(m, 'p')).toEqual(['c', 'l']);
    expect(dependants(m, 'z')).toEqual(['l']);
    expect(dependants(m, 'l')).toEqual([]);
  });

  it('delete A removes the segment and circle too, plus labels', () => {
    const m = model();
    const out = applyEdit(m, { type: 'delete', ids: ['g1'] });
    expect(out.givens.map((g) => g.id)).toEqual(['g2']);
    expect(out.labels).toEqual({ g2: 'B' });
  });

  it('delete of a leaf leaves the rest', () => {
    const out = applyEdit(model(), { type: 'delete', ids: ['g3'] });
    expect(out.givens.map((g) => g.id)).toEqual(['g1', 'g2', 'g4']);
  });
});

describe('applyEdit', () => {
  it('never mutates its input', () => {
    const m = withAB();
    const snap = JSON.stringify(m);
    applyEdit(m, { type: 'move', id: 'g1', pos: v(9, 9) });
    applyEdit(m, { type: 'delete', ids: ['g1'] });
    applyEdit(m, { type: 'relabel', id: 'g1', label: 'Q' });
    applyEdit(m, { type: 'add', specs: [], labels: { x: 'Y' } });
    expect(JSON.stringify(m)).toBe(snap);
  });

  it('does not pollute prototypes through label keys', () => {
    const labels = JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, string>;
    const out = applyEdit(EMPTY_MODEL, { type: 'add', specs: [], labels });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out.labels)).toBe(Object.prototype);
  });

  it("relabel accepts 1-3 chars of [A-Za-z0-9′']", () => {
    const m = withAB();
    for (const label of ['Q', 'A′', "B'", 'x1', 'abc', '9']) {
      expect(applyEdit(m, { type: 'relabel', id: 'g1', label }).labels.g1).toBe(label);
    }
  });

  it('relabel rejects invalid labels', () => {
    const m = withAB();
    for (const label of ['', 'ABCD', 'A B', '<', 'é', 'A-', '\n']) {
      expect(applyEdit(m, { type: 'relabel', id: 'g1', label })).toBe(m);
    }
  });

  it('relabel rejects duplicates and unknown ids', () => {
    const m = withAB();
    expect(applyEdit(m, { type: 'relabel', id: 'g1', label: 'B' })).toBe(m);
    expect(applyEdit(m, { type: 'relabel', id: 'nope', label: 'Q' })).toBe(m);
  });
});
