import { useSignal, type Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Canvas } from '../canvas/Canvas';
import { isPointValue } from '../canvas/candidates';
import { toScreen, type Viewport } from '../canvas/viewport';
import type { ObjDef, ObjId, Scene } from '../construction/types';
import type { Curve } from '../geometry/curves';
import type { Vec } from '../geometry/vec';
import { LEVELS, isBuiltInLevelId } from '../levels';
import type { LevelId, ToolId } from '../levels/types';
import type { Store } from '../state/store';
import { CoachMark } from './CoachMark';
import { avoidSamples, placeCaption, type Box } from './coachPlacement';
import { CompletionCard } from './CompletionCard';
import { HintPanel } from './HintPanel';
import { ToolPalette } from './ToolPalette';
import { TopBar } from './TopBar';
import './game.css';

/** Text entry keeps its own keys; buttons do not count. */
export const isTextEntry = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Tools that arrive later and get a reveal the first time they appear in a session. */
const REVEALABLE: ToolId[] = ['perp-bisector'];

/**
 * Where each level's tip sits (next to a tool button), what dismisses it, and whether the
 * level opens on that tool while the tip shows.
 */
const TIPS: Partial<
  Record<LevelId, { tool: ToolId; done: (d: ObjDef) => boolean; select?: true }>
> = {
  perpendicular: { tool: 'perp-bisector', done: (d) => d.type === 'perp-bisector' },
  'circle-center': {
    tool: 'point',
    done: (d) => d.type === 'on-curve' && d.curve === 'circle',
    select: true,
  },
};

/** What this session has already shown, per store (one store per session); in memory only. */
const seen = new WeakMap<Store, { tools: Set<ToolId>; tips: Set<LevelId> }>();
/** Quiet time after the last viewport change before the caption is placed afresh. */
const SETTLE_MS = 150;

/**
 * The level 1 caption over the canvas. It alone reads the viewport signal, so pans and
 * pinches re-render only this overlay. A full placement runs when the step, scene or caption
 * size changes and once the viewport settles; while the view is moving the last placement
 * just follows its targets (clamped to the canvas).
 */
function CoachOverlay(p: {
  view: Signal<Viewport | null>;
  text: string | null;
  scene: Scene;
  targets: Vec[];
  upcoming: (Vec | Curve)[];
}) {
  const vp = p.view.value;
  const [settled, setSettled] = useState<Viewport | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(p.view.peek()), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [vp]);
  const last = useRef<{
    key: unknown[];
    vp: Viewport;
    pos: Vec;
    anchor: Vec;
  } | null>(null);

  const place = (box: Box): Vec | null => {
    if (!vp || p.text === null) return null;
    const targets = p.targets.map((t) => toScreen(vp, t));
    const n = Math.max(targets.length, 1);
    const anchor = targets.reduce((a, t) => ({ x: a.x + t.x / n, y: a.y + t.y / n }), {
      x: 0,
      y: 0,
    });
    const key = [p.scene, p.text, box.w, box.h];
    const prev = last.current;
    const fresh = !!prev && prev.key.every((k, i) => k === key[i]);
    if (fresh && prev.vp === vp) return prev.pos;
    if (fresh && vp !== settled) {
      // Moving: keep the caption where it was relative to its targets.
      const x = prev.pos.x + anchor.x - prev.anchor.x;
      const y = prev.pos.y + anchor.y - prev.anchor.y;
      return {
        x: Math.min(Math.max(x, 0), Math.max(0, vp.width - box.w)),
        y: Math.min(Math.max(y, 0), Math.max(0, vp.height - box.h)),
      };
    }
    const avoid = avoidSamples(p.scene, p.upcoming, vp, targets);
    const pos = placeCaption({ area: { w: vp.width, h: vp.height }, box, targets, avoid });
    last.current = { key, vp, pos, anchor };
    return pos;
  };
  return <CoachMark text={p.text} place={place} />;
}

const sessionOf = (store: Store) => {
  let s = seen.get(store);
  if (!s) seen.set(store, (s = { tools: new Set(), tips: new Set() }));
  return s;
};

interface Props {
  store: Store;
  /**
   * The editor's Solve sandbox: a panel shown beside the canvas (below it on phones) in
   * place of the Hint button. Ignored unless the open level is a sandbox.
   */
  sidePanel?: ComponentChildren;
  /** Sandbox only: objects that glow on the canvas (the editor's targets). */
  marked?: ObjId[];
}

