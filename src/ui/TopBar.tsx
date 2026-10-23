import type { Ref } from 'preact';
import type { Level } from '../levels/types';
import { BackIcon, HintIcon, MapIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

type Theme = 'light' | 'dark';
type Moves = { L: number; E: number };

interface Props {
  level: Pick<Level, 'number' | 'title' | 'goalText'>;
  moves: Moves;
  /** Par; absent (the editor's Solve) the counter shows the moves alone. */
  targets?: Moves;
  /** Absent: no Hint button (the editor's Solve). */
  onHint?: () => void;
  /** The hint panel is showing (the Hint button reflects it). */
  hintOpen?: boolean;
  /** Hints have nothing to say (the level is solved and the completion card shows). */
  hintDisabled?: boolean;
  /** Focus returns here when the hint panel closes. */
  hintRef?: Ref<HTMLButtonElement>;
  onMap: () => void;
  /** Custom levels: the Map button reads Back (and `onMap` leaves the level). */
  back?: boolean;
  /** Accessible name of the Back button (default `Back`). */
  backLabel?: string;
  theme: Theme | undefined;
  /** Absent: no theme toggle (the editor's mode bar has one). */
  onTheme?: (t: Theme) => void;
}

/** Level heading, goal, move counter and the top-level actions (map, hint, theme). */
export function TopBar(props: Props) {
  const { level, moves, targets, onHint, onMap, theme, onTheme } = props;
  const part = (k: 'L' | 'E') => (
    <span class={`counter-${k.toLowerCase()}${targets && moves[k] > targets[k] ? ' over' : ''}`}>
      {k} {moves[k]}
      {targets && `/${targets[k]}`}
    </span>
  );
  const backName = props.back ? (props.backLabel ?? 'Back') : 'Map';
  return (
    <header class="topbar">
      <button
        type="button"
        class="icon-btn topbar-map"
        aria-label={backName}
        title={backName}
        onClick={onMap}
      >
        {props.back ? <BackIcon /> : <MapIcon />}
      </button>
      <h1 class="topbar-title">
        {level.number !== undefined && (
          <>
            <span class="level-num">
              <span class="sr-only">Level </span>
              {level.number}
            </span>
            <span class="sr-only">: </span>
          </>
        )}
        {level.title}
      </h1>
      <p class="topbar-goal" title={level.goalText}>
        {level.goalText}
      </p>
      <p
        class="counter"
        aria-label={
          targets
            ? `Moves: lines ${moves.L} of ${targets.L}, elementary ${moves.E} of ${targets.E}`
            : `Moves: lines ${moves.L}, elementary ${moves.E}`
        }
      >
        {part('L')} · {part('E')}
      </p>
      <div class="topbar-actions">
        {onHint && (
          <button
            ref={props.hintRef}
            type="button"
            class={props.hintOpen ? 'icon-btn topbar-hint is-open' : 'icon-btn topbar-hint'}
            aria-label="Hint"
            aria-haspopup="dialog"
            aria-expanded={!!props.hintOpen}
            title="Hint"
            disabled={!!props.hintDisabled}
            onClick={onHint}
          >
            <HintIcon />
          </button>
        )}
        {onTheme && <ThemeToggle theme={theme} onChange={onTheme} />}
      </div>
    </header>
  );
}
