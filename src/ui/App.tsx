import { EditorScreen } from '../editor/EditorScreen';
import { activeEditor } from '../editor/session';
import { LEVELS } from '../levels';
import type { Store } from '../state/store';
import { GameScreen } from './GameScreen';
import { LevelMap } from './LevelMap';
import { ProblemsScreen } from './ProblemsScreen';
import { ThemeToggle } from './ThemeToggle';
import { TitleScreen } from './TitleScreen';

/**
 * Routes by `store.screen`: title → level (Begin/Continue), level ⇄ map, My problems (Create)
 * and the editor. `storage` holds the author's drafts.
 */
export function App({ store, storage = null }: { store: Store; storage?: Storage | null }) {
  const screen = store.screen.value;
  if (screen === 'level') return <GameScreen store={store} />;
  const editor = activeEditor(store).value;
  // Keyed by draft, so opening another draft starts a fresh editor screen (and canvas fit).
  // Without an open editor the `editor` screen falls back to My problems.
  if (screen === 'editor' && editor) return <EditorScreen key={editor.localId} editor={editor} />;
  const progress = store.progress.value;
  return (
    <div class="screen">
      {screen === 'title' ? (
        <TitleScreen
          hasProgress={Object.keys(progress.levels).length > 0}
          onStart={() => store.openLevel(store.resumeLevel())}
          onCreate={store.goToProblems}
        />
      ) : screen === 'problems' || screen === 'editor' ? (
        <ProblemsScreen store={store} storage={storage} />
      ) : (
        <LevelMap
          levels={LEVELS}
          progress={progress}
          isUnlocked={store.isUnlocked}
          current={store.resumeLevel()}
          onOpen={store.openLevel}
          onCreate={store.goToProblems}
        />
      )}
      <div class="screen-corner">
        <ThemeToggle theme={progress.theme} onChange={store.setTheme} />
      </div>
    </div>
  );
}
