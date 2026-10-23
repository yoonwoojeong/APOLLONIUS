import { findPointAt, pos } from './goals';
import { bisectorSteps } from './l2-perp-bisector';
import type { Level } from './types';
import { frame } from './view';

const A = { x: -1.2, y: 0 };
const B = { x: 1.2, y: 0 };

export const midpoint: Level = {
  id: 'midpoint',
  number: 3,
  title: 'Midpoint',
  goalText: 'Construct the midpoint of AB.',
  givens: [
    { id: 'A', def: { type: 'given-point', pos: A } },
    { id: 'B', def: { type: 'given-point', pos: B } },
    { id: 'AB', def: { type: 'given-line', a: 'A', b: 'B', extent: 'segment' } },
  ],
  labels: { A: 'A', B: 'B' },
  ...frame([A, B, { x: 0, y: 1.8 }, { x: 0, y: -1.8 }]),
  targets: { L: 3, E: 3 },
  tools: ['point', 'line', 'circle'],
  unlocks: 'perp-bisector',
  goal: (s) => {
    const a = pos(s, 'A');
    const b = pos(s, 'B');
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const o = findPointAt(s, m);
    return o ? { ids: [o.id], gold: [m] } : null;
  },
  reference: [
    ...bisectorSteps,
    {
      objects: [{ id: 'r6', def: { type: 'intersection', a: 'r5', b: 'AB', index: 0 } }],
      nudge: 'The midpoint sits where the bisector crosses AB.',
    },
  ],
  explain: () => '',
};
