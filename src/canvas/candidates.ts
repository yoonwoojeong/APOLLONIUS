import { eqPoint, paramOf, type Curve, type LineG } from '../geometry/curves';
import { intersect } from '../geometry/intersect';
import type { Vec } from '../geometry/vec';
import type { ObjId, Scene, SceneObject } from '../construction/types';

export interface Candidate {
  a: ObjId;
  b: ObjId;
  index: 0 | 1;
  pos: Vec;
}

export const isCurveValue = (v: SceneObject['value']): v is Curve => !!v && 'kind' in v;
export const isPointValue = (v: SceneObject['value']): v is Vec => !!v && !('kind' in v);

/** True when `q` (on the object's curve) lies within a segment/ray given's visible extent. */
export function withinExtent(s: Scene, obj: SceneObject, q: Vec): boolean {
  const def = obj.def;
  if (def.type !== 'given-line' || def.extent === 'line') return true;
  const line = obj.value as LineG | null;
  const pa = s.byId.get(def.a)?.value;
  const pb = s.byId.get(def.b)?.value;
  if (!line || !pa || !pb || !isPointValue(pa) || !isPointValue(pb)) return false;
  const t = paramOf(line, q);
  const ta = paramOf(line, pa);
  const tb = paramOf(line, pb);
  const lo = def.extent === 'segment' ? Math.min(ta, tb) : ta;
  const hi = def.extent === 'segment' ? Math.max(ta, tb) : Infinity;
  return t >= lo - s.tol && t <= hi + s.tol;
}

/**
 * Every curve pair's intersections, excluding any within tol of an existing point and any
 * outside a segment/ray given's extent. Coinciding candidates keep the first.
 */
export function candidateIntersections(s: Scene): Candidate[] {
  const curves = s.objects.filter((o) => isCurveValue(o.value));
  const points = s.objects.flatMap((o) => (isPointValue(o.value) ? [o.value] : []));
  const out: Candidate[] = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const A = curves[i];
      const B = curves[j];
      if (!A || !B) continue;
      const pts = intersect(A.value as Curve, B.value as Curve, s.tol);
      pts.forEach((pos, k) => {
        if (!withinExtent(s, A, pos) || !withinExtent(s, B, pos)) return;
        if (points.some((p) => eqPoint(p, pos, s.tol))) return;
        if (out.some((c) => eqPoint(c.pos, pos, s.tol))) return;
        out.push({ a: A.id, b: B.id, index: k as 0 | 1, pos });
      });
    }
  }
  return out;
}
