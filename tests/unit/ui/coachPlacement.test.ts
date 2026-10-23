import { describe, expect, it } from 'vitest';
import { avoidSamples, placeCaption } from '../../../src/ui/coachPlacement';
import type { Vec } from '../../../src/geometry/vec';

const area = { w: 800, h: 600 };
const box = { w: 220, h: 44 };

/** Distance from `p` to the caption rect at `at`. */
const gap = (at: Vec, p: Vec): number => {
  const dx = Math.max(at.x - p.x, 0, p.x - (at.x + box.w));
  const dy = Math.max(at.y - p.y, 0, p.y - (at.y + box.h));
  return Math.hypot(dx, dy);
};
const inside = (at: Vec) =>
  at.x >= 0 && at.y >= 0 && at.x + box.w <= area.w && at.y + box.h <= area.h;

const ring = (c: Vec, r: number): Vec[] =>
  Array.from({ length: 120 }, (_, i) => ({
    x: c.x + r * Math.cos((i / 120) * 2 * Math.PI),
    y: c.y + r * Math.sin((i / 120) * 2 * Math.PI),
  }));

describe('placeCaption', () => {
  const A = { x: 300, y: 300 };
  const B = { x: 500, y: 300 };

  it('sits close to the targets without covering them', () => {
    const at = placeCaption({ area, box, targets: [A, B], avoid: [] });
    expect(inside(at)).toBe(true);
    expect(Math.min(gap(at, A), gap(at, B))).toBeGreaterThanOrEqual(20);
    expect(Math.min(gap(at, A), gap(at, B))).toBeLessThan(80);
  });

  it('keeps clear of the curves it is told to avoid when there is room', () => {
    const avoid = [...ring(A, 200), ...ring(B, 200)];
    const at = placeCaption({ area, box, targets: [A, B], avoid });
    expect(inside(at)).toBe(true);
    expect(avoid.every((p) => gap(at, p) > 0)).toBe(true);
    expect(Math.min(gap(at, A), gap(at, B))).toBeGreaterThanOrEqual(20);
  });

  it('stays inside a phone-sized area, even near its edge', () => {
    const small = { w: 390, h: 520 };
    const at = placeCaption({ area: small, box, targets: [{ x: 380, y: 10 }], avoid: [] });
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.x + box.w).toBeLessThanOrEqual(small.w);
    expect(at.y + box.h).toBeLessThanOrEqual(small.h);
  });
});

describe('avoidSamples', () => {
  const vp = { cx: 0, cy: 0, scale: 100, width: 800, height: 600 };
  const scene = { objects: [], byId: new Map(), tol: 1e-9 };

  it('keeps an upcoming circle whole but an upcoming line only near the targets', () => {
    const circle = avoidSamples(scene, [{ kind: 'circle', c: { x: 0, y: 0 }, r: 1 }], vp, [
      { x: 400, y: 300 },
    ]);
    expect(circle.some((p) => Math.abs(p.x - 500) < 1)).toBe(true); // radius 100 px
    const line = avoidSamples(scene, [{ kind: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 } }], vp, [
      { x: 400, y: 300 },
    ]);
    expect(line.length).toBeGreaterThan(0);
    expect(line.every((p) => Math.abs(p.x - 400) <= 56)).toBe(true);
  });
});
