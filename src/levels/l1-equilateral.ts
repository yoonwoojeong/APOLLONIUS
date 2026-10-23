import { dist } from '../geometry/vec';
import { eqPoint } from '../geometry/curves';
import { findLine, isPoint, pos } from './goals';
import type { Level } from './types';
import { frame } from './view';

const A = { x: -1, y: 0 };
const B = { x: 1, y: 0 };

export const equilateral: Level = {
  id: 'equilateral',
  number: 1,
  title: 'Equilateral Triangle',
  goalText: 'Construct an equilateral triangle on AB.',
  givens: [
    { id: 'A', def: { type: 'given-point', pos: A } },
    { id: 'B', def: { type: 'given-point', pos: B } },
    { id: 'AB', def: { type: 'given-line', a: 'A', b: 'B', extent: 'segment' } },
  ],
  labels: { A: 'A', B: 'B' },
  ...frame([A, B, { x: 0, y: Math.sqrt(3) }, { x: 0, y: -Math.sqrt(3) }]),
  targets: { L: 4, E: 4 },
  tools: ['point', 'line', 'circle'],
  goal: (s) => {
    const a = pos(s, 'A');
    const b = pos(s, 'B');
    const ab = dist(a, b);
    for (const o of s.objects) {
      const c = o.value;
      if (!isPoint(c)) continue;
      if (Math.abs(dist(c, a) - ab) > s.tol || Math.abs(dist(c, b) - ab) > s.tol) continue;
      const la = findLine(s, a, c);
      const lb = findLine(s, b, c);
      if (la && lb && !eqPoint(a, c, s.tol)) return { ids: [o.id, la.id, lb.id], gold: [c] };
    }
    return null;
  },
  reference: [
    {
      objects: [{ id: 'r1', def: { type: 'circle', center: 'A', through: 'B' } }],
      nudge: 'Which points are exactly AB away from A?',
    },
    {
      objects: [{ id: 'r2', def: { type: 'circle', center: 'B', through: 'A' } }],
      nudge: '…and exactly AB away from B?',
    },
    {
      objects: [{ id: 'r3', def: { type: 'intersection', a: 'r1', b: 'r2', index: 0 } }],
      nudge: 'Where do those two sets meet?',
    },
    {
      objects: [
        { id: 'r4', def: { type: 'line', a: 'A', b: 'r3' } },
        { id: 'r5', def: { type: 'line', a: 'B', b: 'r3' } },
      ],
      nudge: 'Join the new point to A and B.',
    },
  ],
  explain: () => '',
};
