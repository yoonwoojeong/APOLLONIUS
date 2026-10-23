import { LIMITS } from '../problems/format';
import { CircleIcon, LineIcon, PerpBisectorIcon, PointIcon } from '../ui/icons';
import type { Editor } from './editorStore';
import { ValidationList } from './ValidationList';
import './editor.css';

const PAR_MAX = 99;

/** Single-line text: a pasted line break or tab becomes a space (the format forbids them). */
const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, ' ');
/** Enter would add a line break to a single-line field: ignore it (no caret jump). */
const noEnter = (e: KeyboardEvent): void => {
  if (e.key === 'Enter') e.preventDefault();
};

function TextField(p: {
  field: 'title' | 'goalText' | 'explain' | 'author';
  label: string;
  max: number;
  value: string;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const id = `details-${p.field}`;
  const countId = `${id}-count`;
  const hintId = `${id}-hint`;
  const shared = {
    id,
    class: 'field-input',
    value: p.value,
    maxLength: p.max,
    placeholder: p.placeholder,
    autocomplete: 'off',
    spellcheck: true,
    'aria-label': p.label,
    'aria-describedby': p.hint ? `${hintId} ${countId}` : countId,
  };
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {p.label}
      </label>
      <div class="field-box">
        {p.multiline ? (
          <textarea
            {...shared}
            class="field-input is-multi"
            rows={3}
            onKeyDown={noEnter}
            onInput={(e) => p.onChange(oneLine(e.currentTarget.value))}
          />
        ) : (
          <input
            {...shared}
            type="text"
            onInput={(e) => p.onChange(oneLine(e.currentTarget.value))}
          />
        )}
        <span id={countId} class={p.value.length >= p.max ? 'field-count is-full' : 'field-count'}>
          <span class="sr-only">Characters: </span>
          {p.value.length}/{p.max}
        </span>
      </div>
      {p.hint && (
        <p id={hintId} class="field-hint">
          {p.hint}
        </p>
      )}
    </div>
  );
}

function ToolSwitch(p: {
  id?: string;
  name: string;
  icon: preact.ComponentChild;
  on: boolean;
  locked?: boolean;
  note?: string;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      id={p.id}
      role="switch"
      aria-checked={p.on}
      aria-label={p.name}
      disabled={p.locked}
      class="tool-switch"
      onClick={p.onToggle}
    >
      <span class="tool-switch-icon" aria-hidden="true">
        {p.icon}
      </span>
      <span class="tool-switch-name">{p.name}</span>
      {p.note && <span class="tool-switch-note">{p.note}</span>}
      <span class="switch-track" aria-hidden="true">
        <span class="switch-thumb" />
      </span>
    </button>
  );
}

function Stepper(p: {
  id: string;
  axis: 'L' | 'E';
  name: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <div class="stepper" role="group" aria-label={`Par ${p.axis}: ${p.name}`}>
      <span class="stepper-name">
        <span class="stepper-axis" aria-hidden="true">
          {p.axis}
        </span>
        {p.name}
      </span>
      <button
        type="button"
        class="step-btn"
        aria-label={`Decrease par ${p.axis}`}
        disabled={p.value <= p.min}
        onClick={() => p.onChange(Math.max(p.min, p.value - 1))}
      >
        −
      </button>
      <output id={p.id} class="stepper-value" tabindex={-1} aria-live="polite">
        {p.value}
      </output>
      <button
        type="button"
        class="step-btn"
        aria-label={`Increase par ${p.axis}`}
        disabled={p.value >= PAR_MAX}
        onClick={() => p.onChange(Math.min(PAR_MAX, p.value + 1))}
      >
        +
      </button>
    </div>
  );
}

/** Details: the problem's text, which tools players get, par, and the checks. */
export function DetailsPanel({ editor }: { editor: Editor }) {
  const d = editor.details.value;
  const m = editor.moves.value;
  // The store's own clamp: what the problem will actually carry.
  const par = editor.problem.value.par!;
  const set = (patch: Parameters<Editor['setDetails']>[0]): void => editor.setDetails(patch);

  return (
    <div class="details-scroll">
      <div class="details-page">
        <h2 class="details-title">Details</h2>

        <section class="details-card" aria-labelledby="d-text">
          <h3 id="d-text" class="card-title">
            Text
          </h3>
          <TextField
            field="title"
            label="Title"
            max={LIMITS.titleMax}
            value={d.title}
            onChange={(v) => set({ title: v })}
          />
          <TextField
            field="goalText"
            label="Goal sentence"
            max={LIMITS.goalTextMax}
            value={d.goalText}
            hint="Shown above the board, e.g. “Construct the perpendicular bisector of AB.”"
            onChange={(v) => set({ goalText: v })}
          />
          <TextField
            field="explain"
            label="Explanation"
            max={LIMITS.explainMax}
            value={d.explain}
            multiline
            hint="Optional. Shown after a player solves it."
            onChange={(v) => set({ explain: v })}
          />
          <TextField
            field="author"
            label="Author"
            max={LIMITS.authorMax}
            value={d.author}
            hint="Optional."
            onChange={(v) => set({ author: v })}
          />
        </section>

        <section class="details-card" aria-labelledby="d-tools">
          <h3 id="d-tools" class="card-title">
            Tools
          </h3>
          <div class="tool-switches">
            <ToolSwitch name="Point" icon={<PointIcon />} on locked note="Always on" />
            <ToolSwitch name="Line" icon={<LineIcon />} on locked note="Always on" />
            <ToolSwitch name="Circle" icon={<CircleIcon />} on locked note="Always on" />
            <ToolSwitch
              id="details-perp"
              name="Perpendicular bisector"
              icon={<PerpBisectorIcon />}
              on={d.perpBisector}
              onToggle={() => set({ perpBisector: !d.perpBisector })}
            />
          </div>
        </section>

        <section class="details-card" aria-labelledby="d-par">
          <div class="card-head">
            <h3 id="d-par" class="card-title">
              Par
            </h3>
            <span class="par-summary">{`L ${par.L} · E ${par.E}`}</span>
          </div>
          <p class="field-hint">
            The moves a player needs for three stars. It starts at your solution and can only go up.
          </p>
          <Stepper
            id="details-par-L"
            axis="L"
            name="Lines and circles"
            value={par.L}
            min={m.L}
            onChange={(L) => set({ par: { L } })}
          />
          <Stepper
            id="details-par-E"
            axis="E"
            name="Elementary moves"
            value={par.E}
            min={m.E}
            onChange={(E) => set({ par: { E } })}
          />
          {(d.par.L !== null || d.par.E !== null) && (
            <button
              type="button"
              class="text-btn par-reset"
              onClick={() => set({ par: { L: null, E: null } })}
            >
              Match my solution
            </button>
          )}
        </section>

        <ValidationList editor={editor} />
      </div>
    </div>
  );
}
