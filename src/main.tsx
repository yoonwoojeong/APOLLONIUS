import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles/tokens.css';
import './styles/base.css';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { safeStorage } from './state/persistence';
import { createStore } from './state/store';
import { App } from './ui/App';

const store = createStore(safeStorage());

effect(() => {
  const theme = store.progress.value.theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
});

render(<App store={store} />, document.getElementById('app')!);
