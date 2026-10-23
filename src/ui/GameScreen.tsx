import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Canvas } from '../canvas/Canvas';
import { LEVELS, levelById } from '../levels';
import type { ToolId } from '../levels/types';
import type { Store } from '../state/store';
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
/** Tools already revealed, per store (one store per session); in memory only. */
const revealed = new WeakMap<Store, Set<ToolId>>();

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

  // Each opened level (a new construction) starts on the circle tool when it has one.
  useLayoutEffect(() => {
    const available = store.availableTools();
    const t = available.includes('circle') ? 'circle' : available[0];
    if (t) store.selectTool(t);
    setHintOpen(false);
    // A later tool appearing for the first time this session scales in, with the level's tip.
    const seen = revealed.get(store) ?? new Set<ToolId>();
    revealed.set(store, seen);
    const fresh = REVEALABLE.find((x) => available.includes(x) && !seen.has(x)) ?? null;
    if (fresh) seen.add(fresh);
    setReveal(fresh);
    setTip(fresh ? (level.tip ?? null) : null);
  }, [construction]);

  // The tip goes away once the revealed tool has been used.
  useEffect(() => {
    if (tip && reveal && construction.specs().some((s) => s.def.type === reveal)) setTip(null);
  });

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
        onTipDismiss={() => setTip(null)}
      />
      <main class="game-canvas" onPointerDown={() => setHintOpen(false)}>
        <Canvas store={store} />
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
