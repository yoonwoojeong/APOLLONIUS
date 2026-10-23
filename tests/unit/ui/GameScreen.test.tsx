// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { createStore, type Store } from '../../../src/state/store';
import { COACH_FADE_MS } from '../../../src/ui/CoachMark';
import { GameScreen } from '../../../src/ui/GameScreen';
import { levelById } from '../../../src/levels';
import type { Level } from '../../../src/levels/types';
import { playReferenceInto } from '../helpers';

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

describe('GameScreen hints, completion and reveal', () => {
  const buttonText = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
  const panel = (host: HTMLElement) => host.querySelector('[role="dialog"][aria-label="Hint"]');

  it('Hint opens tier 1; More help advances; close keeps the tier and refocuses Hint', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    expect(panel(host)).toBeNull();
    act(() => button(host, 'Hint')!.click());
    expect(store.hintTier.value).toBe(1);
    expect(panel(host)!.textContent).toContain('Which points are exactly AB away from A?');
    act(() => buttonText(host, 'More help')!.click());
    expect(store.hintTier.value).toBe(2);
    expect(host.querySelectorAll('.hint-glow [data-hint-id]')).toHaveLength(0); // no viewport in jsdom
    act(() => button(host, 'Close hint')!.click());
    expect(panel(host)).toBeNull();
    expect(document.activeElement).toBe(button(host, 'Hint'));
    act(() => button(host, 'Hint')!.click());
    expect(store.hintTier.value).toBe(2);
    expect(panel(host)!.textContent).toContain('Show me where');
  });

  it('closes the panel when the hint moves on to a new step', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => button(host, 'Hint')!.click());
    act(() => {
      store.apply({ type: 'add', objects: levelById('equilateral').reference[0]!.objects });
    });
    expect(store.hintTier.value).toBe(0);
    expect(panel(host)).toBeNull();
  });

  it('completing a level closes the hint and shows the card; Next opens level 2', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => button(host, 'Hint')!.click());
    act(() => playReferenceInto(store));
    expect(panel(host)).toBeNull();
    const card = host.querySelector('[role="dialog"].completion')!;
    expect(card.textContent).toContain('Solved');
    expect(card.querySelectorAll('[data-earned="true"]')).toHaveLength(3);
    act(() => buttonText(host, 'Next')!.click());
    expect(store.levelId.value).toBe('perp-bisector');
    expect(host.querySelector('.completion')).toBeNull();
  });

  it('Ctrl+Z with the card open un-solves: the card goes and focus moves to the canvas', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => playReferenceInto(store));
    expect(host.querySelector('.completion')).not.toBeNull();
    key({ key: 'z', ctrlKey: true });
    expect(store.completion.value).toBeNull();
    expect(host.querySelector('.completion')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="canvas"]'));
    key({ key: 'y', ctrlKey: true });
    expect(host.querySelector('.completion')).not.toBeNull();
  });

  it('Replay reopens the same level', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => playReferenceInto(store));
    act(() => buttonText(host, 'Replay')!.click());
    expect(store.levelId.value).toBe('equilateral');
    expect(store.completion.value).toBeNull();
    expect(counter(host)).toBe('L 0/4 · E 0/4');
  });

  const unlocked = () =>
    createStore(storageWith({ version: 1, levels: {}, unlockedTools: ['perp-bisector'] }));
  const tipSlot = (host: HTMLElement) => host.querySelector('.tool-slot.has-tip');

  it('reveals the new tool once per session with its tip; tapping dismisses it', () => {
    const store = unlocked();
    store.openLevel('perpendicular');
    const host = mount(store);
    const tool = button(host, 'Perpendicular bisector')!;
    expect(tool.classList.contains('is-revealing')).toBe(true);
    const tip = host.querySelector('.tool-tip')!;
    expect(tip.textContent).toContain(
      'New tool: drag between two points to draw their perpendicular bisector.',
    );
    expect(tipSlot(host)!.contains(tool)).toBe(true);
    act(() => (tip as HTMLElement).click());
    expect(host.querySelector('.tool-tip')).toBeNull();
    act(() => store.openLevel('perpendicular'));
    expect(button(host, 'Perpendicular bisector')!.classList.contains('is-revealing')).toBe(false);
    expect(host.querySelector('.tool-tip')).toBeNull();
  });

  it('the tip is dismissed by the first use of the tool', () => {
    const store = unlocked();
    store.openLevel('perpendicular');
    const host = mount(store);
    expect(host.querySelector('.tool-tip')).not.toBeNull();
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'b1', def: { type: 'perp-bisector', a: 'A', b: 'P' } }],
      });
    });
    expect(host.querySelector('.tool-tip')).toBeNull();
  });

  it('reveals the tool on the first level that has it; each level shows its own tip once', () => {
    const store = unlocked();
    store.openLevel('angle-bisector');
    const host = mount(store);
    expect(button(host, 'Perpendicular bisector')!.classList.contains('is-revealing')).toBe(true);
    expect(host.querySelector('.tool-tip')).toBeNull(); // level 5 has no tip
    act(() => store.openLevel('perpendicular'));
    expect(button(host, 'Perpendicular bisector')!.classList.contains('is-revealing')).toBe(false);
    expect(host.querySelector('.tool-tip')!.textContent).toContain('New tool:');
    act(() => store.openLevel('circle-center'));
    expect(host.querySelector('.tool-tip')!.textContent).toContain(
      'Tap the circle to place points on it.',
    );
    act(() => store.openLevel('perpendicular'));
    expect(host.querySelector('.tool-tip')).toBeNull();
  });

  it('level 6 tip sits by the Point tool, selects it and goes once a point is on the circle', () => {
    const store = unlocked();
    store.openLevel('circle-center');
    const host = mount(store);
    expect(tipSlot(host)!.contains(button(host, 'Point'))).toBe(true);
    expect(store.tool.value).toBe('point');
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'f', def: { type: 'free-point', pos: { x: 3, y: 3 } } }],
      });
    });
    expect(host.querySelector('.tool-tip')).not.toBeNull(); // not on the circle
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'p', def: { type: 'on-curve', curve: 'circle', t: 1 } }],
      });
    });
    expect(host.querySelector('.tool-tip')).toBeNull();
    act(() => store.openLevel('circle-center'));
    expect(host.querySelector('.tool-tip')).toBeNull();
    expect(store.tool.value).toBe('circle');
  });
});

