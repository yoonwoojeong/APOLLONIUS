import { FALLBACK } from './explain';
import { bisectedPairs, labelOf } from '../reasoning/facts';
import { lineThrough } from '../geometry/curves';
import { add, normalize, sub } from '../geometry/vec';
import { findCurveEq, pos } from './goals';
import type { BuiltInLevel } from './types';
import { frame } from './view';

const V = { x: -1.5, y: 0 };
const A = { x: 1.5, y: 1.2 };
const B = { x: 0.6, y: -0.8 };

export const angleBisector: BuiltInLevel = {
  id: 'angle-bisector',
  number: 5,
  title: 'Angle Bisector',
  goalText: 'Construct the bisector of angle AVB.',
  givens: [
    { id: 'V', def: { type: 'given-point', pos: V } },
    { id: 'A', def: { type: 'given-point', pos: A } },
    { id: 'B', def: { type: 'given-point', pos: B } },
    { id: 'VA', def: { type: 'given-line', a: 'V', b: 'A', extent: 'ray' } },
    { id: 'VB', def: { type: 'given-line', a: 'V', b: 'B', extent: 'ray' } },
  ],
  labels: { V: 'V', A: 'A', B: 'B' },
  ...frame([V, A, B]),
  targets: { L: 2, E: 4 },
  tools: ['point', 'line', 'circle', 'perp-bisector'],
  goal: (s) => {
    const v = pos(s, 'V');
    const u1 = normalize(sub(pos(s, 'A'), v));
    const u2 = normalize(sub(pos(s, 'B'), v));
    const u = u1 && u2 ? normalize(add(u1, u2)) : null;
    const target = u ? lineThrough(v, add(v, u)) : null;
    const o = target && findCurveEq(s, target);
    return o && target ? { ids: [o.id], gold: [target] } : null;
  },
  reference: [
    {
      objects: [{ id: 'r1', def: { type: 'circle', center: 'V', through: 'A' } }],
      nudge: 'Find a point on VB as far from V as A is.',
    },
    {
      objects: [{ id: 'r2', def: { type: 'intersection', a: 'r1', b: 'VB', index: 1 } }],
      nudge: 'Mark it.',
    },
    {
      objects: [{ id: 'r3', def: { type: 'perp-bisector', a: 'A', b: 'r2' } }],
      nudge: 'Points equidistant from A and B′ include V.',
    },
  ],
  explain: (facts, s, m) => {
    const pair = bisectedPairs(facts, m.ids[0] as string).find(([p, q]) => p === 'A' || q === 'A');
    if (!pair) return FALLBACK;
    const other = labelOf(s, pair[0] === 'A' ? pair[1] : pair[0]);
    return `VA = V${other}, so V lies on the perpendicular bisector of A${other} — which splits the angle evenly.`;
  },
};
