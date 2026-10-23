import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dist, sub, type Vec } from '../geometry/vec';
import { levelById } from '../levels';
import type { ObjId } from '../construction/types';
import type { ToolId } from '../levels/types';
import type { Store } from '../state/store';
import { candidateIntersections } from './candidates';
import {
  gestureReducer,
  TAP_SLOP_PX,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
} from './gestures';
import { Magnifier } from './Magnifier';
import { SceneLayer, SETTLE_MS, type GhostView } from './SceneLayer';
import { gridPattern } from './shapes';
import { findSnap, type InputKind, type SnapTarget } from './snap';
import { useSceneAnimation } from './useSceneAnimation';
import { useViewport } from './useViewport';
import { toWorld, type Viewport } from './viewport';
import './canvas.css';

const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 24;
const SHAKE_MS = 240;

type Kind = SnapTarget['kind'];
const TWO_POINT: Kind[] = ['point', 'candidate'];
const POINT_TOOL: Kind[] = ['point', 'candidate', 'curve', 'empty'];
const SOLID: Kind[] = ['point', 'candidate', 'curve'];

const IDLE: GestureState = { mode: 'idle' };

/** What the pointers on the canvas are doing; `consumed` waits for every finger to lift. */
type Mode = 'none' | 'gesture' | 'pan' | 'pinch' | 'consumed';

const inputKind = (e: PointerEvent): InputKind =>
  e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';

const isEndpoint = (t: SnapTarget | null): boolean =>
  !!t && (t.kind === 'point' || t.kind === 'candidate');

/** Text entry keeps its own keys (Space, Esc); buttons do not count. */
const isTextEntry = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Focus on a control (e.g. the tool button just clicked) rather than on the page or canvas. */
const isControl = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && t !== document.body && !(t instanceof SVGElement);

/** Ghost from the gesture's start to the snapped endpoint, or to the raw pointer. */
function ghostFor(g: GestureState, tool: ToolId, pointer: Vec | null): GhostView | null {
  if (g.mode === 'idle' || tool === 'point') return null;
  const to = isEndpoint(g.current) ? g.current!.pos : pointer;
  return to ? { tool, from: g.from.pos, to } : null;
}

interface Props {
  store: Store;
  /** Tutorial targets to pulse: objects by id and world positions. */
  coach?: { ids: ObjId[]; spots: Vec[] } | null;
  /** Reports the viewport whenever it changes, for overlays placed in screen space. */
  onView?: (vp: Viewport | null) => void;
}

