import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ObjId, Scene, SceneObject } from '../construction/types';
import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';
import type { GoalMatch, ToolId } from '../levels/types';
import { candidateIntersections, isCurveValue, isPointValue, type Candidate } from './candidates';
import { curveShapes, ghostShapes, objectShapes, type Shape } from './shapes';
import type { SnapTarget } from './snap';
import { toScreen, type Viewport } from './viewport';

/** Ghost preview of a two-point tool, in world coordinates. */
export interface GhostView {
  tool: ToolId;
  from: Vec;
  to: Vec;
  /** Non-zero plays the invalid shake (a new value replays it); `onGhostEnd` fires after. */
  shake?: number;
}

/** Objects drawing on (`drawIn`) or reversing off from a retained scene (`drawOut`). */
export interface Animating {
  key: number;
  drawIn: ObjId[];
  drawOut: { scene: Scene; ids: ObjId[] } | null;
}

interface Props {
  scene: Scene;
  view: Viewport;
  candidates?: Candidate[];
  /** Objects to pulse briefly (duplicates); a new `key` replays the pulse. */
  highlight?: { ids: ObjId[]; key: number } | null;
  ghost?: GhostView | null;
  snap?: SnapTarget | null;
  /** Changes whenever the gesture locks onto a new target, replaying the lock pulse. */
  lockKey?: number;
  goldMatch?: GoalMatch | null;
  hintIds?: ObjId[];
  animating?: Animating | null;
  onRetainedEnd?: (id: ObjId) => void;
  /** An object in `animating.drawIn` finished drawing on; drop it so pan/zoom never replays it. */
  onDrawnIn?: (id: ObjId) => void;
  /** The duplicate pulse finished; clear `highlight` so pan/zoom never replays it. */
  onHighlightEnd?: () => void;
  onGhostEnd?: () => void;
}

export const POINT_R = 4;
/** Fallback for a one-shot animation whose animationend never fires (e.g. drawn off-screen). */
export const SETTLE_MS = 600;
const CANDIDATE_R = 3;
const HIT_R = 14;
const SNAP_SCALE = 1.4;

function ShapeEls({ shapes, cls }: { shapes: Shape[]; cls: string }) {
  return (
    <>
      {shapes.map((s) =>
        s.tag === 'line' ? (
          <line key={s.key} class={cls} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} pathLength={1} />
        ) : (
          <path key={s.key} class={cls} d={s.d} pathLength={1} />
        ),
      )}
    </>
  );
}

const curveKind = (o: SceneObject): 'line' | 'circle' =>
  (o.value as Curve).kind === 'circle' ? 'circle' : 'line';

function CurveEl(p: {
  obj: SceneObject;
  scene: Scene;
  view: Viewport;
  cls: string;
  anim?: string;
  onAnimEnd?: (id: ObjId) => void;
}) {
  const { obj } = p;
  return (
    <g
      data-kind={curveKind(obj)}
      data-id={obj.id}
      class={p.cls}
      onAnimationEnd={p.anim ? () => p.onAnimEnd?.(obj.id) : undefined}
    >
      <ShapeEls shapes={objectShapes(obj, p.scene, p.view)} cls={`stroke ${p.anim ?? ''}`} />
    </g>
  );
}

function PointEl(p: {
  obj: SceneObject;
  pos: Vec;
  cls: string;
  anim?: string;
  onAnimEnd?: (id: ObjId) => void;
}) {
  const name = p.obj.label ?? p.obj.id;
  return (
    <g
      data-kind="point"
      data-id={p.obj.id}
      data-label={p.obj.label}
      role="button"
      tabindex={0}
      aria-label={`Point ${name}`}
      class={p.cls}
      transform={`translate(${p.pos.x} ${p.pos.y})`}
      onAnimationEnd={p.anim ? () => p.onAnimEnd?.(p.obj.id) : undefined}
    >
      <circle class="hit" r={HIT_R} />
      <circle class={`dot ${p.anim ?? ''}`} r={POINT_R} />
      {p.obj.label && (
        <text class="label" x={7} y={-7} aria-hidden="true">
          {p.obj.label}
        </text>
      )}
    </g>
  );
}

function SnapMarker({ snap, scene, view }: { snap: SnapTarget; scene: Scene; view: Viewport }) {
  const pos = toScreen(view, snap.pos);
  const curve = snap.kind === 'curve' ? scene.byId.get(snap.id) : undefined;
  const ring = snap.kind === 'point' || snap.kind === 'candidate';
  return (
    <g data-kind="snap" data-snap={snap.kind} class="snap">
      {curve && <ShapeEls shapes={objectShapes(curve, scene, view)} cls="snap-curve" />}
      <g transform={`translate(${pos.x} ${pos.y})`}>
        <g class="lock-pulse">
          {ring && <circle class="snap-halo" r={POINT_R * SNAP_SCALE + 5} />}
          <circle
            class={snap.kind === 'empty' ? 'snap-empty' : 'snap-dot'}
            r={POINT_R * SNAP_SCALE}
          />
        </g>
      </g>
    </g>
  );
}

