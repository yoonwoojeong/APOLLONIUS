import type { ObjId, Scene, SceneObject } from '../construction/types';
import { eqCurve, eqPoint, onCurve, type Curve, type LineG } from '../geometry/curves';
import type { Vec } from '../geometry/vec';

export const isCurve = (v: SceneObject['value'] | undefined): v is Curve => !!v && 'kind' in v;
export const isPoint = (v: SceneObject['value'] | undefined): v is Vec => !!v && !('kind' in v);

/** Current position of a point object; throws if the id is not a live point (programmer error). */
export function pos(s: Scene, id: ObjId): Vec {
  const v = s.byId.get(id)?.value;
  if (!isPoint(v)) throw new Error(`not a point: ${id}`);
  return v;
}

/** The line currently in the scene passing through both `a` and `b`. */
export function findLine(s: Scene, a: Vec, b: Vec): SceneObject | undefined {
  return s.objects.find(
    (o) =>
      o.value !== null &&
      isCurve(o.value) &&
      o.value.kind === 'line' &&
      onCurve(a, o.value, s.tol) &&
      onCurve(b, o.value, s.tol),
  );
}

export function findCurveEq(s: Scene, c: Curve): SceneObject | undefined {
  return s.objects.find((o) => isCurve(o.value) && eqCurve(o.value, c, s.tol));
}

export function findPointAt(s: Scene, p: Vec): SceneObject | undefined {
  return s.objects.find((o) => isPoint(o.value) && eqPoint(o.value, p, s.tol));
}

export function lineValue(s: Scene, id: ObjId): LineG {
  const v = s.byId.get(id)?.value;
  if (!isCurve(v) || v.kind !== 'line') throw new Error(`not a line: ${id}`);
  return v;
}
