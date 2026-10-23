import { expect, test } from 'vitest';
import { circleThrough, lineThrough, paramOf } from '../../../src/geometry/curves';
import { intersect } from '../../../src/geometry/intersect';
import { cross, sub } from '../../../src/geometry/vec';

const O = { x: 0, y: 0 };

test('parallel lines → []', () =>
  expect(
    intersect(lineThrough(O, { x: 1, y: 0 })!, lineThrough({ x: 0, y: 1 }, { x: 1, y: 1 })!, 1e-9),
  ).toEqual([]));

test('coincident lines → []', () =>
  expect(
    intersect(lineThrough(O, { x: 1, y: 1 })!, lineThrough({ x: 2, y: 2 }, { x: 3, y: 3 })!, 1e-9),
  ).toEqual([]));

test('line–line crossing → one point', () => {
  const pts = intersect(
    lineThrough(O, { x: 1, y: 1 })!,
    lineThrough({ x: 0, y: 2 }, { x: 2, y: 0 })!,
    1e-9,
  );
  expect(pts).toHaveLength(1);
  expect(pts[0]!.x).toBeCloseTo(1);
  expect(pts[0]!.y).toBeCloseTo(1);
});

test('circle–circle two points; index 0 is left of c1→c2', () => {
  const pts = intersect(circleThrough(O, { x: 2, y: 0 })!, circleThrough({ x: 2, y: 0 }, O)!, 1e-9);
  expect(pts).toHaveLength(2);
  expect(cross(sub({ x: 2, y: 0 }, O), sub(pts[0]!, O))).toBeGreaterThan(0);
  expect(pts[0]!.x).toBeCloseTo(1);
  expect(pts[0]!.y).toBeCloseTo(Math.sqrt(3));
});

test('circle–circle ordering is swapped consistently with argument order', () => {
  const a = circleThrough(O, { x: 2, y: 0 })!;
  const b = circleThrough({ x: 2, y: 0 }, O)!;
  const ab = intersect(a, b, 1e-9);
  const ba = intersect(b, a, 1e-9);
  expect(ab[0]!.y).toBeGreaterThan(0);
  expect(ba[0]!.y).toBeLessThan(0);
});

test('externally tangent circles → exactly one point', () => {
  const pts = intersect(
    circleThrough(O, { x: 1, y: 0 })!,
    circleThrough({ x: 2, y: 0 }, { x: 1, y: 0 })!,
    1e-9,
  );
  expect(pts).toHaveLength(1);
  expect(pts[0]!.x).toBeCloseTo(1);
  expect(pts[0]!.y).toBeCloseTo(0);
});

test('internally tangent circles → exactly one point', () => {
  const pts = intersect(
    circleThrough(O, { x: 2, y: 0 })!,
    circleThrough({ x: 1, y: 0 }, { x: 2, y: 0 })!,
    1e-9,
  );
  expect(pts).toHaveLength(1);
  expect(pts[0]!.x).toBeCloseTo(2);
});

test('concentric / disjoint / nested circles → []', () => {
  expect(
    intersect(circleThrough(O, { x: 1, y: 0 })!, circleThrough(O, { x: 2, y: 0 })!, 1e-9),
  ).toEqual([]);
  expect(
    intersect(
      circleThrough(O, { x: 1, y: 0 })!,
      circleThrough({ x: 5, y: 0 }, { x: 6, y: 0 })!,
      1e-9,
    ),
  ).toEqual([]);
  expect(
    intersect(
      circleThrough(O, { x: 5, y: 0 })!,
      circleThrough({ x: 1, y: 0 }, { x: 2, y: 0 })!,
      1e-9,
    ),
  ).toEqual([]);
});

test('line–circle: index 0 has smaller paramOf along the line', () => {
  const c = circleThrough(O, { x: 1, y: 0 })!;
  for (const l of [
    lineThrough({ x: -3, y: 0 }, { x: 3, y: 0 })!,
    lineThrough({ x: 3, y: 0 }, { x: -3, y: 0 })!,
  ]) {
    const pts = intersect(l, c, 1e-9);
    expect(pts).toHaveLength(2);
    expect(paramOf(l, pts[0]!)).toBeLessThan(paramOf(l, pts[1]!));
    // line as second argument: still sorted by the line's param
    const rev = intersect(c, l, 1e-9);
    expect(rev[0]!.x).toBeCloseTo(pts[0]!.x);
    expect(rev[1]!.x).toBeCloseTo(pts[1]!.x);
  }
});

test('tangent line–circle → one point', () => {
  const pts = intersect(
    lineThrough({ x: -3, y: 1 }, { x: 3, y: 1 })!,
    circleThrough(O, { x: 1, y: 0 })!,
    1e-9,
  );
  expect(pts).toHaveLength(1);
  expect(pts[0]!.x).toBeCloseTo(0);
  expect(pts[0]!.y).toBeCloseTo(1);
});

test('line missing circle → []', () =>
  expect(
    intersect(
      lineThrough({ x: -3, y: 2 }, { x: 3, y: 2 })!,
      circleThrough(O, { x: 1, y: 0 })!,
      1e-9,
    ),
  ).toEqual([]));
