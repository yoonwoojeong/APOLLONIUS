import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Canvas } from '../canvas/Canvas';
import { isPointValue } from '../canvas/candidates';
import { toScreen, type Viewport } from '../canvas/viewport';
import type { ObjDef } from '../construction/types';
import { LEVELS, levelById } from '../levels';
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
const isTextEntry = (t: EventTarget | null): boolean =>
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
const sessionOf = (store: Store) => {
  let s = seen.get(store);
  if (!s) seen.set(store, (s = { tools: new Set(), tips: new Set() }));
  return s;
};

/**
 * The level screen: top bar, tool palette and canvas, plus the tool/history shortcuts.
 * Esc (gesture cancel) and Space+drag (pan) are handled by the Canvas itself.
 */
export function GameScreen({ store }: { store: Store }) {
  void store.revision.value; // re-render on every construction change
  const level = levelById(store.levelId.value);
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
  const tipCfg = TIPS[level.id];

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
      !!level.tip && !!tipCfg && available.includes(tipCfg.tool) && !session.tips.has(level.id);
    if (showTip) session.tips.add(level.id);
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
    () => !store.progress.peek().levels[level.id]?.stars[0],
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

  // The caption sits next to its targets, clear of the strokes about to be drawn.
  const [vp, setVp] = useState<Viewport | null>(null);
  const placeCoach = (box: Box) => {
    if (!vp || !coachTargets) return null;
    const targets = [
      ...coachTargets.ids.flatMap((id) => {
        const v = scene.byId.get(id)?.value;
        return v && isPointValue(v) ? [v] : [];
      }),
      ...coachTargets.spots,
    ].map((p) => toScreen(vp, p));
    // The hint engine's next step, matched to the player's own objects, is what comes next.
    const avoid = avoidSamples(scene, hint?.ghost ?? [], vp, targets);
    return placeCaption({ area: { w: vp.width, h: vp.height }, box, targets, avoid });
  };

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

  return (
    <div class="game">
      <TopBar
        level={level}
        moves={construction.moves()}
        targets={level.targets}
        onHint={onHint}
        hintOpen={showHint}
        hintRef={hintBtn}
        onMap={store.goToMap}
        theme={store.progress.value.theme}
        onTheme={store.setTheme}
      />
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
      <main class="game-canvas" onPointerDown={() => setHintOpen(false)}>
        <Canvas store={store} coach={coachTargets} onView={setVp} />
        {firstTime && level.coach && (
          <CoachMark key={level.id} text={coachShown?.text ?? null} place={placeCoach} />
        )}
      </main>
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
          onNext={isLast ? undefined : store.nextLevel}
          onReplay={() => store.openLevel(level.id)}
          onMap={store.goToMap}
        />
      )}
    </div>
  );
}
