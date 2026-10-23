import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { evaluate } from '../construction/evaluate';
import type { ObjId, ObjSpec, Scene } from '../construction/types';
import { dist, sub, type Vec } from '../geometry/vec';
import { frame } from '../levels/view';
import { givenPoints } from '../problems/format';
import { Magnifier } from '../canvas/Magnifier';
import { SceneLayer, type GhostView } from '../canvas/SceneLayer';
import { gridPattern } from '../canvas/shapes';
import { findSnap, SNAP_RADIUS, type InputKind } from '../canvas/snap';
import { TAP_SLOP_PX } from '../canvas/gestures';
import { useViewport } from '../canvas/useViewport';
import { toScreen, toWorld, type Rect } from '../canvas/viewport';
import type { Editor } from './editorStore';
import {
  setupReducer,
  type SetupEvent,
  type SetupGestureState,
  type SetupPreview,
  type SetupTarget,
  type SetupTool,
} from './setupGestures';
import '../canvas/canvas.css';
import './editor.css';

/** Shown until two framing points exist: a 8 x 6 world box centred on the origin. */
const FALLBACK_BOUNDS: Rect = { x: -4, y: -3, w: 8, h: 6 };
const FALLBACK_DIAMETER = 10;
let instances = 0;
const IDLE: SetupGestureState = { mode: 'idle' };

type Mode = 'none' | 'gesture' | 'pinch' | 'consumed';

const inputKind = (e: PointerEvent): InputKind =>
  e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';

/** Scene of the setup givens (labels attached) and the frame the viewport fits. */
function setupScene(
  givens: ObjSpec[],
  labels: Record<string, string>,
): { scene: Scene; bounds: Rect } {
  const pts = ((): Vec[] => {
    try {
      return givenPoints(givens).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    } catch {
      return [];
    }
  })();
  const f = pts.length >= 2 ? frame(pts) : null;
  const ok = f && f.sceneDiameter > 0 && Number.isFinite(f.sceneDiameter);
  const scene = evaluate(givens, ok ? f.sceneDiameter : FALLBACK_DIAMETER);
  for (const o of scene.objects) if (labels[o.id]) o.label = labels[o.id];
  return { scene, bounds: ok ? f.view : FALLBACK_BOUNDS };
}

interface Props {
  editor: Editor;
  tool: SetupTool;
  /** Circles are placed without a visible centre point (a given-circle). */
  hideCentre: boolean;
  /**
   * Pick mode (Delete): a tap reports the given under it (or null) instead of editing, and
   * drags do nothing. Absent: the tool edits as usual.
   */
  onPick?: ((id: ObjId | null) => void) | null;
  /** Shown highlighted (the picked given and what depends on it). */
  selected?: ObjId[];
  /** Each change refits the view to the givens (a Fit control). */
  fitKey?: number;
}

