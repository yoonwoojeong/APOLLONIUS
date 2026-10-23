import { paramOf, perpBisector, type CircleG, type Curve, type LineG } from '../geometry/curves';
import { add, dist, scale, sub, type Vec } from '../geometry/vec';
import type { Scene, SceneObject } from '../construction/types';
import type { ToolId } from '../levels/types';
import { isPointValue } from './candidates';
import { toScreen, type Rect, type Viewport } from './viewport';

/** Pure screen-space geometry for SceneLayer. Everything here is in CSS pixels. */

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * `key` is stable per role (e.g. a line's forward and backward ray) so a shape that is
 * clipped away and back during pan/zoom keeps its identity instead of re-mounting.
 */
export type Shape = { key: string } & (({ tag: 'line' } & Seg) | { tag: 'path'; d: string });

/** Lines and rays extend this far past the canvas edge so their caps never show. */
const BLEED = 8;

const round = (n: number): number => Math.round(n * 100) / 100 || 0;

/**
 * Clip `l` to `rect`. With `extent.from` only it is a ray from `from` along `l.d`; with
 * `extent.to` as well it is the segment from → to. The result starts at `from` (or where the
 * extent enters the rect) so a draw-on sweeps away from it. Null when nothing is visible.
 */
export function linePath(l: LineG, rect: Rect, extent?: { from: Vec; to?: Vec }): Seg | null {
  let lo = -Infinity;
  let hi = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [l.p.x, l.d.x, rect.x, rect.x + rect.w],
    [l.p.y, l.d.y, rect.y, rect.y + rect.h],
  ];
  for (const [p, d, min, max] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p < min || p > max) return null;
      continue;
    }
    const t1 = (min - p) / d;
    const t2 = (max - p) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  let reversed = false;
  if (extent) {
    const tf = paramOf(l, extent.from);
    if (extent.to) {
      const tt = paramOf(l, extent.to);
      lo = Math.max(lo, Math.min(tf, tt));
      hi = Math.min(hi, Math.max(tf, tt));
      reversed = tt < tf;
    } else {
      lo = Math.max(lo, tf);
    }
  }
  if (!(lo <= hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const [a, b] = reversed ? [hi, lo] : [lo, hi];
  return {
    x1: round(l.p.x + l.d.x * a),
    y1: round(l.p.y + l.d.y * a),
    x2: round(l.p.x + l.d.x * b),
    y2: round(l.p.y + l.d.y * b),
  };
}

/** A full circle as two half-arcs that begin and end at `start` (projected onto the circle). */
export function circlePath(c: CircleG, start: Vec): string {
  const v = sub(start, c.c);
  const l = Math.hypot(v.x, v.y);
  const u = l > 0 && Number.isFinite(l) ? scale(v, 1 / l) : { x: 1, y: 0 };
  const s = add(c.c, scale(u, c.r));
  const o = sub(c.c, scale(u, c.r));
  const r = round(c.r);
  const p = (q: Vec) => `${round(q.x)} ${round(q.y)}`;
  return `M ${p(s)} A ${r} ${r} 0 0 1 ${p(o)} A ${r} ${r} 0 0 1 ${p(s)}`;
}

/** The visible screen rect plus a bleed margin. */
export function screenRect(vp: Viewport): Rect {
  return { x: -BLEED, y: -BLEED, w: vp.width + 2 * BLEED, h: vp.height + 2 * BLEED };
}

export function curveToScreen(c: Curve, vp: Viewport): Curve {
  if (c.kind === 'line') return { kind: 'line', p: toScreen(vp, c.p), d: c.d };
  return { kind: 'circle', c: toScreen(vp, c.c), r: c.r * vp.scale };
}

const flip = (l: LineG): LineG => ({ ...l, d: scale(l.d, -1) });

/** A full line as two rays sweeping outward from `origin` (both start there). */
function raysFrom(l: LineG, origin: Vec, rect: Rect): Shape[] {
  const rays: Array<[string, Seg | null]> = [
    ['fwd', linePath(l, rect, { from: origin })],
    ['back', linePath(flip(l), rect, { from: origin })],
  ];
  return rays.flatMap(([key, s]) => (s ? [{ key, tag: 'line' as const, ...s }] : []));
}

function pointOf(scene: Scene, id: string, vp: Viewport): Vec | null {
  const v = scene.byId.get(id)?.value;
  return v && isPointValue(v) ? toScreen(vp, v) : null;
}

/**
 * Screen shapes for a curve object. Player lines sweep from their first point, perpendicular
 * bisectors from the midpoint, circles trace from the radius point; given lines honour extent.
 */
export function objectShapes(obj: SceneObject, scene: Scene, vp: Viewport): Shape[] {
  const v = obj.value;
  if (!v || isPointValue(v)) return [];
  const rect = screenRect(vp);
  const c = curveToScreen(v, vp);
  const def = obj.def;
  if (c.kind === 'circle') {
    const start = def.type === 'circle' ? pointOf(scene, def.through, vp) : null;
    return [{ key: 'circle', tag: 'path', d: circlePath(c, start ?? add(c.c, { x: c.r, y: 0 })) }];
  }
  if (def.type === 'given-line') {
    const a = pointOf(scene, def.a, vp);
    const b = pointOf(scene, def.b, vp);
    let seg: Seg | null;
    if (def.extent === 'segment' && a && b) seg = linePath(c, rect, { from: a, to: b });
    else if (def.extent === 'ray' && a && b) {
      const dir = paramOf(c, b) >= paramOf(c, a) ? c : flip(c);
      seg = linePath(dir, rect, { from: a });
    } else seg = linePath(c, rect);
    return seg ? [{ key: 'line', tag: 'line', ...seg }] : [];
  }
  if (def.type === 'line') return raysFrom(c, pointOf(scene, def.a, vp) ?? c.p, rect);
  return raysFrom(c, c.p, rect);
}

/** Screen shapes for a free-standing curve value (gold overlays); lines sweep from `p`. */
export function curveShapes(v: Curve, vp: Viewport): Shape[] {
  const c = curveToScreen(v, vp);
  if (c.kind === 'circle')
    return [{ key: 'circle', tag: 'path', d: circlePath(c, add(c.c, { x: c.r, y: 0 })) }];
  return raysFrom(c, c.p, screenRect(vp));
}

/** The game's tools plus the segment and ray extents the problem editor previews. */
export type GhostTool = ToolId | 'segment' | 'ray';

/**
 * Ghost preview for a two-point tool from `from` to `to` (world). Lines and bisectors are
 * the full clipped line; a circle is centred at `from` through `to`. A segment runs from `from` to `to`, a ray from `from` through `to`. Empty when degenerate.
 */
export function ghostShapes(tool: GhostTool, from: Vec, to: Vec, vp: Viewport): Shape[] {
  const a = toScreen(vp, from);
  const b = toScreen(vp, to);
  if (dist(a, b) < 1) return [];
  const rect = screenRect(vp);
  if (tool === 'circle')
    return [
      { key: 'circle', tag: 'path', d: circlePath({ kind: 'circle', c: a, r: dist(a, b) }, b) },
    ];
  if (tool === 'segment' || tool === 'ray') {
    const d = sub(b, a);
    const len = Math.hypot(d.x, d.y);
    const dir = { kind: 'line' as const, p: a, d: scale(d, 1 / len) };
    const l = linePath(dir, rect, tool === 'ray' ? { from: a } : { from: a, to: b });
    return l ? [{ key: 'line', tag: 'line', ...l }] : [];
  }
  if (tool === 'line') {
    const l = linePathThrough(a, b, rect);
    return l ? [{ key: 'line', tag: 'line', ...l }] : [];
  }
  if (tool === 'perp-bisector') {
    const pb = perpBisector(a, b);
    const seg = pb ? linePath(pb, rect) : null;
    const link: Shape = {
      key: 'link',
      tag: 'line',
      x1: round(a.x),
      y1: round(a.y),
      x2: round(b.x),
      y2: round(b.y),
    };
    return seg ? [{ key: 'line', tag: 'line', ...seg }, link] : [link];
  }
  return [];
}

function linePathThrough(a: Vec, b: Vec, rect: Rect): Seg | null {
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y);
  return l > 0 ? linePath({ kind: 'line', p: a, d: scale(d, 1 / l) }, rect) : null;
}

