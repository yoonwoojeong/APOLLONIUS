export type Stars = [boolean, boolean, boolean];

/** `[reached, lines within target, elements within target]`. */
export function scoreStars(m: { L: number; E: number }, t: { L: number; E: number }): Stars {
  return [true, m.L <= t.L, m.E <= t.E];
}

/** Element-wise best-ever. */
export function mergeStars(a: Stars, b: Stars): Stars {
  return [a[0] || b[0], a[1] || b[1], a[2] || b[2]];
}
