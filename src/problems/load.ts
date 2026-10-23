import { FALLBACK } from '../levels/explain';
import type { Level, ProblemLevelId } from '../levels/types';
import { frame } from '../levels/view';
import { NUDGE_FALLBACK, problemPoints, type Problem } from './format';
import { targetGoal } from './goal';

export type { ProblemLevelId } from '../levels/types';

/** A validated problem as a playable Level: built-in behaviour, but no number, unlocks, coach or tip. */
export function toLevel(problem: Problem, id: ProblemLevelId): Level {
  const { view, sceneDiameter } = frame(problemPoints(problem));
  return {
    id,
    title: problem.title,
    goalText: problem.goalText,
    givens: problem.givens,
    labels: problem.labels,
    view,
    sceneDiameter,
    targets: problem.par,
    tools: problem.tools,
    goal: targetGoal(
      problem.givens,
      problem.solution.flatMap((s) => s.objects),
      problem.targets,
      sceneDiameter,
    ),
    reference: problem.solution.map((s) => ({
      objects: s.objects,
      nudge: s.nudge || NUDGE_FALLBACK,
    })),
    explain: () => problem.explain || FALLBACK,
  };
}
