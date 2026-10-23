import { expect } from 'vitest';
import { Construction } from '../../src/construction/construction';
import { levelById } from '../../src/levels';
import type { Level } from '../../src/levels/types';
import type { Store } from '../../src/state/store';

/** Builds a Construction from the level and applies each reference step as one add command. */
export function playReference(level: Level): Construction {
  const c = new Construction(level.givens, level.labels, level.sceneDiameter);
  for (const step of level.reference) {
    const r = c.apply({ type: 'add', objects: step.objects });
    expect(r.ok).toBe(true);
  }
  return c;
}

/** Applies each reference step of the store's current level through the store. */
export function playReferenceInto(store: Store): void {
  for (const step of levelById(store.levelId.value).reference) {
    const r = store.apply({ type: 'add', objects: step.objects });
    expect(r.ok).toBe(true);
  }
}
