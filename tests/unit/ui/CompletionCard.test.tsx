// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Stars } from '../../../src/reasoning/stars';
import { CompletionCard } from '../../../src/ui/CompletionCard';

function mount(p: { stars?: Stars; last?: boolean; unlocked?: 'perp-bisector' } = {}) {
  const calls: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <CompletionCard
        stars={p.stars ?? [true, true, true]}
        explanation="C lies on both circles, so CA = AB = CB."
        targets={{ L: 4, E: 4 }}
        unlocked={p.unlocked}
        onNext={p.last ? undefined : () => calls.push('next')}
        onReplay={() => calls.push('replay')}
        onMap={() => calls.push('map')}
      />,
      host,
    ),
  );
  return { host, calls };
}

const buttonByText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;

afterEach(() => {
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
});

describe('CompletionCard', () => {
  it('renders 3 stars, 2 earned for [true, false, true], with a text summary', () => {
    const { host } = mount({ stars: [true, false, true] });
    const stars = host.querySelectorAll('[data-earned]');
    expect(stars).toHaveLength(3);
    expect(host.querySelectorAll('[data-earned="true"]')).toHaveLength(2);
    expect(host.textContent).toContain('2 of 3 stars');
  });

  it('labels each star with what it means, using the level targets', () => {
    const { host } = mount();
    expect(host.textContent).toContain('Reached the goal');
    expect(host.textContent).toContain('Within 4 moves (L)');
    expect(host.textContent).toContain('Within 4 moves (E)');
  });

  it('is a dialog labelled "Solved" showing the explanation', () => {
    const { host } = mount();
    const dialog = host.querySelector('[role="dialog"]')!;
    const heading = host.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)!;
    expect(heading.textContent).toBe('Solved');
    expect(host.textContent).toContain('C lies on both circles, so CA = AB = CB.');
  });

  it('wires Next, Replay and Map and focuses Next', () => {
    const { host, calls } = mount();
    expect(document.activeElement).toBe(buttonByText(host, 'Next'));
    act(() => buttonByText(host, 'Next')!.click());
    act(() => buttonByText(host, 'Replay')!.click());
    act(() => buttonByText(host, 'Map')!.click());
    expect(calls).toEqual(['next', 'replay', 'map']);
  });

  it('has no Next on the last level; Map is primary and focused', () => {
    const { host } = mount({ last: true });
    expect(buttonByText(host, 'Next')).toBeNull();
    const map = buttonByText(host, 'Map')!;
    expect(map.classList.contains('is-primary')).toBe(true);
    expect(document.activeElement).toBe(map);
  });

  it('announces a newly unlocked tool', () => {
    expect(mount().host.textContent).not.toContain('New tool');
    expect(mount({ unlocked: 'perp-bisector' }).host.textContent).toContain(
      'New tool: Perpendicular Bisector',
    );
  });
});
