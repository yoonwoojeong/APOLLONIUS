import type { ObjId, ObjSpec, Scene } from '../construction/types';
import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';

export type ToolId = 'point' | 'line' | 'circle' | 'perp-bisector';

export type LevelId =
  | 'equilateral'
  | 'perp-bisector'
  | 'midpoint'
  | 'perpendicular'
  | 'angle-bisector'
  | 'circle-center';

export type ProblemLevelId = `problem:${string}`;

/** `ids` = player objects satisfying the goal; `gold` = geometry drawn in gold on completion. */
export interface GoalMatch {
  ids: ObjId[];
  gold: (Vec | Curve)[];
}

export interface ReferenceStep {
  objects: ObjSpec[];
  nudge: string;
}

export interface CoachStep {
  text: string;
  /** Objects that pulse while the step is current. */
  target: ObjId[];
  doneWhen: (s: Scene) => boolean;
  /** World positions that pulse too, for targets that are not objects yet (e.g. a crossing). */
  spots?: (s: Scene) => Vec[];
  /** Tool selected when the step becomes current. */
  tool?: ToolId;
}

export type Fact =
  | { kind: 'on-circle'; point: ObjId; circle: ObjId }
  | { kind: 'equal-radius'; circles: [ObjId, ObjId] }
  | { kind: 'equidistant'; point: ObjId; from: [ObjId, ObjId] }
  | { kind: 'perp-bisector'; line: ObjId; of: [ObjId, ObjId] };

export interface Level {
  id: LevelId | ProblemLevelId;
  number?: number;
  title: string;
  goalText: string;
  givens: ObjSpec[];
  labels: Record<ObjId, string>;
  view: { x: number; y: number; w: number; h: number };
  sceneDiameter: number;
  targets: { L: number; E: number };
  tools: ToolId[];
  unlocks?: ToolId;
  goal: (s: Scene) => GoalMatch | null;
  reference: ReferenceStep[];
  explain: (facts: Fact[], s: Scene, m: GoalMatch) => string;
  coach?: CoachStep[];
  tip?: string;
}

/** A level shipped with the game: always numbered and keyed by a `LevelId`. */
export type BuiltInLevel = Level & { id: LevelId; number: number };
