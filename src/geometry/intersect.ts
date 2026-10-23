import { paramOf, type CircleG, type Curve, type LineG } from './curves';
import { add, cross, dist, dot, normalize, perp, scale, sub, type Vec } from './vec';

/** Unit direction vectors closer to parallel than this are treated as parallel. */
const PARALLEL_EPS = 1e-12;

function lineLine(a: LineG, b: LineG): Vec[] {
  const den = cross(a.d, b.d);
  if (Math.abs(den) < PARALLEL_EPS) return [];
  const t = cross(sub(b.p, a.p), b.d) / den;
  return [add(a.p, scale(a.d, t))];
}

function lineCircle(l: LineG, c: CircleG, tol: number): Vec[] {
  const foot = add(l.p, scale(l.d, dot(sub(c.c, l.p), l.d)));
  const h = dist(foot, c.c);
  if (Math.abs(h - c.r) <= tol) return [foot];
  if (h > c.r) return [];
  const w = Math.sqrt(c.r * c.r - h * h);
  // Ascending paramOf along the line: foot - w*d first.
  return [sub(foot, scale(l.d, w)), add(foot, scale(l.d, w))];
}

function circleCircle(a: CircleG, b: CircleG, tol: number): Vec[] {
  const d = dist(a.c, b.c);
  if (d <= tol) return []; // concentric (including coincident)
  if (d > a.r + b.r + tol) return [];
  if (d < Math.abs(a.r - b.r) - tol) return [];
  const u = normalize(sub(b.c, a.c));
  if (!u) return [];
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const base = add(a.c, scale(u, along));
  const h2 = a.r * a.r - along * along;
  const tangent = Math.abs(d - (a.r + b.r)) <= tol || Math.abs(d - Math.abs(a.r - b.r)) <= tol;
  if (tangent || h2 <= 0) return [base];
  const h = Math.sqrt(h2);
  const n = perp(u);
  // Index 0 has positive cross(c2 - c1, pt - c1).
  return [add(base, scale(n, h)), sub(base, scale(n, h))];
}

/**
 * Intersections of two curves: 0, 1 or 2 points, in a deterministic order that is
 * continuous as the inputs move. Circle-circle: index 0 is left of c1->c2. Line-line
 * and line-circle: ascending paramOf along the line.
 */
export function intersect(a: Curve, b: Curve, tol: number): Vec[] {
  let pts: Vec[];
  if (a.kind === 'line' && b.kind === 'line') pts = lineLine(a, b);
  else if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b, tol);
  else if (a.kind === 'line' && b.kind === 'circle') pts = lineCircle(a, b, tol);
  else pts = lineCircle(b as LineG, a as CircleG, tol);
  const line = a.kind === 'line' ? a : (b as LineG);
  return pts.sort((p, q) => paramOf(line, p) - paramOf(line, q));
}
