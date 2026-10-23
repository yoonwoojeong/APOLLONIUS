import { MoonIcon, SunIcon } from './icons';

type Theme = 'light' | 'dark';

interface Props {
  theme: Theme | undefined;
  onChange: (t: Theme) => void;
}

function effectiveTheme(theme: Theme | undefined): Theme {
  if (theme) return theme;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function ThemeToggle({ theme, onChange }: Props) {
  const current = effectiveTheme(theme);
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      class="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={() => onChange(next)}
    >
      {current === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
