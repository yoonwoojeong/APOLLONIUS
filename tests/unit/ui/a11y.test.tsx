// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/state/store';
import { App } from '../../../src/ui/App';
import { CompletionCard } from '../../../src/ui/CompletionCard';
import { GameScreen } from '../../../src/ui/GameScreen';
import { playReferenceInto } from '../helpers';

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

function mountGame(store: Store) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<GameScreen store={store} />, host));
  return host;
}

function mountApp(store: Store) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App store={store} />, host));
  return host;
}

const level1 = (): Store => {
  const store = createStore(null);
  store.openLevel('equilateral');
  return store;
};

const point = (host: HTMLElement, label: string) =>
  host.querySelector<SVGGElement>(`[data-kind=point][data-label=${label}]`)!;
const liveText = (host: HTMLElement) =>
  host.querySelector('.canvas-host [aria-live]')!.textContent!.trim();
const focus = (el: Element) => act(() => (el as SVGElement).focus());
const press = (key: string, el: Element = document.activeElement ?? document.body) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const circle = (id: string, center: string, through: string) => ({
  type: 'add' as const,
  objects: [{ id, def: { type: 'circle' as const, center, through } }],
});

describe('keyboard construction', () => {
  it('Enter on A then Enter on B commits a circle and announces it', () => {
    const store = level1();
    const host = mountGame(store);
    expect(store.tool.value).toBe('circle');
    focus(point(host, 'A'));
    press('Enter');
    focus(point(host, 'B'));
    press('Enter');
    expect(store.construction().moves().L).toBe(1);
    expect(liveText(host)).toBe('Circle centered at A through B');
  });

  it('Esc after the first Enter cancels: no commit', () => {
    const store = level1();
    const host = mountGame(store);
    focus(point(host, 'A'));
    press('Enter');
    expect(host.querySelector('[data-kind=armed]')).not.toBeNull();
    press('Escape');
    expect(host.querySelector('[data-kind=armed]')).toBeNull();
    focus(point(host, 'B'));
    press('Enter');
    expect(store.construction().moves().L).toBe(0);
  });

  it('a focused point shows the snap ring; while armed the ghost previews to the focused point', () => {
    const store = level1();
    const host = mountGame(store);
    focus(point(host, 'A'));
    expect(host.querySelector('[data-kind=snap][data-snap=point]')).not.toBeNull();
    // Not colour alone: the snapped target is drawn larger than the point itself.
    const r = (sel: string) => Number(host.querySelector(sel)!.getAttribute('r'));
    expect(r('[data-kind=snap] .snap-dot')).toBeGreaterThan(r('[data-label=A] .dot'));
    press('Enter');
    focus(point(host, 'B'));
    expect(host.querySelector('[data-kind=armed]')).not.toBeNull();
    expect(host.querySelector('[data-kind=ghost]')).not.toBeNull();
    expect(host.querySelector('[data-kind=snap][data-snap=point]')).not.toBeNull();
  });

  it('an Enter right after a tool key, before the canvas re-renders, arms the new tool', () => {
    const store = level1();
    const host = mountGame(store);
    store.selectTool('line'); // no act: the canvas has not re-rendered yet
    press('Enter', point(host, 'A'));
    expect(store.tool.value).toBe('line');
    expect(host.querySelector('[data-kind=armed]')).not.toBeNull();
    press('Enter', point(host, 'B'));
    // A line (not a circle) was tried: it coincides with the given segment AB.
    expect(store.lastResult.value).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('Enter on a point with the point tool does nothing', () => {
    const store = level1();
    const host = mountGame(store);
    act(() => store.selectTool('point'));
    focus(point(host, 'A'));
    press('Enter');
    expect(store.construction().scene().objects.filter((o) => !o.given)).toHaveLength(0);
  });

  it('candidate intersections follow the points in tab order and Enter marks them', () => {
    const store = level1();
    const host = mountGame(store);
    act(() => {
      store.apply(circle('c1', 'A', 'B'));
      store.apply(circle('c2', 'B', 'A'));
      store.selectTool('point');
    });
    const stops = [...host.querySelectorAll('[data-testid=canvas] [tabindex="0"]')];
    const kinds = stops.map((el) => el.getAttribute('data-kind'));
    expect(kinds).toEqual(['point', 'point', 'candidate', 'candidate']);
    const cand = stops[2]!;
    expect(cand.getAttribute('role')).toBe('button');
    expect(cand.getAttribute('aria-label')).toMatch(/^Intersection of circle centered at A/);
    expect(stops[2]!.getAttribute('aria-label')).not.toBe(stops[3]!.getAttribute('aria-label'));
    focus(cand);
    expect(host.querySelector('[data-kind=snap][data-snap=candidate]')).not.toBeNull();
    press('Enter');
    const added = store.construction().scene().objects.filter((o) => o.def.type === 'intersection');
    expect(added).toHaveLength(1);
    expect(liveText(host)).toBe('Point C');
    // Focus follows the crossing to the point it became.
    expect(document.activeElement?.getAttribute('data-label')).toBe('C');
  });

  it('Enter on a candidate as the second endpoint of a line commits both', () => {
    const store = level1();
    const host = mountGame(store);
    act(() => {
      store.apply(circle('c1', 'A', 'B'));
      store.apply(circle('c2', 'B', 'A'));
      store.selectTool('line');
    });
    focus(point(host, 'A'));
    press('Enter');
    focus(host.querySelector('[data-kind=candidate]')!);
    press('Enter');
    expect(store.construction().scene().objects.some((o) => o.def.type === 'line')).toBe(true);
    expect(document.activeElement?.getAttribute('data-label')).toBe('C');
  });
});

describe('live region', () => {
  it('announces undo and redo', () => {
    const store = level1();
    const host = mountGame(store);
    act(() => {
      store.apply(circle('c1', 'A', 'B'));
    });
    act(() => store.undo());
    expect(liveText(host)).toBe('Undid: Circle centered at A through B');
    act(() => store.redo());
    expect(liveText(host)).toBe('Redid: Circle centered at A through B');
  });
});

describe('accessible game chrome', () => {
  it('the Hint button is disabled while the completion card shows', () => {
    const store = level1();
    const host = mountGame(store);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label=Hint]')!.disabled).toBe(false);
    act(() => {
      playReferenceInto(store);
    });
    expect(host.querySelector('.completion')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label=Hint]')!.disabled).toBe(true);
  });

  it('the tool tip is announced through a persistent status region', () => {
    const store = createStore(null);
    store.openLevel('midpoint');
    const host = mountGame(store);
    const region = host.querySelector('.game > [role=status]')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    // Solving level 3 unlocks the tool; level 4 then shows its tip.
    act(() => {
      playReferenceInto(store);
    });
    act(() => store.openLevel('perpendicular'));
    expect(host.querySelector('.game > [role=status]')).toBe(region);
    expect(region.textContent).toContain('perpendicular bisector');
    expect(host.querySelector('.tool-tip')!.getAttribute('role')).toBeNull();
  });
});

describe('focus on screen changes', () => {
  it('the title focuses its primary button; Begin focuses the canvas', () => {
    const store = createStore(null);
    const host = mountApp(store);
    const begin = host.querySelector<HTMLButtonElement>('.title-start')!;
    expect(document.activeElement).toBe(begin);
    act(() => begin.click());
    expect(document.activeElement).toBe(host.querySelector('[data-testid=canvas]'));
  });

  it('the map focuses the current level node', () => {
    const store = createStore(null);
    store.goToMap();
    const host = mountApp(store);
    expect(document.activeElement).toBe(host.querySelector('.map-node[aria-current]'));
  });
});

it('earned stars differ in shape (filled) from unearned ones (outline only)', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <CompletionCard
        stars={[true, false, true]}
        explanation="Why."
        targets={{ L: 4, E: 4 }}
        onReplay={() => {}}
        onMap={() => {}}
      />,
      host,
    ),
  );
  const filled = [...host.querySelectorAll('.star')].map((s) => !!s.querySelector('.star-fill'));
  expect(filled).toEqual([true, false, true]);
});
