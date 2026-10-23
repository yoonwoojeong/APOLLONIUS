import { circleThrough, lineThrough, perpBisector, pointAt, type Curve } from '../geometry/curves';
import { intersect } from '../geometry/intersect';
import { tol as tolFor } from '../geometry/tolerance';
import type { Vec } from '../geometry/vec';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject, Value } from './types';

const isCurve = (v: Value | undefined): v is Curve => !!v && 'kind' in v;
const isPoint = (v: Value | undefined): v is Vec => !!v && !('kind' in v);

function valueOf(def: ObjDef, byId: Map<ObjId, SceneObject>, tol: number): Value {
  const get = (id: ObjId): Value => byId.get(id)?.value ?? null;
  const pt = (id: ObjId): Vec | null => {
    const v = get(id);
    return isPoint(v) ? v : null;
  };
  const curve = (id: ObjId): Curve | null => {
    const v = get(id);
    return isCurve(v) ? v : null;
  };
  switch (def.type) {
    case 'given-point':
    case 'free-point':
      return def.pos;
    case 'given-circle':
      return def.r > 0 && Number.isFinite(def.r) ? { kind: 'circle', c: def.c, r: def.r } : null;
    case 'given-line':
    case 'line':
    case 'perp-bisector': {
      const a = pt(def.a);
      const b = pt(def.b);
      if (!a || !b) return null;
      return def.type === 'perp-bisector' ? perpBisector(a, b) : lineThrough(a, b);
    }
    case 'circle': {
      const c = pt(def.center);
      const q = pt(def.through);
      return c && q ? circleThrough(c, q) : null;
    }
    case 'on-curve': {
      const c = curve(def.curve);
      return c ? pointAt(c, def.t) : null;
    }
    case 'intersection': {
      const a = curve(def.a);
      const b = curve(def.b);
      if (!a || !b) return null;
      return intersect(a, b, tol)[def.index] ?? null;
    }
  }
}

/** Evaluates specs in order. Objects whose parents are null (or missing) are null. */
export function evaluate(
  specs: ObjSpec[],
  sceneDiameter: number,
  overrides?: Map<ObjId, ObjDef>,
): Scene {
  const tol = tolFor(sceneDiameter);
  const objects: SceneObject[] = [];
  const byId = new Map<ObjId, SceneObject>();
  for (const spec of specs) {
    const def = overrides?.get(spec.id) ?? spec.def;
    const obj: SceneObject = {
      id: spec.id,
      def,
      value: valueOf(def, byId, tol),
      given: def.type === 'given-point' || def.type === 'given-line' || def.type === 'given-circle',
    };
    objects.push(obj);
    byId.set(obj.id, obj);
  }
  return { objects, byId, tol };
}
