import { distToCurve, paramOf, pointAt, type Curve } from '../geometry/curves';
import { dist, type Vec } from '../geometry/vec';
import type { ObjId } from '../construction/types';
import type { Scene } from '../construction/types';
import { toScreen, toWorld, type Viewport } from './viewport';
import { isCurveValue, isPointValue, withinExtent, type Candidate } from './candidates';

export type SnapTarget =
  | { kind: 'point'; id: ObjId; pos: Vec }
  | { kind: 'candidate'; c: Candidate; pos: Vec }
  | { kind: 'curve'; id: ObjId; t: number; pos: Vec }
  | { kind: 'empty'; pos: Vec };

export type InputKind = 'mouse' | 'pen' | 'touch';

export const SNAP_RADIUS: Record<InputKind, number> = { mouse: 14, pen: 14, touch: 24 };

function nearestOnCurve(curve: Curve, q: Vec): Vec | null {
  if (curve.kind === 'line') return pointAt(curve, paramOf(curve, q));
  const d = dist(q, curve.c);
  if (!(d > 0)) return null;
  return pointAt(curve, paramOf(curve, q));
}

export function findSnap(
  s: Scene,
  cands: Candidate[],
  screenPt: Vec,
  vp: Viewport,
  input: InputKind,
  accept: Array<SnapTarget['kind']>,
): SnapTarget | null {
  const radius = SNAP_RADIUS[input];
  const world = toWorld(vp, screenPt);
  const screenDist = (w: Vec) => dist(toScreen(vp, w), screenPt);

  if (accept.includes('point')) {
    let best: { t: SnapTarget; d: number } | null = null;
    for (const o of s.objects) {
      if (!isPointValue(o.value)) continue;
      const d = screenDist(o.value);
      if (d <= radius && (!best || d < best.d))
        best = { t: { kind: 'point', id: o.id, pos: o.value }, d };
    }
    if (best) return best.t;
  }

  if (accept.includes('candidate')) {
    let best: { t: SnapTarget; d: number } | null = null;
    for (const c of cands) {
      const d = screenDist(c.pos);
      if (d <= radius && (!best || d < best.d))
        best = { t: { kind: 'candidate', c, pos: c.pos }, d };
    }
    if (best) return best.t;
  }

  if (accept.includes('curve')) {
    let best: { t: SnapTarget; d: number } | null = null;
    for (const o of s.objects) {
      if (!isCurveValue(o.value)) continue;
      const d = distToCurve(world, o.value) * vp.scale;
      if (d > radius || (best && d >= best.d)) continue;
      const pos = nearestOnCurve(o.value, world);
      if (!pos || !withinExtent(s, o, pos)) continue;
      best = { t: { kind: 'curve', id: o.id, t: paramOf(o.value, pos), pos }, d };
    }
    if (best) return best.t;
  }

  return accept.includes('empty') ? { kind: 'empty', pos: world } : null;
}
