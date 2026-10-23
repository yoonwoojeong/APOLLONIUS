// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../../../src/levels';
import type { LevelId } from '../../../src/levels/types';
import { freshProgress, type Progress } from '../../../src/state/persistence';
import { LevelMap } from '../../../src/ui/LevelMap';

const oneSolved: Progress = {
  ...freshProgress(),
  levels: { equilateral: { stars: [true, false, true], hintsUsed: 0 } },
};

/** Same rule as the store: level 1 is open, every later one needs its predecessor reached. */
const unlockedBy =
  (p: Progress) =>
  (id: LevelId): boolean => {
    const i = LEVELS.findIndex((l) => l.id === id);
    return i === 0 || p.levels[LEVELS[i - 1]!.id]?.stars[0] === true;
  };

function mount(progress: Progress, current: LevelId = 'equilateral') {
  const opened: LevelId[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <LevelMap
        levels={LEVELS}
        progress={progress}
        isUnlocked={unlockedBy(progress)}
        current={current}
        onOpen={(id) => opened.push(id)}
      />,
      host,
    ),
  );
  return { host, opened };
}

const nodes = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.map-node')];

afterEach(() => {
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
});

describe('LevelMap', () => {
  it('renders six nodes, each with its number and title', () => {
    const { host } = mount(freshProgress());
    const ns = nodes(host);
    expect(ns).toHaveLength(6);
    ns.forEach((n, i) => {
      expect(n.textContent).toContain(String(LEVELS[i]!.number));
      expect(n.textContent).toContain(LEVELS[i]!.title);
      expect(n.querySelectorAll('.map-star')).toHaveLength(3);
    });
  });

  it('with only level 1 solved, nodes 1–2 are enabled and 3–6 disabled', () => {
    const { host } = mount(oneSolved);
    const ns = nodes(host);
    for (const n of ns.slice(0, 2)) {
      expect(n.disabled).toBe(false);
      expect(n.hasAttribute('aria-disabled')).toBe(false);
    }
    for (const n of ns.slice(2)) {
      expect(n.disabled).toBe(true);
      expect(n.getAttribute('aria-disabled')).toBe('true');
      expect(n.getAttribute('aria-label')).toMatch(/, locked$/);
    }
  });

  it('node 1 shows the stars earned in progress', () => {
    const { host } = mount(oneSolved);
    const stars = [...nodes(host)[0]!.querySelectorAll('.map-star')];
    expect(stars.map((s) => s.getAttribute('data-earned'))).toEqual(['true', 'false', 'true']);
    expect(nodes(host)[0]!.getAttribute('aria-label')).toBe(
      'Level 1: Equilateral Triangle, 2 of 3 stars',
    );
    expect(nodes(host)[1]!.getAttribute('aria-label')).toBe(
      'Level 2: Perpendicular Bisector, 0 of 3 stars',
    );
  });

  it('clicking an enabled node calls onOpen(id); a locked node does nothing', () => {
    const { host, opened } = mount(oneSolved);
    act(() => nodes(host)[1]!.click());
    act(() => nodes(host)[4]!.click());
    expect(opened).toEqual(['perp-bisector']);
  });

  it('marks the current node with aria-current', () => {
    const { host } = mount(oneSolved, 'perp-bisector');
    const current = nodes(host).filter((n) => n.getAttribute('aria-current') === 'step');
    expect(current.map((n) => n.getAttribute('aria-label'))).toEqual([
      'Level 2: Perpendicular Bisector, 0 of 3 stars',
    ]);
  });
});
