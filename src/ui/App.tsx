import { EditorScreen } from '../editor/EditorScreen';
import { activeEditor } from '../editor/session';
import { LEVELS } from '../levels';
import type { Store } from '../state/store';
import { GameScreen } from './GameScreen';
import { LevelMap } from './LevelMap';
import { ThemeToggle } from './ThemeToggle';
import { TitleScreen } from './TitleScreen';

/** Routes by `store.screen`: title → level (Begin/Continue), level ⇄ map, the editor. */
export function App({ store }: { store: Store }) {
  const screen = store.screen.value;
  if (screen === 'level') return <GameScreen store={store} />;
  const editor = activeEditor(store).value;
  // Keyed by draft, so opening another draft starts a fresh editor screen (and canvas fit).
  if (screen === 'editor' && editor) return <EditorScreen key={editor.localId} editor={editor} />;
  const progress = store.progress.value;
  return (
    <div class="screen">
      {screen === 'title' ? (
        <TitleScreen
          hasProgress={Object.keys(progress.levels).length > 0}
          onStart={() => store.openLevel(store.resumeLevel())}
        />
      ) : (
        <LevelMap
          levels={LEVELS}
          progress={progress}
          isUnlocked={store.isUnlocked}
          current={store.resumeLevel()}
          onOpen={store.openLevel}
        />
      )}
      <div class="screen-corner">
        <ThemeToggle theme={progress.theme} onChange={store.setTheme} />
      </div>
    </div>
  );
}
