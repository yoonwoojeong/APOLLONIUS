// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupCanvas } from '../../../src/editor/SetupCanvas';
import { createEditor, type Editor } from '../../../src/editor/editorStore';
import type { SetupTool } from '../../../src/editor/setupGestures';
import { newDraft } from '../../../src/problems/drafts';
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

const pointer = (el: Element, type: string, x: number, y: number, id = 1) => {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.assign(e, { pointerId: id, pointerType: 'mouse' });
  el.dispatchEvent(e);
};

function mount(tool: SetupTool = 'point', hideCentre = false) {
  const editor: Editor = createEditor(
    createStore(null),
    null,
    newDraft(1000, () => 0.5),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const draw = (t: SetupTool) =>
    act(() => render(<SetupCanvas editor={editor} tool={t} hideCentre={hideCentre} />, host));
  draw(tool);
  const svg = host.querySelector('[data-testid=setup-canvas]')!;
  return { editor, host, svg, draw };
}

const tap = (svg: Element, x: number, y: number) =>
  act(() => {
    pointer(svg, 'pointerdown', x, y);
    pointer(svg, 'pointerup', x, y);
  });

it('renders a labelled point after an add', () => {
  const { editor, host } = mount();
  act(() => {
    const id = editor.allocId();
    editor.applySetup({
      type: 'add',
      specs: [{ id, def: { type: 'given-point', pos: { x: 0, y: 0 } } }],
      labels: { [id]: 'A' },
    });
  });
  expect(host.querySelector('[data-kind="point"][data-label="A"]')).not.toBeNull();
});

it('a tap on empty space with the point tool adds a point through applySetup', () => {
  const { editor, svg } = mount();
  const spy = vi.spyOn(editor, 'applySetup');
  tap(svg, 300, 200);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toMatchObject({ type: 'add' });
  expect(editor.setup.value.givens).toHaveLength(1);
  expect(Object.values(editor.setup.value.labels)).toEqual(['A']);
});

it('a segment drag shows a ghost, then adds two points and a segment as one undo step', () => {
  const { editor, host, svg } = mount('segment');
  act(() => {
    pointer(svg, 'pointerdown', 300, 300);
    pointer(svg, 'pointermove', 400, 300);
  });
  expect(host.querySelector('[data-kind=ghost]')).not.toBeNull();
  act(() => pointer(svg, 'pointerup', 500, 300));
  expect(host.querySelector('[data-kind=ghost]')).toBeNull();
  expect(editor.setup.value.givens).toHaveLength(3);
  act(() => editor.undoSetup());
  expect(editor.setup.value.givens).toHaveLength(0);
});

it('dragging a point moves it and is one undo step', () => {
  const { editor, svg } = mount();
  tap(svg, 300, 300);
  const id = editor.setup.value.givens[0]!.id;
  const before = editor.setup.value.givens[0]!.def;
  act(() => {
    pointer(svg, 'pointerdown', 300, 300);
    pointer(svg, 'pointermove', 340, 300);
    pointer(svg, 'pointermove', 380, 320);
    pointer(svg, 'pointerup', 380, 320);
  });
  const after = editor.setup.value.givens.find((g) => g.id === id)!.def;
  expect(after).not.toEqual(before);
  act(() => editor.undoSetup());
  expect(editor.setup.value.givens[0]!.def).toEqual(before);
  expect(editor.setup.value.givens).toHaveLength(1);
});

it('a hidden circle shows centre and rim handles', () => {
  const { editor, host, svg } = mount('circle', true);
  act(() => {
    pointer(svg, 'pointerdown', 300, 300);
    pointer(svg, 'pointermove', 400, 300);
    pointer(svg, 'pointerup', 400, 300);
  });
  expect(editor.setup.value.givens[0]!.def.type).toBe('given-circle');
  expect(host.querySelector('[data-handle=centre]')).not.toBeNull();
  expect(host.querySelector('[data-handle=rim]')).not.toBeNull();
});

it('a second finger cancels the gesture: nothing is added', () => {
  const { editor, svg } = mount('segment');
  act(() => {
    pointer(svg, 'pointerdown', 300, 300, 1);
    pointer(svg, 'pointermove', 400, 300, 1);
    pointer(svg, 'pointerdown', 500, 400, 2);
    pointer(svg, 'pointerup', 400, 300, 1);
    pointer(svg, 'pointerup', 500, 400, 2);
  });
  expect(editor.setup.value.givens).toHaveLength(0);
});

const gridStep = (host: Element) => host.querySelector('pattern')!.getAttribute('width');

it('placing and dragging points does not change the grid step until a refit', () => {
  const { host, svg, draw } = mount();
  const before = gridStep(host);
  tap(svg, 300, 300);
  tap(svg, 320, 300);
  act(() => {
    pointer(svg, 'pointerdown', 320, 300);
    pointer(svg, 'pointermove', 330, 300);
    pointer(svg, 'pointermove', 340, 300);
    pointer(svg, 'pointerup', 340, 300);
  });
  expect(gridStep(host)).toBe(before);
  const at = () => host.querySelector('[data-kind=point]')!.getAttribute('transform');
  const placed = at();
  draw('line');
  act(() => {
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  expect(at()).not.toBe(placed); // refitted to the two points
  expect(gridStep(host)).toBe(before); // vp.scale and fitScale agree again
});

const farPoints = (editor: Editor) =>
  act(() => {
    for (const [x, y, l] of [
      [50, 50, 'A'],
      [60, 55, 'B'],
    ] as const) {
      const id = editor.allocId();
      editor.applySetup({
        type: 'add',
        specs: [{ id, def: { type: 'given-point', pos: { x, y } } }],
        labels: { [id]: l },
      });
    }
  });

const pointAt = (host: Element, label: string) =>
  host.querySelector(`[data-kind=point][data-label=${label}]`)!.getAttribute('transform');

it('a double-click does not refit while the point tool is active', () => {
  const { editor, host, svg, draw } = mount();
  farPoints(editor);
  const before = [pointAt(host, 'A'), gridStep(host)];
  act(() => {
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  expect([pointAt(host, 'A'), gridStep(host)]).toEqual(before);
  draw('line'); // the same double-click does refit with another tool
  act(() => {
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  expect(pointAt(host, 'A')).not.toBe(before[0]);
});

describe('resize', () => {
  let resize: () => void;
  const setSize = (w: number, h: number) =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: w,
      bottom: h,
      width: w,
      height: h,
      toJSON: () => ({}),
    } as DOMRect);
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const xy = (host: Element, l: string) =>
    pointAt(host, l)!
      .match(/-?[\d.]+/g)!
      .map(Number) as [number, number];

  it('refits to the current givens before the player pans', () => {
    const { editor, host } = mount();
    farPoints(editor); // far from the empty 8x6 frame the view was fitted to
    setSize(400, 700);
    act(() => resize());
    for (const l of ['A', 'B']) {
      const [x, y] = xy(host, l);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(700);
    }
  });

  it('keeps the player view after a pan or zoom', () => {
    const { editor, host, svg } = mount();
    farPoints(editor);
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    });
    const gap = () => xy(host, 'B')[0] - xy(host, 'A')[0];
    const before = gap();
    setSize(400, 700);
    act(() => resize());
    expect(gap()).toBeCloseTo(before);
  });
});

function dragged(editor: Editor, svg: Element) {
  tap(svg, 300, 300);
  const g = editor.setup.value.givens[0]!;
  const startPos = (g.def as { pos: unknown }).pos;
  act(() => {
    pointer(svg, 'pointerdown', 300, 300);
    pointer(svg, 'pointermove', 340, 300);
    pointer(svg, 'pointermove', 380, 320);
  });
  expect(editor.setup.value.givens[0]!.def).not.toEqual(g.def);
  return { id: g.id, startPos };
}

const unchanged = (editor: Editor, id: string, startPos: unknown) => {
  expect(editor.setup.value.givens.find((x) => x.id === id)!.def).toMatchObject({
    pos: startPos,
  });
  act(() => editor.undoSetup()); // only the placement is in history
  expect(editor.setup.value.givens).toHaveLength(0);
  expect(editor.canUndoSetup.value).toBe(false);
};

it('a second finger mid point-drag restores the point and leaves history unchanged', () => {
  const { editor, svg } = mount();
  const { id, startPos } = dragged(editor, svg);
  act(() => pointer(svg, 'pointerdown', 500, 400, 2));
  unchanged(editor, id, startPos);
});

it('Esc mid point-drag restores the point and leaves history unchanged', () => {
  const { editor, svg } = mount();
  const { id, startPos } = dragged(editor, svg);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  unchanged(editor, id, startPos);
});

it('a tool switch mid point-drag restores the point and leaves history unchanged', () => {
  const { editor, svg, draw } = mount();
  const { id, startPos } = dragged(editor, svg);
  draw('segment');
  unchanged(editor, id, startPos);
});

it('two canvases use distinct grid and scene ids', () => {
  const a = mount();
  const b = mount();
  expect(a.host.querySelector('pattern')!.id).not.toBe(b.host.querySelector('pattern')!.id);
  expect(a.host.querySelector('g[id]')!.id).not.toBe(b.host.querySelector('g[id]')!.id);
});
