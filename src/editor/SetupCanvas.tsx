import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isPointValue } from '../canvas/candidates';
import { describe } from '../construction/describe';
import { evaluate } from '../construction/evaluate';
import type { ObjId, ObjSpec, Scene } from '../construction/types';
import { dist, sub, type Vec } from '../geometry/vec';
import { Magnifier } from '../canvas/Magnifier';
import { SceneLayer, type GhostView } from '../canvas/SceneLayer';
import { gridPattern } from '../canvas/shapes';
import { findSnap, SNAP_RADIUS, type InputKind } from '../canvas/snap';
import { TAP_SLOP_PX } from '../canvas/gestures';
import { useViewport } from '../canvas/useViewport';
import { toScreen, toWorld, type Rect, type Viewport } from '../canvas/viewport';
import { isControl, isTextEntry, stopTarget } from '../canvas/Canvas';
import { frameOf, type Editor } from './editorStore';
import {
  givenName,
  setupReducer,
  type SetupEvent,
  type SetupGestureState,
  type SetupPreview,
  type SetupTarget,
  type SetupTool,
} from './setupGestures';
import '../canvas/canvas.css';
import './editor.css';

let instances = 0;
const IDLE: SetupGestureState = { mode: 'idle' };

type Mode = 'none' | 'gesture' | 'pan' | 'pinch' | 'consumed';

/** Arrow-key nudge of a focused point, in screen px at the current zoom (Shift: ten times). */
const NUDGE_PX = 4;
const NUDGE_SHIFT = 10;
const ARROWS: Record<string, Vec> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
/** A point added from the keyboard keeps this far (screen px) from every other point. */
const ADD_GAP_PX = 40;