function GhostEl({ ghost, view, onEnd }: { ghost: GhostView; view: Viewport; onEnd?: () => void }) {
  const shapes = ghostShapes(ghost.tool, ghost.from, ghost.to, view);
  const a = toScreen(view, ghost.from);
  return (
    <g
      data-kind="ghost"
      class={ghost.shake ? 'ghost is-shaking' : 'ghost'}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onEnd?.();
      }}
    >
      <ShapeEls shapes={shapes} cls="ghost-stroke" />
      {ghost.shake ? <circle class="ghost-ring" cx={a.x} cy={a.y} r={POINT_R * 2.5} /> : null}
      <circle class="ghost-anchor" cx={a.x} cy={a.y} r={POINT_R * SNAP_SCALE} />
    </g>
  );
}

function GoldEl({ g, view, drawing }: { g: Vec | Curve; view: Viewport; drawing: boolean }) {
  if (isCurveValue(g)) {
    return (
      <g data-kind="gold" class="gold">
        <ShapeEls
          shapes={curveShapes(g, view)}
          cls={drawing ? 'gold-stroke draw-in' : 'gold-stroke'}
        />
      </g>
    );
  }
  const p = toScreen(view, g);
  return (
    <g data-kind="gold" class="gold" transform={`translate(${p.x} ${p.y})`}>
      <circle class={drawing ? 'gold-dot pop-in' : 'gold-dot'} r={POINT_R * SNAP_SCALE} />
    </g>
  );
}

/** The goal overlay draws on once when it mounts (a completion), never again on pan/zoom. */
function GoldLayer({ match, view }: { match: GoalMatch; view: Viewport }) {
  const [drawing, setDrawing] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setDrawing(false), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <g class="gold-layer" onAnimationEnd={() => setDrawing(false)}>
      {match.gold.map((g, i) => (
        <GoldEl key={i} g={g} view={view} drawing={drawing} />
      ))}
    </g>
  );
}

/** Renders the scene in screen space: curves, candidates, ghost, points, snap, overlays. */
export function SceneLayer(props: Props) {
  const { scene, view, ghost, snap, animating, highlight, goldMatch } = props;
  const candidates = useMemo(
    () => props.candidates ?? candidateIntersections(scene),
    [props.candidates, scene],
  );
  const drawIn = new Set(animating?.drawIn ?? []);
  const hint = new Set(props.hintIds ?? []);
  const goal = new Set(goldMatch?.ids ?? []);
  const objCls = (o: SceneObject) =>
    [
      'obj',
      o.given ? 'is-given' : '',
      hint.has(o.id) ? 'is-hint' : '',
      goal.has(o.id) ? 'is-goal' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const curves = scene.objects.filter((o) => isCurveValue(o.value));
  const points = scene.objects.filter((o) => isPointValue(o.value));
  const out = animating?.drawOut;
  const retained = out
    ? out.ids.flatMap((id) => out.scene.byId.get(id) ?? []).filter((o) => o.value)
    : [];
  const pulsed = (highlight?.ids ?? []).flatMap((id) => scene.byId.get(id) ?? []);

  return (
    <g class="scene">
      <g class="curves">
        {curves.map((o) => (
          <CurveEl
            key={o.id}
            obj={o}
            scene={scene}
            view={view}
            cls={objCls(o)}
            anim={drawIn.has(o.id) ? 'draw-in' : undefined}
            onAnimEnd={props.onDrawnIn}
          />
        ))}
      </g>
      <g class="retained" aria-hidden="true">
        {retained.map((o) => (
          <g key={`${animating?.key}-${o.id}`} onAnimationEnd={() => props.onRetainedEnd?.(o.id)}>
            {isPointValue(o.value) ? (
              <g
                transform={`translate(${toScreen(view, o.value).x} ${toScreen(view, o.value).y})`}
                class="obj"
              >
                <circle class="dot pop-out" r={POINT_R} />
              </g>
            ) : (
              <g class={o.given ? 'obj is-given' : 'obj'}>
                <ShapeEls shapes={objectShapes(o, out!.scene, view)} cls="stroke draw-out" />
              </g>
            )}
          </g>
        ))}
      </g>
      {goldMatch && <GoldLayer match={goldMatch} view={view} />}
      <g class="candidates">
        {candidates.map((c) => {
          const p = toScreen(view, c.pos);
          return (
            <circle
              key={`${c.a}-${c.b}-${c.index}`}
              data-kind="candidate"
              class="candidate"
              cx={p.x}
              cy={p.y}
              r={CANDIDATE_R}
            />
          );
        })}
      </g>
      {ghost && (
        <GhostEl key={ghost.shake ?? 0} ghost={ghost} view={view} onEnd={props.onGhostEnd} />
      )}
      <g class="points">
        {points.map((o) => (
          <PointEl
            key={o.id}
            obj={o}
            pos={toScreen(view, o.value as Vec)}
            cls={objCls(o)}
            anim={drawIn.has(o.id) ? 'pop-in' : undefined}
            onAnimEnd={props.onDrawnIn}
          />
        ))}
      </g>
      {snap && <SnapMarker key={props.lockKey ?? 0} snap={snap} scene={scene} view={view} />}
      <g class="pulses" aria-hidden="true" onAnimationEnd={() => props.onHighlightEnd?.()}>
        {pulsed.map((o) =>
          isPointValue(o.value) ? (
            <circle
              key={`${highlight!.key}-${o.id}`}
              class="pulse-dot"
              cx={toScreen(view, o.value).x}
              cy={toScreen(view, o.value).y}
              r={POINT_R * 2}
            />
          ) : (
            <g key={`${highlight!.key}-${o.id}`}>
              <ShapeEls shapes={objectShapes(o, scene, view)} cls="pulse-stroke" />
            </g>
          ),
        )}
      </g>
    </g>
  );
}
