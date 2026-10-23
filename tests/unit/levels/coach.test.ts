import { describe, expect, it } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import type { Scene } from '../../../src/construction/types';
import { levelById } from '../../../src/levels';
import type { CoachStep } from '../../../src/levels/types';

const level = levelById('equilateral');
const coach = level.coach ?? [];

/** The level's scene after the first `n` reference steps. */
function after(n: number): Scene {
  const c = new Construction(level.givens, level.labels, level.sceneDiameter);
  for (const step of level.reference.slice(0, n)) {
    expect(c.apply({ type: 'add', objects: step.objects }).ok).toBe(true);
  }
  return c.scene();
}

const current = (s: Scene): CoachStep | undefined => coach.find((st) => !st.doneWhen(s));

describe('level 1 coach', () => {
  it('has the four steps with the exact copy', () => {
    expect(coach.map((s) => s.text)).toEqual([
      'Drag from A to B to draw a circle.',
      'Now drag from B to A.',
      'Tap where the circles cross.',
      'Draw lines from your new point to A and to B.',
    ]);
  });

  it.each([0, 1, 2, 3])('step %i is not done on the givens', (i) => {
    expect(coach[i]!.doneWhen(after(0))).toBe(false);
  });

  it.each([0, 1, 2, 3])('step %i is done after the matching reference step', (i) => {
    expect(coach[i]!.doneWhen(after(i + 1))).toBe(true);
  });

  it('the current step is the first one not done, ending with none', () => {
    expect([0, 1, 2, 3, 4].map((n) => current(after(n))?.text ?? null)).toEqual([
      ...coach.map((s) => s.text),
      null,
    ]);
  });

  it('step 2 wants the circle centred at B: the circle A→B alone does not count', () => {
    const c = new Construction(level.givens, level.labels, level.sceneDiameter);
    c.apply({
      type: 'add',
      objects: [{ id: 'x', def: { type: 'circle', center: 'A', through: 'B' } }],
    });
    expect(coach[1]!.doneWhen(c.scene())).toBe(false);
  });

  it('step 3 counts either crossing point', () => {
    const c = new Construction(level.givens, level.labels, level.sceneDiameter);
    for (const step of level.reference.slice(0, 2)) c.apply({ type: 'add', objects: step.objects });
    expect(coach[2]!.doneWhen(c.scene())).toBe(false);
    c.apply({
      type: 'add',
      objects: [{ id: 'p', def: { type: 'intersection', a: 'r1', b: 'r2', index: 1 } }],
    });
    expect(coach[2]!.doneWhen(c.scene())).toBe(true);
  });

  it('targets pulse A and B; the crossing step pulses both crossings', () => {
    expect(coach[0]!.target).toEqual(['A', 'B']);
    expect(coach[1]!.target).toEqual(['B', 'A']);
    expect(coach[2]!.spots?.(after(2))).toHaveLength(2);
    expect(coach[3]!.spots?.(after(3))).toHaveLength(1); // only the crossing that was marked
  });

  it('the circle steps select the circle tool, step 4 the line tool', () => {
    expect(coach.map((s) => s.tool)).toEqual(['circle', 'circle', undefined, 'line']);
  });
});

describe('inline tips', () => {
  it('level 6 tells the player how to place points on the circle', () => {
    expect(levelById('circle-center').tip).toBe('Tap the circle to place points on it.');
  });

  it('level 4 keeps its tip', () => {
    expect(levelById('perpendicular').tip).toBe(
      'New tool: drag between two points to draw their perpendicular bisector.',
    );
  });
});