/** Grid opacity: 1 down to half the fit scale, easing to 0 at a quarter (the zoom-out limit). */
export function gridOpacity(scale: number, fitScale: number): number {
  const t = Math.min(1, Math.max(0, (scale / fitScale - 0.25) / 0.25));
  return t * t * (3 - 2 * t);
}

/** Grid spacing in pixels at the fit scale; the grid is locked to world coordinates. */
const GRID_PX = 28;

/** Dot-grid pattern tile for `vp`: world-locked spacing and origin, fading as it zooms out. */
export function gridPattern(
  vp: Viewport,
  fitScale: number,
): { step: number; x: number; y: number; opacity: number } {
  const step = (GRID_PX / fitScale) * vp.scale;
  const o = toScreen(vp, { x: 0, y: 0 });
  return { step, x: o.x - step / 2, y: o.y - step / 2, opacity: gridOpacity(vp.scale, fitScale) };
}

export const LOUPE_SIZE = 96;
export const LOUPE_ZOOM = 2;
const LOUPE_OFFSET = 72;
const LOUPE_MARGIN = 8;

/** Centre of the touch loupe: 72 px above the finger, flipped below near the top edge. */
export function magnifierPlacement(
  pt: Vec,
  size: { width: number; height: number },
): { x: number; y: number; flipped: boolean } {
  const half = LOUPE_SIZE / 2;
  const flipped = pt.y - LOUPE_OFFSET - half < LOUPE_MARGIN;
  const min = half + LOUPE_MARGIN;
  const x = Math.min(Math.max(pt.x, min), Math.max(min, size.width - min));
  return { x, y: flipped ? pt.y + LOUPE_OFFSET : pt.y - LOUPE_OFFSET, flipped };
}
