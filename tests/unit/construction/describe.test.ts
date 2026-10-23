import { describe as suite, expect, test } from 'vitest';
import { Construction } from '../../../src/construction/construction';
import { describe } from '../../../src/construction/describe';

suite('describe', () => {
  test('describes circles, lines, perpendicular bisectors and points', () => {
    const c = new Construction(
      [
        { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
        { id: 'B', def: { type: 'given-point', pos: { x: 2, y: 0 } } },
      ],
      { A: 'A', B: 'B' },
      10,
    );
    c.apply({
      type: 'add',
      objects: [
        { id: 'pc', def: { type: 'free-point', pos: { x: 1, y: 1 } } },
        { id: 'k', def: { type: 'circle', center: 'A', through: 'B' } },
        { id: 'l', def: { type: 'line', a: 'A', b: 'pc' } },
        { id: 'p', def: { type: 'perp-bisector', a: 'A', b: 'B' } },
      ],
    });
    const s = c.scene();
    const d = (id: string) => describe(s.byId.get(id)!, s);
    expect(d('k')).toBe('Circle centered at A through B');
    expect(d('l')).toBe('Line through A and C');
    expect(d('p')).toBe('Perpendicular bisector of A and B');
    expect(d('pc')).toBe('Point C');
  });
});
