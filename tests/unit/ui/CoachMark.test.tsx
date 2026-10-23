// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COACH_FADE_MS, CoachMark } from '../../../src/ui/CoachMark';

let host: HTMLElement;
const mount = (
  text: string | null,
  place?: (b: { w: number; h: number }) => { x: number; y: number },
) => act(() => render(<CoachMark text={text} place={place} />, host));
const status = () => host.querySelector<HTMLElement>('[role="status"]')!;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('CoachMark', () => {
  it('renders the caption in a status live region', () => {
    mount('Drag from A to B to draw a circle.');
    expect(status().textContent).toBe('Drag from A to B to draw a circle.');
    expect(status().classList.contains('is-visible')).toBe(true);
  });

  it('fades the old caption out, then updates the same live region in place', () => {
    mount('Drag from A to B to draw a circle.');
    const region = status();
    mount('Now drag from B to A.');
    expect(status()).toBe(region);
    expect(region.classList.contains('is-visible')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(COACH_FADE_MS);
    });
    expect(status()).toBe(region);
    expect(region.textContent).toBe('Now drag from B to A.');
    expect(region.classList.contains('is-visible')).toBe(true);
  });

  it('a null caption hides the mark without removing the live region', () => {
    mount('Tap where the circles cross.');
    const region = status();
    mount(null);
    expect(status()).toBe(region);
    expect(region.classList.contains('is-visible')).toBe(false);
    expect(region.getAttribute('aria-hidden')).toBe('true');
  });

  it('positions itself where `place` puts a caption of its size', () => {
    const place = vi.fn(() => ({ x: 40, y: 12 }));
    mount('Now drag from B to A.', place);
    expect(place).toHaveBeenCalled();
    expect(status().style.left).toBe('40px');
    expect(status().style.top).toBe('12px');
  });
});
