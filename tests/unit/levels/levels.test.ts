import { describe, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import type { ObjSpec } from '../../../src/construction/types';
import { LEVELS, levelById } from '../../../src/levels';
import { isCurve, pos } from '../../../src/levels/goals';
import { fit, toScreen } from '../../../src/canvas/viewport';
import type { Vec } from '../../../src/geometry/vec';
import { playReference } from '../helpers';

const fresh = (id: Parameters<typeof levelById>[0]) => {
  const l = levelById(id);
  return { l, c: new Construction(l.givens, l.labels, l.sceneDiameter) };
};
const add = (c: Construction, objects: ObjSpec[]) =>
  expect(c.apply({ type: 'add', objects }).ok).toBe(true);

describe('levels', () => {
  test.each(LEVELS)('$id: reference solution reaches the goal', (lvl) => {
    const c = playReference(lvl);
    expect(lvl.goal(c.scene())).not.toBeNull();
  });

  test.each(LEVELS)('$id: reference meets L/E targets', (lvl) => {
    const m = playReference(lvl).moves();
    expect(m.L).toBeLessThanOrEqual(lvl.targets.L);
    expect(m.E).toBeLessThanOrEqual(lvl.targets.E);
  });

  test.each(LEVELS)('$id: reference matches L/E targets exactly', (lvl) => {
    expect(playReference(lvl).moves()).toEqual(lvl.targets);
  });

  // Phone canvas: 390 px wide, conservatively 600 px tall; 24 px padding as in useViewport.
  test.each(LEVELS)('$id: reference crossings are >= 40 px from other points on a phone', (lvl) => {
    const vp = fit(lvl.view, 390, 600, 24);
    const c = new Construction(lvl.givens, lvl.labels, lvl.sceneDiameter);
    const points = (): Map<string, Vec> =>
      new Map(
        c
          .scene()
          .objects.filter((o) => o.value && !isCurve(o.value))
          .map((o) => [o.id, o.value as Vec]),
      );
    for (const step of lvl.reference) {
      const before = points();
      add(c, step.objects);
      const after = points();
      for (const o of step.objects) {
        if (o.def.type !== 'intersection') continue;
        const p = toScreen(vp, after.get(o.id) as Vec);
        for (const [id, q] of before) {
          const d = Math.hypot(p.x - toScreen(vp, q).x, p.y - toScreen(vp, q).y);
          expect(d, `${o.id} vs ${id}`).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  test.each(LEVELS)('$id: givens alone do not satisfy the goal', (lvl) => {
    const c = new Construction(lvl.givens, lvl.labels, lvl.sceneDiameter);
    expect(lvl.goal(c.scene())).toBeNull();
  });

  test.each(LEVELS)('$id: view frames the givens and sceneDiameter is its diagonal', (lvl) => {
    expect(lvl.sceneDiameter).toBeCloseTo(Math.hypot(lvl.view.w, lvl.view.h), 12);
    for (const o of lvl.givens) {
      const v = o.def.type === 'given-point' ? o.def.pos : null;
      if (!v) continue;
      expect(v.x).toBeGreaterThan(lvl.view.x);
      expect(v.x).toBeLessThan(lvl.view.x + lvl.view.w);
      expect(v.y).toBeGreaterThan(lvl.view.y);
      expect(v.y).toBeLessThan(lvl.view.y + lvl.view.h);
    }
  });

  test('equilateral: lines to the other intersection (idx 1) also pass', () => {
    const { l, c } = fresh('equilateral');
    add(c, [{ id: 'k1', def: { type: 'circle', center: 'A', through: 'B' } }]);
    add(c, [{ id: 'k2', def: { type: 'circle', center: 'B', through: 'A' } }]);
    add(c, [{ id: 'k3', def: { type: 'intersection', a: 'k1', b: 'k2', index: 1 } }]);
    add(c, [
      { id: 'k4', def: { type: 'line', a: 'A', b: 'k3' } },
      { id: 'k5', def: { type: 'line', a: 'B', b: 'k3' } },
    ]);
    expect(l.goal(c.scene())).not.toBeNull();
  });

  test('equilateral: missing one side line fails', () => {
    const { l, c } = fresh('equilateral');
    add(c, [{ id: 'k1', def: { type: 'circle', center: 'A', through: 'B' } }]);
    add(c, [{ id: 'k2', def: { type: 'circle', center: 'B', through: 'A' } }]);
    add(c, [{ id: 'k3', def: { type: 'intersection', a: 'k1', b: 'k2', index: 0 } }]);
    add(c, [{ id: 'k4', def: { type: 'line', a: 'A', b: 'k3' } }]);
    expect(l.goal(c.scene())).toBeNull();
  });

  test('equilateral: isosceles near-miss (C slightly off) fails', () => {
    const { l, c } = fresh('equilateral');
    add(c, [
      { id: 'k1', def: { type: 'free-point', pos: { x: 0, y: Math.sqrt(3) + 1e-3 } } },
      { id: 'k4', def: { type: 'line', a: 'A', b: 'k1' } },
      { id: 'k5', def: { type: 'line', a: 'B', b: 'k1' } },
    ]);
    expect(l.goal(c.scene())).toBeNull();
  });

  test('perp-bisector: a line through only one circle intersection and A fails', () => {
    const { l, c } = fresh('perp-bisector');
    add(c, [{ id: 'k1', def: { type: 'circle', center: 'A', through: 'B' } }]);
    add(c, [{ id: 'k2', def: { type: 'circle', center: 'B', through: 'A' } }]);
    add(c, [{ id: 'k3', def: { type: 'intersection', a: 'k1', b: 'k2', index: 0 } }]);
    add(c, [{ id: 'k4', def: { type: 'line', a: 'A', b: 'k3' } }]);
    expect(l.goal(c.scene())).toBeNull();
  });

  test('perpendicular: a line through P at 89.9 degrees fails', () => {
    const { l, c } = fresh('perpendicular');
    const s = c.scene();
    const p = pos(s, 'P');
    const a = pos(s, 'A');
    const ang = Math.atan2(p.y - a.y, p.x - a.x) + (89.9 * Math.PI) / 180;
    add(c, [
      {
        id: 'k1',
        def: { type: 'free-point', pos: { x: p.x + Math.cos(ang), y: p.y + Math.sin(ang) } },
      },
      { id: 'k2', def: { type: 'line', a: 'P', b: 'k1' } },
    ]);
    expect(l.goal(c.scene())).toBeNull();
  });

  test('perpendicular: a line at exactly 90 degrees through P passes', () => {
    const { l, c } = fresh('perpendicular');
    const p = pos(c.scene(), 'P');
    const a = pos(c.scene(), 'A');
    const ang = Math.atan2(p.y - a.y, p.x - a.x) + Math.PI / 2;
    add(c, [
      {
        id: 'k1',
        def: { type: 'free-point', pos: { x: p.x + Math.cos(ang), y: p.y + Math.sin(ang) } },
      },
      { id: 'k2', def: { type: 'line', a: 'P', b: 'k1' } },
    ]);
    expect(l.goal(c.scene())).not.toBeNull();
  });

  test('angle-bisector: the external bisector fails', () => {
    const { l, c } = fresh('angle-bisector');
    const s = c.scene();
    const v = pos(s, 'V');
    const a = pos(s, 'A');
    const b = pos(s, 'B');
    const ua = {
      x: (a.x - v.x) / Math.hypot(a.x - v.x, a.y - v.y),
      y: (a.y - v.y) / Math.hypot(a.x - v.x, a.y - v.y),
    };
    const ub = {
      x: (b.x - v.x) / Math.hypot(b.x - v.x, b.y - v.y),
      y: (b.y - v.y) / Math.hypot(b.x - v.x, b.y - v.y),
    };
    const ext = { x: ua.x - ub.x, y: ua.y - ub.y };
    add(c, [
      { id: 'k1', def: { type: 'free-point', pos: { x: v.x + ext.x, y: v.y + ext.y } } },
      { id: 'k2', def: { type: 'line', a: 'V', b: 'k1' } },
    ]);
    expect(l.goal(c.scene())).toBeNull();
  });

  test('goals read current given values: moving B still accepts a rebuilt reference', () => {
    const l = levelById('midpoint');
    const moved = l.givens.map((g) =>
      g.id === 'B' ? { ...g, def: { type: 'given-point' as const, pos: { x: 1.5, y: 0.4 } } } : g,
    );
    const c = new Construction(moved, l.labels, l.sceneDiameter);
    for (const step of l.reference) add(c, step.objects);
    expect(l.goal(c.scene())).not.toBeNull();
  });

  test('levels 1-3 do not offer perp-bisector; 4-6 do', () => {
    for (const l of LEVELS) {
      expect(l.tools.includes('perp-bisector')).toBe(l.number >= 4);
    }
  });

  test('midpoint unlocks perp-bisector and no other level unlocks anything', () => {
    expect(levelById('midpoint').unlocks).toBe('perp-bisector');
    expect(LEVELS.filter((l) => l.unlocks).map((l) => l.id)).toEqual(['midpoint']);
  });

  test('levels are ordered 1-6 and levelById finds each', () => {
    expect(LEVELS.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const l of LEVELS) expect(levelById(l.id)).toBe(l);
  });
});
