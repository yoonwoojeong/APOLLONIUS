// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '../../../src/editor/editorStore';
import { openEditor } from '../../../src/editor/session';
import { detailsFieldId, modeOfPath } from '../../../src/editor/ValidationList';
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

const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const field = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLInputElement & HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
const byText = (host: HTMLElement, sel: string, text: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text))!;

/** A, B and the perpendicular bisector built in Solve (line is the target) — a valid problem. */
function build(ed: Editor, game: Store): void {
  const ids = ['A', 'B'].map((_, i) => {
    const id = ed.allocId();
    act(() =>
      ed.applySetup({
        type: 'add',
        specs: [{ id, def: { type: 'given-point', pos: { x: i ? 1 : -1, y: 0 } } }],
        labels: { [id]: ed.nextLabel() },
      }),
    );
    return id;
  }) as [string, string];
  act(() => ed.enterSolve());
  const add = (defs: object[]): string[] => {
    const objects = defs.map((def) => ({ id: game.construction().allocId(), def }));
    act(() => {
      expect(game.apply({ type: 'add', objects } as never).ok).toBe(true);
    });
    return objects.map((o) => o.id);
  };
  const [c1] = add([{ type: 'circle', center: ids[0], through: ids[1] }]) as [string];
  const [c2] = add([{ type: 'circle', center: ids[1], through: ids[0] }]) as [string];
  const [p, q] = add([
    { type: 'intersection', a: c1, b: c2, index: 0 },
    { type: 'intersection', a: c1, b: c2, index: 1 },
  ]) as [string, string];
  const [line] = add([{ type: 'line', a: p, b: q }]) as [string];
  act(() => ed.toggleTarget(line));
}

const tab = (host: HTMLElement, name: string) => byText(host, '[role="tab"]', name);

