import { equilateral } from './l1-equilateral';
import { perpBisectorLevel } from './l2-perp-bisector';
import { midpoint } from './l3-midpoint';
import { perpendicular } from './l4-perpendicular';
import { angleBisector } from './l5-angle-bisector';
import { circleCenter } from './l6-circle-center';
import type { BuiltInLevel, Level, LevelId } from './types';

export const LEVELS: BuiltInLevel[] = [
  equilateral,
  perpBisectorLevel,
  midpoint,
  perpendicular,
  angleBisector,
  circleCenter,
];

/** True for the ids of the built-in levels (as opposed to `problem:` ids). */
export function isBuiltInLevelId(id: Level['id']): id is LevelId {
  return LEVELS.some((l) => l.id === id);
}

export function levelById(id: LevelId): BuiltInLevel {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown level: ${id}`);
  return l;
}

export type {
  Level,
  LevelId,
  BuiltInLevel,
  ProblemLevelId,
  ToolId,
  GoalMatch,
  ReferenceStep,
  CoachStep,
  Fact,
} from './types';
