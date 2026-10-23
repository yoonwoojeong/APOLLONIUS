import { FALLBACK } from './explain';
import { bisectedPairs } from '../reasoning/facts';
import { findPointAt, isCurve } from './goals';
import type { Level } from './types';
import { frame } from './view';

const C = { x: 0.2, y: -0.1 };
const R = 1.4;
const CHORD_NUDGE = "Any chord's perpendicular bisector passes through the centre.";

export const circleCenter: Level = {
  id: 'circle-center',
  number: 6,
  title: 'Circle Center',
  goalText: 'Construct the center of the circle.',
  givens: [{ id: 'circle', def: { type: 'given-circle', c: C, r: R } }],
  labels: {},
  ...frame([
    { x: C.x - R, y: C.y - R },
    { x: C.x + R, y: C.y + R },
  ]),
  targets: { L: 2, E: 6 },
  tools: ['point', 'line', 'circle', 'perp-bisector'],
  goal: (s) => {
    const circle = s.byId.get('circle')?.value;
    if (!isCurve(circle) || circle.kind !== 'circle') return null;
    const o = findPointAt(s, circle.c);
    return o ? { ids: [o.id], gold: [circle.c] } : null;
  },
  reference: [
    {
      objects: [
        { id: 'r1', def: { type: 'on-curve', curve: 'circle', t: 0.3 } },
        { id: 'r2', def: { type: 'on-curve', curve: 'circle', t: 2.2 } },
        { id: 'r3', def: { type: 'on-curve', curve: 'circle', t: 4.1 } },
      ],
      nudge: CHORD_NUDGE,
    },
    {
      objects: [
        { id: 'r4', def: { type: 'perp-bisector', a: 'r1', b: 'r2' } },
        { id: 'r5', def: { type: 'perp-bisector', a: 'r2', b: 'r3' } },
      ],
      nudge: CHORD_NUDGE,
    },
    {
      objects: [{ id: 'r6', def: { type: 'intersection', a: 'r4', b: 'r5', index: 0 } }],
      nudge: 'Two such lines meet at the centre.',
    },
  ],
  explain: (facts, s, m) => {
    const d = s.byId.get(m.ids[0] as string)?.def;
    if (d?.type !== 'intersection') return FALLBACK;
    const ok = [d.a, d.b].every((l) => bisectedPairs(facts, l).length > 0);
    return ok ? 'Both lines are perpendicular bisectors of chords, so each passes through the centre.' : FALLBACK;
  },
};
