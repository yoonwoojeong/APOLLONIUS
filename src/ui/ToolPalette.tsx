import type { JSX } from 'preact';
import type { ToolId } from '../levels/types';
import {
  CircleIcon,
  CloseIcon,
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
  /** A newly available tool: its button scales in with a gold ring. */
  reveal?: ToolId | null;
  /** One-time inline tip shown next to `tipTool`; tapping it dismisses it. */
  tip?: string | null;
  tipTool?: ToolId | null;
  onTipDismiss?: () => void;
}

/** Tool buttons (with 1–4 key hints) and the undo/redo/reset group. */
export function ToolPalette(p: Props) {
  return (
    <nav class="palette" aria-label="Tools">
      <div class="palette-group" role="group" aria-label="Construction tools">
        {p.tools.map((t, i) => {
          const { name, Icon } = TOOLS[t];
          return (
            <div key={t} class={t === p.tipTool && p.tip ? 'tool-slot has-tip' : 'tool-slot'}>
              <button
                type="button"
                class={t === p.reveal ? 'tool-btn is-revealing' : 'tool-btn'}
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
              {t === p.tipTool && p.tip && (
                <div class="tool-tip" role="status" onClick={p.onTipDismiss}>
                  <span class="tool-tip-text">{p.tip}</span>
                  <button type="button" class="tool-tip-close" aria-label="Dismiss tip">
                    <CloseIcon />
                  </button>
                </div>
              )}
            </div>
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
