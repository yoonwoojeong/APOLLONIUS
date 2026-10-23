// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneLayer } from '../../../src/canvas/SceneLayer';
import { fit } from '../../../src/canvas/viewport';
import { Construction } from '../../../src/construction/construction';
import { levelById } from '../../../src/levels';

const level = levelById('equilateral');
const view = fit(level.view, 800, 600, 24);

function mount(build?: (c: Construction) => void, ghost = null) {
  const c = new Construction(level.givens, level.labels, level.sceneDiameter);
  build?.(c);
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    <svg>
      <SceneLayer scene={c.scene()} view={view} ghost={ghost} snap={null} />
    </svg>,
    host,
  );
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SceneLayer', () => {
  it('renders labelled, focusable points', () => {
    const host = mount();
    const a = host.querySelector('[data-label="A"]')!;
    expect(a).not.toBeNull();
    expect(a.getAttribute('data-kind')).toBe('point');
    expect(a.getAttribute('data-id')).toBe('A');
    expect(a.getAttribute('aria-label')).toBe('Point A');
    expect(a.getAttribute('role')).toBe('button');
    expect(a.getAttribute('tabindex')).toBe('0');
  });

  it('renders the given segment as a line', () => {
    const host = mount();
    expect(host.querySelectorAll('[data-kind="line"][data-id="AB"]')).toHaveLength(1);
  });

  it('renders one candidate per crossing of two circles', () => {
    const host = mount((c) => {
      c.apply({
        type: 'add',
        objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
      });
      c.apply({
        type: 'add',
        objects: [{ id: 'c2', def: { type: 'circle', center: 'B', through: 'A' } }],
      });
    });
    expect(host.querySelectorAll('[data-kind="circle"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-kind="candidate"]')).toHaveLength(2);
  });

  it('renders no ghost when ghost is null', () => {
    const host = mount();
    expect(host.querySelector('[data-kind="ghost"]')).toBeNull();
  });

  it('renders a ghost when one is given', () => {
    const c = new Construction(level.givens, level.labels, level.sceneDiameter);
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      <svg>
        <SceneLayer
          scene={c.scene()}
          view={view}
          ghost={{ tool: 'circle', from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }}
          snap={null}
        />
      </svg>,
      host,
    );
    expect(host.querySelectorAll('[data-kind="ghost"]')).toHaveLength(1);
  });
});

/** jsdom has no `onanimationend`, so Preact listens for the event under its JSX-cased name. */
const animationEnd = (el: Element) =>
  el.dispatchEvent(
    new Event('onanimationend' in el ? 'animationend' : 'AnimationEnd', { bubbles: true }),
  );

describe('SceneLayer one-shot animations', () => {
  const withCircle = () => {
    const c = new Construction(level.givens, level.labels, level.sceneDiameter);
    c.apply({
      type: 'add',
      objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
    });
    return c.scene();
  };

  function mountWith(props: Partial<Parameters<typeof SceneLayer>[0]>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      <svg>
        <SceneLayer scene={withCircle()} view={view} ghost={null} snap={null} {...props} />
      </svg>,
      host,
    );
    return host;
  }

  it('reports a finished draw-on so it is not replayed on pan/zoom', () => {
    const done: string[] = [];
    const host = mountWith({
      animating: { key: 1, drawIn: ['c1'], drawOut: null },
      onDrawnIn: (id) => done.push(id),
    });
    const stroke = host.querySelector('[data-id="c1"] .draw-in')!;
    expect(stroke).not.toBeNull();
    animationEnd(stroke);
    expect(done).toEqual(['c1']);
  });

  it('reports a finished duplicate pulse', () => {
    let ended = 0;
    const host = mountWith({ highlight: { ids: ['c1'], key: 1 }, onHighlightEnd: () => ended++ });
    animationEnd(host.querySelector('.pulse-stroke')!);
    expect(ended).toBe(1);
  });

  it('draws the gold overlay on once, then keeps it without draw-in', () => {
    const host = mountWith({
      goldMatch: { ids: ['c1'], gold: [{ kind: 'circle', c: { x: 0, y: 0 }, r: 1 }] },
    });
    const layer = host.querySelector('.gold-layer')!;
    expect(layer.querySelector('.draw-in')).not.toBeNull();
    animationEnd(layer.querySelector('.draw-in')!);
    return Promise.resolve().then(() => {
      expect(host.querySelector('.gold-layer .draw-in')).toBeNull();
      expect(host.querySelector('.gold-layer .gold-stroke')).not.toBeNull();
    });
  });
});
