import { FALLBACK } from './explain';
import { bisectedPairs, labelOf } from '../reasoning/facts';
import { onCurve } from '../geometry/curves';
import { dot } from '../geometry/vec';
import { isCurve, lineValue, pos } from './goals';
import type { BuiltInLevel } from './types';
import { frame } from './view';

const A = { x: -1.5, y: 0.2 };
const P = { x: 0.3, y: 0.5 };

export const perpendicular: BuiltInLevel = {
  id: 'perpendicular',
  number: 4,
  title: 'Perpendicular at a Point',
  goalText: 'Construct the line through P perpendicular to ℓ.',
  givens: [
    { id: 'A', def: { type: 'given-point', pos: A } },
    { id: 'P', def: { type: 'given-point', pos: P } },
    { id: 'ell', def: { type: 'given-line', a: 'A', b: 'P', extent: 'line' } },
  ],
  labels: { A: 'A', P: 'P' },
  ...frame([A, P, { x: 0.3, y: 1.6 }, { x: 0.3, y: -1.2 }]),
  targets: { L: 2, E: 4 },
  tools: ['point', 'line', 'circle', 'perp-bisector'],
  tip: 'New tool: drag between two points to draw their perpendicular bisector.',
  goal: (s) => {
    const p = pos(s, 'P');
    const ell = lineValue(s, 'ell');
    for (const o of s.objects) {
      const v = o.value;
      if (!isCurve(v) || v.kind !== 'line') continue;
      if (onCurve(p, v, s.tol) && Math.abs(dot(v.d, ell.d)) <= s.tol) {
        return { ids: [o.id], gold: [v] };
      }
    }
    return null;
  },
  reference: [
    {
      objects: [{ id: 'r1', def: { type: 'circle', center: 'P', through: 'A' } }],
      nudge: 'Make a second point on ℓ, as far from P as A is.',
    },
    {
      objects: [{ id: 'r2', def: { type: 'intersection', a: 'r1', b: 'ell', index: 1 } }],
      nudge: 'Mark it.',
    },
    {
      objects: [{ id: 'r3', def: { type: 'perp-bisector', a: 'A', b: 'r2' } }],
      nudge: 'P is now the midpoint of A and A′.',
    },
  ],
  explain: (facts, s, m) => {
    const pair = bisectedPairs(facts, m.ids[0] as string).find(([p, q]) => p === 'A' || q === 'A');
    if (!pair) return FALLBACK;
    const other = labelOf(s, pair[0] === 'A' ? pair[1] : pair[0]);
    return `P is the midpoint of A and ${other}, so the bisector of A${other} is perpendicular to ℓ at P.`;
  },
};
