// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { createStore, type Store } from '../../../src/state/store';
import { App } from '../../../src/ui/App';

const storageWith = (data: unknown): Storage => {
  const m = new Map<string, string>([[STORAGE_KEY, JSON.stringify(data)]]);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
};

const solved = (ids: string[]) =>
  storageWith({
    version: 1,
    levels: Object.fromEntries(ids.map((id) => [id, { stars: [true, true, false], hintsUsed: 0 }])),
    unlockedTools: [],
  });

function mount(store: Store) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App store={store} />, host));
  return host;
}

const buttonByText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;

afterEach(() => {
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
});

describe('App routing', () => {
  it('starts on the title screen and does not open a level by itself', () => {
    const store = createStore(null);
    const host = mount(store);
    expect(store.screen.value).toBe('title');
    expect(host.querySelector('h1')!.textContent).toBe('Apollonius');
    expect(host.textContent).toContain('Compass & straightedge puzzles');
    expect(host.querySelector('.game')).toBeNull();
    expect(host.querySelector('.theme-toggle')).not.toBeNull();
  });

  it('first launch: Begin goes straight into level 1', () => {
    const store = createStore(null);
    const host = mount(store);
    expect(buttonByText(host, 'Continue')).toBeNull();
    act(() => buttonByText(host, 'Begin')!.click());
    expect(store.screen.value).toBe('level');
    expect(store.levelId.value).toBe('equilateral');
    expect(host.querySelector('.game')).not.toBeNull();
  });

  it('returning player: Continue resumes at the first unsolved unlocked level', () => {
    const store = createStore(solved(['equilateral', 'perp-bisector']));
    const host = mount(store);
    expect(buttonByText(host, 'Begin')).toBeNull();
    act(() => buttonByText(host, 'Continue')!.click());
    expect(store.levelId.value).toBe('midpoint');
    expect(store.screen.value).toBe('level');
  });

  it('the top bar Map button shows the map, and a node opens its level', () => {
    const store = createStore(solved(['equilateral']));
    const host = mount(store);
    act(() => buttonByText(host, 'Continue')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Map"]')!.click());
    expect(store.screen.value).toBe('map');
    expect(host.querySelectorAll('.map-node')).toHaveLength(6);
    expect(host.querySelector('.theme-toggle')).not.toBeNull();
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Level 1: Equilateral Triangle, 2 of 3 stars"]',
        )!
        .click(),
    );
    expect(store.screen.value).toBe('level');
    expect(store.levelId.value).toBe('equilateral');
  });
});
