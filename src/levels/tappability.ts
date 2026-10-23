import type { Rect } from '../canvas/viewport';
import { fit, toScreen } from '../canvas/viewport';
import { evaluate } from '../construction/evaluate';
import type { ObjId, ObjSpec } from '../construction/types';
import type { Vec } from '../geometry/vec';

export interface CrossingIssue {
  stepIndex: number;
  id: ObjId;
  nearId: ObjId;
  px: number;
}

/**
 * At `fit(view, 390, 600, 24)` every solution intersection must be at least `minPx`
 * from every other point present when it is created. Reports the nearest offender
 * per intersection.
 */
export function tooCloseCrossings(
  givens: ObjSpec[],
  steps: ObjSpec[][],
  view: Rect,
  minPx = 40,
): CrossingIssue[] {
  const vp = fit(view, 390, 600, 24);
  const diameter = Math.hypot(view.w, view.h);
  const points = (specs: ObjSpec[]): Map<ObjId, Vec> => {
    const m = new Map<ObjId, Vec>();
    for (const o of evaluate(specs, diameter).objects) {
      if (o.value && !('kind' in o.value)) m.set(o.id, o.value);
    }
    return m;
  };
  const issues: CrossingIssue[] = [];
  let specs = [...givens];
  steps.forEach((step, stepIndex) => {
    const before = points(specs);
    specs = [...specs, ...step];
    const after = points(specs);
    for (const o of step) {
      if (o.def.type !== 'intersection') continue;
      const w = after.get(o.id);
      if (!w) continue;
      const p = toScreen(vp, w);
      let best: CrossingIssue | null = null;
      for (const [id, q] of before) {
        const s = toScreen(vp, q);
        const px = Math.hypot(p.x - s.x, p.y - s.y);
        if (px < minPx && (!best || px < best.px)) best = { stepIndex, id: o.id, nearId: id, px };
      }
      if (best) issues.push(best);
    }
  });
  return issues;
}
