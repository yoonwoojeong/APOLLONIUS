import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ObjId, Scene, SceneObject } from '../construction/types';
import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';
import type { GoalMatch, ToolId } from '../levels/types';
import { candidateIntersections, isCurveValue, isPointValue, type Candidate } from './candidates';
import { curveShapes, curveToScreen, ghostShapes, objectShapes, type Shape } from './shapes';
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
  /** Hint tier 2: inputs of the hinted step, glowing in a halo layer under the scene. */
  hintIds?: ObjId[];
  /** Tutorial step targets: objects and world positions that pulse softly. */
  coachIds?: ObjId[];
  coachSpots?: Vec[];
  /** Hint tier 3: the hinted step's result, drawn as a dashed gold ghost to trace. */
  hintGhost?: (Vec | Curve)[];
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
/** Shimmer lifetime fallback (CSS delay + duration, plus slack); animationend normally ends it. */
const SHIMMER_MS = 1400;

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

/** Plain shapes without `pathLength`, so pixel dash patterns keep their length. */
function DashedShapes({ shapes, cls }: { shapes: Shape[]; cls: string }) {
  return (
    <>
      {shapes.map((s) =>
        s.tag === 'line' ? (
          <line key={s.key} class={cls} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ) : (
          <path key={s.key} class={cls} d={s.d} />
        ),
      )}
    </>
  );
}

/**
 * Soft pulsing halos under the hinted inputs (`hint`) or the tutorial's targets (`coach`,
 * which adds a ring rippling out from each point). They live outside the object groups so
 * their animation never reaches a curve/point's draw-on `animationend` handler.
 */
function Glow({
  variant,
  objects,
  spots = [],
  scene,
  view,
}: {
  variant: 'hint' | 'coach';
  objects: SceneObject[];
  spots?: Vec[];
  scene: Scene;
  view: Viewport;
}) {
  const dot = (key: string, p: Vec, id?: ObjId) => {
    const s = toScreen(view, p);
    return (
      <g key={key} {...{ [`data-${variant}-id`]: id ?? key }}>
        <circle class={`${variant}-halo-dot`} cx={s.x} cy={s.y} r={POINT_R * 3} />
        {variant === 'coach' && <circle class="coach-ring" cx={s.x} cy={s.y} r={POINT_R * 3} />}
      </g>
    );
  };
  return (
    <g class={`${variant}-glow`} aria-hidden="true">
      {objects.map((o) =>
        isPointValue(o.value) ? (
          dot(o.id, o.value, o.id)
        ) : (
          <g key={o.id} {...{ [`data-${variant}-id`]: o.id }}>
            <ShapeEls shapes={objectShapes(o, scene, view)} cls={`${variant}-halo-stroke`} />
          </g>
        ),
      )}
      {spots.map((p, i) => dot(`spot-${i}`, p))}
    </g>
  );
}

/** The hinted step's result as a dashed gold preview; one element per ghost value. */
function HintGhost({ values, view }: { values: (Vec | Curve)[]; view: Viewport }) {
  return (
    <g class="hint-ghosts" aria-hidden="true">
      {values.map((g, i) => {
        if (isCurveValue(g)) {
          return (
            <g key={i} data-kind="hint-ghost" class="hint-ghost">
              <DashedShapes shapes={curveShapes(g, view)} cls="hint-ghost-stroke" />
            </g>
          );
        }
        const p = toScreen(view, g);
        return (
          <g key={i} data-kind="hint-ghost" class="hint-ghost">
            <circle class="hint-ghost-ring" cx={p.x} cy={p.y} r={POINT_R * 2.25} />
            <circle class="hint-ghost-dot" cx={p.x} cy={p.y} r={POINT_R * 0.6} />
          </g>
        );
      })}
    </g>
  );
}

/** Screen-space centre of the gold result: points, circle centres, lines nearest the view centre. */
function goldCentre(gold: (Vec | Curve)[], view: Viewport): { c: Vec; r: number } {
  const mid = { x: view.width / 2, y: view.height / 2 };
  const anchors = gold.map((g): { p: Vec; r: number } => {
    if (!isCurveValue(g)) return { p: toScreen(view, g), r: 0 };
    const s = curveToScreen(g, view);
    if (s.kind === 'circle') return { p: s.c, r: s.r };
    const t = (mid.x - s.p.x) * s.d.x + (mid.y - s.p.y) * s.d.y;
    return { p: { x: s.p.x + s.d.x * t, y: s.p.y + s.d.y * t }, r: 0 };
  });
  const n = Math.max(anchors.length, 1);
  const c = anchors.reduce((acc, a) => ({ x: acc.x + a.p.x / n, y: acc.y + a.p.y / n }), {
    x: 0,
    y: 0,
  });
  const r = Math.min(Math.max(140, ...anchors.map((a) => a.r * 1.35)), 320);
  return { c, r };
}

/**
 * A soft radial ring of gold light that blooms once after the gold draw-on. Purely
 * decorative (aria-hidden, `.no-shimmer` hides it under reduced motion); it sits outside
 * the gold layer so its animationend cannot end the draw-on early.
 */
function Shimmer({ match, view }: { match: GoalMatch; view: Viewport }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), SHIMMER_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (!on) return null;
  const { c, r } = goldCentre(match.gold, view);
  return (
    <g class="shimmer-layer" aria-hidden="true" onAnimationEnd={() => setOn(false)}>
      <defs>
        <radialGradient id="apollonius-shimmer">
          <stop offset="0%" class="shimmer-stop" stop-opacity="0" />
          <stop offset="55%" class="shimmer-stop" stop-opacity="0.08" />
          <stop offset="82%" class="shimmer-stop" stop-opacity="0.32" />
          <stop offset="100%" class="shimmer-stop" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle class="shimmer no-shimmer" cx={c.x} cy={c.y} r={r} fill="url(#apollonius-shimmer)" />
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

  const glowing = scene.objects.filter((o) => hint.has(o.id) && o.value);
  const coached = (props.coachIds ?? []).flatMap((id) => {
    const o = scene.byId.get(id);
    return o?.value ? [o] : [];
  });
  const coachSpots = props.coachSpots ?? [];
  const hintGhost = props.hintGhost ?? [];

  return (
    <g class="scene">
      {goldMatch && <Shimmer match={goldMatch} view={view} />}
      {glowing.length > 0 && <Glow variant="hint" objects={glowing} scene={scene} view={view} />}
      {coached.length + coachSpots.length > 0 && (
        <Glow variant="coach" objects={coached} spots={coachSpots} scene={scene} view={view} />
      )}
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
      {hintGhost.length > 0 && <HintGhost values={hintGhost} view={view} />}
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
