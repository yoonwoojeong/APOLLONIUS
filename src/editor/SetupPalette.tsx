import type { JSX } from 'preact';
import {
  CircleIcon,
  FullLineIcon,
  HiddenCentreIcon,
  PointIcon,
  RayIcon,
  RedoIcon,
  SegmentIcon,
  TrashIcon,
  UndoIcon,
} from '../ui/icons';
import type { SetupTool } from './setupGestures';
import '../ui/game.css';
import './editor.css';

/** The Setup tools in key order (keys 1–5). */
export const SETUP_TOOLS: { id: SetupTool; name: string; Icon: () => JSX.Element }[] = [
  { id: 'point', name: 'Point', Icon: PointIcon },
  { id: 'segment', name: 'Segment', Icon: SegmentIcon },
  { id: 'ray', name: 'Ray', Icon: RayIcon },
  { id: 'line', name: 'Line', Icon: FullLineIcon },
  { id: 'circle', name: 'Circle', Icon: CircleIcon },
];

interface Props {
  tool: SetupTool;
  onTool: (t: SetupTool) => void;
  hideCentre: boolean;
  onHideCentre: (on: boolean) => void;
  /** Delete mode is on (tapping the canvas picks what to delete). */
  deleting: boolean;
  onDelete: (on: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Setup tools (Point, Segment, Ray, Line, Circle with its Hide centre option), Delete, and the
 * Setup undo/redo. Laid out like the game palette: a bottom bar on phones, a left rail when wide.
 */
export function SetupPalette(p: Props) {
  return (
    <nav class="palette setup-palette" aria-label="Setup tools">
      <div class="palette-group" role="group" aria-label="Figure tools">
        {SETUP_TOOLS.map(({ id, name, Icon }, i) => {
          const active = !p.deleting && id === p.tool;
          return (
            <div key={id} class="tool-slot">
              <button
                type="button"
                class="tool-btn"
                aria-label={name}
                aria-pressed={active}
                aria-keyshortcuts={String(i + 1)}
                title={`${name} (${i + 1})`}
                onClick={() => p.onTool(id)}
              >
                <Icon />
                <span class="key-hint" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
              {id === 'circle' && active && (
                <button
                  type="button"
                  class="tool-option"
                  aria-label="Hide centre"
                  aria-pressed={p.hideCentre}
                  title="Draw circles without a centre point"
                  onClick={() => p.onHideCentre(!p.hideCentre)}
                >
                  <HiddenCentreIcon />
                  <span aria-hidden="true">Hide centre</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div class="palette-group palette-history" role="group" aria-label="Edit">
        <button
          type="button"
          class="tool-btn tool-delete"
          aria-label="Delete"
          aria-pressed={p.deleting}
          aria-keyshortcuts="Delete"
          title="Delete"
          onClick={() => p.onDelete(!p.deleting)}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          class="tool-btn"
          aria-label="Undo"
          aria-keyshortcuts="Control+Z"
          title="Undo"
          disabled={!p.canUndo}
          onClick={p.onUndo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          class="tool-btn"
          aria-label="Redo"
          aria-keyshortcuts="Control+Shift+Z"
          title="Redo"
          disabled={!p.canRedo}
          onClick={p.onRedo}
        >
          <RedoIcon />
        </button>
      </div>
    </nav>
  );
}
