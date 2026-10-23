import { useEffect, useRef, useState } from 'preact/hooks';
import type { Change, Construction } from '../construction/construction';
import { describe } from '../construction/describe';
import type { ObjId, Scene } from '../construction/types';
import { SETTLE_MS, type Animating } from './SceneLayer';
import { reducedMotion } from './useViewport';

const describeAll = (ids: ObjId[], scene: Scene): string =>
  ids
    .flatMap((id) => scene.byId.get(id) ?? [])
    .map((o) => describe(o, scene))
    .join('. ');

/** "Circle centered at A through B", "Undid: …", "Redid: …"; a reset only removes. */
function announcement(
  kind: Change['kind'],
  added: ObjId[],
  removed: ObjId[],
  scene: Scene,
  previous: Scene,
): string {
  // Undo names what it took away (as it was); undoing a reset only brings objects back.
  if (kind === 'undo') {
    if (removed.length) return `Undid: ${describeAll(removed, previous)}`;
    return added.length ? 'Undid: Construction reset' : '';
  }
  const body = added.length ? describeAll(added, scene) : removed.length ? 'Construction reset' : '';
  return body && kind === 'redo' ? `Redid: ${body}` : body;
}

export interface SceneAnimation {
  animating: Animating | null;
  /**
   * Live-region text: `describe()` of the objects the last change added ("Undid: …" /
   * "Redid: …" for history steps). A repeat of the same text gains a trailing no-break space
   * so the region still changes and is read again.
   */
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
    const { added, removed, kind } = construction.lastChange();
    const drawOut =
      removed.length && !reducedMotion() ? { scene: before.scene, ids: removed } : null;
    setAnimating({ key: ++key.current, drawIn: added, drawOut });
    // Fallback for objects whose animationend never fires (e.g. drawn while off-screen).
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setAnimating(null), SETTLE_MS);
    const text = announcement(kind, added, removed, scene, before.scene);
    if (text) setAnnounce((was) => (was === text ? `${text}\u00a0` : text));
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
