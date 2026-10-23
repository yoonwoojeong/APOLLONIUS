export type Vec = { x: number; y: number };

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (v: Vec): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Unit vector, or null when the length is zero or not finite. */
export function normalize(v: Vec): Vec | null {
  const l = len(v);
  if (!(l > 0) || !Number.isFinite(l)) return null;
  return { x: v.x / l, y: v.y / l };
}

/** Rotate +90 degrees. */
export const perp = (v: Vec): Vec => ({ x: -v.y, y: v.x });