/** The construction canvas: viewport, pointer plumbing, gestures, pinch/pan and keyboard. */
export function Canvas({ store, coach, onView }: Props) {
  const tool = store.tool.value;
  const revision = store.revision.value; // re-render on every construction change
  const level = levelById(store.levelId.value);
  const construction = store.construction();
  const scene = construction.scene();
  const candidates = useMemo(() => candidateIntersections(scene), [scene]);
  const goldMatch = store.completion.value?.match ?? null;
  // Hint visuals follow the tier (not the panel), so the player can close it and trace.
  const hint = goldMatch ? null : store.hint.value;
  const hintTier = store.hintTier.value;
  const hintIds = hint && hintTier >= 2 ? hint.inputIds : undefined;
  const hintGhost = hint && hintTier >= 3 ? hint.ghost : undefined;

  const svgRef = useRef<SVGSVGElement>(null);
  const view = useViewport(level.view, construction, svgRef);
  const { vp, vpRef, size } = view;
  const { animating, announce, retainedEnd, drawnIn } = useSceneAnimation(construction, scene);

  const [, setTick] = useState(0);
  const [hover, setHover] = useState<SnapTarget | null>(null);
  const [loupe, setLoupe] = useState<Vec | null>(null);
  const [lockKey, setLockKey] = useState(0);
  const [shake, setShake] = useState<GhostView | null>(null);
  const [pulse, setPulse] = useState<{ ids: string[]; key: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const gesture = useRef<GestureState>(IDLE);
  const pointer = useRef<Vec | null>(null); // world position of the pointer, for the ghost
  const pointers = useRef(new Map<number, Vec>());
  const mode = useRef<Mode>('none');
  const primary = useRef<{ id: number; kind: InputKind; start: Vec; dragged: boolean } | null>(
    null,
  );
  const pinch = useRef<{ mid: Vec; d: number } | null>(null);
  const lastTap = useRef<{ t: number; pt: Vec } | null>(null);
  const space = useRef(false);
  const keys = useRef(0);
  const shakeTimer = useRef(0);
  const pulseTimer = useRef(0);
  const overCanvas = useRef(false);
  const ownRevision = useRef(revision); // revision after the canvas's own last commit

  useEffect(() => onView?.(vp), [vp, onView]);

  // Latest render values for event handlers.
  const live = useRef({ scene, candidates, tool });
  live.current = { scene, candidates, tool };

  // A new construction (level opened or replayed) drops the gesture and transient effects.
  useEffect(() => {
    gesture.current = IDLE;
    setShake(null);
    setPulse(null);
  }, [construction]);

  // A change the canvas did not commit itself (undo/redo/reset) may remove the gesture's
  // anchor: drop the gesture, its ghost and any snap preview.
  useEffect(() => {
    if (revision === ownRevision.current) return;
    if (gesture.current.mode !== 'idle') dispatch({ type: 'cancel' });
    setShake(null);
    setHover(null);
  }, [revision]);

  // Tool switch cancels the gesture in progress.
  useEffect(() => dispatch({ type: 'tool', tool }), [tool]);

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const snapAt = (pt: Vec, kind: InputKind, accept?: Kind[]): SnapTarget | null => {
    const v = vpRef.current;
    if (!v) return null;
    const { scene: s, candidates: c, tool: t } = live.current;
    return findSnap(s, c, pt, v, kind, accept ?? (t === 'point' ? POINT_TOOL : TWO_POINT));
  };

  /** Invalid: shake the ghost the gesture was showing (a ring at its start), then clear. */
  const startShake = (g: GestureState): void => {
    const ghost = ghostFor(g, live.current.tool, pointer.current);
    if (!ghost) return;
    window.clearTimeout(shakeTimer.current);
    setShake({ ...ghost, shake: ++keys.current });
    // animationend clears it; the timer covers a missed event.
    shakeTimer.current = window.setTimeout(() => setShake(null), SHAKE_MS + 160);
  };

  const runEffect = (eff: GestureEffect, before: GestureState, kind: InputKind): void => {
    if (eff.type === 'lock') {
      setLockKey((k) => k + 1);
      if (kind === 'touch') navigator.vibrate?.(8);
      return;
    }
    if (eff.type === 'invalid') return startShake(before);
    const r = store.apply(eff.command);
    ownRevision.current = store.revision.peek();
    if (r.ok) return; // useSceneAnimation draws it on
    if (r.reason === 'duplicate') {
      setPulse({ ids: [r.existingId], key: ++keys.current });
      // animationend clears it; the timer covers a pulse that never ran (off-screen).
      window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setPulse(null), SETTLE_MS);
    } else startShake(before);
  };

  function dispatch(ev: GestureEvent, kind: InputKind = primary.current?.kind ?? 'mouse'): void {
    const before = gesture.current;
    const r = gestureReducer(before, ev, {
      tool: live.current.tool,
      allocId: () => store.construction().allocId(),
    });
    gesture.current = r.state;
    for (const eff of r.effects) runEffect(eff, before, kind);
    setTick((t) => t + 1);
  }

  const pinchFrame = (): { mid: Vec; d: number } | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: dist(a, b) };
  };

  /** A pointer left: end everything when none remain; a broken pinch waits for the rest. */
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

  /** Double-tap / double-click on empty space refits the view. */
  const noteTap = (pt: Vec, kind: InputKind): void => {
    if (snapAt(pt, kind, SOLID)) {
      lastTap.current = null;
      return;
    }
    const lt = lastTap.current;
    const now = performance.now();
    if (lt && now - lt.t < DOUBLE_TAP_MS && dist(lt.pt, pt) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      view.refit();
    } else lastTap.current = { t: now, pt };
  };

  const onPointerDown = (e: PointerEvent): void => {
    const v = vpRef.current;
    if (!v) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); // also suppresses the focus change, so move focus here ourselves
    svgRef.current?.focus({ preventScroll: true });
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
      setHover(null);
      if (space.current || e.button === 1) {
        mode.current = 'pan';
        setPanning(true);
        return;
      }
      mode.current = 'gesture';
      pointer.current = toWorld(v, pt);
      dispatch({ type: 'down', target: snapAt(pt, kind), screen: pt }, kind);
    } else if (pointers.current.size === 2 && mode.current !== 'pan') {
      // A second finger is never part of a construction: abandon it and pinch/pan instead.
      if (mode.current === 'gesture') dispatch({ type: 'cancel' });
      mode.current = 'pinch';
      pinch.current = pinchFrame();
      pointer.current = null;
      setLoupe(null);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    overCanvas.current = true;
    const v = vpRef.current;
    if (!v) return;
    const pt = local(e);
    const kind = inputKind(e);
    const last = pointers.current.get(e.pointerId);
    if (!last) {
      // Hover (mouse/pen without a button): preview the snap; an armed gesture follows it.
      if (kind === 'touch' || mode.current !== 'none') return;
      const target = snapAt(pt, kind);
      pointer.current = toWorld(v, pt);
      if (gesture.current.mode === 'armed') {
        setHover(null);
        dispatch({ type: 'move', target, screen: pt }, kind);
      } else setHover(target);
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
      pointer.current = toWorld(v, pt);
      dispatch({ type: 'move', target: snapAt(pt, kind), screen: pt }, kind);
      // The loupe appears once a touch actually drags, so plain taps never flash it.
      setLoupe(kind === 'touch' && p.dragged && gesture.current.mode !== 'idle' ? pt : null);
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = local(e);
    const kind = inputKind(e);
    pointers.current.delete(e.pointerId);
    const p = primary.current;
    if (mode.current === 'gesture' && p && e.pointerId === p.id) {
      dispatch({ type: 'up', target: snapAt(pt, kind), screen: pt }, kind);
      if (kind === 'touch') pointer.current = null;
      if (dist(pt, p.start) <= TAP_SLOP_PX) noteTap(pt, kind);
      else lastTap.current = null;
    }
    release();
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (mode.current === 'gesture' && e.pointerId === primary.current?.id)
      dispatch({ type: 'cancel' });
    release();
  };

  const onPointerLeave = (e: PointerEvent): void => {
    if (pointers.current.has(e.pointerId)) return;
    overCanvas.current = false;
    setHover(null);
    pointer.current = null;
    setTick((t) => t + 1);
  };

  // Keyboard: Space+drag pans, Esc cancels the gesture.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.key === ' ') {
        // On a focused control Space is the pan modifier only while the pointer is over the
        // canvas (or already panning); otherwise it keeps activating the control.
        if (isControl(e.target) && !overCanvas.current && !space.current) return;
        e.preventDefault();
        space.current = true;
        setSpaceHeld(true);
      } else if (e.key === 'Escape') {
        dispatch({ type: 'cancel' });
        setShake(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !space.current) return;
      e.preventDefault(); // a button activates on Space keyup: not while it was the pan key
      space.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.clearTimeout(shakeTimer.current);
      window.clearTimeout(pulseTimer.current);
    };
  }, []);

  const g = gesture.current;
  const ghost = shake ?? ghostFor(g, tool, pointer.current);
  const snap = g.mode !== 'idle' ? g.current : hover;
  const grid = vp ? gridPattern(vp, view.fitScale) : null;
  const cls = ['canvas', panning ? 'is-panning' : spaceHeld ? 'is-grab' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div class="canvas-host" ref={view.hostRef}>
      <svg
        ref={svgRef}
        data-testid="canvas"
        class={cls}
        role="application"
        aria-label={`Construction canvas: ${level.title}`}
        tabindex={-1}
        onPointerEnter={() => (overCanvas.current = true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {grid && (
          <>
            <defs>
              <pattern
                id="apollonius-grid"
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
              fill="url(#apollonius-grid)"
              style={{ opacity: grid.opacity }}
            />
          </>
        )}
        <g id="scene-root">
          {vp && (
            <SceneLayer
              scene={scene}
              view={vp}
              candidates={candidates}
              highlight={pulse}
              ghost={ghost}
              snap={snap}
              lockKey={lockKey}
              goldMatch={goldMatch}
              hintIds={hintIds}
              hintGhost={hintGhost}
              coachIds={coach?.ids}
              coachSpots={coach?.spots}
              animating={animating}
              onRetainedEnd={retainedEnd}
              onDrawnIn={drawnIn}
              onHighlightEnd={() => setPulse(null)}
              onGhostEnd={() => setShake(null)}
            />
          )}
        </g>
      </svg>
      {size && <Magnifier point={loupe} size={size} />}
      <div aria-live="polite" class="sr-only">
        {announce}
      </div>
    </div>
  );
}
