import type { Command, ObjId, ObjSpec } from '../construction/types';
import { dist, type Vec } from '../geometry/vec';
import type { ToolId } from '../levels/types';
import type { SnapTarget } from './snap';

export const TAP_SLOP_PX = 6;

export type GestureState =
  | { mode: 'idle' }
  | { mode: 'dragging'; from: SnapTarget; current: SnapTarget | null; startScreen: Vec }
  | {
      mode: 'armed';
      from: SnapTarget;
      current: SnapTarget | null;
      /** The pointer-down in progress while armed; absent between gestures. */
      down?: { target: SnapTarget | null; startScreen: Vec };
    };

export type GestureEvent =
  | { type: 'down'; target: SnapTarget | null; screen: Vec }
  | { type: 'move'; target: SnapTarget | null; screen: Vec }
  | { type: 'up'; target: SnapTarget | null; screen: Vec }
  | { type: 'cancel' }
  | { type: 'tool'; tool: ToolId };

export type GestureEffect =
  { type: 'commit'; command: Command } | { type: 'invalid' } | { type: 'lock'; target: SnapTarget };

type Ctx = { tool: ToolId; allocId: () => ObjId };
type Result = { state: GestureState; effects: GestureEffect[] };
type Endpoint = Extract<SnapTarget, { kind: 'point' | 'candidate' }>;

const IDLE: GestureState = { mode: 'idle' };
const idle = (effects: GestureEffect[] = []): Result => ({ state: IDLE, effects });

const isEndpoint = (t: SnapTarget | null): t is Endpoint =>
  !!t && (t.kind === 'point' || t.kind === 'candidate');

/** Same point id, or same candidate (a, b, index). */
function sameEndpoint(x: SnapTarget, y: SnapTarget): boolean {
  if (x.kind === 'point' && y.kind === 'point') return x.id === y.id;
  if (x.kind === 'candidate' && y.kind === 'candidate') {
    return x.c.a === y.c.a && x.c.b === y.c.b && x.c.index === y.c.index;
  }
  return false;
}

function sameTarget(x: SnapTarget | null, y: SnapTarget | null): boolean {
  if (!x || !y) return x === y;
  if (x.kind === 'curve' && y.kind === 'curve') return x.id === y.id;
  if (x.kind === 'empty' && y.kind === 'empty') return true;
  return sameEndpoint(x, y);
}

const commit = (objects: ObjSpec[]): GestureEffect => ({
  type: 'commit',
  command: { type: 'add', objects },
});

function intersectionSpec(t: Extract<SnapTarget, { kind: 'candidate' }>, id: ObjId): ObjSpec {
  return { id, def: { type: 'intersection', a: t.c.a, b: t.c.b, index: t.c.index } };
}

/** Resolve an endpoint to an object id, appending an intersection spec when it is a candidate. */
function resolve(t: Endpoint, specs: ObjSpec[], ctx: Ctx): ObjId {
  if (t.kind === 'point') return t.id;
  const id = ctx.allocId();
  specs.push(intersectionSpec(t, id));
  return id;
}

function commitTwoPoint(a: Endpoint, b: Endpoint, ctx: Ctx): GestureEffect {
  const specs: ObjSpec[] = [];
  const ia = resolve(a, specs, ctx);
  const ib = resolve(b, specs, ctx);
  const id = ctx.allocId();
  if (ctx.tool === 'circle') specs.push({ id, def: { type: 'circle', center: ia, through: ib } });
  else if (ctx.tool === 'perp-bisector')
    specs.push({ id, def: { type: 'perp-bisector', a: ia, b: ib } });
  else specs.push({ id, def: { type: 'line', a: ia, b: ib } });
  return commit(specs);
}

/** A tap on an endpoint: candidates are committed as intersections and armed as the new point. */
function arm(t: Endpoint, ctx: Ctx): Result {
  if (t.kind === 'point') return { state: { mode: 'armed', from: t, current: null }, effects: [] };
  const id = ctx.allocId();
  return {
    state: { mode: 'armed', from: { kind: 'point', id, pos: t.pos }, current: null },
    effects: [commit([intersectionSpec(t, id)])],
  };
}

function pointToolCommit(t: SnapTarget | null, ctx: Ctx): GestureEffect[] {
  if (!t) return [];
  switch (t.kind) {
    case 'empty':
      return [commit([{ id: ctx.allocId(), def: { type: 'free-point', pos: t.pos } }])];
    case 'curve':
      return [commit([{ id: ctx.allocId(), def: { type: 'on-curve', curve: t.id, t: t.t } }])];
    case 'candidate':
      return [commit([intersectionSpec(t, ctx.allocId())])];
    case 'point':
      return [];
  }
}

function hover(
  state: Extract<GestureState, { mode: 'dragging' | 'armed' }>,
  target: SnapTarget | null,
): Result {
  const lock = target && target.kind !== 'empty' && !sameTarget(state.current, target);
  return {
    state: { ...state, current: target },
    effects: lock ? [{ type: 'lock', target }] : [],
  };
}

export function gestureReducer(state: GestureState, ev: GestureEvent, ctx: Ctx): Result {
  if (ev.type === 'cancel' || ev.type === 'tool') return idle();
  const twoPoint = ctx.tool !== 'point';

  switch (state.mode) {
    case 'idle': {
      if (ev.type !== 'down') return idle();
      if (twoPoint && !isEndpoint(ev.target)) return idle();
      if (!ev.target) return idle();
      return {
        state: { mode: 'dragging', from: ev.target, current: ev.target, startScreen: ev.screen },
        effects: [],
      };
    }
    case 'dragging': {
      if (ev.type === 'move') return hover(state, ev.target);
      if (ev.type !== 'up') return { state, effects: [] };
      const tap = dist(ev.screen, state.startScreen) <= TAP_SLOP_PX;
      if (!twoPoint) return idle(tap ? pointToolCommit(ev.target, ctx) : []);
      const from = state.from;
      if (!isEndpoint(from)) return idle();
      if (tap) return arm(from, ctx);
      if (isEndpoint(ev.target) && !sameEndpoint(ev.target, from)) {
        return idle([commitTwoPoint(from, ev.target, ctx)]);
      }
      if (isEndpoint(ev.target)) return idle([{ type: 'invalid' }]);
      return idle();
    }
    case 'armed': {
      if (ev.type === 'move') return hover(state, ev.target);
      if (ev.type === 'down') {
        return {
          state: { ...state, down: { target: ev.target, startScreen: ev.screen } },
          effects: [],
        };
      }
      const { down, ...rest } = state;
      const stay: Result = { state: rest, effects: [] };
      const from = state.from;
      if (!down || !isEndpoint(down.target) || !isEndpoint(from) || !isEndpoint(ev.target))
        return stay;
      const tap = dist(ev.screen, down.startScreen) <= TAP_SLOP_PX;
      if (tap) {
        if (!sameEndpoint(ev.target, down.target)) return stay;
        return idle([
          sameEndpoint(down.target, from)
            ? { type: 'invalid' }
            : commitTwoPoint(from, down.target, ctx),
        ]);
      }
      if (sameEndpoint(down.target, from)) {
        if (sameEndpoint(ev.target, from)) return idle([{ type: 'invalid' }]);
        return idle([commitTwoPoint(from, ev.target, ctx)]);
      }
      if (sameEndpoint(ev.target, down.target)) return stay;
      return idle([commitTwoPoint(down.target, ev.target, ctx)]);
    }
  }
}
