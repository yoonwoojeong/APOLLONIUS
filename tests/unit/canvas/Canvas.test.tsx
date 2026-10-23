// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Canvas } from '../../../src/canvas/Canvas';
import { createStore } from '../../../src/state/store';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const pointer = (el: Element, type: string, x: number, y: number) => {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.assign(e, { pointerId: 1, pointerType: 'mouse' });
  el.dispatchEvent(e);
};

it('an armed gesture is cleared when the store undoes a step', () => {
  const store = createStore(null);
  store.openLevel('equilateral');
  store.selectTool('circle');
  store.apply({
    type: 'add',
    objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<Canvas store={store} />, host));
  const svg = host.querySelector('[data-testid=canvas]')!;
  const a = host.querySelector('[data-kind=point][data-label=A]')!;
  const [x, y] = a
    .getAttribute('transform')!
    .match(/-?[\d.]+/g)!
    .map(Number) as [number, number];
  act(() => {
    pointer(svg, 'pointerdown', x, y);
    pointer(svg, 'pointerup', x, y);
  });
  expect(host.querySelector('[data-kind=ghost]')).not.toBeNull(); // armed on A
  act(() => store.undo());
  expect(host.querySelector('[data-kind=ghost]')).toBeNull();
  act(() => render(null, host));
});
