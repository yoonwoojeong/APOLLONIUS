import { useEffect } from 'preact/hooks';
import type { Store } from '../state/store';
import { GameScreen } from './GameScreen';

/** Routes by `store.screen`. Title and map screens arrive later; until then every screen shows the game. */
export function App({ store }: { store: Store }) {
  useEffect(() => {
    if (store.screen.peek() !== 'level') store.openLevel(store.resumeLevel());
  }, [store]);
  return <GameScreen store={store} />;
}
