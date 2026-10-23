import type { Scene, SceneObject } from './types';

export function describe(obj: SceneObject, scene: Scene): string {
  const name = (id: string): string => {
    const o = scene.byId.get(id);
    return o?.label ?? id;
  };
  const d = obj.def;
  switch (d.type) {
    case 'circle':
      return `Circle centered at ${name(d.center)} through ${name(d.through)}`;
    case 'line':
    case 'given-line':
      return `Line through ${name(d.a)} and ${name(d.b)}`;
    case 'perp-bisector':
      return `Perpendicular bisector of ${name(d.a)} and ${name(d.b)}`;
    case 'given-circle':
      return 'Circle';
    default:
      return `Point ${obj.label ?? obj.id}`;
  }
}
