import { describe, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import { evaluate } from '../../../src/construction/evaluate';
import type { ObjSpec } from '../../../src/construction/types';
import { levelById } from '../../../src/levels';
import { FALLBACK } from '../../../src/levels/explain';
import type { Level } from '../../../src/levels/types';
import { isRobust, mulberry32 } from '../../../src/reasoning/robustness';
import { nextHint } from '../../../src/reasoning/hints';
import { NUDGE_FALLBACK, problemPoints, type Problem } from '../../../src/problems/format';
import { toLevel } from '../../../src/problems/load';
import { validate } from '../../../src/problems/validate';
import level1Fixture from '../../fixtures/problems/level1.json';
import perpBisectorFixture from '../../fixtures/problems/valid-perp-bisector.json';
import { playReference } from '../helpers';

const loadProblem = (raw: unknown): Problem => {
  const r = validate(structuredClone(raw));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.problem;
};
const specsOf = (l: Level): ObjSpec[] => [...l.givens, ...l.reference.flatMap((s) => s.objects)];

describe('toLevel', () => {
  test('maps problem fields onto a Level', () => {
    const p = loadProblem(perpBisectorFixture);
    const l = toLevel(p, 'problem:abc');
    expect(l.id).toBe('problem:abc');
    expect(l.number).toBeUndefined();
    expect(l.unlocks).toBeUndefined();
    expect(l.coach).toBeUndefined();
    expect(l.tip).toBeUndefined();
    expect(l.title).toBe(p.title);
    expect(l.goalText).toBe(p.goalText);
    expect(l.givens).toEqual(p.givens);
    expect(l.labels).toEqual(p.labels);
    expect(l.targets).toEqual(p.par);
    expect(l.tools).toEqual(p.tools);
    expect(l.sceneDiameter).toBeCloseTo(Math.hypot(l.view.w, l.view.h), 12);
  });

  test('reference of the valid fixture reaches the goal and is robust', () => {
    const l = toLevel(loadProblem(perpBisectorFixture), 'problem:pb');
    expect(l.goal(playReference(l).scene())).not.toBeNull();
    expect(isRobust(l, specsOf(l), mulberry32(7))).toBe(true);
  });

  test('play and validation frame every solution circle whole (centre ± r on both axes)', () => {
    const p = loadProblem(level1Fixture);
    const pts = problemPoints(p);
    // Circles A→B (centre -1, r 2) and B→A (centre 1, r 2).
    for (const q of [
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      { x: -1, y: 2 },
      { x: -1, y: -2 },
      { x: 1, y: 2 },
      { x: 1, y: -2 },
    ]) {
      expect(pts.some((v) => Math.abs(v.x - q.x) < 1e-9 && Math.abs(v.y - q.y) < 1e-9)).toBe(true);
    }
    const { view } = toLevel(p, 'problem:x');
    expect(view.x).toBeLessThan(-3);
    expect(view.x + view.w).toBeGreaterThan(3);
    expect(view.y).toBeLessThan(-2);
    expect(view.y + view.h).toBeGreaterThan(2);
  });

  test('explain falls back when the problem has none', () => {
    const p = loadProblem(perpBisectorFixture);
    const none = { ...p, explain: undefined };
    const l = toLevel(none, 'problem:x');
    expect(l.explain([], playReference(l).scene(), { ids: [], gold: [] })).toBe(FALLBACK);
    const withText = toLevel({ ...p, explain: 'Because.' }, 'problem:y');
    expect(withText.explain([], playReference(withText).scene(), { ids: [], gold: [] })).toBe(
      'Because.',
    );
  });

  test('nextHint on an empty scene returns the first step nudge, or the fallback', () => {
    const p = loadProblem(perpBisectorFixture);
    const l = toLevel(p, 'problem:h');
    const c = new Construction(l.givens, l.labels, l.sceneDiameter);
    expect(nextHint(l, c.scene())?.nudge).toBe(p.solution[0]?.nudge);

    const blank = structuredClone(p);
    const first = blank.solution[0];
    if (first) first.nudge = '';
    const l2 = toLevel(blank, 'problem:h2');
    const c2 = new Construction(l2.givens, l2.labels, l2.sceneDiameter);
    expect(l2.reference[0]?.nudge).toBe(NUDGE_FALLBACK);
    expect(nextHint(l2, c2.scene())?.nudge).toBe(NUDGE_FALLBACK);
  });
});

describe('parity with built-in level 1', () => {
  const builtIn = levelById('equilateral');
  const loaded = toLevel(loadProblem(level1Fixture), 'problem:level1');

  /** Reference circles about A and B, plus an isosceles apex C and its two lines. */
  const wrong = (l: Level): Construction => {
    const c = new Construction(l.givens, l.labels, l.sceneDiameter);
    const add = (objects: ObjSpec[]) => expect(c.apply({ type: 'add', objects }).ok).toBe(true);
    add([{ id: 'w1', def: { type: 'free-point', pos: { x: 0, y: 1 } } }]);
    add([{ id: 'w2', def: { type: 'line', a: 'A', b: 'w1' } }]);
    add([{ id: 'w3', def: { type: 'line', a: 'B', b: 'w1' } }]);
    return c;
  };

  test.each([
    ['built-in', builtIn],
    ['loaded', loaded],
  ] as const)('%s: reference satisfies the goal', (_n, l) => {
    const c = playReference(l);
    expect(l.goal(c.scene())).not.toBeNull();
    expect(evaluate(specsOf(l), l.sceneDiameter).objects.every((o) => o.value)).toBe(true);
  });

  test.each([
    ['built-in', builtIn],
    ['loaded', loaded],
  ] as const)('%s: an isosceles C fails the goal', (_n, l) => {
    expect(l.goal(wrong(l).scene())).toBeNull();
  });

  test('reference moves are {L:4,E:4} for both', () => {
    expect(playReference(builtIn).moves()).toEqual({ L: 4, E: 4 });
    expect(playReference(loaded).moves()).toEqual({ L: 4, E: 4 });
  });
});

describe('mirror-image solutions', () => {
  const builtIn = levelById('equilateral');
  const loaded = toLevel(loadProblem(level1Fixture), 'problem:level1m');

  /** Both circles, then the lower apex C and its two lines. */
  const lower = (l: Level): Construction => {
    const c = new Construction(l.givens, l.labels, l.sceneDiameter);
    const add = (objects: ObjSpec[]) => expect(c.apply({ type: 'add', objects }).ok).toBe(true);
    add([{ id: 'm1', def: { type: 'circle', center: 'A', through: 'B' } }]);
    add([{ id: 'm2', def: { type: 'circle', center: 'B', through: 'A' } }]);
    add([{ id: 'm3', def: { type: 'intersection', a: 'm1', b: 'm2', index: 1 } }]);
    add([{ id: 'm4', def: { type: 'line', a: 'A', b: 'm3' } }]);
    add([{ id: 'm5', def: { type: 'line', a: 'B', b: 'm3' } }]);
    return c;
  };

  test('the lower apex satisfies the built-in goal and the loaded goal', () => {
    expect(builtIn.goal(lower(builtIn).scene())).not.toBeNull();
    expect(loaded.goal(lower(loaded).scene())).not.toBeNull();
  });

  test('gold is the matched variant (the lower apex)', () => {
    const m = loaded.goal(lower(loaded).scene());
    const apex = m?.gold[0];
    expect(apex && !('kind' in apex) ? apex.y : 0).toBeCloseTo(-Math.sqrt(3), 9);
  });

  test('a midpoint target is unaffected', () => {
    const l = toLevel(loadProblem(perpBisectorFixture), 'problem:pbm');
    expect(l.goal(playReference(l).scene())).not.toBeNull();
    const c = new Construction(l.givens, l.labels, l.sceneDiameter);
    expect(l.goal(c.scene())).toBeNull();
  });

  /** Givens A, B; free points F0..F9 on rays from A; X_k = the far crossing of AF_k with c1. */
  const manyCrossings = (): Problem => {
    const base = loadProblem(level1Fixture);
    const objs: ObjSpec[] = [{ id: 'q1', def: { type: 'circle', center: 'A', through: 'B' } }];
    for (let k = 0; k < 10; k++) {
      const ang = 0.3 + 0.25 * k;
      objs.push(
        {
          id: `F${k}`,
          def: { type: 'free-point', pos: { x: -1 + Math.cos(ang), y: Math.sin(ang) } },
        },
        { id: `n${k}`, def: { type: 'line', a: 'A', b: `F${k}` } },
        { id: `X${k}`, def: { type: 'intersection', a: 'q1', b: `n${k}`, index: 0 } },
      );
    }
    objs.push(
      { id: 'T0', def: { type: 'line', a: 'X0', b: 'X1' } },
      { id: 'T1', def: { type: 'line', a: 'X2', b: 'X3' } },
      { id: 'T2', def: { type: 'line', a: 'X4', b: 'X5' } },
      { id: 'u6', def: { type: 'line', a: 'X6', b: 'X7' } },
      { id: 'u8', def: { type: 'line', a: 'X8', b: 'X9' } },
      { id: 'T3', def: { type: 'intersection', a: 'u6', b: 'u8', index: 0 } },
    );
    return {
      ...base,
      solution: [{ objects: objs, nudge: '' }],
      targets: ['T0', 'T1', 'T2', 'T3'],
    };
  };

  test('the variant cap holds for a reference with 10 distinct intersections', () => {
    const l = toLevel(manyCrossings(), 'problem:cap');
    expect(l.goal(playReference(l).scene())).not.toBeNull();
    const c = new Construction(l.givens, l.labels, l.sceneDiameter);
    const t0 = performance.now();
    expect(l.goal(c.scene())).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  test('a flipped variant is rejected unless a symmetry of the givens maps the targets onto it', () => {
    const base = loadProblem(level1Fixture);
    const givens: ObjSpec[] = [
      ...base.givens,
      { id: 'C', def: { type: 'given-point', pos: { x: 0, y: 1 } } },
      { id: 'D', def: { type: 'given-point', pos: { x: 0, y: 2.5 } } },
    ];
    const steps = (i: 0 | 1, j: 0 | 1): ObjSpec[] => [
      { id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } },
      { id: 'c2', def: { type: 'circle', center: 'B', through: 'A' } },
      { id: 'I', def: { type: 'intersection', a: 'c1', b: 'c2', index: i } },
      { id: 'ln', def: { type: 'line', a: 'A', b: 'I' } },
      { id: 'c3', def: { type: 'circle', center: 'C', through: 'D' } },
      { id: 'J', def: { type: 'intersection', a: 'ln', b: 'c3', index: j } },
    ];
    const l = toLevel(
      {
        ...base,
        givens,
        labels: { ...base.labels, C: 'C', D: 'D' },
        solution: [{ objects: steps(0, 0), nudge: '' }],
        targets: ['J'],
      },
      'problem:ij',
    );
    const play = (i: 0 | 1, j: 0 | 1): Construction => {
      const c = new Construction(l.givens, l.labels, l.sceneDiameter);
      expect(c.apply({ type: 'add', objects: steps(i, j) }).ok).toBe(true);
      return c;
    };
    expect(l.goal(play(0, 0).scene())).not.toBeNull();
    for (const [i, j] of [
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      const scene = play(i, j).scene();
      expect(scene.byId.get('J')?.value).not.toBeNull(); // J' exists, it is just not a solution
      expect(l.goal(scene)).toBeNull();
    }
  });
});
