import { useEffect, useRef, useState } from 'preact/hooks';
import type { Construction } from '../construction/construction';
import { describe } from '../construction/describe';
import type { ObjId, Scene } from '../construction/types';
import { SETTLE_MS, type Animating } from './SceneLayer';
import { reducedMotion } from './useViewport';

export interface SceneAnimation {
  animating: Animating | null;
  /** Live-region text: `describe()` of the objects the last change added. */
  announce: string;
  /** A retained (removed) object finished its reverse draw-on. */
  retainedEnd: (id: ObjId) => void;
  /** An added object finished drawing on: it must not replay when pan/zoom remounts it. */
  drawnIn: (id: ObjId) => void;
}

/**
 * Animation bookkeeping for construction changes. The scene object is replaced only by a
 * successful apply/undo/redo/reset, so a new `scene` from the same construction means
 * `lastChange()` is fresh: added objects draw on, removed ones reverse-draw from a retained
 * copy of the previous scene (skipped under reduced motion). A new construction (level
 * opened or replayed) starts clean.
 */
export function useSceneAnimation(construction: Construction, scene: Scene): SceneAnimation {
  const [animating, setAnimating] = useState<Animating | null>(null);
  const [announce, setAnnounce] = useState('');
  const prev = useRef<{ construction: Construction; scene: Scene } | null>(null);
  const key = useRef(0);
  const settle = useRef(0);

  useEffect(() => {
    const before = prev.current;
    prev.current = { construction, scene };
    if (!before || before.scene === scene) return;
    if (before.construction !== construction) {
      setAnimating(null);
      return;
    }
    const { added, removed } = construction.lastChange();
    const drawOut =
      removed.length && !reducedMotion() ? { scene: before.scene, ids: removed } : null;
    setAnimating({ key: ++key.current, drawIn: added, drawOut });
    // Fallback for objects whose animationend never fires (e.g. drawn while off-screen).
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setAnimating(null), SETTLE_MS);
    const text = added
      .flatMap((id) => scene.byId.get(id) ?? [])
      .map((o) => describe(o, scene))
      .join('. ');
    if (text) setAnnounce(text);
  }, [construction, scene]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const retainedEnd = (id: ObjId): void =>
    setAnimating((a) =>
      a?.drawOut
        ? { ...a, drawOut: { ...a.drawOut, ids: a.drawOut.ids.filter((x) => x !== id) } }
        : a,
    );

  const drawnIn = (id: ObjId): void =>
    setAnimating((a) =>
      a?.drawIn.includes(id) ? { ...a, drawIn: a.drawIn.filter((x) => x !== id) } : a,
    );

  return { animating, announce, retainedEnd, drawnIn };
}
