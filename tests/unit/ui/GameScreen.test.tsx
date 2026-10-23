// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { createStore, type Store } from '../../../src/state/store';
import { GameScreen } from '../../../src/ui/GameScreen';

const storageWith = (data: unknown): Storage => {
  const m = new Map<string, string>([[STORAGE_KEY, JSON.stringify(data)]]);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
};

function mount(store: Store) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<GameScreen store={store} />, host));
  return host;
}

const counter = (host: HTMLElement) => host.querySelector('.counter')!.textContent;
const button = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const key = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });

afterEach(() => {
  act(() => render(null, document.body.firstElementChild!));
  document.body.innerHTML = '';
});

describe('GameScreen', () => {
  it('shows the level title, goal and counter "L 0/4 · E 0/4" on level 1', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    expect(counter(host)).toBe('L 0/4 · E 0/4');
    expect(host.textContent).toContain('Equilateral Triangle');
    expect(host.textContent).toContain('Construct an equilateral triangle on AB.');
  });

  it('opens with the circle tool active', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    expect(store.tool.value).toBe('circle');
    expect(button(host, 'Circle')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('pressing 2 selects line', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    key({ key: '2' });
    expect(button(host, 'Line')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(host, 'Circle')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('Ctrl+Z after an apply restores L 0/4; Ctrl+Y redoes it', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
      });
    });
    expect(counter(host)).toBe('L 1/4 · E 1/4');
    key({ key: 'z', ctrlKey: true });
    expect(counter(host)).toBe('L 0/4 · E 0/4');
    key({ key: 'y', ctrlKey: true });
    expect(counter(host)).toBe('L 1/4 · E 1/4');
    key({ key: 'z', ctrlKey: true });
    key({ key: 'Z', metaKey: true, shiftKey: true });
    expect(counter(host)).toBe('L 1/4 · E 1/4');
  });

  it('ignores shortcuts while focus is in a text input', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    mount(store);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    });
    expect(store.tool.value).toBe('circle');
  });

  it('undo, redo and reset buttons are disabled until applicable', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    expect(button(host, 'Undo')!.disabled).toBe(true);
    expect(button(host, 'Redo')!.disabled).toBe(true);
    expect(button(host, 'Reset')!.disabled).toBe(true);
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
      });
    });
    expect(button(host, 'Undo')!.disabled).toBe(false);
    expect(button(host, 'Reset')!.disabled).toBe(false);
    act(() => button(host, 'Reset')!.click());
    expect(counter(host)).toBe('L 0/4 · E 0/4');
    expect(button(host, 'Reset')!.disabled).toBe(true);
    act(() => button(host, 'Undo')!.click());
    expect(counter(host)).toBe('L 1/4 · E 1/4');
    expect(button(host, 'Redo')!.disabled).toBe(false);
  });

  it('marks an exceeded counter part as over', () => {
    const store = createStore(
      storageWith({ version: 1, levels: {}, unlockedTools: ['perp-bisector'] }),
    );
    store.openLevel('perpendicular');
    const host = mount(store);
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'b1', def: { type: 'perp-bisector', a: 'A', b: 'P' } }],
      });
    });
    expect(counter(host)).toBe('L 1/2 · E 3/4');
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'c1', def: { type: 'circle', center: 'P', through: 'A' } }],
      });
      store.apply({
        type: 'add',
        objects: [{ id: 'c2', def: { type: 'circle', center: 'A', through: 'P' } }],
      });
    });
    expect(host.querySelector('.counter-l')!.classList.contains('over')).toBe(true);
    expect(host.querySelector('.counter-e')!.classList.contains('over')).toBe(true);
  });

  it('level 1 palette has no Perpendicular bisector; level 4 with the unlocked tool has it', () => {
    const s1 = createStore(null);
    s1.openLevel('equilateral');
    const h1 = mount(s1);
    expect(button(h1, 'Point')).not.toBeNull();
    expect(button(h1, 'Perpendicular bisector')).toBeNull();
    act(() => render(null, h1));

    const s4 = createStore(
      storageWith({ version: 1, levels: {}, unlockedTools: ['perp-bisector'] }),
    );
    s4.openLevel('perpendicular');
    const h4 = mount(s4);
    expect(button(h4, 'Perpendicular bisector')).not.toBeNull();
    key({ key: '4' });
    expect(s4.tool.value).toBe('perp-bisector');
  });

  it('removes its keyboard listener on unmount', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => render(null, host));
    key({ key: '2' });
    expect(store.tool.value).toBe('circle');
  });
});
