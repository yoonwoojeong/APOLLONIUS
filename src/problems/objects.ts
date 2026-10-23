/** Helpers for reading unchecked, JSON-like data (stored drafts, imported files). */

/** A plain object (not null, not an array). */
export const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Whether `k` is an own property of `o` (never one inherited from Object.prototype). */
export const has = (o: object, k: PropertyKey): boolean => Object.hasOwn(o, k);

/** Own-property read; undefined when the key is absent. */
export const own = (o: Record<string, unknown>, k: string): unknown =>
  has(o, k) ? o[k] : undefined;
