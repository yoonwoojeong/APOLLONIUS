// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../../../src/ui/ThemeToggle';

function mount(theme: 'light' | 'dark' | undefined, onChange: (t: 'light' | 'dark') => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(<ThemeToggle theme={theme} onChange={onChange} />, host);
  return host.querySelector('button')!;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('from light, labels "Switch to dark theme" and calls onChange("dark")', () => {
    const onChange = vi.fn();
    const btn = mount('light', onChange);
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark theme');
    btn.click();
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('from dark, labels "Switch to light theme" and calls onChange("light")', () => {
    const onChange = vi.fn();
    const btn = mount('dark', onChange);
    expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
    btn.click();
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('with no stored theme, follows the system preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(mount(undefined, () => {}).getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('with no stored theme and no matchMedia, treats the theme as light', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(mount(undefined, () => {}).getAttribute('aria-label')).toBe('Switch to dark theme');
  });
});
