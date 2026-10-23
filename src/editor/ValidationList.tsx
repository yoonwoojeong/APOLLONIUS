import type { ValidationError } from '../problems/validate';
import { CheckIcon, CloseIcon } from '../ui/icons';
import type { Editor, EditorMode } from './editorStore';
import { modeTabId } from './ModeBar';
import './editor.css';

/** The mode an error concerns: `givens` → Setup, `solution`/`targets` → Solve, the rest → Details. */
export function modeOfPath(path: string): EditorMode {
  const head = /^[A-Za-z]+/.exec(path)?.[0] ?? '';
  if (head === 'givens' || head === 'labels') return 'setup';
  if (head === 'solution' || head === 'targets') return 'solve';
  return 'details';
}

/** The control a validation error path belongs to (title, goalText, explain, author, tools, par). */
export function detailsFieldId(path: string): string | null {
  const head = /^[A-Za-z]+/.exec(path)?.[0] ?? '';
  switch (head) {
    case 'title':
    case 'goalText':
    case 'explain':
    case 'author':
      return `details-${head}`;
    case 'tools':
      return 'details-perp';
    case 'par':
      return path.endsWith('.E') ? 'details-par-E' : 'details-par-L';
    default:
      return null;
  }
}

/** Moves focus once the mode has rendered: the field in Details, else the mode's tab. */
function focusFor(mode: EditorMode, path: string): void {
  const go = (): void => {
    const id = mode === 'details' ? detailsFieldId(path) : null;
    const el =
      (id && document.getElementById(id)) || document.getElementById(modeTabId(mode)) || null;
    el?.focus({ preventScroll: false });
  };
  // The mode switch renders on the next frame; Details fields may already be there.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  else setTimeout(go, 0);
}

/**
 * Every validation error as a row (✗ and the message; tapping it jumps to the mode it
 * concerns), or a ✓ Ready to test row. A polite live region announces the summary.
 */
export function ValidationList({ editor }: { editor: Editor }) {
  const v = editor.validation.value;
  const errors: ValidationError[] = v.ok ? [] : v.errors;
  const summary = v.ok
    ? 'Ready to test'
    : `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix`;

  const go = (e: ValidationError): void => {
    const mode = modeOfPath(e.path);
    if (editor.mode.peek() !== mode) editor.setMode(mode);
    focusFor(mode, e.path);
  };

  return (
    <section class="checks" aria-labelledby="checks-title">
      <h3 id="checks-title" class="checks-title">
        Checks
      </h3>
      <p class="sr-only" role="status" aria-live="polite">
        {summary}
      </p>
      {v.ok ? (
        <p class="check-row is-ok">
          <span class="check-mark" aria-hidden="true">
            <CheckIcon />
          </span>
          <span class="check-text">Ready to test</span>
        </p>
      ) : (
        <ul class="check-list">
          {errors.map((e, i) => (
            <li key={`${e.path}:${i}`}>
              <button type="button" class="check-row is-error" onClick={() => go(e)}>
                <span class="check-mark" aria-hidden="true">
                  <CloseIcon />
                </span>
                <span class="check-text">{e.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
