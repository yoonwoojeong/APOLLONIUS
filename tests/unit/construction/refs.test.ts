import { expect, test } from 'vitest';
import { refIds } from '../../../src/construction/refs';
import type { ObjDef } from '../../../src/construction/types';

test('refIds lists the ids a def refers to, own string fields only', () => {
  expect(refIds({ type: 'circle', center: 'A', through: 'B' })).toEqual(['A', 'B']);
  expect(refIds({ type: 'on-curve', curve: 'c', t: 0 })).toEqual(['c']);
  expect(refIds({ type: 'given-point', pos: { x: 0, y: 0 } })).toEqual([]);
  const odd = Object.create({ a: 'inherited' }) as Record<string, unknown>;
  Object.assign(odd, { type: 'line', b: 7 });
  expect(refIds(odd as unknown as ObjDef)).toEqual([]);
});
