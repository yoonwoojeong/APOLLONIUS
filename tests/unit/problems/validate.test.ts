import { describe, expect, test } from 'vitest';
import { solutionMoves, validate, type ValidationError } from '../../../src/problems/validate';
import { problemPoints, type Problem } from '../../../src/problems/format';
import { tooCloseCrossings } from '../../../src/levels/tappability';
import { frame } from '../../../src/levels/view';
import { circleCenter } from '../../../src/levels/l6-circle-center';
import level1Fixture from '../../fixtures/problems/level1.json';
import perpBisectorFixture from '../../fixtures/problems/valid-perp-bisector.json';

const fixtures: Record<string, unknown> = {
  'valid-perp-bisector': perpBisectorFixture,
  level1: level1Fixture,
};
/** A fresh, mutable copy of a fixture. */
const load = (name: string): Problem => structuredClone(fixtures[name]) as Problem;

/** A fresh, mutable copy of the level-2-like fixture. */
const valid = (): Problem => load('valid-perp-bisector');

type Result = ReturnType<typeof validate>;
const codes = (r: Result): ValidationError['code'][] => (r.ok ? [] : r.errors.map((e) => e.code));
const errors = (r: Result): ValidationError[] => (r.ok ? [] : r.errors);

/** Givens A(-1,0), B(1,0) and C just above the crossing of the two circles at (0, √3). */
const nearCrossing = (dy: number): Problem => {
  const p = valid();
  p.givens.push({ id: 'C', def: { type: 'given-point', pos: { x: 0, y: Math.sqrt(3) + dy } } });
  p.labels.C = 'C';
  return p;
};

