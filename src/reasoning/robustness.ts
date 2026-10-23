import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec } from '../construction/types';
import type { Level } from '../levels/types';

const MAX_SHIFT = 0.1;

/** Deterministic RNG in [0, 1) for tests. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random offset of length at most `max`, uniform over the disc. */
function offset(rng: () => number, max: number): { x: number; y: number } {
  const len = max * Math.sqrt(rng());
  const ang = 2 * Math.PI * rng();
  return { x: len * Math.cos(ang), y: len * Math.sin(ang) };
}

/** Overrides for the level's given points and circles; everything else keeps its parameters. */
export function perturbGivens(level: Level, rng: () => number): Map<ObjId, ObjDef> {
  const max = MAX_SHIFT * level.sceneDiameter;
  const out = new Map<ObjId, ObjDef>();
  for (const { id, def } of level.givens) {
    if (def.type === 'given-point') {
      const d = offset(rng, max);
      out.set(id, { type: 'given-point', pos: { x: def.pos.x + d.x, y: def.pos.y + d.y } });
    } else if (def.type === 'given-circle') {
      const d = offset(rng, max);
      const scale = 1 + MAX_SHIFT * (2 * rng() - 1);
      out.set(id, {
        type: 'given-circle',
        c: { x: def.c.x + d.x, y: def.c.y + d.y },
        r: def.r * scale,
      });
    }
  }
  return out;
}

/** True if the goal still holds (with no null objects) on the unperturbed specs and every trial. */
export function isRobust(
  level: Level,
  specs: ObjSpec[],
  rng: () => number = Math.random,
  trials = 5,
): boolean {
  const holds = (overrides?: Map<ObjId, ObjDef>): boolean => {
    try {
      const scene = evaluate(specs, level.sceneDiameter, overrides);
      if (scene.objects.some((o) => o.value === null)) return false;
      return level.goal(scene) !== null;
    } catch {
      return false;
    }
  };
  if (!holds()) return false;
  for (let i = 0; i < trials; i++) {
    if (!holds(perturbGivens(level, rng))) return false;
  }
  return true;
}
