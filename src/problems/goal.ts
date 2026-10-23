import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject, Value } from '../construction/types';
import {
  eqCurve,
  eqPoint,
  lineThrough,
  onCurve,
  perpBisector,
  type Curve,
} from '../geometry/curves';
import { add, dot, scale, sub, type Vec } from '../geometry/vec';
import type { GoalMatch } from '../levels/types';

const isCurve = (v: Value): v is Curve => !!v && 'kind' in v;

/** Same geometry: equal points, or equal curves (as point sets), at `tol`. */
export function sameValue(a: Value, b: Value, tol: number): boolean {
  if (!a || !b) return false;
  if (isCurve(a)) return isCurve(b) && eqCurve(a, b, tol);
  return !isCurve(b) && eqPoint(a, b, tol);
}

type Isometry = (v: Vec) => Vec;

const reflectIn =
  (line: { p: Vec; d: Vec }): Isometry =>
  (v) => {
    const foot = add(line.p, scale(line.d, dot(sub(v, line.p), line.d)));
    return sub(scale(foot, 2), v);
  };
const halfTurn =
  (m: Vec): Isometry =>
  (v) =>
    sub(scale(m, 2), v);

/** The image of a point or curve under an isometry; null if a line degenerates. */
function mapValue(t: Isometry, v: Value): Value {
  if (!v) return null;
  if (!isCurve(v)) return t(v);
  if (v.kind === 'circle') return { kind: 'circle', c: t(v.c), r: v.r };
  return lineThrough(t(v.p), t(add(v.p, v.d)));
}

/**
 * Candidate symmetries of the givens: identity; reflections in each given line, in each line
 * through two given points and in each perpendicular bisector of two given points; half-turns
 * about each given point and each midpoint of two. Only those that fix every given (each given
 * point fixed, each given line/segment/ray mapped onto itself, each given circle onto itself)
 * are returned, identity excluded.
 */
function givenSymmetries(givens: ObjSpec[], ref: Scene, tol: number): Isometry[] {
  const points: Vec[] = [];
  const lines: { p: Vec; d: Vec }[] = [];
  for (const g of givens) {
    const v = ref.byId.get(g.id)?.value;
    if (!v) continue;
    if (!isCurve(v)) points.push(v);
    else if (v.kind === 'line') lines.push(v);
  }
  const cands: Isometry[] = [...lines.map(reflectIn), ...points.map(halfTurn)];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i] as Vec;
      const b = points[j] as Vec;
      const through = lineThrough(a, b);
      const bis = perpBisector(a, b);
      if (through) cands.push(reflectIn(through));
      if (bis) cands.push(reflectIn(bis));
      cands.push(halfTurn(scale(add(a, b), 0.5)));
    }
  }
  const same = (a: Vec, b: Vec): boolean => eqPoint(a, b, tol);
  const fixesGivens = (t: Isometry): boolean =>
    givens.every((g) => {
      const v = ref.byId.get(g.id)?.value;
      if (!v) return false;
      if (g.def.type === 'given-line') {
        const a = ref.byId.get(g.def.a)?.value;
        const b = ref.byId.get(g.def.b)?.value;
        if (!a || !b || isCurve(a) || isCurve(b)) return false;
        const ta = t(a);
        const tb = t(b);
        const line = lineThrough(a, b);
        if (!line) return false;
        switch (g.def.extent) {
          case 'segment':
            return (same(ta, a) && same(tb, b)) || (same(ta, b) && same(tb, a));
          case 'ray':
            return same(ta, a) && onCurve(tb, line, tol) && dot(sub(tb, a), sub(b, a)) > 0;
          default:
            return onCurve(ta, line, tol) && onCurve(tb, line, tol);
        }
      }
      if (!isCurve(v)) return same(t(v), v);
      if (v.kind === 'circle') return same(t(v.c), v.c);
      return mapValue(t, v) !== null && eqCurve(mapValue(t, v) as Curve, v, tol);
    });
  return cands.filter(fixesGivens);
}

/** At most this many intersections are flipped, so a reference has at most 2^8 variants. */
const MAX_FLIPPED = 8;

/**
 * The intersections the targets depend on (transitively), in solution order, capped at
 * `MAX_FLIPPED` (the first ones win: earlier crossings are the ones a player meets first).
 * Flipping any other intersection cannot change a target.
 */
