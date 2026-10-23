import { ArrowIcon } from '../ui/icons';
import type { Editor } from './editorStore';
import { ValidationList } from './ValidationList';
import './editor.css';

/** Test: play the problem as a player would; passing it marks the problem Tested. */
export function TestPanel({ editor }: { editor: Editor }) {
  const v = editor.validation.value;
  const tested = editor.tested.value;
  const n = v.ok ? 0 : v.errors.length;
  return (
    <div class="details-scroll">
      <div class="details-page">
        <h2 class="details-title">Test</h2>
        <section class="details-card test-card" aria-labelledby="t-play">
          <h3 id="t-play" class="card-title">
            Play it yourself
          </h3>
          {tested ? (
            <p class="tested-badge">Tested ✓</p>
          ) : (
            <p class="field-hint">
              Solve your problem the way a player will. Any change to it asks for a new test.
            </p>
          )}
          <button
            type="button"
            class="btn is-primary test-play"
            disabled={!v.ok}
            aria-describedby={v.ok ? undefined : 'test-reason'}
            onClick={() => editor.startTest()}
          >
            Play test
            <ArrowIcon />
          </button>
          {!v.ok && (
            <p id="test-reason" class="test-reason">
              Fix {n === 1 ? '1 problem' : `${n} problems`} below to play.
            </p>
          )}
        </section>
        <ValidationList editor={editor} />
      </div>
    </div>
  );
}
