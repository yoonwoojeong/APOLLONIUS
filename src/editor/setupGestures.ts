import { TAP_SLOP_PX } from '../canvas/gestures';
import type { SnapTarget } from '../canvas/snap';
import type { ObjDef, ObjId, ObjSpec } from '../construction/types';
import { dist, type Vec } from '../geometry/vec';

export type SetupTool = 'point' | 'segment' | 'ray' | 'line' | 'circle';

export interface SetupModel {
  givens: ObjSpec[];
  /** Point labels, keyed by object id. */
  labels: Record<ObjId, string>;
}

export type SetupEdit =
  | { type: 'add'; specs: ObjSpec[]; labels: Record<ObjId, string> }
  | { type: 'move'; id: ObjId; pos: Vec }
  | { type: 'move-circle'; id: ObjId; c?: Vec; r?: number }
  | { type: 'delete'; ids: ObjId[] }
  | { type: 'relabel'; id: ObjId; label: string };

/**
 * What the setup canvas hit-tests: the game's snap targets (Setup uses only 'point' and
 * 'empty') plus the two handles of a hidden given-circle.
 */
export type SetupTarget =
  SnapTarget | { kind: 'handle'; id: ObjId; which: 'centre' | 'rim'; pos: Vec };

/**
 * Sibling of the game's `GestureEvent`: the same shape, but pointer events also carry the raw
 * (unsnapped) `world` position, which a moving point or circle handle follows instead of the
 * snapped target. `screen` is still what the tap slop is measured in.
 */
export type SetupEvent =
  | { type: 'down'; target: SetupTarget | null; screen: Vec; world: Vec }
  | { type: 'move'; target: SetupTarget | null; screen: Vec; world: Vec }
  | { type: 'up'; target: SetupTarget | null; screen: Vec; world: Vec }
  | { type: 'cancel' }
  | { type: 'tool'; tool: SetupTool };

export type SetupGestureState =
  | { mode: 'idle' }
  | {
      mode: 'dragging';
      from: SetupTarget | null;
      startScreen: Vec;
      /** Beyond the tap slop at some point of this drag (stays true once set). */
      moved: boolean;
    };

export type SetupPreview = {
  kind: 'segment' | 'ray' | 'line' | 'circle';
  from: Vec;
  to: Vec;
} | null;

export interface SetupCtx {
  tool: SetupTool;
  hideCentre: boolean;
  model: SetupModel;
  /** Successive calls return fresh ids (`g1`, `g2`, …). */
  allocId: () => ObjId;
  /** Successive calls return successive unused labels (A, B, …). */
  nextLabel: () => string;
}

type Result = { state: SetupGestureState; edits: SetupEdit[]; preview: SetupPreview };

const IDLE: SetupGestureState = { mode: 'idle' };
const done = (edits: SetupEdit[] = []): Result => ({ state: IDLE, edits, preview: null });

