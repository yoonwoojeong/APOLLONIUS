import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles/tokens.css';
import './styles/base.css';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { safeStorage } from './state/persistence';
import { createStore } from './state/store';
import { Canvas } from './canvas/Canvas';

const store = createStore(safeStorage());

effect(() => {
  const theme = store.progress.value.theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
});

// Temporary stub until GameScreen/App (Task 13): level 1 on a full-viewport canvas.
store.openLevel('equilateral');
store.selectTool('circle');
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')
    return e.shiftKey ? store.redo() : store.undo();
  const t = store.availableTools()[Number(e.key) - 1];
  if (t) store.selectTool(t);
});

render(<Canvas store={store} />, document.getElementById('app')!);
