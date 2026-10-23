// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewport } from '../../../src/canvas/viewport';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { createStore, type Store } from '../../../src/state/store';

/** Stand-in canvas: counts its renders and exposes the viewport callback it was given. */
const canvas = vi.hoisted(() => ({
  renders: 0,
  onView: undefined as ((vp: Viewport | null) => void) | undefined,
}));
vi.mock('../../../src/canvas/Canvas', () => ({
  Canvas: (p: { onView?: (vp: Viewport | null) => void }) => {
    canvas.renders++;
    canvas.onView = p.onView;
    return <svg data-testid="canvas" />;
  },
}));

const { GameScreen } = await import('../../../src/ui/GameScreen');

const vpAt = (cx: number): Viewport => ({ cx, cy: 0, scale: 100, width: 800, height: 600 });
let host: HTMLElement;
const mount = (store: Store) => act(() => render(<GameScreen store={store} />, host));
const pan = (n: number) => {
  for (let i = 0; i < n; i++) act(() => canvas.onView?.(vpAt(i * 0.01)));
};

beforeEach(() => {
  vi.useFakeTimers();
  canvas.renders = 0;
  canvas.onView = undefined;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('GameScreen and viewport changes', () => {
  it('does not subscribe to the viewport when no coach is shown', () => {
    const storage = new Map([
      [STORAGE_KEY, JSON.stringify({ version: 1, levels: {}, unlockedTools: ['perp-bisector'] })],
    ]);
    const store = createStore({
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: () => {},
    } as unknown as Storage);
    store.openLevel('perpendicular'); // shows a tip, which is anchored to the palette
    mount(store);
    expect(host.querySelector('.tool-tip')).not.toBeNull();
    expect(canvas.onView).toBeUndefined();
  });

  it('a pan on level 1 moves the caption without re-rendering the game screen', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    mount(store);
    const before = canvas.renders;
    pan(30);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(canvas.renders).toBe(before);
    const caption = host.querySelector<HTMLElement>('.coach[role="status"]')!;
    expect(caption.getAttribute('data-placed')).toBe('true');
  });
});
