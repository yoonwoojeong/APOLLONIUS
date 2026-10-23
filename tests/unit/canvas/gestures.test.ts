import { describe, expect, it } from 'vitest';
import {
  gestureReducer,
  TAP_SLOP_PX,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
} from '../../../src/canvas/gestures';
import type { SnapTarget } from '../../../src/canvas/snap';
import type { ToolId } from '../../../src/levels/types';

const pt = (id: string, x = 0, y = 0): SnapTarget => ({ kind: 'point', id, pos: { x, y } });
const cand = (a: string, b: string, index: 0 | 1 = 0): SnapTarget => ({
  kind: 'candidate',
  c: { a, b, index, pos: { x: 5, y: 5 } },
  pos: { x: 5, y: 5 },
});
const A = pt('A');
const B = pt('B', 10, 0);
const scr = (x: number, y: number) => ({ x, y });

function run(tool: ToolId, events: GestureEvent[], start: GestureState = { mode: 'idle' }) {
  let n = 0;
  const allocId = () => `n${++n}`;
  let state = start;
  const effects: GestureEffect[] = [];
  for (const ev of events) {
    const r = gestureReducer(state, ev, { tool, allocId });
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const down = (target: SnapTarget | null, x = 0, y = 0): GestureEvent => ({
  type: 'down',
  target,
  screen: scr(x, y),
});
const move = (target: SnapTarget | null, x = 0, y = 0): GestureEvent => ({
  type: 'move',
  target,
  screen: scr(x, y),
});
const up = (target: SnapTarget | null, x = 0, y = 0): GestureEvent => ({
  type: 'up',
  target,
  screen: scr(x, y),
});
const commits = (effects: GestureEffect[]) => effects.filter((e) => e.type === 'commit');

describe('gestureReducer', () => {
  it('drag A→B with circle tool commits circle(center A, through B)', () => {
    const r = run('circle', [down(A), move(B, 100, 0), up(B, 100, 0)]);
    expect(r.state).toEqual({ mode: 'idle' });
    expect(commits(r.effects)).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'circle', center: 'A', through: 'B' } }] },
      },
    ]);
  });

  it('tap A then tap B with line tool commits line A–B', () => {
    const first = run('line', [down(A), up(A)]);
    expect(first.state).toMatchObject({ mode: 'armed', from: A });
    expect(first.effects).toEqual([]);
    const second = run('line', [down(B, 50, 0), up(B, 50, 0)], first.state);
    expect(second.state).toEqual({ mode: 'idle' });
    expect(second.effects).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'line', a: 'A', b: 'B' } }] },
      },
    ]);
  });

  it('drag from point to candidate commits intersection + line in one command', () => {
    const c = cand('c1', 'c2', 1);
    const r = run('line', [down(A), up(c, 80, 80)]);
    expect(r.effects).toEqual([
      {
        type: 'commit',
        command: {
          type: 'add',
          objects: [
            { id: 'n1', def: { type: 'intersection', a: 'c1', b: 'c2', index: 1 } },
            { id: 'n2', def: { type: 'line', a: 'A', b: 'n1' } },
          ],
        },
      },
    ]);
  });

  it('perp-bisector from two candidates puts both intersections first', () => {
    const r = run('perp-bisector', [down(cand('a', 'b', 0)), up(cand('a', 'b', 1), 80, 0)]);
    const cmd = (r.effects[0] as { type: 'commit'; command: { objects: { id: string }[] } }).command;
    expect(cmd.objects.map((o) => o.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('release on same point → invalid', () => {
    const r = run('line', [down(A), move(A, 40, 0), move(A, 1, 0), up(A, 40, 0)]);
    expect(r.effects.filter((e) => e.type !== 'lock')).toEqual([{ type: 'invalid' }]);
    expect(r.state).toEqual({ mode: 'idle' });
  });

  it('tapping the armed endpoint again → invalid and idle', () => {
    const r = run('line', [down(A), up(A), down(A), up(A)]);
    expect(r.effects).toEqual([{ type: 'invalid' }]);
    expect(r.state).toEqual({ mode: 'idle' });
  });

  it('release over empty space with line tool → idle, nothing committed', () => {
    const empty: SnapTarget = { kind: 'empty', pos: { x: 3, y: 3 } };
    const r = run('line', [down(A), move(empty, 90, 90), up(empty, 90, 90)]);
    expect(r.state).toEqual({ mode: 'idle' });
    expect(r.effects).toEqual([]);
    const r2 = run('line', [down(A), up(null, 90, 90)]);
    expect(r2.state).toEqual({ mode: 'idle' });
    expect(r2.effects).toEqual([]);
  });

  it('cancel mid-drag → idle, nothing committed', () => {
    const r = run('line', [down(A), move(B, 90, 0), { type: 'cancel' }]);
    expect(r.state).toEqual({ mode: 'idle' });
    expect(commits(r.effects)).toEqual([]);
    const armed = run('line', [{ type: 'cancel' }], { mode: 'armed', from: A, current: null });
    expect(armed.state).toEqual({ mode: 'idle' });
    expect(armed.effects).toEqual([]);
  });

  it('point tool on curve → on-curve with t from target', () => {
    const curve: SnapTarget = { kind: 'curve', id: 'c1', t: 1.25, pos: { x: 1, y: 1 } };
    const r = run('point', [down(curve, 5, 5), up(curve, 5, 5)]);
    expect(r.effects).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'on-curve', curve: 'c1', t: 1.25 } }] },
      },
    ]);
  });

  it('point tool on empty → free-point; on existing point → nothing; drag → nothing', () => {
    const e: SnapTarget = { kind: 'empty', pos: { x: 2, y: 3 } };
    const r = run('point', [down(e), up(e)]);
    expect(r.effects).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'free-point', pos: { x: 2, y: 3 } } }] },
      },
    ]);
    expect(run('point', [down(A), up(A)]).effects).toEqual([]);
    expect(run('point', [down(e), up(e, TAP_SLOP_PX + 10, 0)]).effects).toEqual([]);
  });

  it('point tool on candidate → intersection', () => {
    const r = run('point', [down(cand('c1', 'c2')), up(cand('c1', 'c2'))]);
    expect(r.effects).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'intersection', a: 'c1', b: 'c2', index: 0 } }] },
      },
    ]);
    expect(r.state).toEqual({ mode: 'idle' });
  });

  it('tap on candidate with circle tool commits intersection and arms it', () => {
    const r = run('circle', [down(cand('c1', 'c2')), up(cand('c1', 'c2'))]);
    expect(commits(r.effects)).toHaveLength(1);
    expect(r.state).toMatchObject({ mode: 'armed', from: { kind: 'point', id: 'n1' } });
    const r2 = run('circle', [down(B), up(B)], r.state);
    expect(r2.effects).toEqual([
      {
        type: 'commit',
        command: { type: 'add', objects: [{ id: 'n1', def: { type: 'circle', center: 'n1', through: 'B' } }] },
      },
    ]);
  });

  it('moving onto a new snap target emits lock once', () => {
    const r = run('line', [down(A), move(null, 30, 0), move(B, 60, 0), move(B, 61, 0), move(B, 62, 0)]);
    expect(r.effects).toEqual([{ type: 'lock', target: B }]);
  });

  it('armed hover updates current and locks on change', () => {
    const r = run('line', [move(B, 5, 5), move(B, 6, 5)], { mode: 'armed', from: A, current: null });
    expect(r.state).toEqual({ mode: 'armed', from: A, current: B });
    expect(r.effects).toEqual([{ type: 'lock', target: B }]);
  });

  it('two-point tool ignores down on non-endpoint targets', () => {
    const e: SnapTarget = { kind: 'empty', pos: { x: 0, y: 0 } };
    expect(run('line', [down(e), up(e)])).toEqual({ state: { mode: 'idle' }, effects: [] });
    const armed: GestureState = { mode: 'armed', from: A, current: null };
    const r = run('line', [down(e, 30, 30), up(e, 30, 30)], armed);
    expect(r.state).toEqual(armed);
    expect(r.effects).toEqual([]);
  });

  it('changing tool while armed → idle', () => {
    const r = run('line', [{ type: 'tool', tool: 'circle' }], { mode: 'armed', from: A, current: null });
    expect(r).toEqual({ state: { mode: 'idle' }, effects: [] });
  });
});
