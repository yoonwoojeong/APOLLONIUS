import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';

export type ObjId = string;

export type ObjDef =
  | { type: 'given-point'; pos: Vec }
  | { type: 'given-line'; a: ObjId; b: ObjId; extent: 'line' | 'segment' | 'ray' }
  | { type: 'given-circle'; c: Vec; r: number }
  | { type: 'free-point'; pos: Vec }
  | { type: 'on-curve'; curve: ObjId; t: number }
  | { type: 'intersection'; a: ObjId; b: ObjId; index: 0 | 1 }
  | { type: 'line'; a: ObjId; b: ObjId }
  | { type: 'circle'; center: ObjId; through: ObjId }
  | { type: 'perp-bisector'; a: ObjId; b: ObjId };

export type Value = Vec | Curve | null;

export interface SceneObject {
  id: ObjId;
  def: ObjDef;
  value: Value;
  label?: string;
  given: boolean;
}

export interface Scene {
  objects: SceneObject[];
  byId: Map<ObjId, SceneObject>;
  tol: number;
}

export type ObjSpec = { id: ObjId; def: ObjDef };

export type Command = { type: 'add'; objects: ObjSpec[] } | { type: 'reset' };

export type ApplyResult =
  | { ok: true; ids: ObjId[] }
  | { ok: false; reason: 'degenerate' }
  | { ok: false; reason: 'duplicate'; existingId: ObjId };