function flippable(givens: ObjSpec[], solution: ObjSpec[], targets: ObjId[]): ObjId[] {
  const defs = new Map<ObjId, ObjDef>();
  for (const o of [...givens, ...solution]) defs.set(o.id, o.def);
  const needed = new Set<ObjId>();
  const visit = (id: ObjId): void => {
    if (needed.has(id)) return;
    needed.add(id);
    const d = defs.get(id);
    if (!d) return;
    switch (d.type) {
      case 'on-curve':
        visit(d.curve);
        break;
      case 'circle':
        visit(d.center);
        visit(d.through);
        break;
      case 'given-line':
      case 'intersection':
      case 'line':
      case 'perp-bisector':
        visit(d.a);
        visit(d.b);
        break;
      default:
    }
  };
  targets.forEach(visit);
  return solution
    .filter((o) => o.def.type === 'intersection' && needed.has(o.id))
    .map((o) => o.id)
    .slice(0, MAX_FLIPPED);
}

/**
 * Goal for a user-authored problem. Evaluates `givens + solution` against the scene's current
 * given values (so perturbations flow through), then requires a distinct player object equal to
 * each target. Player objects that coincide count once: the game cannot hold two copies of the
 * same geometry, so targets with identical geometry can never all be matched.
 *
 * A construction also satisfies the goal when it matches any variant of the reference that flips
 * the `index` of some of its intersections (mirror-image solutions), tried in a fixed order
 * starting with the original; see `flippable` for which intersections are flipped. A variant is
 * accepted only if a symmetry of the givens (see `givenSymmetries`) maps the original targets onto
 * it, so it is a genuine mirror image of the solution rather than an arbitrary other crossing.
 */
export function targetGoal(
  givens: ObjSpec[],
  solution: ObjSpec[],
  targets: ObjId[],
  sceneDiameter: number,
): (s: Scene) => GoalMatch | null {
  const givenIds = new Set(givens.map((g) => g.id));
  const flips = flippable(givens, solution, targets);
  /** Which pairs of targets coincide; a mirror variant must coincide in exactly the same pairs. */
  const pattern = (gold: (Vec | Curve)[], tol: number): string =>
    gold
      .flatMap((a, i) => gold.slice(i + 1).map((b) => (sameValue(a, b, tol) ? '1' : '0')))
      .join('');
  return (s) => {
    let original: string | undefined;
    const overrides = new Map<ObjId, ObjDef>();
    for (const id of givenIds) {
      const o = s.byId.get(id);
      if (o) overrides.set(id, o.def);
    }
    // Player objects, keeping only the first of any that coincide.
    const players: SceneObject[] = [];
    for (const o of s.objects) {
      if (givenIds.has(o.id) || !o.value) continue;
      if (players.some((q) => sameValue(q.value, o.value, s.tol))) continue;
      players.push(o);
    }
    let base: { ref: Scene; gold: (Vec | Curve)[] } | undefined;
    let isos: Isometry[] | undefined;
    for (let mask = 0; mask < 1 << flips.length; mask++) {
      const variant = solution.map((o): ObjSpec => {
        const j = flips.indexOf(o.id);
        if (j < 0 || !((mask >> j) & 1) || o.def.type !== 'intersection') return o;
        return { id: o.id, def: { ...o.def, index: o.def.index === 0 ? 1 : 0 } };
      });
      const ref = evaluate([...givens, ...variant], sceneDiameter, overrides);
      const gold: (Vec | Curve)[] = [];
      for (const id of targets) {
        const v = ref.byId.get(id)?.value;
        if (!v) break;
        gold.push(v);
      }
      if (gold.length < targets.length) {
        if (mask === 0) return null; // the reference itself must evaluate
        continue;
      }
      const shape = pattern(gold, s.tol);
      original ??= shape;
      if (shape !== original) continue;
      if (mask === 0) {
        base = { ref, gold };
      } else if (base) {
        // Soundness: a mirror variant is only a solution if a symmetry of the givens maps the
        // original targets onto it (target i to target i).
        isos ??= givenSymmetries(givens, base.ref, s.tol);
        if (isos.length === 0) break;
        const orig = base.gold;
        const ok = isos.some((t) =>
          orig.every((g, i) => sameValue(mapValue(t, g), gold[i] ?? null, s.tol)),
        );
        if (!ok) continue;
      }
      const ids = matchTargets(gold, players, s.tol);
      if (ids) return { ids, gold };
    }
    return null;
  };
}

function matchTargets(gold: (Vec | Curve)[], players: SceneObject[], tol: number): ObjId[] | null {
  const used = new Set<number>();
  const ids: ObjId[] = [];
  const match = (k: number): boolean => {
    if (k === gold.length) return true;
    const target = gold[k] ?? null;
    for (let i = 0; i < players.length; i++) {
      const q = players[i];
      if (!q || used.has(i) || !sameValue(target, q.value, tol)) continue;
      used.add(i);
      ids.push(q.id);
      if (match(k + 1)) return true;
      used.delete(i);
      ids.pop();
    }
    return false;
  };
  return match(0) ? ids : null;
}
