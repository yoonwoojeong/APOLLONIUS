import type { Ref } from 'preact';
import type { Level } from '../levels/types';
import { HintIcon, MapIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

type Theme = 'light' | 'dark';
type Moves = { L: number; E: number };

interface Props {
  level: Pick<Level, 'number' | 'title' | 'goalText'>;
  moves: Moves;
  targets: Moves;
  onHint: () => void;
  /** The hint panel is showing (the Hint button reflects it). */
  hintOpen?: boolean;
  /** Focus returns here when the hint panel closes. */
  hintRef?: Ref<HTMLButtonElement>;
  onMap: () => void;
  theme: Theme | undefined;
  onTheme: (t: Theme) => void;
}

/** Level heading, goal, move counter and the top-level actions (map, hint, theme). */
export function TopBar(props: Props) {
  const { level, moves, targets, onHint, onMap, theme, onTheme } = props;
  const part = (k: 'L' | 'E') => (
    <span class={`counter-${k.toLowerCase()}${moves[k] > targets[k] ? ' over' : ''}`}>
      {k} {moves[k]}/{targets[k]}
    </span>
  );
  return (
    <header class="topbar">
      <button
        type="button"
        class="icon-btn topbar-map"
        aria-label="Map"
        title="Map"
        onClick={onMap}
      >
        <MapIcon />
      </button>
      <h1 class="topbar-title">
        <span class="level-num">
          <span class="sr-only">Level </span>
          {level.number}
        </span>
        <span class="sr-only">: </span>
        {level.title}
      </h1>
      <p class="topbar-goal" title={level.goalText}>
        {level.goalText}
      </p>
      <p
        class="counter"
        aria-label={`Moves: lines ${moves.L} of ${targets.L}, elementary ${moves.E} of ${targets.E}`}
      >
        {part('L')} · {part('E')}
      </p>
      <div class="topbar-actions">
        <button
          ref={props.hintRef}
          type="button"
          class={props.hintOpen ? 'icon-btn topbar-hint is-open' : 'icon-btn topbar-hint'}
          aria-label="Hint"
          aria-haspopup="dialog"
          aria-expanded={!!props.hintOpen}
          title="Hint"
          onClick={onHint}
        >
          <HintIcon />
        </button>
        <ThemeToggle theme={theme} onChange={onTheme} />
      </div>
    </header>
  );
}
