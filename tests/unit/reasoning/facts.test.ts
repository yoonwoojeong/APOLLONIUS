import { describe, expect, test } from 'vitest';
import { levelById, LEVELS } from '../../../src/levels';
import { deriveFacts } from '../../../src/reasoning/facts';
import { playReference } from '../helpers';

const EXPECTED: Record<string, string> = {
  equilateral: 'C lies on both circles, so CA = AB = CB.',
  'perp-bisector':
    'C and D are each equidistant from A and B, so the line CD is the perpendicular bisector.',
  midpoint: 'The perpendicular bisector of AB crosses it exactly halfway, at E.',
  perpendicular: 'P is the midpoint of A and C, so the bisector of AC is perpendicular to ℓ at P.',
  'angle-bisector':
    'VA = VC, so V lies on the perpendicular bisector of AC — which splits the angle evenly.',
  'circle-center': 'Both lines are perpendicular bisectors of chords, so each passes through the centre.',
};

describe('deriveFacts', () => {
  test('equilateral reference: C is on both circles', () => {
    const s = playReference(levelById('equilateral')).scene();
    const facts = deriveFacts(s);
    const c = s.objects.find((o) => o.label === 'C')?.id;
    expect(facts.filter((f) => f.kind === 'on-circle' && f.point === c)).toHaveLength(2);
    expect(facts).toContainEqual({ kind: 'equal-radius', circles: ['r1', 'r2'] });
  });

  test('perp-bisector reference: line is a derived perp-bisector of A,B', () => {
    const facts = deriveFacts(playReference(levelById('perp-bisector')).scene());
    expect(facts).toContainEqual({ kind: 'perp-bisector', line: 'r5', of: ['A', 'B'] });
  });

  test.each(LEVELS)('$id: explain() of the reference returns its exact sentence', (lvl) => {
    const s = playReference(lvl).scene();
    const m = lvl.goal(s);
    expect(m).not.toBeNull();
    expect(lvl.explain(deriveFacts(s), s, m as NonNullable<typeof m>)).toBe(EXPECTED[lvl.id]);
  });

  test('alternative solution without expected facts gets the fallback sentence', () => {
    const lvl = levelById('perp-bisector');
    const c = playReference(lvl);
    c.undo();
    c.undo();
    c.undo();
    c.undo();
    c.apply({ type: 'add', objects: [{ id: 'alt', def: { type: 'perp-bisector', a: 'A', b: 'B' } }] });
    const s = c.scene();
    const m = lvl.goal(s);
    expect(m).not.toBeNull();
    expect(lvl.explain(deriveFacts(s), s, m as NonNullable<typeof m>)).toBe(
      'Solved — every step is a valid construction.',
    );
  });
});
