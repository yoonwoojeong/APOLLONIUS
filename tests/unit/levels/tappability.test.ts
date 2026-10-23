import { describe, expect, test } from 'vitest';
import { LEVELS } from '../../../src/levels';
import { tooCloseCrossings } from '../../../src/levels/tappability';
import type { ObjSpec } from '../../../src/construction/types';

describe('tooCloseCrossings', () => {
  test.each(LEVELS)('$id: reference has no too-close crossings', (lvl) => {
    expect(
      tooCloseCrossings(
        lvl.givens,
        lvl.reference.map((s) => s.objects),
        lvl.view,
      ),
    ).toEqual([]);
  });

  test('flags a crossing landing ~6 px from another point', () => {
    const pt = (id: string, x: number, y: number): ObjSpec => ({
      id,
      def: { type: 'given-point', pos: { x, y } },
    });
    // scale at this view is 114 px/unit, so D at 0.05 sits 5.7 px from the crossing at the origin.
    const givens = [pt('A', -1, 0), pt('B', 1, 0), pt('C', 0, 1), pt('E', 0, -1), pt('D', 0.05, 0)];
    const steps: ObjSpec[][] = [
      [
        { id: 'l1', def: { type: 'line', a: 'A', b: 'B' } },
        { id: 'l2', def: { type: 'line', a: 'C', b: 'E' } },
      ],
      [{ id: 'x', def: { type: 'intersection', a: 'l1', b: 'l2', index: 0 } }],
    ];
    const issues = tooCloseCrossings(givens, steps, { x: -1.5, y: -1.125, w: 3, h: 2.25 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stepIndex: 1, id: 'x', nearId: 'D' });
    expect(issues[0]?.px).toBeCloseTo(5.7, 5);
  });
});
