import { expect, test } from 'vitest';
import {
  circleThrough,
  distToCurve,
  eqCurve,
  eqPoint,
  lineThrough,
  onCurve,
  paramOf,
  perpBisector,
  pointAt,
} from '../../../src/geometry/curves';
import { tol } from '../../../src/geometry/tolerance';
import { normalize, perp } from '../../../src/geometry/vec';

test('lineThrough is null for coincident points', () =>
  expect(lineThrough({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull());

test('lineThrough has unit direction and p = a', () => {
  const l = lineThrough({ x: 1, y: 1 }, { x: 4, y: 5 })!;
  expect(l.p).toEqual({ x: 1, y: 1 });
  expect(l.d.x).toBeCloseTo(0.6);
  expect(l.d.y).toBeCloseTo(0.8);
});

test('perpBisector of (0,0),(2,0) is x = 1', () => {
  const l = perpBisector({ x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(eqCurve(l, lineThrough({ x: 1, y: -5 }, { x: 1, y: 5 })!, 1e-9)).toBe(true);
});

test('perpBisector is null for coincident points', () =>
  expect(perpBisector({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull());

test('eqCurve ignores line direction', () =>
  expect(
    eqCurve(
      lineThrough({ x: 0, y: 0 }, { x: 1, y: 1 })!,
      lineThrough({ x: 2, y: 2 }, { x: -1, y: -1 })!,
      1e-9,
    ),
  ).toBe(true));

test('eqCurve distinguishes parallel lines, circles and kinds', () => {
  const l1 = lineThrough({ x: 0, y: 0 }, { x: 1, y: 0 })!;
  const l2 = lineThrough({ x: 0, y: 1 }, { x: 1, y: 1 })!;
  expect(eqCurve(l1, l2, 1e-9)).toBe(false);
  const c1 = circleThrough({ x: 0, y: 0 }, { x: 1, y: 0 })!;
  const c2 = circleThrough({ x: 0, y: 0 }, { x: 0, y: -1 })!;
  const c3 = circleThrough({ x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(eqCurve(c1, c2, 1e-9)).toBe(true);
  expect(eqCurve(c1, c3, 1e-9)).toBe(false);
  expect(eqCurve(c1, l1, 1e-9)).toBe(false);
});

test('pointAt(paramOf(q)) round-trips on line and circle', () => {
  const l = lineThrough({ x: 1, y: 2 }, { x: 4, y: 6 })!;
  const q = { x: 7, y: 10 };
  expect(eqPoint(pointAt(l, paramOf(l, q)), q, 1e-9)).toBe(true);
  const c = circleThrough({ x: 1, y: 1 }, { x: 4, y: 1 })!;
  const r = { x: 1 + 3 * Math.cos(2), y: 1 + 3 * Math.sin(2) };
  expect(eqPoint(pointAt(c, paramOf(c, r)), r, 1e-9)).toBe(true);
});

test('circleThrough is null for zero radius', () =>
  expect(circleThrough({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull());

test('circleThrough radius is dist(c, q)', () =>
  expect(circleThrough({ x: 0, y: 0 }, { x: 3, y: 4 })!.r).toBe(5));

test('onCurve and distToCurve', () => {
  const c = circleThrough({ x: 0, y: 0 }, { x: 2, y: 0 })!;
  expect(onCurve({ x: 0, y: 2 }, c, 1e-9)).toBe(true);
  expect(onCurve({ x: 0, y: 2.1 }, c, 1e-9)).toBe(false);
  expect(distToCurve({ x: 0, y: 5 }, c)).toBeCloseTo(3);
  const l = lineThrough({ x: 0, y: 0 }, { x: 1, y: 0 })!;
  expect(distToCurve({ x: 3, y: -4 }, l)).toBeCloseTo(4);
  expect(onCurve({ x: 9, y: 0 }, l, 1e-9)).toBe(true);
});

test('vec helpers: perp rotates +90 degrees, normalize null for zero', () => {
  expect(perp({ x: 1, y: 0 })).toEqual({ x: -0, y: 1 });
  expect(normalize({ x: 0, y: 0 })).toBeNull();
});

test('tol scales with scene diameter', () => expect(tol(10)).toBeCloseTo(1e-8, 15));
