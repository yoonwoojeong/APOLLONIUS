import { describe, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import { evaluate } from '../../../src/construction/evaluate';
import type { ObjSpec } from '../../../src/construction/types';
import { levelById } from '../../../src/levels';
import { FALLBACK } from '../../../src/levels/explain';
import type { Level } from '../../../src/levels/types';
import { isRobust, mulberry32 } from '../../../src/reasoning/robustness';
import { nextHint } from '../../../src/reasoning/hints';
import { NUDGE_FALLBACK, type Problem } from '../../../src/problems/format';
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
