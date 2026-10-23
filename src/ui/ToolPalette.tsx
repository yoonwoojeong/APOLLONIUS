import type { JSX } from 'preact';
import type { ToolId } from '../levels/types';
import {
  CircleIcon,
  LineIcon,
  PerpBisectorIcon,
  PointIcon,
  RedoIcon,
  ResetIcon,
  UndoIcon,
} from './icons';

const TOOLS: Record<ToolId, { name: string; Icon: () => JSX.Element }> = {
  point: { name: 'Point', Icon: PointIcon },
  line: { name: 'Line', Icon: LineIcon },
  circle: { name: 'Circle', Icon: CircleIcon },
  'perp-bisector': { name: 'Perpendicular bisector', Icon: PerpBisectorIcon },
};

interface Props {
  tools: ToolId[];
  active: ToolId;
  onSelect: (t: ToolId) => void;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}

/** Tool buttons (with 1–4 key hints) and the undo/redo/reset group. */
export function ToolPalette(p: Props) {
  return (
    <nav class="palette" aria-label="Tools">
      <div class="palette-group" role="group" aria-label="Construction tools">
        {p.tools.map((t, i) => {
          const { name, Icon } = TOOLS[t];
          return (
            <button
              key={t}
              type="button"
              class="tool-btn"
              aria-label={name}
              aria-pressed={t === p.active}
              aria-keyshortcuts={String(i + 1)}
              title={`${name} (${i + 1})`}
              onClick={() => p.onSelect(t)}
            >
              <Icon />
              <span class="key-hint" aria-hidden="true">
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      <div class="palette-group palette-history" role="group" aria-label="History">
        <button
          type="button"
          class="tool-btn"
          aria-label="Undo"
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
          title="Redo"
          disabled={!p.canRedo}
          onClick={p.onRedo}
        >
          <RedoIcon />
        </button>
        <button
          type="button"
          class="tool-btn"
          aria-label="Reset"
          title="Reset"
          disabled={!p.canReset}
          onClick={p.onReset}
        >
          <ResetIcon />
        </button>
      </div>
    </nav>
  );
}
