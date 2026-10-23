import { useEffect, useLayoutEffect } from 'preact/hooks';
import { Canvas } from '../canvas/Canvas';
import { levelById } from '../levels';
import type { Store } from '../state/store';
import { ToolPalette } from './ToolPalette';
import { TopBar } from './TopBar';
import './game.css';

/** Text entry keeps its own keys; buttons do not count. */
const isTextEntry = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * The level screen: top bar, tool palette and canvas, plus the tool/history shortcuts.
 * Esc (gesture cancel) and Space+drag (pan) are handled by the Canvas itself.
 */
export function GameScreen({ store }: { store: Store }) {
  void store.revision.value; // re-render on every construction change
  const level = levelById(store.levelId.value);
  const construction = store.construction();
  const tools = store.availableTools();

  // Each opened level (a new construction) starts on the circle tool when it has one.
  useLayoutEffect(() => {
    const available = store.availableTools();
    const t = available.includes('circle') ? 'circle' : available[0];
    if (t) store.selectTool(t);
  }, [construction]);

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
        onHint={store.requestHint}
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
      />
      <main class="game-canvas">
        <Canvas store={store} />
      </main>
    </div>
  );
}
