import type { Vec } from '../geometry/vec';

/**
 * Screen space: origin top-left of the canvas, x right, y down. World space
 * has the same orientation (no y flip). `(cx, cy)` is the world point at the
 * screen centre; `scale` is pixels per world unit.
 */
export interface Viewport {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function toScreen(vp: Viewport, w: Vec): Vec {
  return {
    x: vp.width / 2 + (w.x - vp.cx) * vp.scale,
    y: vp.height / 2 + (w.y - vp.cy) * vp.scale,
  };
}

export function toWorld(vp: Viewport, s: Vec): Vec {
  return {
    x: vp.cx + (s.x - vp.width / 2) / vp.scale,
    y: vp.cy + (s.y - vp.height / 2) / vp.scale,
  };
}

/** Zoom by `factor` keeping the world point under `screenPt` fixed; scale clamped to `limits`. */
export function zoomAt(
  vp: Viewport,
  screenPt: Vec,
  factor: number,
  limits: { min: number; max: number },
): Viewport {
  const scale = Math.min(limits.max, Math.max(limits.min, vp.scale * factor));
  const anchor = toWorld(vp, screenPt);
  return {
    ...vp,
    scale,
    cx: anchor.x - (screenPt.x - vp.width / 2) / scale,
    cy: anchor.y - (screenPt.y - vp.height / 2) / scale,
  };
}

/** Move the content with the pointer: dragging right shifts content right (cx decreases). */
export function panBy(vp: Viewport, dScreen: Vec): Viewport {
  return {
    ...vp,
    cx: vp.cx - dScreen.x / vp.scale,
    cy: vp.cy - dScreen.y / vp.scale,
  };
}

/** Viewport that centres `bounds` and fits it inside the screen minus `padding` on every side. */
export function fit(bounds: Rect, width: number, height: number, padding: number): Viewport {
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const sx = bounds.w > 0 ? availW / bounds.w : Infinity;
  const sy = bounds.h > 0 ? availH / bounds.h : Infinity;
  let scale = Math.min(sx, sy);
  if (!Number.isFinite(scale)) scale = 1;
  return {
    cx: bounds.x + bounds.w / 2,
    cy: bounds.y + bounds.h / 2,
    scale,
    width,
    height,
  };
}

export function visibleWorldRect(vp: Viewport): Rect {
  const w = vp.width / vp.scale;
  const h = vp.height / vp.scale;
  return { x: vp.cx - w / 2, y: vp.cy - h / 2, w, h };
}
