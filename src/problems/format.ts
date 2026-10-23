import type { ObjDef, ObjId, ObjSpec } from '../construction/types';
import { evaluate } from '../construction/evaluate';
import type { Vec } from '../geometry/vec';
import type { ToolId } from '../levels/types';

export interface ProblemStep {
  objects: ObjSpec[];
  nudge: string;
}

export interface Problem {
  format: 'apollonius-problem';
  version: 1;
  title: string;
  goalText: string;
  explain?: string;
  author?: string;
  tools: ToolId[];
  givens: ObjSpec[];
  labels: Record<ObjId, string>;
  solution: ProblemStep[];
  targets: ObjId[];
  par: { L: number; E: number };
}

export const GIVEN_TYPES: readonly ObjDef['type'][] = [
  'given-point',
  'given-line',
  'given-circle',
  'circle',
];

export const SOLUTION_TYPES: readonly ObjDef['type'][] = [
  'free-point',
  'on-curve',
  'intersection',
  'line',
  'circle',
  'perp-bisector',
];

export const LIMITS = {
  givensMin: 2,
  givensMax: 40,
  solutionMin: 1,
  solutionMax: 60,
  targetsMin: 1,
  targetsMax: 4,
  titleMin: 1,
  titleMax: 40,
  goalTextMin: 1,
  goalTextMax: 120,
  nudgeMax: 120,
  explainMax: 200,
  authorMax: 40,
  labelMin: 1,
  labelMax: 3,
  idMax: 16,
  coordMax: 100,
} as const;

export const NUDGE_FALLBACK = 'Try the next construction step.';

/**
 * Framing points: given points, given-line endpoints, every point-valued solution object
 * (evaluated), and every circle's centre and c±r on both axes (given and solution circles), so
 * the board shows each circle whole. Play (`toLevel`) and validation (tappability) share it.
 */
export function problemPoints(p: Problem): Vec[] {
  return givenPoints([...p.givens, ...p.solution.flatMap((s) => s.objects)]);
}

/** Framing points of evaluated `specs`: point values, plus each circle's centre and c±r on both axes. */
export function givenPoints(specs: ObjSpec[]): Vec[] {
  const scene = evaluate(specs, 1);
  const out: Vec[] = [];
  for (const o of scene.objects) {
    const v = o.value;
    if (!v) continue;
    if (!('kind' in v)) {
      out.push(v);
    } else if (v.kind === 'circle') {
      out.push(
        v.c,
        { x: v.c.x + v.r, y: v.c.y },
        { x: v.c.x - v.r, y: v.c.y },
        { x: v.c.x, y: v.c.y + v.r },
        { x: v.c.x, y: v.c.y - v.r },
      );
    }
  }
  return out;
}
