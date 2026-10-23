// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjSpec } from '../../../src/construction/types';
import { activeEditor, openEditor } from '../../../src/editor/session';
import type { Editor } from '../../../src/editor/editorStore';
import { newDraft } from '../../../src/problems/drafts';
import { createStore, type Store } from '../../../src/state/store';
import { App } from '../../../src/ui/App';

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
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setup() {
  const game = createStore(null);
  const editor = openEditor(
    game,
    null,
    newDraft(1000, () => 0.5),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App store={game} />, host));
  return { game, editor, host };
}

const tab = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) =>
    t.textContent?.includes(name),
  )!;
const btn = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
  });

/** Adds given points through the editor; returns their ids. */
function addPoints(ed: Editor, pts: [number, number][]): string[] {
  return pts.map(([x, y]) => {
    const id = ed.allocId();
    act(() =>
      ed.applySetup({
        type: 'add',
        specs: [{ id, def: { type: 'given-point', pos: { x, y } } }],
        labels: { [id]: ed.nextLabel() },
      }),
    );
    return id;
  });
}

/** Screen position of a point on the setup canvas (from its transform). */
function posOf(host: HTMLElement, id: string): [number, number] {
  const el = host.querySelector(`[data-kind="point"][data-id="${id}"]`)!;
  const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '')!;
  return [Number(m[1]), Number(m[2])];
}

/** A mouse tap (or drag to `to`) on the setup canvas. */
function tapAt(host: HTMLElement, [x, y]: [number, number], to?: [number, number]) {
  const svg = host.querySelector('[data-testid="setup-canvas"]')!;
  const pointer = (type: string, px: number, py: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py });
    Object.assign(e, { pointerId: 1, pointerType: 'mouse' });
    svg.dispatchEvent(e);
  };
  act(() => {
    pointer('pointerdown', x, y);
    if (to) pointer('pointermove', to[0], to[1]);
    pointer('pointerup', ...(to ?? [x, y]));
  });
}

const typeInto = (input: HTMLInputElement, value: string) =>
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const keyOn = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

function add(game: Store, defs: ObjSpec['def'][]): string[] {
  const objects = defs.map((def) => ({ id: game.construction().allocId(), def }));
  act(() => {
    expect(game.apply({ type: 'add', objects }).ok).toBe(true);
  });
  return objects.map((o) => o.id);
}