describe('validate: valid problems', () => {
  test('valid fixture passes', () => {
    const r = validate(valid());
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('level1 fixture passes', () => {
    const r = validate(load('level1'));
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('returns the problem on success', () => {
    const p = valid();
    const r = validate(p);
    expect(r.ok && r.problem).toEqual(p);
  });

  test('a perp-bisector step passes when the tool is allowed', () => {
    const p = valid();
    p.tools.push('perp-bisector');
    p.solution = [
      { objects: [{ id: 's1', def: { type: 'perp-bisector', a: 'A', b: 'B' } }], nudge: '' },
    ];
    p.targets = ['s1'];
    p.par = { L: 1, E: 3 };
    expect(errors(validate(p))).toEqual([]);
  });

  test('a free point that the target does not depend on is fine', () => {
    const p = valid();
    // A free point off to the side (well clear of the lower crossing at the framed scale), then
    // the reference construction.
    p.solution.unshift({
      objects: [{ id: 'f', def: { type: 'free-point', pos: { x: 1.6, y: -0.9 } } }],
      nudge: '',
    });
    expect(errors(validate(p))).toEqual([]);
  });
  test('points on a circle that the target does not depend on are fine (Level 6)', () => {
    const p: Problem = {
      ...valid(),
      tools: ['point', 'line', 'circle', 'perp-bisector'],
      givens: [
        { id: 'k', def: { type: 'given-circle', c: { x: 0.2, y: -0.1 }, r: 1.4 } },
        { id: 'P', def: { type: 'given-point', pos: { x: 1.8, y: 1.2 } } },
      ],
      labels: { P: 'P' },
      solution: circleCenter.reference.map((s) => ({
        nudge: s.nudge,
        objects: s.objects.map((o) =>
          o.def.type === 'on-curve' ? { ...o, def: { ...o.def, curve: 'k' } } : o,
        ),
      })),
      targets: ['r6'],
      par: { L: 2, E: 6 },
    };
    expect(errors(validate(p))).toEqual([]);
  });
});

describe('validate: shape', () => {
  test('non-object input → shape', () => expect(codes(validate('x'))).toContain('shape'));

  test('null and arrays → shape', () => {
    expect(codes(validate(null))).toContain('shape');
    expect(codes(validate([]))).toContain('shape');
  });

  test('unknown top-level key → shape', () => {
    const p = { ...valid(), id: 'abc' };
    const r = validate(p);
    expect(codes(r)).toEqual(['shape']);
    expect(errors(r)[0]?.path).toBe('id');
  });

  test('missing required key → shape', () => {
    const p: Partial<Problem> = valid();
    delete p.goalText;
    expect(codes(validate(p))).toEqual(['shape']);
  });

  test('version 2 → shape', () => {
    expect(codes(validate({ ...valid(), version: 2 }))).toEqual(['shape']);
  });

  test('wrong format → shape', () => {
    expect(codes(validate({ ...valid(), format: 'other' }))).toEqual(['shape']);
  });

  test('unknown object type → shape', () => {
    const p = valid() as unknown as { givens: { def: { type: string } }[] };
    p.givens[0]!.def.type = 'blob';
    expect(codes(validate(p))).toEqual(['shape']);
  });

  test('NaN coordinate → shape', () => {
    const p = valid();
    p.givens[0] = { id: 'A', def: { type: 'given-point', pos: { x: NaN, y: 0 } } };
    const r = validate(p);
    expect(codes(r)).toEqual(['shape']);
    expect(errors(r)[0]?.path).toBe('givens[0].def.pos.x');
  });

  test('Infinity radius → shape', () => {
    const p = valid();
    p.givens.push({ id: 'k', def: { type: 'given-circle', c: { x: 0, y: 0 }, r: Infinity } });
    expect(codes(validate(p))).toEqual(['shape']);
  });

  test('non-integer par → shape', () => {
    expect(codes(validate({ ...valid(), par: { L: 2.5, E: 3 } }))).toEqual(['shape']);
  });

  test('a NaN near a crossing never reaches untappable', () => {
    const p = nearCrossing(0.14);
    p.givens[2] = { id: 'C', def: { type: 'given-point', pos: { x: 0, y: NaN } } };
    expect(codes(validate(p))).toEqual(['shape']);
  });
});

describe('validate: limits and text', () => {
  test('41 givens → limit', () => {
    const p = valid();
    for (let i = 0; i < 39; i++) {
      p.givens.push({ id: `g${i}`, def: { type: 'given-point', pos: { x: i / 10, y: 5 } } });
    }
    expect(p.givens).toHaveLength(41);
    expect(codes(validate(p))).toContain('limit');
  });

  test('1 given → limit', () => {
    const p = valid();
    p.givens = p.givens.slice(0, 1);
    expect(codes(validate(p))).toContain('limit');
  });

  test('title of 41 chars → limit', () => {
    expect(codes(validate({ ...valid(), title: 'x'.repeat(41) }))).toEqual(['limit']);
  });

  test('title of 40 chars passes', () => {
    expect(errors(validate({ ...valid(), title: 'x'.repeat(40) }))).toEqual([]);
  });

  test('5 targets → limit', () => {
    const p = valid();
    p.targets = ['r1', 'r2', 'r3', 'r4', 'r5'];
    expect(codes(validate(p))).toEqual(['limit']);
  });

  test('label of 4 chars → limit', () => {
    const p = valid();
    p.labels.A = 'ABCD';
    expect(codes(validate(p))).toEqual(['limit']);
  });

  test('coordinate 1e9 → limit', () => {
    const p = valid();
    p.givens[1] = { id: 'B', def: { type: 'given-point', pos: { x: 1e9, y: 0 } } };
    expect(codes(validate(p))).toEqual(['limit']);
  });

  test('title containing "<b>" → text', () => {
    expect(codes(validate({ ...valid(), title: 'A <b>bold</b> move' }))).toEqual(['text']);
  });

  test('control character in a nudge → text', () => {
    const p = valid();
    p.solution[0]!.nudge = 'line\nbreak';
    const r = validate(p);
    expect(codes(r)).toEqual(['text']);
    expect(errors(r)[0]?.message).toMatch(/Step 1/);
  });

  test('untrimmed goal text → text', () => {
    expect(codes(validate({ ...valid(), goalText: ' Do it. ' }))).toEqual(['text']);
  });
});

describe('validate: references', () => {
  test('id "A B" → id', () => {
    const p = valid();
    p.solution[0]!.objects[0]!.id = 'A B';
    expect(codes(validate(p))).toContain('id');
  });

  test('duplicate id → id', () => {
    const p = valid();
    p.solution[1]!.objects[0]!.id = 'r1';
    expect(codes(validate(p))).toContain('id');
  });

  test('solution references id defined later → reference', () => {
    const p = valid();
    p.solution[0]!.objects[0] = { id: 'r1', def: { type: 'circle', center: 'A', through: 'r3' } };
    const r = validate(p);
    expect(codes(r)).toEqual(['reference']);
    expect(errors(r)[0]?.message).toMatch(/Step 1/);
  });

  test('target that does not exist → reference', () => {
    expect(codes(validate({ ...valid(), targets: ['zz'] }))).toEqual(['reference']);
  });

  test('label for an unknown id → reference', () => {
    const p = valid();
    p.labels.zz = 'Z';
    expect(codes(validate(p))).toEqual(['reference']);
  });

  test('given of type "circle" whose centre is not a given point → type', () => {
    const p = valid();
    p.givens.push({ id: 'AB', def: { type: 'given-line', a: 'A', b: 'B', extent: 'line' } });
    p.givens.push({ id: 'k', def: { type: 'circle', center: 'AB', through: 'B' } });
    expect(codes(validate(p))).toEqual(['type']);
  });

  test('solution using "given-point" → type', () => {
    const p = valid();
    p.solution.push({
      objects: [{ id: 'q', def: { type: 'given-point', pos: { x: 0, y: 3 } } }],
      nudge: '',
    });
    expect(codes(validate(p))).toEqual(['type']);
  });

  test('intersection of a point → type', () => {
    const p = valid();
    p.solution[2]!.objects[0] = {
      id: 'r3',
      def: { type: 'intersection', a: 'A', b: 'r2', index: 0 },
    };
    expect(codes(validate(p))).toEqual(['type']);
  });
});

describe('validate: tools', () => {
  test('perp-bisector step while tools lacks it → tool', () => {
    const p = valid();
    p.solution = [
      { objects: [{ id: 's1', def: { type: 'perp-bisector', a: 'A', b: 'B' } }], nudge: '' },
    ];
    p.targets = ['s1'];
    p.par = { L: 1, E: 3 };
    const r = validate(p);
    expect(codes(r)).toEqual(['tool']);
    expect(errors(r)[0]?.message).toMatch(/Step 1/);
  });

  test('tools missing "circle" → tool', () => {
    expect(codes(validate({ ...valid(), tools: ['point', 'line'] }))).toEqual(['tool']);
  });

  test('unknown tool → tool', () => {
    const p = valid() as unknown as { tools: string[] };
    p.tools.push('ruler');
    expect(codes(validate(p))).toEqual(['tool']);
  });
});

describe('validate: geometry', () => {
  test('line through A and A → degenerate', () => {
    const p = valid();
    p.solution.push({ objects: [{ id: 'bad', def: { type: 'line', a: 'A', b: 'A' } }], nudge: '' });
    const r = validate(p);
    expect(codes(r)).toEqual(['degenerate']);
    expect(errors(r)[0]?.message).toMatch(/Step 5/);
  });

  test('circles that do not meet → degenerate', () => {
    const p = valid();
    p.givens.push({ id: 'k', def: { type: 'given-circle', c: { x: 0, y: 50 }, r: 1 } });
    p.solution.push({
      objects: [{ id: 'x', def: { type: 'intersection', a: 'r1', b: 'k', index: 0 } }],
      nudge: '',
    });
    expect(codes(validate(p))).toEqual(['degenerate']);
  });

  test('drawing a line that is already there → degenerate', () => {
    const p = valid();
    p.solution.push({
      objects: [{ id: 'again', def: { type: 'line', a: 'r4', b: 'r3' } }],
      nudge: '',
    });
    expect(codes(validate(p))).toEqual(['degenerate']);
  });

  test('a degenerate problem with a too-close crossing never reaches untappable', () => {
    const p = nearCrossing(0.14);
    p.solution.push({ objects: [{ id: 'bad', def: { type: 'line', a: 'A', b: 'A' } }], nudge: '' });
    expect(codes(validate(p))).toEqual(['degenerate']);
  });

  test('two given points at the same spot → degenerate', () => {
    const p = valid();
    p.givens[1] = { id: 'B', def: { type: 'given-point', pos: { x: -1, y: 0 } } };
    expect(codes(validate(p))).toContain('degenerate');
  });

  test('target is a given → target-given', () => {
    expect(codes(validate({ ...valid(), targets: ['A'] }))).toEqual(['target-given']);
  });

  test('target equal to a given point → target-given', () => {
    const p = valid();
    p.givens.push({ id: 'C', def: { type: 'given-point', pos: { x: 0, y: Math.sqrt(3) } } });
    p.targets = ['r3'];
    expect(codes(validate(p))).toEqual(['target-given']);
  });

  test('two targets with identical geometry (a point and its duplicate intersection) → unsolved', () => {
    const p = valid();
    p.solution.push({
      objects: [{ id: 'r6', def: { type: 'intersection', a: 'r1', b: 'r2', index: 0 } }],
      nudge: '',
    });
    p.targets = ['r3', 'r6'];
    expect(codes(validate(p))).toEqual(['unsolved']);
  });

  test('target is a free point placed exactly at the midpoint of AB → not-robust', () => {
    const p = valid();
    p.solution = [
      { objects: [{ id: 'm', def: { type: 'free-point', pos: { x: 0, y: 0 } } }], nudge: '' },
    ];
    p.targets = ['m'];
    p.par = { L: 0, E: 0 };
    expect(codes(validate(p))).toEqual(['not-robust']);
  });

  test('target is a point on AB placed exactly at its midpoint → not-robust', () => {
    const p = valid();
    p.solution = [
      { objects: [{ id: 'l', def: { type: 'line', a: 'A', b: 'B' } }], nudge: '' },
      { objects: [{ id: 'm', def: { type: 'on-curve', curve: 'l', t: 1 } }], nudge: '' },
    ];
    p.targets = ['m'];
    p.par = { L: 1, E: 1 };
    expect(codes(validate(p))).toEqual(['not-robust']);
  });
});

describe('validate: par and tappability', () => {
  test('par.L below solution → par', () => {
    const r = validate({ ...valid(), par: { L: 2, E: 3 } });
    expect(codes(r)).toEqual(['par']);
    expect(errors(r)[0]?.path).toBe('par.L');
  });

  test('par.E below solution → par', () => {
    expect(codes(validate({ ...valid(), par: { L: 3, E: 2 } }))).toEqual(['par']);
  });

  test('par above the solution passes', () => {
    expect(errors(validate({ ...valid(), par: { L: 5, E: 7 } }))).toEqual([]);
  });

  test('crossing 6 px from a point → untappable', () => {
    // 0.19 world units at the framed scale (both circles whole in view) is about 6 px.
    const r = validate(nearCrossing(0.19));
    expect(codes(r)).toEqual(['untappable']);
    const p = nearCrossing(0.19);
    const issues = tooCloseCrossings(
      p.givens,
      p.solution.map((s) => s.objects),
      frame(problemPoints(p)).view,
    );
    expect(issues[0]?.px).toBeCloseTo(6, 0);
    expect(errors(r)[0]?.message).toContain(
      'Step 3: the crossing is too close to point C to tap on a phone — move C or pick another construction.',
    );
  });

  test('a point well away from the crossing is tappable', () => {
    expect(errors(validate(nearCrossing(1.5)))).toEqual([]);
  });
});

describe('solutionMoves', () => {
  test('solutionMoves(valid fixture) = {L:3,E:3}', () => {
    expect(solutionMoves(valid())).toEqual({ L: 3, E: 3 });
  });

  test('level1 fixture = {L:4,E:4}; perp-bisector costs 1L3E; points are free', () => {
    expect(solutionMoves(load('level1'))).toEqual({ L: 4, E: 4 });
    const p = valid();
    p.solution = [
      { objects: [{ id: 'f', def: { type: 'free-point', pos: { x: 0, y: 2 } } }], nudge: '' },
      { objects: [{ id: 's1', def: { type: 'perp-bisector', a: 'A', b: 'B' } }], nudge: '' },
    ];
    expect(solutionMoves(p)).toEqual({ L: 1, E: 3 });
  });
});

describe('validate: fix round 1', () => {
  test.each([
    ['solution r1 → constructor', (p: Problem) => (p.solution[0]!.objects[0]!.id = 'constructor')],
    ['solution r3 → __proto__', (p: Problem) => (p.solution[2]!.objects[0]!.id = '__proto__')],
    ['given B → toString', (p: Problem) => (p.givens[1]!.id = 'toString')],
  ])('Object.prototype names as ids → id (%s)', (_, mutate) => {
    const p = valid();
    mutate(p);
    const r = validate(p);
    expect(codes(r)).toContain('id');
    expect(JSON.stringify(r)).not.toContain('native code');
  });

  test.each([
    ['constructor', '{"constructor": 5}'],
    ['toString', '{"toString": "x"}'],
    ['__proto__', '{"__proto__": {"x": 1}}'],
  ])('a def with an inherited-name extra key (%s) → shape', (key, extra) => {
    const json = JSON.stringify(valid()).replace(
      '"def":{"type":"given-point",',
      `"def":{${extra.slice(1, -1)},"type":"given-point",`,
    );
    const p: unknown = JSON.parse(json);
    const r = validate(p);
    expect(codes(r)).toEqual(['shape']);
    expect(errors(r)[0]?.path).toBe(`givens[0].def.${key}`);
  });

  test('inherited-name extra keys at top level, in a step and in par → shape', () => {
    const top = JSON.parse(JSON.stringify(valid()).replace('{', '{"__proto__":{"a":1},'));
    expect(codes(validate(top))).toEqual(['shape']);
    const step = JSON.parse(
      JSON.stringify(valid()).replace('{"objects":', '{"constructor":1,"objects":'),
    );
    expect(codes(validate(step))).toEqual(['shape']);
    const par = JSON.parse(
      JSON.stringify(valid()).replace('"par":{"L":3,"E":3}', '"par":{"L":3,"toString":3}'),
    );
    expect(codes(validate(par))).toEqual(['shape']);
  });

  test('a label keyed by an Object.prototype name → reference', () => {
    const p = JSON.parse(
      JSON.stringify(valid()).replace('"labels":{', '"labels":{"constructor":"K",'),
    );
    expect(codes(validate(p))).toEqual(['reference']);
  });

  test('a step without a nudge passes and is normalised to ""', () => {
    const p = valid() as unknown as { solution: { nudge?: string }[] };
    delete p.solution[1]!.nudge;
    const r = validate(p);
    expect(errors(r)).toEqual([]);
    expect(r.ok && r.problem.solution[1]!.nudge).toBe('');
  });

  test('a sparse givens array → shape', () => {
    const p = valid();
    const sparse: unknown[] = [];
    sparse[0] = p.givens[0];
    sparse[2] = p.givens[1];
    expect(codes(validate({ ...p, givens: sparse }))).toEqual(['shape']);
  });

  test('a throwing getter never throws out of validate', () => {
    const p: Record<string, unknown> = { ...valid() };
    Object.defineProperty(p, 'title', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    let r: Result | undefined;
    expect(() => (r = validate(p))).not.toThrow();
    expect(r && codes(r)).toEqual(['shape']);
    expect(r && errors(r)[0]?.message).toBe("This file isn't a valid problem.");
  });

  test('a 5,000,000-char title → limit, quickly', () => {
    const t0 = performance.now();
    const r = validate({ ...valid(), title: 'x'.repeat(5_000_000) });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(codes(r)).toEqual(['limit']);
  });

  test.each([
    ['U+202E', 'Right‮left'],
    ['U+2028', 'Line sep'],
    ['U+200B', 'Zero​width'],
    ['U+2066', 'Iso⁦late'],
    ['U+FEFF', 'Bom﻿here'],
  ])('title containing %s → text', (_, title) => {
    expect(codes(validate({ ...valid(), title }))).toEqual(['text']);
  });
});

describe('validate: untrusted strings in messages', () => {
  const long = 'x'.repeat(5000);
  const all = (r: Result): string =>
    errors(r)
      .map((e) => `${e.path} ${e.message}`)
      .join('\n');

  test('an unknown field name, object type, id, reference, target and tool are cut short', () => {
    const p = valid() as unknown as Record<string, unknown> & Problem;
    p[long] = 1;
    expect(all(validate(p))).not.toContain('x'.repeat(25));
    expect(all(validate(p))).toContain(`${'x'.repeat(24)}…`);

    const q = valid();
    (q.givens[0]!.def as unknown as Record<string, unknown>).type = long;
    expect(all(validate(q))).toContain(`"${'x'.repeat(24)}…"`);

    const r = valid();
    (r.givens[0]!.def as unknown as Record<string, unknown>)[long] = 1;
    expect(all(validate(r))).not.toContain('x'.repeat(25));

    const s = valid();
    s.givens[0]!.id = long;
    s.labels = {};
    s.targets = [long];
    s.tools = [...s.tools, long as never];
    const sol = s.solution[0]!.objects[0]!.def as unknown as Record<string, unknown>;
    sol.center = `${long}!`;
    const text = all(validate(s));
    expect(text).not.toContain('x'.repeat(25));
    expect(text).toContain('\u2026');
  });

  test('hidden and direction-changing characters in echoes are spelled out', () => {
    const p = valid();
    p.targets = ['ev\u202eil\u0000'];
    const text = all(validate(p));
    expect(text).toContain('ev\\u202Eil\\u0000');
    expect(text).not.toContain('\u202e');
    expect(text).not.toContain('\u0000');
  });

  test('more invisible characters are refused in text', () => {
    for (const ch of [
      '\u200e',
      '\u200f',
      '\u061c',
      '\u2060',
      '\u2064',
      '\u00ad',
      '\u180e',
      '\u{e0001}',
      '\u{e007f}',
    ]) {
      const p = valid();
      p.title = `Bi${ch}sector`;
      expect(codes(validate(p)), JSON.stringify(ch)).toContain('text');
    }
  });
});
