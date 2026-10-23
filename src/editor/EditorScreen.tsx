import { useEffect, useRef, useState } from 'preact/hooks';
import type { ObjDef, ObjId } from '../construction/types';
import { GameScreen, isTextEntry } from '../ui/GameScreen';
import { FitIcon } from '../ui/icons';
import type { Editor, EditorMode } from './editorStore';
import { EDITOR_PANEL_ID, ModeBar, modeTabId } from './ModeBar';
import { SetupCanvas } from './SetupCanvas';
import { dependants, LABEL_RE, type SetupModel, type SetupTool } from './setupGestures';
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

/** How many working solution steps use any of `gone` (directly or through an earlier step). */
function stepsBreaking(editor: Editor, gone: ObjId[]): number {
  const lost = new Set(gone);
  const steps = editor.solution.peek();
  const working = editor.broken.peek() ?? steps.length;
  let n = 0;
  for (const st of steps.slice(0, working)) {
    const uses = st.objects.some((o) => {
      const d = o.def as Record<string, unknown>;
      return ['a', 'b', 'center', 'through', 'curve'].some(
        (k) => Object.hasOwn(d, k) && lost.has(d[k] as ObjId),
      );
    });
    if (!uses) continue;
    n++;
    for (const o of st.objects) lost.add(o.id);
  }
  return n;
}

/** The inline label editor pinned to a point: Enter commits, Esc cancels. */
function LabelEditor(p: {
  initial: string;
  /** Applies the label; returns an error message instead when it is not allowed. */
  onCommit: (label: string) => string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(p.initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Closed by Enter or Esc: a blur on the way out must not commit again. */
  const closed = useRef(false);
  const close = (): void => {
    closed.current = true;
    p.onClose();
  };
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  const commit = (): void => {
    const err = p.onCommit(value.trim());
    setError(err);
    if (!err) close();
  };
  return (
    <div class="label-edit">
      <input
        ref={input}
        type="text"
        class="label-edit-input"
        value={value}
        maxLength={3}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        aria-label="Point label"
        aria-invalid={!!error}
        aria-describedby={error ? 'label-edit-error' : undefined}
        onInput={(e) => {
          setValue(e.currentTarget.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        // Leaving the field keeps a valid label and drops anything else.
        onBlur={() => {
          if (closed.current) return;
          p.onCommit(value.trim());
          close();
        }}
      />
      {error && (
        <p id="label-edit-error" class="label-edit-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

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
  const [chosen, setChosen] = useState<ObjId | null>(null);
  const [editing, setEditing] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const exists = (id: ObjId | null): id is ObjId => !!id && model.givens.some((g) => g.id === id);
  const pick = exists(picked) ? picked : null;
  const going = pick ? dependants(model, pick) : [];
  // The selected point (Point tool): highlighted; tapping it again edits its label.
  const sel = !deleting && tool === 'point' && exists(chosen) ? chosen : null;
  const breaking = pick ? stepsBreaking(editor, [pick, ...going]) : 0;

  const select = (id: ObjId | null, edit = false): void => {
    setChosen(id);
    setEditing(!!id && edit);
  };
  const setTool = (t: SetupTool): void => {
    setPicked(null);
    select(null);
    onState({ tool: t, deleting: false });
  };
  const setDeleting = (on: boolean): void => {
    setPicked(null);
    select(null);
    onState({ deleting: on });
  };
  const confirmDelete = (): void => {
    if (!pick) return;
    editor.applySetup({ type: 'delete', ids: [pick] });
    setPicked(null);
  };
  const relabel = (id: ObjId, label: string): string | null => {
    const labels = editor.setup.peek().labels;
    if (label === labels[id]) return null;
    if (!LABEL_RE.test(label)) return 'Use 1–3 letters or digits.';
    if (Object.entries(labels).some(([k, l]) => k !== id && l === label))
      return `${label} is already used.`;
    editor.applySetup({ type: 'relabel', id, label });
    return null;
  };

  const live = useRef({ pick, sel, deleting, confirmDelete, setTool, setDeleting, select });
  live.current = { pick, sel, deleting, confirmDelete, setTool, setDeleting, select };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || isTextEntry(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const s = live.current;
      // Delete and Backspace belong to the figure: only from the canvas (or nothing focused).
      const onFigure =
        e.target === document.body ||
        (e.target instanceof Element && !!e.target.closest('[data-testid="setup-canvas"]'));
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
      } else if (!mod && onFigure && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (s.pick) s.confirmDelete();
        else s.setDeleting(true);
      } else if (e.key === 'Escape') {
        if (s.deleting) {
          if (s.pick) setPicked(null);
          else s.setDeleting(false);
        } else if (s.sel) s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  // The delete card takes focus (its Delete button) when it appears.
  const deleteBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pick) deleteBtn.current?.focus({ preventScroll: true });
  }, [pick]);

  const cue = deleting
    ? pick
      ? null
      : 'Tap a point, line or circle to delete it.'
    : sel && !editing
      ? `Tap ${model.labels[sel] ?? 'the point'} again to rename it.`
      : model.givens.length < 2
        ? TOOL_CUES[tool]
        : null;

  const target = pick ? model.givens.find((g) => g.id === pick)! : null;
  const prompt = target
    ? {
        name: nameOf(target.def, target.id, model.labels),
        rest:
          going.length > 0
            ? ` and ${going.length} ${going.length === 1 ? 'object that depends' : 'objects that depend'} on it`
            : '',
        breaks:
          breaking > 0
            ? `${breaking} solution ${breaking === 1 ? 'step' : 'steps'} will break.`
            : '',
      }
    : null;

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
          selected={pick ? [pick, ...going] : sel ? [sel] : []}
          fitKey={fitKey}
          onTap={(id) => select(id, !!id && id === sel)}
          onPointKey={(id, key) => select(id, key === 'F2' || id === sel)}
          overlay={
            sel && editing
              ? {
                  id: sel,
                  content: (
                    <LabelEditor
                      key={sel}
                      initial={model.labels[sel] ?? ''}
                      onCommit={(label) => relabel(sel, label)}
                      onClose={() => setEditing(false)}
                    />
                  ),
                }
              : null
          }
        />
        {/* Announced politely; shown as a quiet caption over the canvas. */}
        <p class={cue ? 'stage-cue' : 'stage-cue is-empty'} role="status">
          {cue ?? ''}
        </p>
        {/* The delete prompt, announced when it appears. */}
        <p class="sr-only" role="status">
          {prompt ? `Delete ${prompt.name}${prompt.rest}? ${prompt.breaks}` : ''}
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
        {prompt && (
          <div class="delete-confirm" role="group" aria-label="Confirm delete">
            <p class="delete-text">
              Delete <strong>{prompt.name}</strong>
              {prompt.rest}?{prompt.breaks && <span class="delete-breaks"> {prompt.breaks}</span>}
            </p>
            <div class="delete-actions">
              <button type="button" class="text-btn" onClick={() => setPicked(null)}>
                Cancel
              </button>
              <button ref={deleteBtn} type="button" class="danger-btn" onClick={confirmDelete}>
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
