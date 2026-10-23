import { useRef } from 'preact/hooks';
import { BackIcon, CheckIcon } from '../ui/icons';
import { ThemeToggle } from '../ui/ThemeToggle';
import type { Editor, EditorMode } from './editorStore';
import './editor.css';

const MODES: { id: EditorMode; name: string }[] = [
  { id: 'setup', name: 'Setup' },
  { id: 'solve', name: 'Solve' },
  { id: 'details', name: 'Details' },
  { id: 'test', name: 'Test' },
];

/** Id of a mode's tab (the editor body is labelled by the selected one). */
export const modeTabId = (m: EditorMode): string => `editor-tab-${m}`;
export const EDITOR_PANEL_ID = 'editor-panel';

/**
 * The editor's header: Back (saves and leaves), the Setup · Solve · Details · Test segmented
 * control (✓ on each finished part) and the theme toggle.
 */
export function ModeBar({ editor }: { editor: Editor }) {
  const mode = editor.mode.value;
  const done = editor.modeDone.value;
  const game = editor.game;
  const title = editor.details.value.title.trim();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys, Home and End move between the tabs (and switch to the focused one).
  const onKey = (e: KeyboardEvent): void => {
    const i = MODES.findIndex((m) => m.id === mode);
    const n = MODES.length;
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    editor.setMode(MODES[to]!.id);
    tabs.current[to]?.focus();
  };

  return (
    <header class="modebar">
      <div class="modebar-lead">
        <button
          type="button"
          class="icon-btn modebar-back"
          aria-label="Back to My problems"
          title="Back"
          onClick={() => editor.exit()}
        >
          <BackIcon />
        </button>
        <p class="modebar-title" title={title || 'Untitled problem'}>
          {title || 'Untitled problem'}
        </p>
      </div>
      <div class="mode-tabs" role="tablist" aria-label="Editor mode" onKeyDown={onKey}>
        {MODES.map((m, i) => {
          const selected = m.id === mode;
          return (
            <button
              key={m.id}
              ref={(el) => void (tabs.current[i] = el)}
              type="button"
              role="tab"
              id={modeTabId(m.id)}
              class="mode-tab"
              aria-selected={selected}
              aria-controls={EDITOR_PANEL_ID}
              aria-label={done[m.id] ? `${m.name}, done` : m.name}
              tabindex={selected ? 0 : -1}
              onClick={() => {
                if (!selected) editor.setMode(m.id);
              }}
            >
              <span class="mode-name">{m.name}</span>
              {done[m.id] && (
                <span class="mode-check" aria-hidden="true">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div class="modebar-end">
        {/* Always mounted, so a failure is announced. */}
        <span class="save-warn" role="status">
          {editor.saveFailed.value ? 'Not saved on this device' : ''}
        </span>
        <ThemeToggle theme={game.progress.value.theme} onChange={game.setTheme} />
      </div>
    </header>
  );
}
