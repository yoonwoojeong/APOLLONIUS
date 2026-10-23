import { equilateral } from './l1-equilateral';
import { perpBisectorLevel } from './l2-perp-bisector';
import { midpoint } from './l3-midpoint';
import { perpendicular } from './l4-perpendicular';
import { angleBisector } from './l5-angle-bisector';
import { circleCenter } from './l6-circle-center';
import type { Level, LevelId } from './types';

export const LEVELS: Level[] = [
  equilateral,
  perpBisectorLevel,
  midpoint,
  perpendicular,
  angleBisector,
  circleCenter,
];

export function levelById(id: LevelId): Level {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown level: ${id}`);
  return l;
}

export type { Level, LevelId, ToolId, GoalMatch, ReferenceStep, CoachStep, Fact } from './types';
