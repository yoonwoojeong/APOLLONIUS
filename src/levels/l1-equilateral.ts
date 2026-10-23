import { FALLBACK } from './explain';
import { isEquidistant, labelOf } from '../reasoning/facts';
import type { Scene } from '../construction/types';
import { add, dist, perp, scale, sub, type Vec } from '../geometry/vec';
import { eqPoint } from '../geometry/curves';
import { findCurveEq, findLine, findPointAt, isPoint, pos } from './goals';
import type { GoalMatch, Level } from './types';
import { frame } from './view';

const A = { x: -1, y: 0 };
const B = { x: 1, y: 0 };

/** The circle centred at `c` through `q`, if the scene has it. */
const hasCircle = (s: Scene, c: string, q: string): boolean =>
  !!findCurveEq(s, { kind: 'circle', c: pos(s, c), r: dist(pos(s, c), pos(s, q)) });

/** The two points that complete an equilateral triangle on AB (where the circles cross). */
function apexes(s: Scene): Vec[] {
  const a = pos(s, 'A');
  const b = pos(s, 'B');
  const mid = scale(add(a, b), 0.5);
  const h = scale(sub(b, a), Math.sqrt(3) / 2);
  const n = perp(h);
  return [add(mid, n), sub(mid, n)];
}

const markedApexes = (s: Scene): Vec[] => apexes(s).filter((p) => findPointAt(s, p));

function goal(s: Scene): GoalMatch | null {
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
}

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
  goal,
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
  explain: (facts, s, m) => {
    const c = m.ids[0] as string;
    if (!isEquidistant(facts, c, ['A', 'B'])) return FALLBACK;
    const l = labelOf(s, c);
    return `${l} lies on both circles, so ${l}A = AB = ${l}B.`;
  },
  coach: [
    {
      text: 'Drag from A to B to draw a circle.',
      target: ['A', 'B'],
      tool: 'circle',
      doneWhen: (s) => hasCircle(s, 'A', 'B'),
    },
    {
      text: 'Now drag from B to A.',
      target: ['B', 'A'],
      tool: 'circle',
      doneWhen: (s) => hasCircle(s, 'B', 'A'),
    },
    {
      text: 'Tap where the circles cross.',
      target: [],
      spots: apexes,
      doneWhen: (s) => markedApexes(s).length > 0,
    },
    {
      text: 'Draw lines from your new point to A and to B.',
      target: ['A', 'B'],
      spots: markedApexes,
      tool: 'line',
      doneWhen: (s) => goal(s) !== null,
    },
  ],
};
