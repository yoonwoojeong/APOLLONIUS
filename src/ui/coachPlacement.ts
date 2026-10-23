import { isCurveValue } from '../canvas/candidates';
import { curveShapes, curveToScreen, objectShapes, type Shape } from '../canvas/shapes';
import { toScreen, type Viewport } from '../canvas/viewport';
import type { Scene } from '../construction/types';
import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';

/** Placement grid cell, in CSS pixels. */
const CELL = 8;
/** Distance kept between the caption and the edges of the canvas. */
const EDGE = 12;
/** Clearance around each target: the caption never comes closer than this. */
const TARGET_CLEAR = 30;
/** Clearance around avoided strokes and points. */
const AVOID_CLEAR = 8;
/** Pixels of extra distance worth avoiding one covered cell of a stroke. */
const COVER_COST = 40;
const BLOCKED = 1e6;
const SAMPLE_PX = 6;

export interface Box {
  w: number;
  h: number;
}

/**
 * Top-left corner for a caption of size `box` inside `area`: as close as possible to the
 * targets without covering them (or coming within 30 px), and covering as little of `avoid`
 * (sampled strokes and points, screen space) as it can.
 */
export function placeCaption(o: { area: Box; box: Box; targets: Vec[]; avoid: Vec[] }): Vec {
  const { area, box, targets } = o;
  const cols = Math.max(1, Math.ceil(area.w / CELL));
  const rows = Math.max(1, Math.ceil(area.h / CELL));
  const cost = new Float64Array(cols * rows);
  const stamp = (p: Vec, r: number, w: number): void => {
    const c0 = Math.max(0, Math.floor((p.x - r) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((p.x + r) / CELL));
    const r0 = Math.max(0, Math.floor((p.y - r) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((p.y + r) / CELL));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const dx = Math.max(x * CELL - p.x, 0, p.x - (x + 1) * CELL);
        const dy = Math.max(y * CELL - p.y, 0, p.y - (y + 1) * CELL);
        if (dx * dx + dy * dy < r * r) cost[y * cols + x] = Math.max(cost[y * cols + x]!, w);
      }
    }
  };
  for (const p of o.avoid) stamp(p, AVOID_CLEAR, 1);
  for (const p of targets) stamp(p, TARGET_CLEAR, BLOCKED);

  // Summed-area table: the cost of any cell rectangle in O(1).
  const sat = new Float64Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let line = 0;
    for (let x = 0; x < cols; x++) {
      line += cost[y * cols + x]!;
      sat[(y + 1) * (cols + 1) + x + 1] = sat[y * (cols + 1) + x + 1]! + line;
    }
  }
  const covered = (x: number, y: number): number => {
    const c0 = Math.max(0, Math.floor(x / CELL));
    const r0 = Math.max(0, Math.floor(y / CELL));
    const c1 = Math.min(cols, Math.ceil((x + box.w) / CELL));
    const r1 = Math.min(rows, Math.ceil((y + box.h) / CELL));
    const at = (c: number, r: number) => sat[r * (cols + 1) + c]!;
    return at(c1, r1) - at(c0, r1) - at(c1, r0) + at(c0, r0);
  };

  const n = Math.max(targets.length, 1);
  const centre = targets.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), {
    x: 0,
    y: 0,
  });
  const maxX = Math.max(EDGE, area.w - box.w - EDGE);
  const maxY = Math.max(EDGE, area.h - box.h - EDGE);
  let best = { x: Math.min(EDGE, maxX), y: Math.min(EDGE, maxY) };
  let bestScore = Infinity;
  for (let y = EDGE; y <= maxY; y += CELL / 2) {
    for (let x = EDGE; x <= maxX; x += CELL / 2) {
      const dx = Math.max(x - centre.x, 0, centre.x - (x + box.w));
      const dy = Math.max(y - centre.y, 0, centre.y - (y + box.h));
      // Reading order: a caption above or level with its targets beats one below.
      const below = y > centre.y ? 0.25 * (y - centre.y) : 0;
      const score = covered(x, y) * COVER_COST + Math.hypot(dx, dy) + below;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  // An area smaller than the caption keeps it pinned to the top-left edge.
  return { x: Math.min(best.x, Math.max(0, area.w - box.w)), y: best.y };
}

function sampleShapes(shapes: Shape[], out: Vec[]): void {
  for (const s of shapes) {
    if (s.tag !== 'line') continue;
    const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const k = Math.max(1, Math.ceil(l / SAMPLE_PX));
    for (let i = 0; i <= k; i++) {
      out.push({ x: s.x1 + ((s.x2 - s.x1) * i) / k, y: s.y1 + ((s.y2 - s.y1) * i) / k });
    }
  }
}

function sampleCircle(c: Vec, r: number, vp: Viewport, out: Vec[]): void {
  const k = Math.min(2000, Math.max(12, Math.ceil((2 * Math.PI * r) / SAMPLE_PX)));
  for (let i = 0; i < k; i++) {
    const p = {
      x: c.x + r * Math.cos((2 * Math.PI * i) / k),
      y: c.y + r * Math.sin((2 * Math.PI * i) / k),
    };
    if (p.x >= 0 && p.y >= 0 && p.x <= vp.width && p.y <= vp.height) out.push(p);
  }
}

/** Circles sampled directly (their shape is an arc path); lines along their clipped shapes. */
function sampleCurve(v: Curve, vp: Viewport, out: Vec[], shapes: Shape[]): void {
  const c = curveToScreen(v, vp);
  if (c.kind === 'circle') sampleCircle(c.c, c.r, vp, out);
  else sampleShapes(shapes, out);
}

/** How far past its targets a line still matters: the stretch the player traces or reads. */
const TRACE_PX = 56;

/**
 * Screen-space samples of everything a caption should not cover: the points and curves on
 * the canvas now, and `upcoming` (world space), what the player is about to draw. Circles
 * and points count in full; lines only near `targets` (screen space), since only that
 * stretch matters and the rest of an infinite line would push the caption to a far corner.
 */
export function avoidSamples(
  scene: Scene,
  upcoming: (Vec | Curve)[],
  vp: Viewport,
  targets: Vec[] = [],
): Vec[] {
  const xs = targets.map((p) => p.x);
  const ys = targets.map((p) => p.y);
  const near = (p: Vec): boolean =>
    targets.length === 0 ||
    (p.x >= Math.min(...xs) - TRACE_PX &&
      p.x <= Math.max(...xs) + TRACE_PX &&
      p.y >= Math.min(...ys) - TRACE_PX &&
      p.y <= Math.max(...ys) + TRACE_PX);
  const out: Vec[] = [];
  const add = (v: Vec | Curve, shapes: (c: Curve) => Shape[]): void => {
    if (!isCurveValue(v)) out.push(toScreen(vp, v));
    else if (v.kind === 'circle') sampleCurve(v, vp, out, []);
    else {
      const line: Vec[] = [];
      sampleCurve(v, vp, line, shapes(v));
      out.push(...line.filter(near));
    }
  };
  for (const o of scene.objects) if (o.value) add(o.value, () => objectShapes(o, scene, vp));
  for (const v of upcoming) add(v, (c) => curveShapes(c, vp));
  return out;
}
