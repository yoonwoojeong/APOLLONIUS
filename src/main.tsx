import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles/tokens.css';
import './styles/base.css';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { safeStorage } from './state/persistence';
import { createStore } from './state/store';

const store = createStore(safeStorage());

effect(() => {
  const theme = store.progress.value.theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
});

render(<div>Apollonius</div>, document.getElementById('app')!);
