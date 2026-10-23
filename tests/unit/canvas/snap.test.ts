import { describe, expect, it } from 'vitest';
import { candidateIntersections } from '../../../src/canvas/candidates';
import { findSnap, SNAP_RADIUS, type SnapTarget } from '../../../src/canvas/snap';
import { toScreen, type Viewport } from '../../../src/canvas/viewport';
import { evaluate } from '../../../src/construction/evaluate';
import type { ObjSpec } from '../../../src/construction/types';

const vp: Viewport = { cx: 0, cy: 0, scale: 10, width: 400, height: 400 };
const ALL: Array<SnapTarget['kind']> = ['point', 'candidate', 'curve', 'empty'];
const scr = (x: number, y: number) => toScreen(vp, { x, y });

// A=(0,0), B=(4,0); circles centred on each through the other meet at (2, ±3.46).
const base: ObjSpec[] = [
  { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
  { id: 'B', def: { type: 'given-point', pos: { x: 4, y: 0 } } },
  { id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } },
  { id: 'c2', def: { type: 'circle', center: 'B', through: 'A' } },
];
const sc = evaluate(base, 20);
const cands = candidateIntersections(sc);
const X = cands[0]!.pos;

describe('candidateIntersections', () => {
  it('offers both circle intersections with an index that reproduces pos', () => {
    expect(cands).toHaveLength(2);
    const c = cands[1]!;
    const s2 = evaluate(
      [...base, { id: 'P', def: { type: 'intersection', a: c.a, b: c.b, index: c.index } }],
      20,
    );
    expect(s2.byId.get('P')!.value).toEqual(c.pos);
  });

  it('does not offer a candidate coinciding with an existing point', () => {
    const s2 = evaluate(
      [...base, { id: 'P', def: { type: 'intersection', a: 'c1', b: 'c2', index: 0 } }],
      20,
    );
    expect(candidateIntersections(s2)).toHaveLength(1);
  });

  it('dedupes candidates shared by several curves', () => {
    const s2 = evaluate(
      [
        ...base,
        { id: 'l', def: { type: 'line', a: 'A', b: 'B' } },
        { id: 'pb', def: { type: 'perp-bisector', a: 'A', b: 'B' } },
      ],
      20,
    );
    const pts = candidateIntersections(s2).map((c) => c.pos);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(pts[i]).not.toEqual(pts[j]);
  });

  it('drops an intersection beyond a segment endpoint, keeps one beyond a line one', () => {
    const mk = (extent: 'line' | 'segment' | 'ray'): ObjSpec[] => [
      { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
      { id: 'B', def: { type: 'given-point', pos: { x: 2, y: 0 } } },
      { id: 'g', def: { type: 'given-line', a: 'A', b: 'B', extent } },
      { id: 'k', def: { type: 'given-circle', c: { x: 10, y: 0 }, r: 3 } },
    ];
    expect(candidateIntersections(evaluate(mk('segment'), 20))).toHaveLength(0);
    expect(candidateIntersections(evaluate(mk('line'), 20))).toHaveLength(2);
    expect(candidateIntersections(evaluate(mk('ray'), 20))).toHaveLength(2);
  });

  it('ray excludes intersections behind its start', () => {
    const specs: ObjSpec[] = [
      { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
      { id: 'B', def: { type: 'given-point', pos: { x: 2, y: 0 } } },
      { id: 'g', def: { type: 'given-line', a: 'A', b: 'B', extent: 'ray' } },
      { id: 'k', def: { type: 'given-circle', c: { x: -10, y: 0 }, r: 3 } },
    ];
    expect(candidateIntersections(evaluate(specs, 20))).toHaveLength(0);
  });
});

describe('findSnap', () => {
  it('point beats candidate beats curve when all within radius', () => {
    const s = evaluate(
      [...base, { id: 'P', def: { type: 'free-point', pos: { x: X.x + 0.5, y: X.y } } }],
      20,
    );
    const cs = candidateIntersections(s);
    const at = scr(X.x + 0.2, X.y);
    expect(findSnap(s, cs, at, vp, 'mouse', ALL)).toMatchObject({ kind: 'point', id: 'P' });
    const t2 = findSnap(sc, cands, at, vp, 'mouse', ALL);
    expect(t2).toMatchObject({ kind: 'candidate' });
    expect(findSnap(sc, cands, at, vp, 'mouse', ['curve', 'empty'])).toMatchObject({
      kind: 'curve',
    });
  });

  it('nearest wins among equal-priority targets', () => {
    const s = evaluate(
      [
        ...base,
        { id: 'P', def: { type: 'free-point', pos: { x: 10, y: 10 } } },
        { id: 'Q', def: { type: 'free-point', pos: { x: 10.5, y: 10 } } },
      ],
      40,
    );
    expect(findSnap(s, [], scr(10.4, 10), vp, 'mouse', ALL)).toMatchObject({ id: 'Q' });
    expect(findSnap(s, [], scr(10.1, 10), vp, 'mouse', ALL)).toMatchObject({ id: 'P' });
  });

  it('touch radius 24 catches a point 20px away; mouse 14 does not', () => {
    expect(SNAP_RADIUS).toEqual({ mouse: 14, pen: 14, touch: 24 });
    const at = { x: scr(0, 0).x + 20, y: scr(0, 0).y + 0 };
    const pts: Array<SnapTarget['kind']> = ['point'];
    expect(findSnap(sc, cands, at, vp, 'touch', pts)).toMatchObject({ kind: 'point', id: 'A' });
    expect(findSnap(sc, cands, at, vp, 'mouse', pts)).toBeNull();
  });

  it('accept excludes kinds: line tool ignores curves and empty', () => {
    const onCircle = scr(0, 4); // on c1 (radius 4 about A), far from points
    const pts: Array<SnapTarget['kind']> = ['point', 'candidate'];
    expect(findSnap(sc, cands, onCircle, vp, 'mouse', ALL)).toMatchObject({
      kind: 'curve',
      id: 'c1',
    });
    expect(findSnap(sc, cands, onCircle, vp, 'mouse', pts)).toBeNull();
  });

  it('curve target reports the nearest point and its parameter', () => {
    const t = findSnap(sc, cands, scr(0, 4.3), vp, 'mouse', ['curve']);
    expect(t).toMatchObject({ kind: 'curve', id: 'c1' });
    if (t?.kind === 'curve') {
      expect(t.pos.x).toBeCloseTo(0, 9);
      expect(t.pos.y).toBeCloseTo(4, 9);
      expect(t.t).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  it('segment given is not a curve target beyond its endpoint', () => {
    const s = evaluate(
      [
        { id: 'A', def: { type: 'given-point', pos: { x: 0, y: 0 } } },
        { id: 'B', def: { type: 'given-point', pos: { x: 2, y: 0 } } },
        { id: 'g', def: { type: 'given-line', a: 'A', b: 'B', extent: 'segment' } },
      ],
      20,
    );
    expect(findSnap(s, [], scr(1, 0.2), vp, 'mouse', ['curve'])).toMatchObject({ id: 'g' });
    expect(findSnap(s, [], scr(5, 0.2), vp, 'mouse', ['curve'])).toBeNull();
  });

  it('nothing in range and empty not accepted → null; empty accepted → world position', () => {
    const far = scr(15, -15);
    expect(findSnap(sc, cands, far, vp, 'mouse', ['point', 'candidate', 'curve'])).toBeNull();
    const e = findSnap(sc, cands, far, vp, 'mouse', ALL);
    expect(e).toMatchObject({ kind: 'empty' });
    expect(e!.pos.x).toBeCloseTo(15, 9);
    expect(e!.pos.y).toBeCloseTo(-15, 9);
  });

  it('hidden given-circle centre is never a point target', () => {
    const s = evaluate([{ id: 'k', def: { type: 'given-circle', c: { x: 0, y: 0 }, r: 5 } }], 20);
    expect(findSnap(s, [], scr(0, 0), vp, 'touch', ['point', 'candidate'])).toBeNull();
    expect(findSnap(s, [], scr(0, 0), vp, 'touch', ['curve'])).toBeNull();
  });
});
