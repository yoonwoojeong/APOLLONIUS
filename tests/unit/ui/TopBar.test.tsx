// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TopBar } from '../../../src/ui/TopBar';

const base = {
  moves: { L: 0, E: 0 },
  targets: { L: 4, E: 4 },
  onHint: vi.fn(),
  onMap: vi.fn(),
  theme: undefined,
  onTheme: vi.fn(),
};

describe('TopBar', () => {
  let host: HTMLElement | undefined;
  afterEach(() => {
    if (host) render(null, host);
    host?.remove();
  });
  const mount = (level: { number?: number; title: string; goalText: string }) => {
    host = document.createElement('div');
    document.body.append(host);
    render(<TopBar {...base} level={level} />, host);
    return host;
  };

  test('shows the level number when present', () => {
    const h = mount({ number: 3, title: 'Midpoint', goalText: 'g' });
    expect(h.querySelector('.level-num')?.textContent).toContain('3');
  });

  test('renders no number element for a level without number', () => {
    const h = mount({ title: 'Mine', goalText: 'g' });
    expect(h.querySelector('.level-num')).toBeNull();
    expect(h.querySelector('.topbar-title')?.textContent).toBe('Mine');
  });
});
