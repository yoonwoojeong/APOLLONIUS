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

  it('announces undo and redo by name', () => {
    c.undo();
    show();
    expect(latest.announce).toBe('Undid: Circle centered at A through B');
    c.redo();
    show();
    expect(latest.announce).toBe('Redid: Circle centered at A through B');
  });

  it('a repeat of the same announcement still changes the text, so it is read again', () => {
    vi.spyOn(c, 'lastChange').mockReturnValue({ added: ['c1'], removed: [], kind: 'apply' });
    c.undo();
    c.redo(); // a new scene whose change reads exactly like the last one
    show();
    expect(latest.announce).not.toBe('Circle centered at A through B');
    expect(latest.announce.trim()).toBe('Circle centered at A through B');
  });

  it('announces a reset', () => {
    c.apply({ type: 'reset' });
    show();
    expect(latest.announce).toBe('Construction reset');
  });
});
