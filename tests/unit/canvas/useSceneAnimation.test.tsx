// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS } from '../../../src/canvas/SceneLayer';
import { useSceneAnimation, type SceneAnimation } from '../../../src/canvas/useSceneAnimation';
import { Construction } from '../../../src/construction/construction';
import type { Scene } from '../../../src/construction/types';
import { levelById } from '../../../src/levels';

const level = levelById('equilateral');
let latest: SceneAnimation;

function Probe({ c, scene }: { c: Construction; scene: Scene }) {
  latest = useSceneAnimation(c, scene);
  return null;
}

describe('useSceneAnimation', () => {
  let host: HTMLDivElement;
  let c: Construction;
  const show = () => act(() => render(<Probe c={c} scene={c.scene()} />, host));

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    c = new Construction(level.givens, level.labels, level.sceneDiameter);
    show();
    c.apply({
      type: 'add',
      objects: [{ id: 'c1', def: { type: 'circle', center: 'A', through: 'B' } }],
    });
    show();
  });

  afterEach(() => {
    render(null, host);
    vi.useRealTimers();
  });

  it('draws added objects on and announces them', () => {
    expect(latest.animating?.drawIn).toEqual(['c1']);
    expect(latest.announce).toBe('Circle centered at A through B');
  });

  it('drops an object from drawIn once its draw-on has finished', () => {
    act(() => latest.drawnIn('c1'));
    expect(latest.animating?.drawIn).toEqual([]);
  });

  it('clears the animation after SETTLE_MS even without animationend', () => {
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(latest.animating).toBeNull();
  });

  it('reverse-draws removed objects from the previous scene on undo', () => {
    c.undo();
    show();
    expect(latest.animating?.drawIn).toEqual([]);
    expect(latest.animating?.drawOut?.ids).toEqual(['c1']);
  });
});
