import type { ObjDef, ObjId } from './types';

/** The fields of an object definition that refer to other objects. */
export const REF_KEYS = ['a', 'b', 'center', 'through', 'curve'] as const;

/** Ids a def refers to (own string fields only, so an unchecked def is safe to read). */
export function refIds(def: ObjDef): ObjId[] {
  const d = def as unknown as Record<string, unknown>;
  return REF_KEYS.map((k) => (Object.hasOwn(d, k) ? d[k] : undefined)).filter(
    (v): v is ObjId => typeof v === 'string',
  );
}
