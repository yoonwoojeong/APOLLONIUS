import { add, cross, dist, dot, normalize, perp, scale, sub, type Vec } from './vec';

export type LineG = { kind: 'line'; p: Vec; d: Vec };
export type CircleG = { kind: 'circle'; c: Vec; r: number };
export type Curve = LineG | CircleG;

export function lineThrough(a: Vec, b: Vec): LineG | null {
  const d = normalize(sub(b, a));
  return d ? { kind: 'line', p: a, d } : null;
}

export function circleThrough(c: Vec, q: Vec): CircleG | null {
  const r = dist(c, q);
  return r > 0 && Number.isFinite(r) ? { kind: 'circle', c, r } : null;
}

export function perpBisector(a: Vec, b: Vec): LineG | null {
  const u = normalize(sub(b, a));
  if (!u) return null;
  return { kind: 'line', p: scale(add(a, b), 0.5), d: perp(u) };
}

/** Line: signed distance along d from p. Circle: atan2 angle about the centre. */
export function paramOf(curve: Curve, q: Vec): number {
  if (curve.kind === 'line') return dot(sub(q, curve.p), curve.d);
  return Math.atan2(q.y - curve.c.y, q.x - curve.c.x);
}

export function pointAt(curve: Curve, t: number): Vec {
  if (curve.kind === 'line') return add(curve.p, scale(curve.d, t));
  return { x: curve.c.x + curve.r * Math.cos(t), y: curve.c.y + curve.r * Math.sin(t) };
}

export function eqPoint(a: Vec, b: Vec, tol: number): boolean {
  return dist(a, b) <= tol;
}

export function distToCurve(q: Vec, c: Curve): number {
  if (c.kind === 'line') return Math.abs(cross(c.d, sub(q, c.p)));
  return Math.abs(dist(q, c.c) - c.r);
}

export function onCurve(q: Vec, c: Curve, tol: number): boolean {
  return distToCurve(q, c) <= tol;
}

/** Equality as point sets; line direction sign is ignored. */
export function eqCurve(a: Curve, b: Curve, tol: number): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    return Math.abs(cross(a.d, b.d)) <= tol && distToCurve(a.p, b) <= tol;
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    return eqPoint(a.c, b.c, tol) && Math.abs(a.r - b.r) <= tol;
  }
  return false;
}
