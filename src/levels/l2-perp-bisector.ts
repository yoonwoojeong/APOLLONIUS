import { FALLBACK } from './explain';
import { isEquidistant, labelOf } from '../reasoning/facts';
import { perpBisector } from '../geometry/curves';
import { findCurveEq, pos } from './goals';
import type { Level, ReferenceStep } from './types';
import { frame } from './view';

const A = { x: -1, y: 0 };
const B = { x: 1, y: 0 };

/** Two equal circles, their crossings, and the line through the crossings (ids r1–r5). */
export const bisectorSteps: ReferenceStep[] = [
  {
    objects: [{ id: 'r1', def: { type: 'circle', center: 'A', through: 'B' } }],
    nudge: 'Which points are the same distance from A and from B?',
  },
  {
    objects: [{ id: 'r2', def: { type: 'circle', center: 'B', through: 'A' } }],
    nudge: 'Which points are the same distance from A and from B?',
  },
  {
    objects: [
      { id: 'r3', def: { type: 'intersection', a: 'r1', b: 'r2', index: 0 } },
      { id: 'r4', def: { type: 'intersection', a: 'r1', b: 'r2', index: 1 } },
    ],
    nudge: 'Mark where the circles cross.',
  },
  {
    objects: [{ id: 'r5', def: { type: 'line', a: 'r3', b: 'r4' } }],
    nudge: 'Every point on one line is equidistant from A and from B.',
  },
];

export const perpBisectorLevel: Level = {
  id: 'perp-bisector',
  number: 2,
  title: 'Perpendicular Bisector',
  goalText: 'Construct the perpendicular bisector of AB.',
  givens: [
    { id: 'A', def: { type: 'given-point', pos: A } },
    { id: 'B', def: { type: 'given-point', pos: B } },
  ],
  labels: { A: 'A', B: 'B' },
  ...frame([A, B, { x: 0, y: 1.7 }, { x: 0, y: -1.7 }]),
  targets: { L: 3, E: 3 },
  tools: ['point', 'line', 'circle'],
  goal: (s) => {
    const target = perpBisector(pos(s, 'A'), pos(s, 'B'));
    const o = target && findCurveEq(s, target);
    return o && target ? { ids: [o.id], gold: [target] } : null;
  },
  reference: bisectorSteps,
  explain: (facts, s, m) => {
    const d = s.byId.get(m.ids[0] as string)?.def;
    if (d?.type !== 'line') return FALLBACK;
    const ok = [d.a, d.b].every((p) => isEquidistant(facts, p, ['A', 'B']));
    if (!ok) return FALLBACK;
    const [x, y] = [labelOf(s, d.a), labelOf(s, d.b)];
    return `${x} and ${y} are each equidistant from A and B, so the line ${x}${y} is the perpendicular bisector.`;
  },
};