describe('Details mode', () => {
  it('shows live counters and blocks over-long titles with maxLength', () => {
    const { editor, host } = setup();
    click(tab(host, 'Details'));
    const title = field(host, 'Title');
    expect(title.maxLength).toBe(40);
    expect(field(host, 'Goal sentence').maxLength).toBe(120);
    expect(field(host, 'Explanation').maxLength).toBe(200);
    expect(field(host, 'Author').maxLength).toBe(40);
    expect(host.textContent).toContain('0/40');
    typeInto(title, 'Bisector');
    expect(editor.details.value.title).toBe('Bisector');
    expect(host.textContent).toContain('8/40');
    typeInto(field(host, 'Explanation'), 'a\nb');
    expect(editor.details.value.explain).toBe('a b');
  });

  it('keeps Point, Line and Circle on and toggles the perpendicular bisector', () => {
    const { editor, host } = setup();
    click(tab(host, 'Details'));
    for (const n of ['Point', 'Line', 'Circle']) {
      const sw = host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${n}"]`)!;
      expect(sw.disabled).toBe(true);
      expect(sw.getAttribute('aria-checked')).toBe('true');
    }
    const pb = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Perpendicular bisector"]',
    )!;
    expect(pb.getAttribute('aria-checked')).toBe('false');
    click(pb);
    expect(editor.details.value.perpBisector).toBe(true);
    expect(pb.getAttribute('aria-checked')).toBe('true');
  });

  it('par stepper cannot go below the solution, writes only its axis and can reset', () => {
    const { editor, game, host } = setup();
    build(editor, game);
    click(tab(host, 'Details'));
    expect(editor.moves.value).toEqual({ L: 3, E: 3 });
    expect(host.querySelector('.par-summary')!.textContent).toBe('L 3 · E 3');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Decrease par L"]')!.disabled).toBe(
      true,
    );
    expect(byText(host, 'button', 'Match my solution')).toBeUndefined();
    click(host.querySelector('[aria-label="Increase par E"]'));
    expect(editor.problem.value.par).toEqual({ L: 3, E: 4 });
    expect(editor.details.value.par).toEqual({ L: null, E: 4 });
    expect(host.querySelector('.par-summary')!.textContent).toBe('L 3 · E 4');
    click(host.querySelector('[aria-label="Decrease par E"]'));
    expect(editor.details.value.par).toEqual({ L: null, E: null });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Decrease par E"]')!.disabled).toBe(
      true,
    );
    click(host.querySelector('[aria-label="Increase par L"]'));
    click(byText(host, 'button', 'Match my solution'));
    expect(editor.details.value.par).toEqual({ L: null, E: null });
    expect(byText(host, 'button', 'Match my solution')).toBeUndefined();
  });

  it('Enter in the explanation adds nothing', () => {
    const { host } = setup();
    click(tab(host, 'Details'));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      field(host, 'Explanation').dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('lists errors and goes to the mode each concerns', () => {
    const { editor, game, host } = setup();
    build(editor, game);
    act(() => editor.toggleTarget(editor.targets.value[0]!));
    click(tab(host, 'Details'));
    const rows = host.querySelectorAll('.check-row.is-error');
    expect(rows.length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain('Ready to test');
    const targetRow = [...host.querySelectorAll<HTMLButtonElement>('button.check-row')].find(
      (b) => !/title|goal/i.test(b.textContent ?? ''),
    )!;
    click(targetRow);
    expect(editor.mode.value).toBe('solve');
  });
});

describe('error paths', () => {
  it.each([
    ['givens', 'setup'],
    ['givens[2].pos', 'setup'],
    ['labels.A', 'setup'],
    ['solution', 'solve'],
    ['solution[3].objects[0]', 'solve'],
    ['targets', 'solve'],
    ['targets[0]', 'solve'],
    ['tools', 'details'],
    ['tools[1]', 'details'],
    ['par.L', 'details'],
    ['par.E', 'details'],
    ['title', 'details'],
    ['', 'details'],
    ['format', 'details'],
  ])('%s concerns %s', (path, mode) => {
    expect(modeOfPath(path)).toBe(mode);
  });

  it.each([
    ['title', 'details-title'],
    ['goalText', 'details-goalText'],
    ['explain', 'details-explain'],
    ['author', 'details-author'],
    ['tools', 'details-perp'],
    ['tools[0]', 'details-perp'],
    ['par.L', 'details-par-L'],
    ['par.E', 'details-par-E'],
    ['par', 'details-par-L'],
    ['', null],
    ['format', null],
    ['givens', null],
  ])('%s focuses %s', (path, id) => {
    expect(detailsFieldId(path)).toBe(id);
  });

  it('clicking a solution error switches to Solve and focuses the step hint', async () => {
    const { editor, game, host } = setup();
    act(() => editor.setDetails({ perpBisector: true }));
    const ids = [-1, 1].map((x) => {
      const id = editor.allocId();
      act(() =>
        editor.applySetup({
          type: 'add',
          specs: [{ id, def: { type: 'given-point', pos: { x, y: 0 } } }],
          labels: { [id]: editor.nextLabel() },
        }),
      );
      return id;
    });
    act(() => editor.enterSolve());
    const oid = game.construction().allocId();
    act(() => {
      expect(
        game.apply({
          type: 'add',
          objects: [{ id: oid, def: { type: 'perp-bisector', a: ids[0], b: ids[1] } }],
        } as never).ok,
      ).toBe(true);
    });
    act(() => editor.toggleTarget(oid));
    act(() => editor.setDetails({ perpBisector: false, title: 'T', goalText: 'G' }));
    click(tab(host, 'Details'));
    const row = byText(host, 'button.check-row', 'Perpendicular Bisector');
    expect(row).toBeDefined();
    click(row);
    expect(editor.mode.value).toBe('solve');
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(document.activeElement?.classList.contains('step-hint-input')).toBe(true);
  });
});

describe('Test mode', () => {
  it('disables Play test with the reason while the problem is invalid', () => {
    const { editor, host } = setup();
    click(tab(host, 'Test'));
    const play = byText(host, 'button', 'Play test') as HTMLButtonElement;
    expect(play.getAttribute('aria-disabled')).toBe('true');
    expect(play.getAttribute('aria-describedby')).toBe('test-reason');
    click(play);
    expect(editor.mode.value).toBe('test');
    expect(host.querySelector('.test-reason')!.textContent).toMatch(/Fix/);
    expect(host.querySelector('.check-row.is-error')).not.toBeNull();
    expect(editor.startTest()).toBe(false);
  });

  it('enables Play test for a valid problem and shows Tested once passed', () => {
    const { editor, game, host } = setup();
    build(editor, game);
    act(() => editor.setDetails({ title: 'Bisector', goalText: 'Construct the bisector of AB.' }));
    click(tab(host, 'Test'));
    expect(host.textContent).toContain('Ready to test');
    const play = byText(host, 'button', 'Play test') as HTMLButtonElement;
    expect(play.getAttribute('aria-disabled')).toBe('false');
    expect(host.textContent).not.toContain('Tested ✓');
    // Replaying the solution in the game completes the level and marks the problem tested.
    click(play);
    expect(game.screen.value).toBe('level');
    const steps = editor.solution.value;
    for (const st of steps) {
      act(() => {
        game.apply({ type: 'add', objects: st.objects } as never);
      });
    }
    act(() => game.exitCustomLevel());
    expect(editor.mode.value).toBe('test');
    expect(editor.tested.value).toBe(true);
    expect(host.textContent).toContain('Tested ✓');
  });
});