/** The Setup canvas: place and drag givens with the game's pointer flow, through the editor. */
export function SetupCanvas({ editor, tool, hideCentre, onPick, selected, fitKey }: Props) {
  const model = editor.setup.value;
  const { scene, bounds } = useMemo(
    () => setupScene(model.givens, model.labels),
    [model.givens, model.labels],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  // The viewport fits the bounds of the last fit (mount or double-click refit), so editing
  // never changes the fit scale (grid step, zoom limits) between fits.
  const [fitted, setFitted] = useState({ bounds, key: 0 });
  const view = useViewport(fitted.bounds, fitted.key, svgRef);
  const { vp, vpRef, size } = view;
  // A resize before the player pans refits to the givens as they are now, not at the last fit.
  const sized = useRef(size);
  useEffect(() => {
    const was = sized.current;
    sized.current = size;
    if (!was || !size || (was.width === size.width && was.height === size.height)) return;
    if (!view.movedRef.current) setFitted((f) => ({ bounds, key: f.key + 1 }));
  }, [size?.width, size?.height]);
  const [ids] = useState(() => {
    const n = ++instances;
    return { grid: `setup-grid-${n}`, root: `setup-scene-${n}` };
  });

  const [preview, setPreview] = useState<SetupPreview>(null);
  const [snap, setSnap] = useState<SetupTarget | null>(null);
  const [loupe, setLoupe] = useState<Vec | null>(null);

  const gesture = useRef<SetupGestureState>(IDLE);
  const mode = useRef<Mode>('none');
  const pointers = useRef(new Map<number, Vec>());
  const primary = useRef<{ id: number; kind: InputKind; start: Vec; dragged: boolean } | null>(
    null,
  );
  const pinch = useRef<{ mid: Vec; d: number } | null>(null);
  const live = useRef({ scene, tool, hideCentre, editor, dispatch, onPick });
  live.current = { scene, tool, hideCentre, editor, dispatch, onPick };
  const picking = !!onPick;

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The hidden-circle handle under a screen point, if any. */
  const handleAt = (pt: Vec, kind: InputKind): SetupTarget | null => {
    const v = vpRef.current;
    if (!v) return null;
    let best: { h: SetupTarget; d: number } | null = null;
    for (const o of live.current.scene.objects) {
      if (o.def.type !== 'given-circle' || !o.value || !('r' in o.value)) continue;
      const c = o.value;
      for (const [which, pos] of [
        ['centre', c.c],
        ['rim', { x: c.c.x + c.r, y: c.c.y }],
      ] as const) {
        const d = dist(toScreen(v, pos), pt);
        if (d <= SNAP_RADIUS[kind] && (!best || d < best.d))
          best = { h: { kind: 'handle', id: o.id, which, pos }, d };
      }
    }
    return best?.h ?? null;
  };

  /** Hidden-circle handles first (point tool only), then points, then empty space. */
  const targetAt = (pt: Vec, kind: InputKind): SetupTarget | null => {
    const v = vpRef.current;
    if (!v) return null;
    const handle = live.current.tool === 'point' ? handleAt(pt, kind) : null;
    return handle ?? findSnap(live.current.scene, [], pt, v, kind, ['point', 'empty']);
  };

  /** Pick mode: the given under a screen point — a handle's circle, a point, then a curve. */
  const pickAt = (pt: Vec, kind: InputKind): ObjId | null => {
    const v = vpRef.current;
    if (!v) return null;
    const h = handleAt(pt, kind);
    if (h?.kind === 'handle') return h.id;
    const t = findSnap(live.current.scene, [], pt, v, kind, ['point', 'curve']);
    return t && (t.kind === 'point' || t.kind === 'curve') ? t.id : null;
  };

  function dispatch(ev: SetupEvent): void {
    const before = gesture.current;
    const { tool: t, hideCentre: hide, editor } = live.current;
    if (ev.type === 'down' && before.mode === 'idle') editor.beginSetupGesture();
    const r = setupReducer(before, ev, {
      tool: t,
      hideCentre: hide,
      model: editor.setup.peek(),
      allocId: editor.allocId,
      nextLabel: editor.nextLabel,
    });
    gesture.current = r.state;
    for (const edit of r.edits) editor.applySetup(edit);
    if (before.mode !== 'idle' && r.state.mode === 'idle') {
      if (ev.type === 'cancel' || ev.type === 'tool') editor.cancelSetupGesture();
      else editor.endSetupGesture();
    }
    setPreview(r.preview);
  }

  // Switching tool mid-gesture abandons it.
  useEffect(() => {
    if (gesture.current.mode !== 'idle') live.current.dispatch({ type: 'tool', tool });
    setSnap(null);
  }, [tool]);

  // Entering pick mode abandons an edit in progress.
  useEffect(() => {
    if (picking && gesture.current.mode !== 'idle') live.current.dispatch({ type: 'cancel' });
    setSnap(null);
  }, [picking]);

  // The Fit control refits the view to the givens as they are now.
  const firstFit = useRef(fitKey);
  useEffect(() => {
    if (fitKey === firstFit.current) return;
    firstFit.current = fitKey;
    setFitted((f) => ({ bounds, key: f.key + 1 }));
  }, [fitKey]);

  // A gesture left open on unmount must not keep the editor's snapshot.
  useEffect(
    () => () => {
      if (gesture.current.mode !== 'idle') live.current.editor.cancelSetupGesture();
    },
    [],
  );

  // Esc abandons the gesture in progress.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current.mode !== 'idle')
        live.current.dispatch({ type: 'cancel' });
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const pinchFrame = (): { mid: Vec; d: number } | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: dist(a, b) };
  };

  const release = (): void => {
    if (pointers.current.size === 0) {
      mode.current = 'none';
      primary.current = null;
      pinch.current = null;
      setLoupe(null);
    } else if (mode.current === 'pinch') {
      mode.current = 'consumed';
      pinch.current = null;
    }
  };

  const event = (type: 'down' | 'move' | 'up', pt: Vec, kind: InputKind): SetupEvent => ({
    type,
    target: targetAt(pt, kind),
    screen: pt,
    world: toWorld(vpRef.current!, pt),
  });

  const onPointerDown = (e: PointerEvent): void => {
    if (!vpRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const pt = local(e);
    const kind = inputKind(e);
    pointers.current.set(e.pointerId, pt);
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (pointers.current.size === 1) {
      primary.current = { id: e.pointerId, kind, start: pt, dragged: false };
      mode.current = 'gesture';
      setSnap(null);
      if (!live.current.onPick) dispatch(event('down', pt, kind));
    } else if (pointers.current.size === 2) {
      // A second finger is never part of an edit: abandon it and pinch/pan instead.
      if (mode.current === 'gesture' && !live.current.onPick) dispatch({ type: 'cancel' });
      mode.current = 'pinch';
      pinch.current = pinchFrame();
      setLoupe(null);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!vpRef.current) return;
    const pt = local(e);
    const kind = inputKind(e);
    const last = pointers.current.get(e.pointerId);
    if (!last) {
      if (kind !== 'touch' && mode.current === 'none')
        setSnap(live.current.onPick ? null : targetAt(pt, kind));
      return;
    }
    pointers.current.set(e.pointerId, pt);
    if (mode.current === 'pinch') {
      const now = pinchFrame();
      const was = pinch.current;
      if (!now || !was) return;
      view.move(sub(now.mid, was.mid), now.mid, was.d > 0 ? now.d / was.d : 1);
      pinch.current = now;
    } else if (mode.current === 'gesture' && e.pointerId === primary.current?.id) {
      const p = primary.current;
      if (dist(pt, p.start) > TAP_SLOP_PX) p.dragged = true;
      if (live.current.onPick) return;
      dispatch(event('move', pt, kind));
      setLoupe(kind === 'touch' && p.dragged && gesture.current.mode !== 'idle' ? pt : null);
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = local(e);
    pointers.current.delete(e.pointerId);
    const p = primary.current;
    if (mode.current === 'gesture' && e.pointerId === p?.id) {
      const pick = live.current.onPick;
      if (!pick) dispatch(event('up', pt, inputKind(e)));
      else if (!p.dragged) pick(pickAt(pt, inputKind(e)));
    }
    release();
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (mode.current === 'gesture' && e.pointerId === primary.current?.id && !live.current.onPick)
      dispatch({ type: 'cancel' });
    release();
  };

  const ghost: GhostView | null = preview
    ? { tool: preview.kind, from: preview.from, to: preview.to }
    : null;
  const grid = vp ? gridPattern(vp, view.fitScale) : null;
  const shownSnap = gesture.current.mode === 'idle' ? snap : null;

  return (
    <div class="canvas-host setup-host" ref={view.hostRef}>
      <svg
        ref={svgRef}
        data-testid="setup-canvas"
        class={picking ? 'canvas setup-canvas is-picking' : 'canvas setup-canvas'}
        role="application"
        aria-label="Setup canvas"
        tabindex={-1}
        onKeyDown={(e) => {
          // Pick mode: Enter or Space on a focused point picks it.
          const pick = live.current.onPick;
          if (!pick || (e.key !== 'Enter' && e.key !== ' ')) return;
          const id = (e.target as Element)
            .closest?.('[data-kind="point"]')
            ?.getAttribute('data-id');
          if (!id) return;
          e.preventDefault();
          pick(id);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={() => setSnap(null)}
        onDblClick={() => {
          if (live.current.tool === 'point' || live.current.onPick) return;
          setFitted((f) => ({ bounds, key: f.key + 1 }));
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {grid && (
          <>
            <defs>
              <pattern
                id={ids.grid}
                patternUnits="userSpaceOnUse"
                width={grid.step}
                height={grid.step}
                x={grid.x}
                y={grid.y}
              >
                <circle class="grid-dot" cx={grid.step / 2} cy={grid.step / 2} r={1.1} />
              </pattern>
            </defs>
            <rect
              class="grid"
              width="100%"
              height="100%"
              fill={`url(#${ids.grid})`}
              style={{ opacity: grid.opacity }}
            />
          </>
        )}
        <g id={ids.root}>
          {vp && (
            <>
              <SceneLayer
                scene={scene}
                view={vp}
                candidates={[]}
                hintIds={selected}
                ghost={ghost}
                snap={shownSnap && shownSnap.kind !== 'handle' ? shownSnap : null}
              />
              <g class="setup-handles">
                {scene.objects.map((o) => {
                  const c = o.def.type === 'given-circle' ? o.value : null;
                  if (!c || !('r' in c)) return null;
                  return (
                    <g key={o.id} data-circle={o.id}>
                      {(['centre', 'rim'] as const).map((which) => {
                        const p = toScreen(
                          vp,
                          which === 'centre' ? c.c : { x: c.c.x + c.r, y: c.c.y },
                        );
                        return (
                          <g
                            key={which}
                            data-handle={which}
                            data-id={o.id}
                            transform={`translate(${p.x} ${p.y})`}
                          >
                            <circle class="handle-ring" r={9} />
                            <circle class="handle-dot" r={3.5} />
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </g>
            </>
          )}
        </g>
      </svg>
      {size && <Magnifier point={loupe} size={size} sceneId={ids.root} />}
    </div>
  );
}
