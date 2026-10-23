import type { Vec } from '../geometry/vec';

/** Frames points with a 35% margin on every side, widened to a 4:3 aspect ratio. */
export function frame(points: Vec[]): {
  view: { x: number; y: number; w: number; h: number };
  sceneDiameter: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.35 * Math.max(maxX - minX, maxY - minY);
  let w = maxX - minX + 2 * pad;
  let h = maxY - minY + 2 * pad;
  if (w / h < 4 / 3) w = (4 / 3) * h;
  else h = (3 / 4) * w;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { view: { x: cx - w / 2, y: cy - h / 2, w, h }, sceneDiameter: Math.hypot(w, h) };
}