/**
 * The level screen: top bar, tool palette and canvas, plus the tool/history shortcuts.
 * Esc (gesture cancel) and Space+drag (pan) are handled by the Canvas itself.
 */
export function GameScreen({ store, sidePanel, marked }: Props) {
  void store.revision.value; // re-render on every construction change
  const level = store.currentLevel.value;
  const custom = store.isCustom.value;
  const sandbox = store.isSandbox.value;
  // Only built-in levels have tips and the tutorial coach; custom levels get neither.
  const builtInId = !custom && isBuiltInLevelId(level.id) ? level.id : null;
  const construction = store.construction();
  const tools = store.availableTools();
  const completion = store.completion.value;
  const hint = store.hint.value;
  const tier = store.hintTier.value;

  const [hintOpen, setHintOpen] = useState(false);
  const hintBtn = useRef<HTMLButtonElement>(null);
  const showHint = hintOpen && tier > 0 && !!hint && !completion;
  const [reveal, setReveal] = useState<ToolId | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const tipCfg = builtInId ? TIPS[builtInId] : undefined;

  // Each opened level (a new construction) starts on the circle tool when it has one.
  useLayoutEffect(() => {
    const available = store.availableTools();
    const session = sessionOf(store);
    setHintOpen(false);
    // A later tool appearing for the first time this session scales in.
    const fresh = REVEALABLE.find((x) => available.includes(x) && !session.tools.has(x)) ?? null;
    if (fresh) session.tools.add(fresh);
    setReveal(fresh);
    // A level's tip shows the first time that level is opened this session.
    const showTip =
      !!builtInId &&
      !!level.tip &&
      !!tipCfg &&
      available.includes(tipCfg.tool) &&
      !session.tips.has(builtInId);
    if (showTip) session.tips.add(builtInId);
    setTip(showTip ? level.tip! : null);
    const t =
      showTip && tipCfg.select
        ? tipCfg.tool
        : available.includes('circle')
          ? 'circle'
          : available[0];
    if (t) store.selectTool(t);
  }, [construction]);

  // The tip goes away after the first action it describes.
  useEffect(() => {
    if (tip && tipCfg && construction.specs().some((s) => tipCfg.done(s.def))) setTip(null);
  });

  // Level 1 tutorial, for players who have not solved the level yet: the current step is the
  // first one not done, so undo moves the coach back.
  const firstTime = useMemo(
    () => !!builtInId && !store.progress.peek().levels[builtInId]?.stars[0],
    [construction],
  );
  const scene = construction.scene();
  const coachStep = firstTime ? (level.coach?.find((st) => !st.doneWhen(scene)) ?? null) : null;
  const coachShown = coachStep && !completion && !showHint ? coachStep : null;
  const coachTargets = coachShown
    ? { ids: coachShown.target, spots: coachShown.spots?.(scene) ?? [] }
    : null;

  // A step that brings its own tool selects it when it becomes current.
  const lastStep = useRef(coachStep);
  useEffect(() => {
    if (coachStep !== lastStep.current && coachStep?.tool) store.selectTool(coachStep.tool);
    lastStep.current = coachStep;
  }, [coachStep]);

  // The caption sits next to its targets, clear of the strokes about to be drawn. Only the
  // coach needs screen positions, so only then does the canvas report its viewport.
  const view = useSignal<Viewport | null>(null);
  const coachActive = firstTime && !!level.coach;
  const coachWorld = coachTargets
    ? [
        ...coachTargets.ids.flatMap((id) => {
          const v = scene.byId.get(id)?.value;
          return v && isPointValue(v) ? [v] : [];
        }),
        ...coachTargets.spots,
      ]
    : [];
  const onView = useMemo(() => (vp: Viewport | null) => (view.value = vp), [view]);

  // When the panel closes on its own (new hint step, completion) with focus inside it,
  // hand focus back to the Hint button; the completion card takes focus itself.
  const wasShown = useRef(false);
  useEffect(() => {
    const was = wasShown.current;
    wasShown.current = showHint;
    if (!was || showHint || completion) return;
    const active = document.activeElement;
    if (!active || active === document.body) hintBtn.current?.focus({ preventScroll: true });
  }, [showHint, completion]);

  // When an undo or reset un-solves the level, the card unmounts; keep focus in the game.
  const canvasHost = useRef<HTMLElement>(null);
  const wasCompleted = useRef(false);
  useEffect(() => {
    const was = wasCompleted.current;
    wasCompleted.current = !!completion;
    if (!was || completion) return;
    const active = document.activeElement;
    if (!active || active === document.body)
      canvasHost.current
        ?.querySelector<SVGSVGElement>('[data-testid="canvas"]')
        ?.focus({ preventScroll: true });
  }, [completion]);

  const onHint = (): void => {
    if (completion) return;
    if (showHint) {
      setHintOpen(false);
      return;
    }
    if (store.hintTier.peek() === 0) store.requestHint();
    setHintOpen(store.hintTier.peek() > 0);
  };
  const closeHint = (): void => {
    setHintOpen(false);
    hintBtn.current?.focus({ preventScroll: true });
  };
  const isLast = LEVELS[LEVELS.length - 1]!.id === level.id;
  const exit = custom ? store.exitCustomLevel : store.goToMap;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || isTextEntry(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && k === 'y' && !e.shiftKey) {
        e.preventDefault();
        store.redo();
      } else if (!mod && !e.shiftKey && /^[1-4]$/.test(e.key)) {
        const t = store.availableTools()[Number(e.key) - 1];
        if (t) {
          e.preventDefault();
          store.selectTool(t);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  // In the sandbox the editor's targets glow the way the tutorial marks its targets.
  const glow = sandbox ? { ids: marked ?? [], spots: [] } : coachTargets;

  return (
    <div class={sandbox && sidePanel ? 'game has-side' : 'game'}>
      {/* Always mounted, so a tip that appears is announced (a fresh live region often is not). */}
      <div role="status" class="sr-only">
        {tip ?? ''}
      </div>
      {sandbox ? (
        <TopBar
          level={{
            title: level.title || 'Untitled problem',
            goalText: level.goalText || 'Each move you make becomes a solution step.',
          }}
          moves={construction.moves()}
          onMap={exit}
          back
          backLabel="Back to Setup"
          theme={store.progress.value.theme}
        />
      ) : (
        <TopBar
          level={level}
          moves={construction.moves()}
          targets={level.targets}
          onHint={onHint}
          hintOpen={showHint}
          hintDisabled={!!completion}
          hintRef={hintBtn}
          onMap={exit}
          back={custom}
          theme={store.progress.value.theme}
          onTheme={store.setTheme}
        />
      )}
      <ToolPalette
        tools={tools}
        active={store.tool.value}
        onSelect={store.selectTool}
        canUndo={construction.canUndo()}
        canRedo={construction.canRedo()}
        canReset={construction.specs().length > level.givens.length}
        onUndo={store.undo}
        onRedo={store.redo}
        onReset={store.reset}
        reveal={reveal}
        tip={tip}
        tipTool={tipCfg?.tool ?? null}
        onTipDismiss={() => setTip(null)}
      />
      <main class="game-canvas" ref={canvasHost} onPointerDown={() => setHintOpen(false)}>
        <Canvas store={store} coach={glow} onView={coachActive ? onView : undefined} />
        {coachActive && (
          <CoachOverlay
            key={level.id}
            view={view}
            text={coachShown?.text ?? null}
            scene={scene}
            targets={coachWorld}
            // The hint engine's next step, matched to the player's own objects.
            upcoming={hint?.ghost ?? []}
          />
        )}
      </main>
      {sandbox && sidePanel && <div class="game-side">{sidePanel}</div>}
      {showHint && (
        <HintPanel
          hint={hint}
          tier={tier as 1 | 2 | 3}
          onMore={store.requestHint}
          onClose={closeHint}
        />
      )}
      {completion && (
        <CompletionCard
          stars={completion.stars}
          explanation={completion.explanation}
          targets={level.targets}
          unlocked={completion.unlocked}
          onNext={isLast || custom ? undefined : store.nextLevel}
          onReplay={store.replayLevel}
          onMap={store.goToMap}
          onBack={custom ? store.exitCustomLevel : undefined}
        />
      )}
    </div>
  );
}