describe('GameScreen level 1 coach', () => {
  const ref = levelById('equilateral').reference;
  const step = (store: Store, i: number) =>
    act(() => {
      store.apply({ type: 'add', objects: ref[i]!.objects });
    });
  const coach = (host: HTMLElement) => host.querySelector<HTMLElement>('.coach[role="status"]');
  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(COACH_FADE_MS);
    });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('walks a new player through the four steps, one caption at a time', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    const region = coach(host)!;
    expect(region.textContent).toBe('Drag from A to B to draw a circle.');
    expect(store.tool.value).toBe('circle');
    step(store, 0);
    settle();
    expect(coach(host)).toBe(region);
    expect(region.textContent).toBe('Now drag from B to A.');
    step(store, 1);
    settle();
    expect(region.textContent).toBe('Tap where the circles cross.');
    expect(store.tool.value).toBe('circle');
    step(store, 2);
    settle();
    expect(region.textContent).toBe('Draw lines from your new point to A and to B.');
    expect(store.tool.value).toBe('line');
    step(store, 3);
    expect(region.getAttribute('aria-hidden')).toBe('true');
  });

  it('a wrong action leaves the caption; undo moves the coach back', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => {
      store.apply({
        type: 'add',
        objects: [{ id: 'x', def: { type: 'circle', center: 'B', through: 'A' } }],
      });
    });
    settle();
    expect(coach(host)!.textContent).toBe('Drag from A to B to draw a circle.');
    step(store, 0);
    settle();
    expect(coach(host)!.textContent).toBe('Tap where the circles cross.');
    act(() => store.undo());
    settle();
    expect(coach(host)!.textContent).toBe('Drag from A to B to draw a circle.');
  });

  it('undoing back from step 4 to a circle step selects the circle tool again', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    step(store, 0);
    step(store, 1);
    step(store, 2);
    settle();
    expect(store.tool.value).toBe('line');
    act(() => store.undo());
    act(() => store.undo());
    settle();
    expect(coach(host)!.textContent).toBe('Now drag from B to A.');
    expect(store.tool.value).toBe('circle');
  });

  it('hides while the hint panel is open', () => {
    const store = createStore(null);
    store.openLevel('equilateral');
    const host = mount(store);
    act(() => button(host, 'Hint')!.click());
    expect(coach(host)!.getAttribute('aria-hidden')).toBe('true');
    act(() => button(host, 'Close hint')!.click());
    expect(coach(host)!.getAttribute('aria-hidden')).toBeNull();
  });

  it('is not shown once level 1 has been completed, nor on other levels', () => {
    const store = createStore(
      storageWith({
        version: 1,
        levels: { equilateral: { stars: [true, false, false], hintsUsed: 0 } },
        unlockedTools: [],
      }),
    );
    store.openLevel('equilateral');
    const host = mount(store);
    expect(coach(host)).toBeNull();
    act(() => store.openLevel('perp-bisector'));
    expect(coach(host)).toBeNull();
  });
});

describe('GameScreen with a custom level', () => {
  const buttonText = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
  /** Level 1 dressed as a custom level, keeping its coach and tip to prove they never show. */
  const custom = (): Level => ({
    ...levelById('equilateral'),
    id: 'problem:l1',
    number: undefined,
    tip: 'A tip that must not show.',
  });

  it('top bar Back exits; no number, coach or tip', () => {
    const store = createStore(null);
    const onExit = vi.fn();
    store.openCustomLevel(custom(), { onExit });
    const host = mount(store);
    expect(button(host, 'Map')).toBeNull();
    expect(host.querySelector('.level-num')).toBeNull();
    expect(host.querySelector('.coach')).toBeNull();
    expect(host.querySelector('.tool-tip')).toBeNull();
    expect(store.tool.value).toBe('circle');
    key({ key: '2' });
    expect(store.tool.value).toBe('line');
    act(() => button(host, 'Back')!.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('completion card offers Back and Replay, not Next or Map', () => {
    const store = createStore(null);
    const onExit = vi.fn();
    const onComplete = vi.fn();
    store.openCustomLevel(custom(), { onExit, onComplete });
    const host = mount(store);
    act(() => playReferenceInto(store));
    const card = host.querySelector<HTMLElement>('.completion')!;
    expect(card.querySelectorAll('[data-earned="true"]')).toHaveLength(3);
    expect(buttonText(card, 'Next')).toBeNull();
    expect(buttonText(card, 'Map')).toBeNull();
    expect(document.activeElement).toBe(buttonText(card, 'Back'));
    act(() => buttonText(card, 'Replay')!.click());
    expect(store.completion.value).toBeNull();
    expect(store.isCustom.value).toBe(true);
    act(() => playReferenceInto(store));
    expect(onComplete).toHaveBeenCalledTimes(2);
    act(() => buttonText(host.querySelector<HTMLElement>('.completion')!, 'Back')!.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