describe('EditorScreen', () => {
  it('routes the editor screen to the active editor', () => {
    const { game, editor, host } = setup();
    expect(game.screen.value).toBe('editor');
    expect(activeEditor(game).value).toBe(editor);
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="setup-canvas"]')).not.toBeNull();
  });

  it('switches modes with the tabs and marks the selected one', () => {
    const { editor, host } = setup();
    const names = [...host.querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent?.replace('✓', '').trim(),
    );
    expect(names).toEqual(['Setup', 'Solve', 'Details', 'Test']);
    expect(tab(host, 'Setup').getAttribute('aria-selected')).toBe('true');

    click(tab(host, 'Details'));
    expect(editor.mode.value).toBe('details');
    expect(tab(host, 'Details').getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[data-testid="setup-canvas"]')).toBeNull();

    click(tab(host, 'Solve'));
    expect(editor.mode.value).toBe('solve');
    expect(host.querySelector('[data-testid="canvas"]')).not.toBeNull();

    click(tab(host, 'Setup'));
    expect(editor.mode.value).toBe('setup');
    expect(host.querySelector('[data-testid="setup-canvas"]')).not.toBeNull();
  });

  it('shows ✓ on a tab whose part is done', () => {
    const { editor, host } = setup();
    expect(tab(host, 'Setup').querySelector('.mode-check')).toBeNull();
    addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]);
    expect(tab(host, 'Setup').querySelector('.mode-check')).not.toBeNull();
  });

  it('Back exits the editor', () => {
    const { game, host } = setup();
    click(btn(host, 'Back to My problems'));
    expect(game.screen.value).toBe('problems');
  });

  it('selects Setup tools from the palette and with keys 1–5', () => {
    const { host } = setup();
    expect(btn(host, 'Point')!.getAttribute('aria-pressed')).toBe('true');
    click(btn(host, 'Segment'));
    expect(btn(host, 'Segment')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(host, 'Point')!.getAttribute('aria-pressed')).toBe('false');
    key('3');
    expect(btn(host, 'Ray')!.getAttribute('aria-pressed')).toBe('true');
    key('5');
    expect(btn(host, 'Circle')!.getAttribute('aria-pressed')).toBe('true');
    // Hide centre belongs to the circle tool.
    const hide = btn(host, 'Hide centre')!;
    expect(hide.getAttribute('aria-pressed')).toBe('false');
    click(hide);
    expect(btn(host, 'Hide centre')!.getAttribute('aria-pressed')).toBe('true');
    key('4');
    expect(btn(host, 'Line')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(host, 'Hide centre')).toBeNull();
  });

  it('undoes and redoes Setup edits from the palette', () => {
    const { editor, host } = setup();
    expect(btn(host, 'Undo')!.disabled).toBe(true);
    addPoints(editor, [[0, 0]]);
    expect(btn(host, 'Undo')!.disabled).toBe(false);
    click(btn(host, 'Undo'));
    expect(editor.setup.value.givens).toHaveLength(0);
    click(btn(host, 'Redo'));
    expect(editor.setup.value.givens).toHaveLength(1);
  });

  it('Delete selects an object, shows what goes with it, and deletes on confirm', () => {
    const { editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    act(() =>
      editor.applySetup({
        type: 'add',
        specs: [{ id: editor.allocId(), def: { type: 'given-line', a, b, extent: 'segment' } }],
        labels: {},
      }),
    );
    click(btn(host, 'Delete'));
    expect(btn(host, 'Delete')!.getAttribute('aria-pressed')).toBe('true');
    // Tap A on the canvas: world (-1, 0) sits left of the centre.
    const svg = host.querySelector('[data-testid="setup-canvas"]')!;
    const pt = host.querySelector(`[data-id="${a}"]`) ?? host.querySelector('[data-label="A"]');
    expect(pt).not.toBeNull();
    const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(pt!.getAttribute('transform') ?? '');
    const [x, y] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
    const pointer = (type: string) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.assign(e, { pointerId: 1, pointerType: 'mouse' });
      svg.dispatchEvent(e);
    };
    act(() => {
      pointer('pointerdown');
      pointer('pointerup');
    });
    const confirm = host.querySelector('.delete-confirm')!;
    expect(confirm.textContent).toContain('point A');
    expect(confirm.textContent).toContain('1 object that depends on it');
    click([...confirm.querySelectorAll('button')].find((x) => x.textContent === 'Delete')!);
    expect(editor.setup.value.givens.map((g) => g.id)).toEqual([b]);
    expect(host.querySelector('.delete-confirm')).toBeNull();
  });

  it('in Solve, lists steps as they are applied and toggles targets with ☆', () => {
    const { game, editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    click(tab(host, 'Solve'));
    expect(host.querySelectorAll('.step-row')).toHaveLength(0);
    const [c] = add(game, [{ type: 'circle', center: a, through: b }]) as [string];
    const rows = host.querySelectorAll('.step-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('1');
    expect(rows[0]!.textContent).toContain('Circle centered at A through B');

    const star = rows[0]!.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    expect(star.getAttribute('aria-pressed')).toBe('false');
    click(star);
    expect(editor.targets.value).toEqual([c]);
    expect(host.querySelector('.step-row button[aria-pressed]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    // The target glows on the game canvas.
    expect(host.querySelector(`[data-coach-id="${c}"]`)).not.toBeNull();
    click(host.querySelector('.step-row button[aria-pressed]'));
    expect(editor.targets.value).toEqual([]);
  });

  it('edits a step hint with a live counter capped at 120', () => {
    const { game, editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    click(tab(host, 'Solve'));
    add(game, [{ type: 'circle', center: a, through: b }]);
    const input = host.querySelector<HTMLInputElement>('.step-row input')!;
    expect(input.maxLength).toBe(120);
    act(() => {
      input.value = 'Draw a circle';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(editor.solution.value[0]!.nudge).toBe('Draw a circle');
    expect(host.querySelector('.step-row')!.textContent).toContain('13/120');
  });

  it('flags a broken step with Broken and Remove from here', () => {
    const { game, editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    click(tab(host, 'Solve'));
    add(game, [{ type: 'circle', center: a, through: b }]);
    click(tab(host, 'Setup'));
    act(() => editor.applySetup({ type: 'delete', ids: [b] }));
    click(tab(host, 'Solve'));
    const row = host.querySelector('.step-row')!;
    expect(row.textContent).toContain('Broken');
    const remove = [...row.querySelectorAll('button')].find(
      (x) => x.textContent === 'Remove from here',
    )!;
    click(remove);
    expect(editor.solution.value).toHaveLength(0);
    expect(host.querySelectorAll('.step-row')).toHaveLength(0);
  });

  it("Solve has one Back (the mode bar's); the Setup tab returns to Setup", () => {
    const { game, editor, host } = setup();
    click(tab(host, 'Solve'));
    expect(host.querySelector('.topbar')).not.toBeNull();
    expect(host.querySelector('.topbar .topbar-map')).toBeNull();
    const backs = [...host.querySelectorAll('button')].filter((b) =>
      /^Back/.test(b.getAttribute('aria-label') ?? ''),
    );
    expect(backs.map((b) => b.getAttribute('aria-label'))).toEqual(['Back to My problems']);
    click(tab(host, 'Setup'));
    expect(editor.mode.value).toBe('setup');
    expect(game.screen.value).toBe('editor');
    expect(host.querySelector('[data-testid="setup-canvas"]')).not.toBeNull();
  });

  it('remounts the editor for a different draft', () => {
    const { game, host } = setup();
    const before = host.querySelector('[data-testid="setup-canvas"]');
    let two: Editor | undefined;
    act(() => {
      two = openEditor(
        game,
        null,
        newDraft(2000, () => 0.9),
      );
    });
    expect(activeEditor(game).value).toBe(two);
    const after = host.querySelector('[data-testid="setup-canvas"]');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('exiting clears the active editor', () => {
    const { game, host } = setup();
    click(btn(host, 'Back to My problems'));
    expect(activeEditor(game).value).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it('in Solve, the mode bar keeps the theme toggle while the game bar has no Hint or theme', () => {
    const { host } = setup();
    click(tab(host, 'Solve'));
    expect(host.querySelector('.modebar .theme-toggle')).not.toBeNull();
    expect(host.querySelector('.topbar .theme-toggle')).toBeNull();
    expect(btn(host, 'Hint')).toBeNull();
  });

  it('digits typed in a hint input stay text and do not switch tools', () => {
    const { game, editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    click(tab(host, 'Solve'));
    add(game, [{ type: 'circle', center: a, through: b }]);
    const tool = game.tool.value;
    const input = host.querySelector<HTMLInputElement>('.step-row input')!;
    const e = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
    expect(game.tool.value).toBe(tool);
  });

  it('names the step on each ☆', () => {
    const { game, editor, host } = setup();
    const [a, b] = addPoints(editor, [
      [-1, 0],
      [1, 0],
    ]) as [string, string];
    click(tab(host, 'Solve'));
    add(game, [{ type: 'circle', center: a, through: b }]);
    expect(btn(host, 'Step 1 target: Circle centered at A through B')).not.toBeNull();
  });

  describe('Setup selection and labels', () => {
    it('a tap selects a point; tapping it again edits its label (one undo step)', () => {
      const { editor, host } = setup();
      const [a] = addPoints(editor, [
        [-1, 0],
        [1, 0],
      ]) as [string, string];
      tapAt(host, posOf(host, a));
      expect(editor.setup.value.givens).toHaveLength(2); // no point added
      expect(host.querySelector(`[data-kind="point"][data-id="${a}"]`)!.classList).toContain(
        'is-hint',
      );
      expect(host.querySelector('.label-edit input')).toBeNull();
      tapAt(host, posOf(host, a));
      const input = host.querySelector<HTMLInputElement>('.label-edit input')!;
      expect(input.value).toBe('A');
      expect(input.maxLength).toBe(3);
      typeInto(input, 'P');
      keyOn(input, 'Enter');
      expect(editor.setup.value.labels[a]).toBe('P');
      expect(host.querySelector('.label-edit')).toBeNull();
      click(btn(host, 'Undo'));
      expect(editor.setup.value.labels[a]).toBe('A');
    });

    it('rejects invalid and duplicate labels with an inline error; Esc cancels', () => {
      const { editor, host } = setup();
      const [a] = addPoints(editor, [
        [-1, 0],
        [1, 0],
      ]) as [string, string];
      tapAt(host, posOf(host, a));
      tapAt(host, posOf(host, a));
      const input = host.querySelector<HTMLInputElement>('.label-edit input')!;
      typeInto(input, '!');
      keyOn(input, 'Enter');
      expect(host.querySelector('.label-edit-error')!.textContent).toMatch(/letters/);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      typeInto(input, 'B');
      keyOn(input, 'Enter');
      expect(host.querySelector('.label-edit-error')!.textContent).toContain('already');
      expect(editor.setup.value.labels[a]).toBe('A');
      keyOn(input, 'Escape');
      expect(host.querySelector('.label-edit')).toBeNull();
      expect(editor.setup.value.labels[a]).toBe('A');
      expect(editor.canUndoSetup.value).toBe(true); // only the two adds
    });

    it('F2 on a focused point edits its label', () => {
      const { editor, host } = setup();
      const [a] = addPoints(editor, [[0, 0]]) as [string];
      keyOn(host.querySelector(`[data-kind="point"][data-id="${a}"]`)!, 'F2');
      expect(host.querySelector<HTMLInputElement>('.label-edit input')!.value).toBe('A');
    });

    it('a drag still moves a point, and a tap on empty space deselects (and places a point)', () => {
      const { editor, host } = setup();
      const [a] = addPoints(editor, [
        [-1, 0],
        [1, 0],
      ]) as [string, string];
      tapAt(host, posOf(host, a));
      const [x, y] = posOf(host, a);
      tapAt(host, [x, y], [x + 40, y + 40]);
      const def = editor.setup.value.givens[0]!.def as { pos: { x: number } };
      expect(def.pos.x).not.toBe(-1);
      tapAt(host, [20, 20]);
      expect(editor.setup.value.givens).toHaveLength(3);
      expect(host.querySelectorAll('.points .is-hint')).toHaveLength(0);
    });
  });

  describe('Delete', () => {
    function withSegment() {
      const env = setup();
      const [a, b] = addPoints(env.editor, [
        [-1, 0],
        [1, 0],
      ]) as [string, string];
      act(() =>
        env.editor.applySetup({
          type: 'add',
          specs: [
            { id: env.editor.allocId(), def: { type: 'given-line', a, b, extent: 'segment' } },
          ],
          labels: {},
        }),
      );
      return { ...env, a, b };
    }

    it('focuses the card’s Delete button and announces the prompt', () => {
      const { host, a } = withSegment();
      click(btn(host, 'Delete'));
      tapAt(host, posOf(host, a));
      const confirm = host.querySelector('.delete-confirm')!;
      expect(document.activeElement?.textContent).toBe('Delete');
      expect(confirm.contains(document.activeElement)).toBe(true);
      const status = [...host.querySelectorAll('[role="status"]')].map((s) => s.textContent);
      expect(status.some((t) => t?.includes('point A'))).toBe(true);
    });

    it('undo after a confirmed delete restores the objects', () => {
      const { editor, host, a } = withSegment();
      click(btn(host, 'Delete'));
      tapAt(host, posOf(host, a));
      click(
        [...host.querySelectorAll('.delete-confirm button')].find(
          (x) => x.textContent === 'Delete',
        )!,
      );
      expect(editor.setup.value.givens).toHaveLength(1);
      click(btn(host, 'Undo'));
      expect(editor.setup.value.givens).toHaveLength(3);
    });

    it('a lone segment can be picked from the keyboard', () => {
      const { host } = withSegment();
      click(btn(host, 'Delete'));
      const key = host.querySelector('[data-pick-id]')!;
      expect(key.getAttribute('tabindex')).toBe('0');
      keyOn(key, 'Enter');
      expect(host.querySelector('.delete-confirm')!.textContent).toContain('segment AB');
    });

    it('says how many solution steps will break', () => {
      const { game, editor, host, a, b } = withSegment();
      click(tab(host, 'Solve'));
      add(game, [{ type: 'circle', center: a, through: b }]);
      click(tab(host, 'Setup'));
      void editor;
      click(btn(host, 'Delete'));
      tapAt(host, posOf(host, a));
      expect(host.querySelector('.delete-confirm')!.textContent).toContain(
        '1 solution step will break',
      );
    });

    it('Delete and Backspace do nothing while a button has focus', () => {
      const { host } = withSegment();
      const t = tab(host, 'Setup');
      t.focus();
      keyOn(t, 'Delete');
      expect(btn(host, 'Delete')!.getAttribute('aria-pressed')).toBe('false');
    });
  });
});
