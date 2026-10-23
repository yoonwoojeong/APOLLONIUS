import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/construction/evaluate';
import type { ObjSpec } from '../../../src/construction/types';
import { LEVELS, levelById } from '../../../src/levels';
import { isRobust, mulberry32, perturbGivens } from '../../../src/reasoning/robustness';
import { playReference } from '../helpers';

describe('robustness', () => {
  test.each(LEVELS)('$id: reference solution is robust', (lvl) => {
    expect(isRobust(lvl, playReference(lvl).specs(), mulberry32(1))).toBe(true);
  });

  test('midpoint: a free point placed exactly at the midpoint is not robust', () => {
    const lvl = levelById('midpoint');
    const specs: ObjSpec[] = [
      ...lvl.givens,
      { id: 'o1', def: { type: 'free-point', pos: { x: 0, y: 0 } } },
    ];
    expect(lvl.goal(evaluate(specs, lvl.sceneDiameter))).not.toBeNull();
    expect(isRobust(lvl, specs, mulberry32(1))).toBe(false);
  });

  test('a rebuild containing null fails', () => {
    const lvl = levelById('equilateral');
    const a = lvl.givens[0]!;
    // A perpendicular bisector of a point with itself evaluates to null.
    const specs: ObjSpec[] = [
      ...lvl.givens,
      { id: 'o1', def: { type: 'perp-bisector', a: a.id, b: a.id } },
    ];
    expect(evaluate(specs, lvl.sceneDiameter).byId.get('o1')?.value).toBeNull();
    expect(isRobust(lvl, specs, mulberry32(1))).toBe(false);
  });

  test('perturbation moves each given point by at most 10% of sceneDiameter', () => {
    const rng = mulberry32(7);
    for (const lvl of LEVELS) {
      for (let i = 0; i < 20; i++) {
        const overrides = perturbGivens(lvl, rng);
        for (const g of lvl.givens) {
          const o = overrides.get(g.id);
          if (g.def.type === 'given-point') {
            expect(o?.type).toBe('given-point');
            if (o?.type !== 'given-point') continue;
            const d = Math.hypot(o.pos.x - g.def.pos.x, o.pos.y - g.def.pos.y);
            expect(d).toBeLessThanOrEqual(0.1 * lvl.sceneDiameter + 1e-12);
          } else if (g.def.type === 'given-circle') {
            if (o?.type !== 'given-circle') throw new Error('expected circle');
            const d = Math.hypot(o.c.x - g.def.c.x, o.c.y - g.def.c.y);
            expect(d).toBeLessThanOrEqual(0.1 * lvl.sceneDiameter + 1e-12);
            expect(o.r / g.def.r).toBeGreaterThanOrEqual(0.9 - 1e-12);
            expect(o.r / g.def.r).toBeLessThanOrEqual(1.1 + 1e-12);
          } else {
            expect(o).toBeUndefined();
          }
        }
      }
    }
  });

  test('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
