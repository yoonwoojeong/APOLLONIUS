import type { ObjId, Scene, SceneObject } from '../construction/types';
import type { Fact } from '../levels/types';

type Pair = [ObjId, ObjId];

const isCircle = (o: SceneObject | undefined): boolean =>
  !!o?.value && 'kind' in o.value && o.value.kind === 'circle';

const radius = (o: SceneObject): number =>
  o.value && 'kind' in o.value && o.value.kind === 'circle' ? o.value.r : NaN;

const samePair = (p: Pair, q: Pair): boolean =>
  (p[0] === q[0] && p[1] === q[1]) || (p[0] === q[1] && p[1] === q[0]);

/** Facts that follow from how each object was constructed (never from coincidence). */
export function deriveFacts(s: Scene): Fact[] {
  const facts: Fact[] = [];
  const circles = s.objects.filter((o) => isCircle(o));

  for (const o of s.objects) {
    const d = o.def;
    if (d.type === 'circle') facts.push({ kind: 'on-circle', point: d.through, circle: o.id });
    else if (d.type === 'on-curve' && isCircle(s.byId.get(d.curve))) {
      facts.push({ kind: 'on-circle', point: o.id, circle: d.curve });
    } else if (d.type === 'intersection') {
      for (const c of [d.a, d.b]) {
        if (isCircle(s.byId.get(c))) facts.push({ kind: 'on-circle', point: o.id, circle: c });
      }
    }
  }

  const equalRadius: Pair[] = [];
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i] as SceneObject;
      const b = circles[j] as SceneObject;
      if (Math.abs(radius(a) - radius(b)) <= s.tol) {
        equalRadius.push([a.id, b.id]);
        facts.push({ kind: 'equal-radius', circles: [a.id, b.id] });
      }
    }
  }

  const onCircle = (p: ObjId, c: ObjId): boolean =>
    facts.some((f) => f.kind === 'on-circle' && f.point === p && f.circle === c);
  const centre = (c: ObjId): ObjId | undefined => {
    const d = s.byId.get(c)?.def;
    return d?.type === 'circle' ? d.center : undefined;
  };

  for (const o of s.objects) {
    for (const [c1, c2] of equalRadius) {
      const a = centre(c1);
      const b = centre(c2);
      if (a && b && a !== b && onCircle(o.id, c1) && onCircle(o.id, c2)) {
        facts.push({ kind: 'equidistant', point: o.id, from: [a, b] });
      }
    }
  }

  for (const o of s.objects) {
    const d = o.def;
    if (d.type === 'perp-bisector') {
      facts.push({ kind: 'perp-bisector', line: o.id, of: [d.a, d.b] });
    } else if (d.type === 'line') {
      for (const f of facts) {
        if (f.kind === 'equidistant' && f.point === d.a && isEquidistant(facts, d.b, f.from)) {
          facts.push({ kind: 'perp-bisector', line: o.id, of: f.from });
        }
      }
    }
  }
  return facts;
}

export function isEquidistant(facts: Fact[], point: ObjId, from: Pair): boolean {
  return facts.some((f) => f.kind === 'equidistant' && f.point === point && samePair(f.from, from));
}

/** The pairs `line` is known to be the perpendicular bisector of. */
export function bisectedPairs(facts: Fact[], line: ObjId): Pair[] {
  return facts.flatMap((f) => (f.kind === 'perp-bisector' && f.line === line ? [f.of] : []));
}

export const labelOf = (s: Scene, id: ObjId): string => s.byId.get(id)?.label ?? id;
