import { useEffect, useRef, useState } from 'preact/hooks';
import type { ObjDef, ObjId } from '../construction/types';
import { GameScreen, isTextEntry } from '../ui/GameScreen';
import { FitIcon } from '../ui/icons';
import type { Editor, EditorMode } from './editorStore';
import { EDITOR_PANEL_ID, ModeBar, modeTabId } from './ModeBar';
import { SetupCanvas } from './SetupCanvas';
import { dependants, type SetupModel, type SetupTool } from './setupGestures';
import { SETUP_TOOLS, SetupPalette } from './SetupPalette';
import { StepsPanel } from './StepsPanel';
import './editor.css';

/** "point A", "segment AB", "circle centred at A" — how a given reads in the delete prompt. */
function nameOf(def: ObjDef, id: ObjId, labels: SetupModel['labels']): string {
  const l = (x: ObjId): string => labels[x] ?? x;
  switch (def.type) {
    case 'given-point':
      return `point ${l(id)}`;
    case 'given-line':
      return `${def.extent} ${l(def.a)}${l(def.b)}`;
    case 'circle':
      return `circle centred at ${l(def.center)}`;
    case 'given-circle':
      return 'circle';
    default:
      return 'object';
  }
}

/** What the Setup canvas says while the figure is still being started (or in Delete). */
const TOOL_CUES: Record<SetupTool, string> = {
  point: 'Tap to place a point. Drag a point to move it.',
  segment: 'Drag from one point to another to draw a segment.',
  ray: 'Drag from the start point towards the second point to draw a ray.',
  line: 'Drag from one point to another to draw a line.',
  circle: 'Drag from the centre out to the radius.',
};

interface SetupState {
  tool: SetupTool;
  hideCentre: boolean;
  deleting: boolean;
}

function SetupMode({
  editor,
  state,
  onState,
}: {
  editor: Editor;
  state: SetupState;
  onState: (s: Partial<SetupState>) => void;
}) {
  const { tool, hideCentre, deleting } = state;
  const model = editor.setup.value;
  const [picked, setPicked] = useState<ObjId | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const pick = picked && model.givens.some((g) => g.id === picked) ? picked : null;
  const going = pick ? dependants(model, pick) : [];

  const setTool = (t: SetupTool): void => {
    setPicked(null);
    onState({ tool: t, deleting: false });
  };
  const setDeleting = (on: boolean): void => {
    setPicked(null);
    onState({ deleting: on });
  };
  const confirmDelete = (): void => {
    if (!pick) return;
    editor.applySetup({ type: 'delete', ids: [pick] });
    setPicked(null);
  };

  const live = useRef({ pick, deleting, confirmDelete, setTool, setDeleting });
  live.current = { pick, deleting, confirmDelete, setTool, setDeleting };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || isTextEntry(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const s = live.current;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redoSetup();
        else editor.undoSetup();
      } else if (mod && k === 'y' && !e.shiftKey) {
        e.preventDefault();
        editor.redoSetup();
      } else if (!mod && !e.shiftKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        s.setTool(SETUP_TOOLS[Number(e.key) - 1]!.id);
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (s.pick) s.confirmDelete();
        else s.setDeleting(true);
      } else if (e.key === 'Escape' && s.deleting) {
        if (s.pick) setPicked(null);
        else s.setDeleting(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const cue = deleting
    ? pick
      ? null
      : 'Tap a point, line or circle to delete it.'
    : model.givens.length < 2
      ? TOOL_CUES[tool]
      : null;

  const target = pick ? model.givens.find((g) => g.id === pick)! : null;

  return (
    <div class="setup-screen">
      <SetupPalette
        tool={tool}
        onTool={setTool}
        hideCentre={hideCentre}
        onHideCentre={(on) => onState({ hideCentre: on })}
        deleting={deleting}
        onDelete={setDeleting}
        canUndo={editor.canUndoSetup.value}
        canRedo={editor.canRedoSetup.value}
        onUndo={editor.undoSetup}
        onRedo={editor.redoSetup}
      />
      <main class="setup-stage">
        <SetupCanvas
          editor={editor}
          tool={tool}
          hideCentre={hideCentre}
          onPick={deleting ? setPicked : null}
          selected={pick ? [pick, ...going] : []}
          fitKey={fitKey}
        />
        {/* Announced politely; shown as a quiet caption over the canvas. */}
        <p class={cue ? 'stage-cue' : 'stage-cue is-empty'} role="status">
          {cue ?? ''}
        </p>
        {model.givens.length > 0 && (
          <button
            type="button"
            class="icon-btn stage-fit"
            aria-label="Fit figure to view"
            title="Fit figure to view"
            onClick={() => setFitKey((k) => k + 1)}
          >
            <FitIcon />
          </button>
        )}
        {target && (
          <div class="delete-confirm" role="group" aria-label="Delete">
            <p class="delete-text">
              Delete <strong>{nameOf(target.def, target.id, model.labels)}</strong>
              {going.length > 0 &&
                ` and ${going.length} ${going.length === 1 ? 'object that depends' : 'objects that depend'} on it`}
              ?
            </p>
            <div class="delete-actions">
              <button type="button" class="text-btn" onClick={() => setPicked(null)}>
                Cancel
              </button>
              <button type="button" class="danger-btn" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const PLACEHOLDER: Record<'details' | 'test', { title: string; text: string }> = {
  details: { title: 'Details', text: 'Title, goal, tools and par are set here.' },
  test: { title: 'Test', text: 'Play your problem here once it passes every check.' },
};

/** The problem editor: the mode bar over Setup, Solve (the game), Details or Test. */
export function EditorScreen({ editor }: { editor: Editor }) {
  const mode: EditorMode = editor.mode.value;
  const [setup, setSetup] = useState<SetupState>({
    tool: 'point',
    hideCentre: false,
    deleting: false,
  });

  return (
    <div class="editor" data-mode={mode}>
      <ModeBar editor={editor} />
      <div
        class="editor-body"
        id={EDITOR_PANEL_ID}
        role="tabpanel"
        aria-labelledby={modeTabId(mode)}
      >
        {mode === 'setup' && (
          <SetupMode
            editor={editor}
            state={setup}
            onState={(s) => setSetup((old) => ({ ...old, ...s }))}
          />
        )}
        {mode === 'solve' && editor.game.isSandbox.value && (
          <GameScreen
            store={editor.game}
            sidePanel={<StepsPanel editor={editor} />}
            marked={editor.targets.value}
          />
        )}
        {(mode === 'details' || mode === 'test') && (
          <section class="editor-placeholder">
            <h2>{PLACEHOLDER[mode].title}</h2>
            <p>{PLACEHOLDER[mode].text}</p>
          </section>
        )}
      </div>
    </div>
  );
}
