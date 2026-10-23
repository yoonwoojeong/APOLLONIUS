import { describe, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import type { ObjSpec } from '../../../src/construction/types';
import { eqCurve, eqPoint, perpBisector, pointAt, type Curve } from '../../../src/geometry/curves';
import type { Vec } from '../../../src/geometry/vec';
import { LEVELS, levelById } from '../../../src/levels';
import type { Level } from '../../../src/levels/types';
import { nextHint } from '../../../src/reasoning/hints';
import { playReference } from '../helpers';

const PREFIX = 'Try starting from the given points. ';

function build(level: Level, ...steps: ObjSpec[][]): Construction {
  const c = new Construction(level.givens, level.labels, level.sceneDiameter);
  for (const objects of steps) expect(c.apply({ type: 'add', objects }).ok).toBe(true);
  return c;
}

const circle = (id: string, center: string, through: string): ObjSpec => ({
  id,
  def: { type: 'circle', center, through },
});

describe('nextHint', () => {
  const eq = levelById('equilateral');

  test('empty scene → step 0 with its nudge', () => {
    const h = nextHint(eq, build(eq).scene());
    expect(h).not.toBeNull();
    expect(h?.stepIndex).toBe(0);
    expect(h?.nudge).toBe(eq.reference[0]?.nudge);
    expect(h?.inputIds).toEqual(['A', 'B']);
    expect(h?.ghost).toHaveLength(1);
  });

  test('after first reference circle → step 1', () => {
    const h = nextHint(eq, build(eq, [circle('o1', 'A', 'B')]).scene());
    expect(h?.stepIndex).toBe(1);
    expect(h?.nudge).toBe(eq.reference[1]?.nudge);
    expect(h?.inputIds).toEqual(['B', 'A']);
  });

  test('equivalent progress in a different order is recognised', () => {
    // Circle B→A is reference step 1; step 0 (circle A→B) is still missing.
    const h = nextHint(eq, build(eq, [circle('o1', 'B', 'A')]).scene());
    expect(h?.stepIndex).toBe(0);
    expect(h?.nudge).toBe(eq.reference[0]?.nudge);
  });

  test('player circles drawn in another order still map (step order irrelevant)', () => {
    const s = build(eq, [circle('o1', 'B', 'A')], [circle('o2', 'A', 'B')]).scene();
    const h = nextHint(eq, s);
    expect(h?.stepIndex).toBe(2);
    expect(h?.inputIds).toEqual(['o2', 'o1']);
  });

  test('unrelated objects only → nudge starts with "Try starting from the given points."', () => {
    const s = build(eq, [{ id: 'o1', def: { type: 'free-point', pos: { x: 5, y: 5 } } }]).scene();
    const h = nextHint(eq, s);
    expect(h?.stepIndex).toBe(0);
    expect(h?.nudge).toBe(PREFIX + eq.reference[0]?.nudge);
  });

  test('no prefix once a reference object is matched', () => {
    const s = build(
      eq,
      [circle('o1', 'A', 'B')],
      [{ id: 'o2', def: { type: 'free-point', pos: { x: 5, y: 5 } } }],
    ).scene();
    expect(nextHint(eq, s)?.nudge).toBe(eq.reference[1]?.nudge);
  });

  test('inputIds refer to player ids, not reference ids', () => {
    const s = build(
      eq,
      [circle('o1', 'A', 'B')],
      [circle('o2', 'B', 'A')],
      [{ id: 'o3', def: { type: 'intersection', a: 'o1', b: 'o2', index: 0 } }],
    ).scene();
    const h = nextHint(eq, s);
    expect(h?.stepIndex).toBe(3);
    expect(h?.inputIds).toEqual(['A', 'o3', 'B']);
    expect(h?.ghost).toHaveLength(2);
  });

  test('circle-center: player points at other angles still map to the reference points', () => {
    const lvl = levelById('circle-center');
    const ts = [1.0, 3.0, 5.0];
    const pts: ObjSpec[] = ts.map((t, i) => ({
      id: `o${i + 1}`,
      def: { type: 'on-curve', curve: 'circle', t },
    }));
    const s = build(lvl, pts, [
      { id: 'o4', def: { type: 'perp-bisector', a: 'o1', b: 'o2' } },
    ]).scene();
    const h = nextHint(lvl, s);
    expect(h?.stepIndex).toBe(1);
    expect(h?.inputIds).toEqual(['o1', 'o2', 'o3']);
    expect(h?.ghost).toHaveLength(1);
    const c = s.byId.get('circle')?.value as Curve;
    const p = ts.map((t): Vec => pointAt(c, t));
    const expected = perpBisector(p[1] as Vec, p[2] as Vec) as Curve;
    expect(eqCurve(h?.ghost[0] as Curve, expected, s.tol)).toBe(true);
  });

  test('circle-center: two player points → step 0 asks for the missing one', () => {
    const lvl = levelById('circle-center');
    const s = build(lvl, [
      { id: 'o1', def: { type: 'on-curve', curve: 'circle', t: 1 } },
      { id: 'o2', def: { type: 'on-curve', curve: 'circle', t: 3 } },
    ]).scene();
    const h = nextHint(lvl, s);
    expect(h?.stepIndex).toBe(0);
    expect(h?.ghost).toHaveLength(1);
    expect(h?.nudge).toBe(lvl.reference[0]?.nudge);
  });

  test.each([
    ['o1', 'o2'],
    ['o2', 'o1'],
  ])('equilateral: the lower apex via intersection(%s, %s) is recognised', (ca, cb) => {
    const scenes = ([0, 1] as const).map((index) =>
      build(
        eq,
        [circle('o1', 'A', 'B')],
        [circle('o2', 'B', 'A')],
        [{ id: 'o3', def: { type: 'intersection', a: ca, b: cb, index } }],
        [{ id: 'o4', def: { type: 'line', a: 'A', b: 'o3' } }],
      ).scene(),
    );
    const s = scenes.find((sc) => (sc.byId.get('o3')?.value as Vec).y < 0);
    if (!s) throw new Error('no lower apex');
    const apex = s.byId.get('o3')?.value as Vec;
    const h = nextHint(eq, s);
    expect(h?.stepIndex).toBe(3);
    expect(h?.inputIds).toEqual(['A', 'o3', 'B']);
    expect(h?.ghost).toHaveLength(1);
    const b = s.byId.get('B')?.value as Vec;
    const expected = { kind: 'line', p: b, d: { x: apex.x - b.x, y: apex.y - b.y } } as Curve;
    expect(eqCurve(h?.ghost[0] as Curve, expected, s.tol)).toBe(true);
  });

  test('circle-center: hub bisectors (o1–o2, o1–o3) map → step 2 ghosting the centre', () => {
    const lvl = levelById('circle-center');
    const pts: ObjSpec[] = [1.0, 3.0, 5.0].map((t, i) => ({
      id: `o${i + 1}`,
      def: { type: 'on-curve', curve: 'circle', t },
    }));
    const s = build(
      lvl,
      pts,
      [{ id: 'o4', def: { type: 'perp-bisector', a: 'o1', b: 'o2' } }],
      [{ id: 'o5', def: { type: 'perp-bisector', a: 'o1', b: 'o3' } }],
    ).scene();
    const h = nextHint(lvl, s);
    expect(h?.stepIndex).toBe(2);
    expect([...(h?.inputIds ?? [])].sort()).toEqual(['o4', 'o5']);
    const c = s.byId.get('circle')?.value as { c: Vec };
    expect(h?.ghost).toHaveLength(1);
    expect(eqPoint(h?.ghost[0] as Vec, c.c, s.tol)).toBe(true);
  });

  test.each(LEVELS)('$id: each reference prefix targets the next step', (lvl) => {
    for (let k = 0; k < lvl.reference.length; k++) {
      const c = build(lvl, ...lvl.reference.slice(0, k).map((st) => st.objects));
      expect(nextHint(lvl, c.scene())?.stepIndex).toBe(k);
    }
  });

  test.each(LEVELS)('$id: goal met → null', (lvl) => {
    expect(nextHint(lvl, playReference(lvl).scene())).toBeNull();
  });
});
