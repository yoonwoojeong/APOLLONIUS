// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
