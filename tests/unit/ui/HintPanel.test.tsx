// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Hint } from '../../../src/reasoning/hints';
import { HintPanel } from '../../../src/ui/HintPanel';

const hint: Hint = {
  stepIndex: 0,
  nudge: 'Which points are exactly AB away from A?',
  inputIds: ['A', 'B'],
  ghost: [{ kind: 'circle', c: { x: 0, y: 0 }, r: 1 }],
};

function mount(tier: 1 | 2 | 3, on: { more?: () => void; close?: () => void } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <HintPanel
        hint={hint}
        tier={tier}
        onMore={on.more ?? (() => {})}
        onClose={on.close ?? (() => {})}
      />,
      host,
    ),
  );
  return host;
}

const buttonByText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;

afterEach(() => {
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
});

describe('HintPanel', () => {
  it('tier 1 shows the exact nudge and "More help" in a labelled dialog', () => {
    const host = mount(1);
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Hint');
    expect(host.querySelector('.hint-nudge')!.textContent).toBe(
      'Which points are exactly AB away from A?',
    );
    expect(buttonByText(host, 'More help')).not.toBeNull();
    expect(host.textContent).not.toContain('Show me where');
  });

  it('tier 2 adds "Show me where"', () => {
    const host = mount(2);
    expect(host.textContent).toContain('Show me where');
    expect(host.textContent).not.toContain('Show the next step');
    expect(buttonByText(host, 'More help')).not.toBeNull();
  });

  it('tier 3 shows "Show the next step" and hides "More help"', () => {
    const host = mount(3);
    expect(host.textContent).toContain('Show the next step');
    expect(buttonByText(host, 'More help')).toBeNull();
  });

  it('"More help" calls onMore; the close button and Esc call onClose', () => {
    let more = 0;
    let close = 0;
    const host = mount(1, { more: () => more++, close: () => close++ });
    act(() => buttonByText(host, 'More help')!.click());
    expect(more).toBe(1);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close hint"]')!.click());
    expect(close).toBe(1);
    act(() => {
      host
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(close).toBe(2);
  });

  it('moves focus into the panel when it opens', () => {
    const host = mount(1);
    expect(host.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });
});
