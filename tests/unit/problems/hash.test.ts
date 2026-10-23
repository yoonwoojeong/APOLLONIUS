import { describe, expect, test } from 'vitest';
import { canonicalJson, problemHash } from '../../../src/problems/hash';
import type { Problem } from '../../../src/problems/format';

const base = (): Problem => ({
  format: 'apollonius-problem',
  version: 1,
  title: 'T',
  goalText: 'G',
  tools: ['point', 'line', 'circle'],
  givens: [
    { id: 'g1', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
    { id: 'g2', def: { type: 'given-point', pos: { x: 1, y: 0 } } },
  ],
  labels: { g1: 'A', g2: 'B' },
  solution: [
    { objects: [{ id: 'o1', def: { type: 'line', a: 'g1', b: 'g2' } }], nudge: 'Draw it' },
  ],
  targets: ['o1'],
  par: { L: 1, E: 1 },
});

describe('canonicalJson', () => {
  test('sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 0, c: 1 }] })).toBe('{"a":[2,{"c":1,"d":0}],"b":1}');
  });
  test('rounds numbers to 12 significant digits', () => {
    expect(canonicalJson(0.1 + 0.2)).toBe('0.3');
  });
});

describe('problemHash', () => {
  test('is 14 chars base-36 and ignores key order', () => {
    const a = base();
    const b: Problem = JSON.parse(JSON.stringify(a));
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as unknown as Problem;
    expect(problemHash(a)).toMatch(/^[0-9a-z]{14}$/);
    expect(problemHash(reordered)).toBe(problemHash(a));
  });
  test('changes with a 1e-6 coordinate change', () => {
    const b = base();
    b.givens[1] = { id: 'g2', def: { type: 'given-point', pos: { x: 1 + 1e-6, y: 0 } } };
    expect(problemHash(b)).not.toBe(problemHash(base()));
  });
  test('changes with one nudge character', () => {
    const b = base();
    b.solution = [{ ...b.solution[0]!, nudge: 'Draw its' }];
    expect(problemHash(b)).not.toBe(problemHash(base()));
  });
});
