import { describe, expect, it } from 'vitest';
import {
  circlePath,
  gridOpacity,
  linePath,
  magnifierPlacement,
  objectShapes,
} from '../../../src/canvas/shapes';
import { fit, panBy } from '../../../src/canvas/viewport';
import { Construction } from '../../../src/construction/construction';
import { levelById } from '../../../src/levels';
import type { LineG } from '../../../src/geometry/curves';

const rect = { x: 0, y: 0, w: 100, h: 50 };
const horizontal: LineG = { kind: 'line', p: { x: 40, y: 5 }, d: { x: 1, y: 0 } };

describe('linePath', () => {
  it('clips a horizontal line to the rect', () => {
    expect(linePath(horizontal, rect)).toEqual({ x1: 0, y1: 5, x2: 100, y2: 5 });
  });

  it('clips a diagonal line to the rect', () => {
    const l: LineG = { kind: 'line', p: { x: 0, y: 0 }, d: { x: Math.SQRT1_2, y: Math.SQRT1_2 } };
    const s = linePath(l, rect)!;
    expect(s.x1).toBeCloseTo(0);
    expect(s.y1).toBeCloseTo(0);
    expect(s.x2).toBeCloseTo(50);
    expect(s.y2).toBeCloseTo(50);
  });

  it('returns null when the line misses the rect', () => {
    expect(linePath({ ...horizontal, p: { x: 0, y: 80 } }, rect)).toBeNull();
  });

  it('keeps a segment extent between its endpoints, starting at `from`', () => {
    expect(linePath(horizontal, rect, { from: { x: 70, y: 5 }, to: { x: 20, y: 5 } })).toEqual({
      x1: 70,
      y1: 5,
      x2: 20,
      y2: 5,
    });
  });

  it('clips a segment that leaves the rect', () => {
    expect(linePath(horizontal, rect, { from: { x: 60, y: 5 }, to: { x: 300, y: 5 } })).toEqual({
      x1: 60,
      y1: 5,
      x2: 100,
      y2: 5,
    });
  });

  it('starts a ray at its vertex and runs along the line direction', () => {
    expect(linePath(horizontal, rect, { from: { x: 30, y: 5 } })).toEqual({
      x1: 30,
      y1: 5,
      x2: 100,
      y2: 5,
    });
  });

  it('starts a ray whose vertex is off-screen at the rect edge', () => {
    expect(linePath(horizontal, rect, { from: { x: -30, y: 5 } })).toEqual({
      x1: 0,
      y1: 5,
      x2: 100,
      y2: 5,
    });
    expect(linePath(horizontal, rect, { from: { x: 130, y: 5 } })).toBeNull();
  });
});

describe('circlePath', () => {
  it('begins with M start and closes back on it with two arcs', () => {
    const d = circlePath({ kind: 'circle', c: { x: 50, y: 50 }, r: 10 }, { x: 60, y: 50 });
    expect(d.startsWith('M 60 50')).toBe(true);
    expect(d.match(/A /g)).toHaveLength(2);
    expect(d).toContain('40 50');
    expect(d.endsWith('60 50')).toBe(true);
  });

  it('projects a start that is off the circle onto it', () => {
    const d = circlePath({ kind: 'circle', c: { x: 0, y: 0 }, r: 10 }, { x: 0, y: 3 });
    expect(d.startsWith('M 0 10')).toBe(true);
  });
});

describe('gridOpacity', () => {
  it('is 1 at and above half the fit scale and eases to 0 at a quarter', () => {
    expect(gridOpacity(100, 100)).toBe(1);
    expect(gridOpacity(50, 100)).toBe(1);
    expect(gridOpacity(37.5, 100)).toBeCloseTo(0.5);
    expect(gridOpacity(25, 100)).toBe(0);
  });
});

describe('magnifierPlacement', () => {
  it('centres the loupe 72 px above the touch point', () => {
    expect(magnifierPlacement({ x: 200, y: 300 }, { width: 400, height: 600 })).toEqual({
      x: 200,
      y: 228,
      flipped: false,
    });
  });

  it('flips below the touch point near the top edge', () => {
    expect(magnifierPlacement({ x: 200, y: 40 }, { width: 400, height: 600 })).toEqual({
      x: 200,
      y: 112,
      flipped: true,
    });
  });

  it('keeps the loupe inside the canvas horizontally', () => {
    expect(magnifierPlacement({ x: 10, y: 300 }, { width: 400, height: 600 }).x).toBe(56);
  });
});

describe('objectShapes keys', () => {
  it('keeps a stable key for each ray of a player line when one is clipped away', () => {
    const level = levelById('equilateral');
    const c = new Construction(level.givens, level.labels, level.sceneDiameter);
    c.apply({
      type: 'add',
      objects: [
        { id: 'p1', def: { type: 'free-point', pos: { x: -1, y: -1 } } },
        { id: 'l1', def: { type: 'line', a: 'A', b: 'p1' } },
      ],
    });
    const s = c.scene();
    const line = s.byId.get('l1')!;
    const vp = fit(level.view, 800, 600, 24);
    expect(objectShapes(line, s, vp).map((x) => x.key)).toEqual(['fwd', 'back']);
    // Pan the line's first point A off one edge, then the other: each time one ray is
    // clipped away and the survivor keeps its own key (no remount, no replayed draw-on).
    const down = objectShapes(line, s, panBy(vp, { x: 0, y: 2000 })).map((x) => x.key);
    const up = objectShapes(line, s, panBy(vp, { x: 0, y: -2000 })).map((x) => x.key);
    expect(down).toHaveLength(1);
    expect(up).toHaveLength(1);
    expect([...down, ...up].sort()).toEqual(['back', 'fwd']);
  });
});