/** What a point label may be: 1–3 letters, digits or primes. */
export const LABEL_RE = /^[A-Za-z0-9′']{1,3}$/;

/** Where an end of a gesture sits: an existing point's id, or empty space. */
type End = { id: ObjId } | { pos: Vec };

function endOf(t: SetupTarget | null, world: Vec): End {
  return t && t.kind === 'point' ? { id: t.id } : { pos: t && t.kind === 'empty' ? t.pos : world };
}

const startPos = (t: SetupTarget | null): Vec | null =>
  t && (t.kind === 'point' || t.kind === 'empty' || t.kind === 'handle') ? t.pos : null;

/** Resolve an end to an object id, appending a new labelled given-point when it is empty space. */
function resolve(e: End, specs: ObjSpec[], labels: Record<ObjId, string>, ctx: SetupCtx): ObjId {
  if ('id' in e) return e.id;
  const id = ctx.allocId();
  specs.push({ id, def: { type: 'given-point', pos: e.pos } });
  labels[id] = ctx.nextLabel();
  return id;
}

function previewOf(tool: SetupTool, from: Vec, to: Vec): SetupPreview {
  return { kind: tool === 'point' ? 'segment' : tool, from, to };
}

function posOf(model: SetupModel, id: ObjId): Vec | null {
  const def = model.givens.find((g) => g.id === id)?.def;
  return def?.type === 'given-point' ? def.pos : null;
}

function commitTwoPoint(
  from: SetupTarget,
  ev: Extract<SetupEvent, { type: 'up' }>,
  ctx: SetupCtx,
): SetupEdit[] {
  const a = endOf(from, ev.world);
  const b = endOf(ev.target, ev.world);
  if ('id' in a && 'id' in b && a.id === b.id) return [];
  const pa = 'id' in a ? posOf(ctx.model, a.id) : a.pos;
  const pb = 'id' in b ? posOf(ctx.model, b.id) : b.pos;
  if (!pa || !pb || (pa.x === pb.x && pa.y === pb.y)) return [];

  const specs: ObjSpec[] = [];
  const labels: Record<ObjId, string> = {};
  if (ctx.tool === 'circle' && ctx.hideCentre) {
    specs.push({ id: ctx.allocId(), def: { type: 'given-circle', c: pa, r: dist(pa, pb) } });
    return [{ type: 'add', specs, labels }];
  }
  const ia = resolve(a, specs, labels, ctx);
  const ib = resolve(b, specs, labels, ctx);
  const id = ctx.allocId();
  const def: ObjDef =
    ctx.tool === 'circle'
      ? { type: 'circle', center: ia, through: ib }
      : {
          type: 'given-line',
          a: ia,
          b: ib,
          extent: ctx.tool === 'point' ? 'line' : ctx.tool === 'segment' ? 'segment' : ctx.tool,
        };
  specs.push({ id, def });
  return [{ type: 'add', specs, labels }];
}

/** Live edit for a drag of a point or circle handle (point tool). */
function liveMove(from: SetupTarget, world: Vec, ctx: SetupCtx): SetupEdit[] {
  if (from.kind === 'point') return [{ type: 'move', id: from.id, pos: world }];
  if (from.kind !== 'handle') return [];
  if (from.which === 'centre') return [{ type: 'move-circle', id: from.id, c: world }];
  const def = ctx.model.givens.find((g) => g.id === from.id)?.def;
  if (def?.type !== 'given-circle') return [];
  const r = dist(def.c, world);
  return r > 0 ? [{ type: 'move-circle', id: from.id, r }] : [];
}

export function setupReducer(state: SetupGestureState, ev: SetupEvent, ctx: SetupCtx): Result {
  if (ev.type === 'cancel' || ev.type === 'tool') return done();

  if (state.mode === 'idle') {
    if (ev.type !== 'down') return done();
    return {
      state: { mode: 'dragging', from: ev.target, startScreen: ev.screen, moved: false },
      edits: [],
      preview: null,
    };
  }

  const { from } = state;
  const moved = state.moved || dist(ev.screen, state.startScreen) > TAP_SLOP_PX;
  const next: SetupGestureState = { ...state, moved };

  if (ev.type === 'down') return { state, edits: [], preview: null };

  if (ctx.tool === 'point') {
    if (ev.type === 'move') {
      return {
        state: next,
        edits: moved && from ? liveMove(from, ev.world, ctx) : [],
        preview: null,
      };
    }
    // up: a tap on empty space places a point; a finished drag has already been applied live.
    if (moved || !from || from.kind !== 'empty' || ev.target?.kind !== 'empty') return done();
    const id = ctx.allocId();
    return done([
      {
        type: 'add',
        specs: [{ id, def: { type: 'given-point', pos: ev.target.pos } }],
        labels: { [id]: ctx.nextLabel() },
      },
    ]);
  }

  // Two-point tools.
  const fromPos = startPos(from);
  if (!from || from.kind === 'handle' || !fromPos) return done();
  if (ev.type === 'move') {
    if (!moved) return { state: next, edits: [], preview: null };
    const to = ev.target && ev.target.kind !== 'handle' ? ev.target.pos : ev.world;
    return { state: next, edits: [], preview: previewOf(ctx.tool, fromPos, to) };
  }
  if (!moved) return done();
  return done(commitTwoPoint(from, ev, ctx));
}

// --- Model edits -------------------------------------------------------------------------

function refsOf(def: ObjDef): ObjId[] {
  switch (def.type) {
    case 'given-line':
      return [def.a, def.b];
    case 'circle':
      return [def.center, def.through];
    default:
      return [];
  }
}

/** Ids that transitively depend on `id` (not `id` itself), in model order. */
export function dependants(model: SetupModel, id: ObjId): ObjId[] {
  const gone = new Set<ObjId>([id]);
  const found = new Set<ObjId>();
  for (let grew = true; grew;) {
    grew = false;
    for (const g of model.givens) {
      if (gone.has(g.id) || !refsOf(g.def).some((r) => gone.has(r))) continue;
      gone.add(g.id);
      found.add(g.id);
      grew = true;
    }
  }
  return model.givens.filter((g) => found.has(g.id)).map((g) => g.id);
}

const mapDef = (model: SetupModel, id: ObjId, f: (def: ObjDef) => ObjDef): SetupModel => ({
  ...model,
  givens: model.givens.map((g) => (g.id === id ? { ...g, def: f(g.def) } : g)),
});

/** Pure: returns a new model (or the same one when the edit is rejected / a no-op). */
export function applyEdit(model: SetupModel, edit: SetupEdit): SetupModel {
  switch (edit.type) {
    case 'add':
      return {
        givens: [...model.givens, ...edit.specs],
        labels: { ...model.labels, ...edit.labels },
      };
    case 'move':
      return mapDef(model, edit.id, (d) =>
        d.type === 'given-point' ? { ...d, pos: edit.pos } : d,
      );
    case 'move-circle':
      return mapDef(model, edit.id, (d) =>
        d.type === 'given-circle' ? { ...d, c: edit.c ?? d.c, r: edit.r ?? d.r } : d,
      );
    case 'delete': {
      const gone = new Set<ObjId>(edit.ids);
      for (const id of edit.ids) for (const d of dependants(model, id)) gone.add(d);
      return {
        givens: model.givens.filter((g) => !gone.has(g.id)),
        labels: Object.fromEntries(Object.entries(model.labels).filter(([k]) => !gone.has(k))),
      };
    }
    case 'relabel': {
      if (!LABEL_RE.test(edit.label)) return model;
      if (!model.givens.some((g) => g.id === edit.id)) return model;
      const taken = Object.entries(model.labels).some(
        ([k, l]) => k !== edit.id && l === edit.label,
      );
      if (taken) return model;
      return { ...model, labels: { ...model.labels, [edit.id]: edit.label } };
    }
  }
}
