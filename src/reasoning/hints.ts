import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject, Value } from '../construction/types';
import { eqCurve, eqPoint, type Curve } from '../geometry/curves';
import { intersect } from '../geometry/intersect';
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

/** Upper bound on explored placeholder assignments, to keep hint lookup cheap. */
const SEARCH_LIMIT = 500;

interface MapState {
  mapping: Map<ObjId, ObjId>;
  overrides: Map<ObjId, ObjDef>;
  ref: Scene;
}

/**
 * Maps reference objects to player objects one-to-one, by geometric equality (§7.3).
 * Givens map to themselves. Some reference objects stand for a choice the player makes:
 * `free-point` / `on-curve` points are placeholders for any player point of the same kind
 * (on the same mapped curve), and an `intersection` also accepts the other intersection of
 * its two curves. Each such choice overrides the reference def and re-evaluates it, so
 * downstream objects follow the player's own construction. Choices are searched (bounded)
 * for the assignment that maps the most reference objects; ties keep player order.
 */
function mapReference(level: Level, scene: Scene): MapState {
  const givenSpecs: ObjSpec[] = scene.objects
    .filter((o) => o.given)
    .map((o) => ({ id: o.id, def: o.def }));
  const refSpecs = level.reference.flatMap((s) => s.objects);
  const specs = [...givenSpecs, ...refSpecs];
  const players = scene.objects.filter((o) => !o.given && o.value !== null);

  /** Candidate player matches for a reference object, each with the def override it implies. */
  const candidates = (spec: ObjSpec, st: MapState): { obj: SceneObject; def?: ObjDef }[] => {
    const used = new Set(st.mapping.values());
    const open = players.filter((o) => !used.has(o.id));
    const { def } = spec;
    if (def.type === 'free-point') {
      return open.flatMap((o) =>
        o.def.type === 'free-point'
          ? [{ obj: o, def: { type: 'free-point', pos: o.def.pos } }]
          : [],
      );
    }
    if (def.type === 'on-curve') {
      const curve = st.mapping.get(def.curve);
      return open.flatMap((o) =>
        o.def.type === 'on-curve' && o.def.curve === curve
          ? [{ obj: o, def: { ...def, t: o.def.t } }]
          : [],
      );
    }
    const v = st.ref.byId.get(spec.id)?.value ?? null;
    const exact = open.find((o) => sameValue(v, o.value, scene.tol));
    if (exact) return [{ obj: exact }];
    if (def.type !== 'intersection') return [];
    const a = st.ref.byId.get(def.a)?.value;
    const b = st.ref.byId.get(def.b)?.value;
    if (!isCurve(a) || !isCurve(b)) return [];
    const other = intersect(a, b, scene.tol)[1 - def.index];
    const obj = other && open.find((o) => sameValue(other, o.value, scene.tol));
    return obj ? [{ obj, def: { ...def, index: def.index === 0 ? 1 : 0 } }] : [];
  };

  const start: MapState = {
    mapping: new Map(givenSpecs.map((g) => [g.id, g.id])),
    overrides: new Map(),
    ref: evaluate(specs, level.sceneDiameter),
  };
  let best = start;
  let leaves = 0;
  const search = (i: number, st: MapState): void => {
    if (leaves >= SEARCH_LIMIT) return;
    const spec = refSpecs[i];
    if (!spec) {
      leaves++;
      if (st.mapping.size > best.mapping.size) best = st;
      return;
    }
    const options = candidates(spec, st);
    if (options.length === 0) return search(i + 1, st);
    for (const { obj, def } of options) {
      const mapping = new Map(st.mapping).set(spec.id, obj.id);
      if (!def) {
        search(i + 1, { ...st, mapping });
        continue;
      }
      const overrides = new Map(st.overrides).set(spec.id, def);
      search(i + 1, { mapping, overrides, ref: evaluate(specs, level.sceneDiameter, overrides) });
    }
  };
  search(0, start);
  return best;
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
