import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject, Value } from '../construction/types';
import { eqCurve, eqPoint, type Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';
import type { GoalMatch } from '../levels/types';

const isCurve = (v: Value): v is Curve => !!v && 'kind' in v;

/** Same geometry: equal points, or equal curves (as point sets), at `tol`. */
export function sameValue(a: Value, b: Value, tol: number): boolean {
  if (!a || !b) return false;
  if (isCurve(a)) return isCurve(b) && eqCurve(a, b, tol);
  return !isCurve(b) && eqPoint(a, b, tol);
}

/**
 * Goal for a user-authored problem. Evaluates `givens + solution` against the scene's current
 * given values (so perturbations flow through), then requires a distinct player object equal to
 * each target. Player objects that coincide count once: the game cannot hold two copies of the
 * same geometry, so targets with identical geometry can never all be matched.
 */
export function targetGoal(
  givens: ObjSpec[],
  solution: ObjSpec[],
  targets: ObjId[],
  sceneDiameter: number,
): (s: Scene) => GoalMatch | null {
  const givenIds = new Set(givens.map((g) => g.id));
  return (s) => {
    const overrides = new Map<ObjId, ObjDef>();
    for (const id of givenIds) {
      const o = s.byId.get(id);
      if (o) overrides.set(id, o.def);
    }
    const ref = evaluate([...givens, ...solution], sceneDiameter, overrides);
    const gold: (Vec | Curve)[] = [];
    for (const id of targets) {
      const v = ref.byId.get(id)?.value;
      if (!v) return null;
      gold.push(v);
    }
    // Player objects, keeping only the first of any that coincide.
    const players: SceneObject[] = [];
    for (const o of s.objects) {
      if (givenIds.has(o.id) || !o.value) continue;
      if (players.some((q) => sameValue(q.value, o.value, s.tol))) continue;
      players.push(o);
    }
    const used = new Set<number>();
    const ids: ObjId[] = [];
    const match = (k: number): boolean => {
      if (k === gold.length) return true;
      const target = gold[k] ?? null;
      for (let i = 0; i < players.length; i++) {
        const q = players[i];
        if (!q || used.has(i) || !sameValue(target, q.value, s.tol)) continue;
        used.add(i);
        ids.push(q.id);
        if (match(k + 1)) return true;
        used.delete(i);
        ids.pop();
      }
      return false;
    };
    return match(0) ? { ids, gold } : null;
  };
}
