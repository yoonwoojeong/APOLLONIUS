import { describe, expect, it } from 'vitest';
import {
  fit,
  panBy,
  toScreen,
  toWorld,
  visibleWorldRect,
  zoomAt,
} from '../../../src/canvas/viewport';
import type { Viewport } from '../../../src/canvas/viewport';

const vp: Viewport = { cx: 3, cy: -2, scale: 40, width: 800, height: 600 };

describe('toScreen / toWorld', () => {
  it('puts (cx, cy) at the screen centre', () => {
    expect(toScreen(vp, { x: 3, y: -2 })).toEqual({ x: 400, y: 300 });
  });
  it('round-trips', () => {
    const p = { x: -7.25, y: 11.5 };
    const q = toWorld(vp, toScreen(vp, p));
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });
  it('does not flip y', () => {
    expect(toScreen(vp, { x: 3, y: -1 }).y).toBeGreaterThan(300);
  });
});

describe('zoomAt', () => {
  const limits = { min: 5, max: 200 };
  it('keeps the anchor fixed', () => {
    const s = { x: 123, y: 456 };
    const before = toWorld(vp, s);
    const z = zoomAt(vp, s, 1.7, limits);
    expect(z.scale).toBeCloseTo(68, 9);
    const after = toWorld(z, s);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
  it('clamps to the limits and still keeps the anchor', () => {
    const s = { x: 10, y: 20 };
    const before = toWorld(vp, s);
    const hi = zoomAt(vp, s, 1000, limits);
    expect(hi.scale).toBe(200);
    expect(toWorld(hi, s).x).toBeCloseTo(before.x, 9);
    expect(zoomAt(vp, s, 1e-6, limits).scale).toBe(5);
  });
});

describe('panBy', () => {
  it('moves content with the pointer', () => {
    const p = panBy(vp, { x: 40, y: -80 });
    expect(p.cx).toBeCloseTo(2, 9);
    expect(p.cy).toBeCloseTo(0, 9);
    const w = { x: 5, y: 5 };
    const a = toScreen(vp, w);
    const b = toScreen(p, w);
    expect(b.x - a.x).toBeCloseTo(40, 9);
    expect(b.y - a.y).toBeCloseTo(-80, 9);
  });
});

describe('fit', () => {
  const bounds = { x: -3, y: 2, w: 10, h: 6 };
  for (const [w, h] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    it(`centres bounds and keeps corners inside padding at ${w}x${h}`, () => {
      const pad = 24;
      const f = fit(bounds, w, h, pad);
      expect(f.width).toBe(w);
      expect(f.height).toBe(h);
      expect(f.cx).toBeCloseTo(2, 9);
      expect(f.cy).toBeCloseTo(5, 9);
      for (const x of [bounds.x, bounds.x + bounds.w]) {
        for (const y of [bounds.y, bounds.y + bounds.h]) {
          const s = toScreen(f, { x, y });
          expect(s.x).toBeGreaterThanOrEqual(pad - 1e-9);
          expect(s.x).toBeLessThanOrEqual(w - pad + 1e-9);
          expect(s.y).toBeGreaterThanOrEqual(pad - 1e-9);
          expect(s.y).toBeLessThanOrEqual(h - pad + 1e-9);
        }
      }
    });
  }
  it('stays positive when padding exceeds the size or bounds are degenerate', () => {
    expect(fit(bounds, 30, 30, 50).scale).toBeGreaterThan(0);
    const d = fit({ x: 1, y: 1, w: 0, h: 0 }, 300, 300, 10);
    expect(d.scale).toBeGreaterThan(0);
    expect(Number.isFinite(d.scale)).toBe(true);
  });
});

describe('visibleWorldRect', () => {
  it('spans the screen in world units', () => {
    const r = visibleWorldRect(vp);
    expect(r.w).toBeCloseTo(20, 9);
    expect(r.h).toBeCloseTo(15, 9);
    expect(r.x).toBeCloseTo(-7, 9);
    expect(r.y).toBeCloseTo(-9.5, 9);
  });
});