/** Where a keyboard-added point goes: the view centre, else the nearest free spot around it. */
function freeSpot(v: Viewport, scene: Scene): Vec {
  const taken = scene.objects.flatMap((o) => (isPointValue(o.value) ? [toScreen(v, o.value)] : []));
  const c = { x: v.width / 2, y: v.height / 2 };
  for (let ring = 0; ring <= 6; ring++) {
    for (let k = 0; k < (ring ? 8 * ring : 1); k++) {
      const a = (2 * Math.PI * k) / (8 * ring || 1);
      const p = {
        x: c.x + ring * ADD_GAP_PX * Math.cos(a),
        y: c.y + ring * ADD_GAP_PX * Math.sin(a),
      };
      if (taken.every((q) => dist(q, p) >= ADD_GAP_PX)) return toWorld(v, p);
    }
  }
  return toWorld(v, c);
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

const inputKind = (e: PointerEvent): InputKind =>
  e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';

/** Scene of the setup givens (labels attached) and the frame the viewport fits. */
function setupScene(
  givens: ObjSpec[],
  labels: Record<string, string>,
): { scene: Scene; bounds: Rect } {
  // The editor's framing of the givens alone (its fallback until two framing points exist).
  const f = frameOf(givens, []);
  const scene = evaluate(givens, f.sceneDiameter);
  for (const o of scene.objects) if (labels[o.id]) o.label = labels[o.id];
  return { scene, bounds: f.view };
}

/** Where a given line or circle takes keyboard focus: a line's midpoint, a circle's centre. */
function curveAnchor(o: Scene['objects'][number], scene: Scene): Vec | null {
  if (!o.value) return null;
  if (o.def.type === 'given-line') {
    const a = scene.byId.get(o.def.a)?.value ?? null;
    const b = scene.byId.get(o.def.b)?.value ?? null;
    return isPointValue(a) && isPointValue(b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }
  if (o.def.type === 'circle' || o.def.type === 'given-circle') {
    return 'c' in o.value ? o.value.c : null;
  }
  return null;
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
  /**
   * Point tool: a tap (no drag) reports the point it started on, or null for empty space
   * (which still places a point as usual).
   */
  onTap?: (id: ObjId | null) => void;
  /** Point tool: Enter or F2 on a focused point. */
  onPointKey?: (id: ObjId, key: 'Enter' | 'F2') => void;
  /** Content pinned to a point on screen (the label editor); follows pans and zooms. */
  overlay?: { id: ObjId; content: ComponentChildren } | null;
  /** What a keyboard action did, for the screen's status region. */
  onAnnounce?: (text: string) => void;
}

/**
 * The Setup canvas: place and drag givens with the game's pointer flow, through the editor.
 * Keyboard: N (or Enter on the canvas with the Point tool) adds a point at the view centre;
 * arrows nudge the focused point (one undo step per press); with a two-point tool, Enter on a
 * point starts and Enter on another finishes, as in the game; Space+drag pans; Esc cancels.
 */
export function SetupCanvas(props: Props) {
  const { editor, tool, hideCentre, onPick, selected, fitKey, overlay } = props;
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
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** Two-point tools from the keyboard: the point Enter started on. */
  const [armedId, setArmedId] = useState<ObjId | null>(null);
  const armed = useRef<ObjId | null>(null);
  const arm = (id: ObjId | null): void => {
    armed.current = id;
    setArmedId(id);
  };

  const gesture = useRef<SetupGestureState>(IDLE);
  const mode = useRef<Mode>('none');
  const pointers = useRef(new Map<number, Vec>());
  const primary = useRef<{
    id: number;
    kind: InputKind;
    start: Vec;
    dragged: boolean;
    /** The point the press started on, if any. */
    from: ObjId | null;
  } | null>(null);
  const pinch = useRef<{ mid: Vec; d: number } | null>(null);
  const space = useRef(false);
  const overCanvas = useRef(false);
  /** A point added from the keyboard: focus moves onto it after the render. */
  const focusId = useRef<ObjId | null>(null);
  /** The latest `addPoint`, for the window key handler. */
  const addRef = useRef<() => void>(() => {});
  const live = useRef({ scene, tool, hideCentre, editor, dispatch, onPick, props });
  live.current = { scene, tool, hideCentre, editor, dispatch, onPick, props };
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
    if (armed.current) {
      arm(null);
      setPreview(null);
    }
  }, [tool]);

  // Entering pick mode abandons an edit in progress.
  useEffect(() => {
    if (picking && gesture.current.mode !== 'idle') live.current.dispatch({ type: 'cancel' });
    setSnap(null);
    if (picking && armed.current) {
      arm(null);
      setPreview(null);
    }
  }, [picking]);

  // After a keyboard add, focus the new point (so arrows can nudge it at once).
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = null;
    svgRef.current
      ?.querySelector<SVGElement>(`[data-kind=point][data-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  });

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

  // Esc abandons the gesture in progress (or the keyboard start point); N adds a point;
  // Space+drag pans, as in the game.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.key === 'Escape') {
        if (gesture.current.mode !== 'idle') live.current.dispatch({ type: 'cancel' });
        if (armed.current) {
          arm(null);
          setPreview(null);
        }
      } else if (e.key === ' ') {
        // On a focused control Space is the pan modifier only while the pointer is over the
        // canvas (or already panning); otherwise it keeps activating the control.
        // In pick mode Space on a focused point, line or circle picks it instead.
        const onStop =
          e.target instanceof Element && !!e.target.closest('[data-pick-id], [data-kind=point]');
        if (live.current.onPick && onStop) return;
        if (isControl(e.target) && !overCanvas.current && !space.current) return;
        e.preventDefault();
        space.current = true;
        setSpaceHeld(true);
      } else if (
        e.key.toLowerCase() === 'n' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat &&
        !live.current.onPick
      ) {
        e.preventDefault();
        addRef.current();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !space.current) return;
      e.preventDefault(); // a button activates on Space keyup: not while it was the pan key
      space.current = false;
      setSpaceHeld(false);
    };
    // Leaving the window with Space held never delivers its keyup: drop the pan modifier and
    // stop a pan in progress (the remaining pointers are ignored until they lift).
    const blur = () => {
      space.current = false;
      setSpaceHeld(false);
      if (mode.current === 'pan') {
        mode.current = 'consumed';
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
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
      setPanning(false);
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
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    const pt = local(e);
    const kind = inputKind(e);
    pointers.current.set(e.pointerId, pt);
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // Pointer input drops a start point picked from the keyboard.
    if (armed.current) {
      arm(null);
      setPreview(null);
    }
    if (pointers.current.size === 1) {
      if (space.current || e.button === 1) {
        primary.current = { id: e.pointerId, kind, start: pt, dragged: false, from: null };
        mode.current = 'pan';
        setPanning(true);
        setSnap(null);
        return;
      }
      const at = targetAt(pt, kind);
      primary.current = {
        id: e.pointerId,
        kind,
        start: pt,
        dragged: false,
        from: at?.kind === 'point' ? at.id : null,
      };
      mode.current = 'gesture';
      setSnap(null);
      if (!live.current.onPick) dispatch(event('down', pt, kind));
    } else if (pointers.current.size === 2 && mode.current !== 'pan') {
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
    } else if (mode.current === 'pan') {
      view.move(sub(pt, last), pt, 1);
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
      if (pick) {
        if (!p.dragged) pick(pickAt(pt, inputKind(e)));
      } else {
        dispatch(event('up', pt, inputKind(e)));
        if (!p.dragged && live.current.tool === 'point') live.current.props.onTap?.(p.from);
      }
    }
    release();
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (mode.current === 'gesture' && e.pointerId === primary.current?.id && !live.current.onPick)
      dispatch({ type: 'cancel' });
    release();
  };

  const announce = (text: string): void => live.current.props.onAnnounce?.(text);
  const labelOf = (id: ObjId): string => editor.setup.peek().labels[id] ?? id;

  /** N, or Enter on the canvas with the Point tool: a point at the view centre (or beside). */
  const addPoint = (): void => {
    const v = vpRef.current;
    if (!v || gesture.current.mode !== 'idle' || mode.current !== 'none') return;
    const id = editor.allocId();
    const label = editor.nextLabel();
    editor.applySetup({
      type: 'add',
      specs: [{ id, def: { type: 'given-point', pos: freeSpot(v, live.current.scene) } }],
      labels: { [id]: label },
    });
    focusId.current = id;
    announce(`Added point ${label}.`);
  };
  addRef.current = addPoint;

  /** Arrows on a focused point: one undo step per press. */
  const nudge = (id: ObjId, dir: Vec, far: boolean): void => {
    const v = vpRef.current;
    const def = editor.setup.peek().givens.find((g) => g.id === id)?.def;
    if (!v || def?.type !== 'given-point' || gesture.current.mode !== 'idle') return;
    const step = (NUDGE_PX * (far ? NUDGE_SHIFT : 1)) / v.scale;
    editor.applySetup({
      type: 'move',
      id,
      pos: { x: def.pos.x + dir.x * step, y: def.pos.y + dir.y * step },
    });
    const now = editor.setup.peek().givens.find((g) => g.id === id)?.def;
    if (now?.type === 'given-point')
      announce(`${labelOf(id)} moved to (${fmt(now.pos.x)}, ${fmt(now.pos.y)}).`);
  };

  /**
   * Enter on a point with a two-point tool, as in the game: the first Enter picks the start,
   * Enter on another point finishes (through the same reducer as a drag, so one undo step),
   * Enter on the start again drops it.
   */
  const twoPointKey = (el: Element): void => {
    const v = vpRef.current;
    const { scene: sc, tool: t } = live.current;
    const end = stopTarget(el, sc, []);
    if (!v || !end || end.kind !== 'point' || gesture.current.mode !== 'idle') return;
    const startId = armed.current;
    const startPos = startId ? (sc.byId.get(startId)?.value ?? null) : null;
    if (!startId || !isPointValue(startPos)) {
      arm(end.id);
      setPreview(null);
      const name = t.charAt(0).toUpperCase() + t.slice(1);
      announce(`${name} from ${labelOf(end.id)}. Move to another point and press Enter.`);
      return;
    }
    arm(null);
    if (startId === end.id) {
      setPreview(null);
      announce('Start point dropped.');
      return;
    }
    const before = editor.setup.peek().givens.length;
    const from = { kind: 'point' as const, id: startId, pos: startPos };
    const at = (p: Vec) => ({ screen: toScreen(v, p), world: p });
    dispatch({ type: 'down', target: from, ...at(startPos) });
    dispatch({ type: 'up', target: end, ...at(end.pos) });
    const m = editor.setup.peek();
    const added = m.givens.length > before ? m.givens[m.givens.length - 1]! : null;
    announce(added ? `Added ${givenName(added.def, added.id, m.labels)}.` : 'Nothing was added.');
  };

  // While a start point is picked, focusing another point previews the shape to it.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onFocusIn = (e: FocusEvent): void => {
      const startId = armed.current;
      if (!startId) return;
      const { scene: sc, tool: t } = live.current;
      const from = sc.byId.get(startId)?.value ?? null;
      const to = stopTarget(e.target, sc, []);
      if (t === 'point' || !isPointValue(from) || to?.kind !== 'point' || to.id === startId) return;
      setPreview({ kind: t, from, to: to.pos });
    };
    svg.addEventListener('focusin', onFocusIn);
    return () => svg.removeEventListener('focusin', onFocusIn);
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    const el = (e.target as Element).closest?.('[data-kind="point"], [data-pick-id]');
    const id = el?.getAttribute('data-pick-id') ?? el?.getAttribute('data-id');
    const { onPick: pick, props: p, tool: t } = live.current;
    if (pick) {
      // Pick mode: Enter or Space on a focused point, line or circle picks it.
      if (!el || !id || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      pick(id);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!el && e.target === svgRef.current && t === 'point' && e.key === 'Enter') {
      e.preventDefault();
      addPoint();
      return;
    }
    if (!el || !id || el.getAttribute('data-kind') !== 'point') return;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      nudge(id, dir, e.shiftKey);
    } else if (t === 'point' && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      p.onPointKey?.(id, e.key);
    } else if (t !== 'point' && e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      twoPointKey(el);
    }
  };

  const ghost: GhostView | null = preview
    ? { tool: preview.kind, from: preview.from, to: preview.to }
    : null;
  const grid = vp ? gridPattern(vp, view.fitScale) : null;
  const shownSnap = gesture.current.mode === 'idle' ? snap : null;
  const armedValue = armedId ? (scene.byId.get(armedId)?.value ?? null) : null;
  const armedPos = isPointValue(armedValue) ? armedValue : null;

  return (
    <div class="canvas-host setup-host" ref={view.hostRef}>
      <svg
        ref={svgRef}
        data-testid="setup-canvas"
        class={[
          'canvas setup-canvas',
          picking ? 'is-picking' : '',
          panning ? 'is-panning' : spaceHeld ? 'is-grab' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="application"
        aria-label="Setup canvas"
        tabindex={-1}
        onKeyDown={onKeyDown}
        onPointerEnter={() => (overCanvas.current = true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={() => {
          overCanvas.current = false;
          setSnap(null);
        }}
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
                armed={armedPos}
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
              {picking && (
                // Keyboard access to lines and circles in pick mode: a focus stop at each.
                <g class="pick-keys">
                  {scene.objects.map((o) => {
                    const at = curveAnchor(o, scene);
                    if (!at) return null;
                    const p = toScreen(vp, at);
                    const name = describe(o, scene);
                    return (
                      <g
                        key={o.id}
                        class="pick-key"
                        data-pick-id={o.id}
                        role="button"
                        tabindex={0}
                        aria-label={`Select ${name.charAt(0).toLowerCase()}${name.slice(1)}`}
                        transform={`translate(${p.x} ${p.y})`}
                      >
                        <circle class="pick-key-ring" r={12} />
                      </g>
                    );
                  })}
                </g>
              )}
            </>
          )}
        </g>
      </svg>
      {vp &&
        overlay &&
        (() => {
          const v = scene.byId.get(overlay.id)?.value;
          if (!v || !isPointValue(v)) return null;
          const p = toScreen(vp, v);
          return (
            <div class="canvas-overlay" style={{ left: `${p.x}px`, top: `${p.y}px` }}>
              {overlay.content}
            </div>
          );
        })()}
      {size && <Magnifier point={loupe} size={size} sceneId={ids.root} />}
    </div>
  );
}
