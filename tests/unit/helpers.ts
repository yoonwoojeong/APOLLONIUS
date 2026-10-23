import { expect } from 'vitest';
import { Construction } from '../../src/construction/construction';
import type { Level } from '../../src/levels/types';

/** Builds a Construction from the level and applies each reference step as one add command. */
export function playReference(level: Level): Construction {
  const c = new Construction(level.givens, level.labels, level.sceneDiameter);
  for (const step of level.reference) {
    const r = c.apply({ type: 'add', objects: step.objects });
    expect(r.ok).toBe(true);
  }
  return c;
}
