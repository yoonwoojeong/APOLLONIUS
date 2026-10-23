import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject, Value } from '../construction/types';
import { eqCurve, eqPoint, type Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';
import { isCurve, isPoint } from '../levels/goals';
import type { Level } from '../levels/types';

export interface Hint {
  stepIndex: number;
  nudge: string;
  inputIds: ObjId[];
  ghost: (Vec | Curve)[];
}

const START_PREFIX = 'Try starting from the given points. ';

function refsOf(def: ObjDef): ObjId[] {
  switch (def.type) {
    case 'given-point':
    case 'given-circle':
    case 'free-point':
      return [];
    case 'on-curve':
      return [def.curve];
    case 'circle':
      return [def.center, def.through];
    case 'given-line':
    case 'intersection':
    case 'line':
    case 'perp-bisector':
      return [def.a, def.b];
  }
}

function sameValue(a: Value, b: Value, tol: number): boolean {
  if (isPoint(a)) return isPoint(b) && eqPoint(a, b, tol);
  if (isCurve(a)) return isCurve(b) && eqCurve(a, b, tol);
  return false;
}

/**
 * Maps reference objects to player objects one-to-one. Givens map to themselves;
 * `free-point` / `on-curve` reference points are placeholders for any player point of the
 * same kind (on the same mapped curve), and the reference is re-evaluated at the player's
 * position so downstream objects match the player's own construction.
 */
function mapReference(level: Level, scene: Scene): { mapping: Map<ObjId, ObjId>; ref: Scene } {
  const givenSpecs: ObjSpec[] = scene.objects
    .filter((o) => o.given)
    .map((o) => ({ id: o.id, def: o.def }));
  const specs = [...givenSpecs, ...level.reference.flatMap((s) => s.objects)];
  const overrides = new Map<ObjId, ObjDef>();
  let ref = evaluate(specs, level.sceneDiameter);
  const mapping = new Map<ObjId, ObjId>(givenSpecs.map((g) => [g.id, g.id]));
  const used = new Set<ObjId>(mapping.values());
  const free = (pred: (o: SceneObject) => boolean): SceneObject | undefined =>
    scene.objects.find((o) => !used.has(o.id) && o.value !== null && pred(o));

  for (const step of level.reference) {
    for (const { id, def } of step.objects) {
      let match: SceneObject | undefined;
      if (def.type === 'free-point') {
        match = free((o) => o.def.type === 'free-point');
        if (match?.def.type === 'free-point')
          overrides.set(id, { type: 'free-point', pos: match.def.pos });
      } else if (def.type === 'on-curve') {
        const curve = mapping.get(def.curve);
        match = free((o) => o.def.type === 'on-curve' && o.def.curve === curve);
        if (match?.def.type === 'on-curve') overrides.set(id, { ...def, t: match.def.t });
      } else {
        const v = ref.byId.get(id)?.value ?? null;
        match = free((o) => sameValue(v, o.value, scene.tol));
      }
      if (!match) continue;
      mapping.set(id, match.id);
      used.add(match.id);
      if (overrides.has(id)) ref = evaluate(specs, level.sceneDiameter, overrides);
    }
  }
  return { mapping, ref };
}

/** Next hint for the player's scene, or `null` when the goal is already met. */
export function nextHint(level: Level, scene: Scene): Hint | null {
  if (level.goal(scene)) return null;
  const { mapping, ref } = mapReference(level, scene);

  const hintFor = (index: number, requireInputs: boolean): Hint | null => {
    const step = level.reference[index];
    if (!step) return null;
    const unmapped = step.objects.filter((o) => !mapping.has(o.id));
    if (unmapped.length === 0) return null;
    const own = new Set(step.objects.map((o) => o.id));
    const inputs = [...new Set(step.objects.flatMap((o) => refsOf(o.def)))].filter(
      (i) => !own.has(i),
    );
    if (requireInputs && !inputs.every((i) => mapping.has(i))) return null;
    const inputIds = inputs.flatMap((i) => mapping.get(i) ?? []);
    const ghost = unmapped.flatMap((o) => ref.byId.get(o.id)?.value ?? []);
    return { stepIndex: index, nudge: step.nudge, inputIds, ghost };
  };

  let hint: Hint | null = null;
  for (let i = 0; i < level.reference.length && !hint; i++) hint = hintFor(i, true);
  for (let i = 0; i < level.reference.length && !hint; i++) hint = hintFor(i, false);
  if (!hint) return null;

  const playerBuilt = scene.objects.some((o) => !o.given);
  const progress = [...mapping.keys()].some((id) => !ref.byId.get(id)?.given);
  return playerBuilt && !progress ? { ...hint, nudge: START_PREFIX + hint.nudge } : hint;
}
