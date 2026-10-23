import { useEffect, useRef, useState } from 'preact/hooks';
import { describe } from '../construction/describe';
import type { ObjSpec, Scene, SceneObject } from '../construction/types';
import { LIMITS, NUDGE_FALLBACK } from '../problems/format';
import { StarIcon } from '../ui/icons';
import type { Editor } from './editorStore';
import './editor.css';

const NUDGE_MAX = LIMITS.nudgeMax;

/**
 * `describe()` of a step object. One the board does not have (a broken step) is described
 * from its def, with `?` for itself and for every object it refers to that the board lacks.
 */
function describeSpec(o: ObjSpec, scene: Scene): string {
  const live = scene.byId.get(o.id);
  if (live) return describe(live, scene);
  const byId = new Map(scene.byId);
  const d = o.def as Record<string, unknown>;
  for (const k of ['a', 'b', 'center', 'through', 'curve']) {
    const ref = Object.hasOwn(d, k) ? d[k] : undefined;
    if (typeof ref === 'string' && !byId.has(ref)) {
      byId.set(ref, { id: ref, def: o.def, value: null, given: false, label: '?' });
    }
  }
  const stub: SceneObject = { id: o.id, def: o.def, given: false, value: null, label: '?' };
  return describe(stub, { ...scene, byId });
}

const ChevronIcon = ({ up }: { up: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
  </svg>
);

/**
 * Solve's steps: one row per solution step with its objects (`describe()`), a ☆ per object
 * toggling it as a target, the step's hint, and a red Broken flag with Remove from here when
 * the step no longer fits the figure. A right-hand panel when wide; a bottom sheet on phones.
 */
export function StepsPanel({ editor }: { editor: Editor }) {
  void editor.game.revision.value; // the board's labels follow the construction
  const scene = editor.game.construction().scene();
  const steps = editor.solution.value;
  const broken = editor.broken.value;
  const targets = new Set(editor.targets.value);
  const [open, setOpen] = useState(true);

  // A new step scrolls into view.
  const list = useRef<HTMLOListElement>(null);
  const count = useRef(steps.length);
  useEffect(() => {
    const grew = steps.length > count.current;
    count.current = steps.length;
    if (grew) list.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  }, [steps.length]);

  const nTargets = targets.size;
  const meta =
    steps.length === 0
      ? 'No steps yet'
      : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${
          nTargets === 0 ? 'no target' : `${nTargets} ${nTargets === 1 ? 'target' : 'targets'}`
        }`;

  return (
    <section
      class={open ? 'steps-panel' : 'steps-panel is-collapsed'}
      aria-labelledby="steps-title"
    >
      <header class="steps-head">
        <h2 id="steps-title" class="steps-title">
          Steps
        </h2>
        <span class={nTargets === 0 && steps.length > 0 ? 'steps-meta needs-target' : 'steps-meta'}>
          {meta}
        </span>
        <button
          type="button"
          class="icon-btn steps-toggle"
          aria-expanded={open}
          aria-controls="steps-body"
          aria-label={open ? 'Hide steps' : 'Show steps'}
          onClick={() => setOpen(!open)}
        >
          <ChevronIcon up={!open} />
        </button>
      </header>
      <div class="steps-body" id="steps-body">
        {steps.length === 0 ? (
          <p class="steps-empty">
            Construct the solution with the tools. Each move you make becomes a step here.
          </p>
        ) : (
          <>
            {nTargets === 0 && (
              <p class="steps-note">
                Tap <StarIcon /> on the object players must construct to make it a target.
              </p>
            )}
            <ol class="steps-list" ref={list}>
              {steps.map((st, i) => {
                const isBroken = broken !== null && i >= broken;
                const countId = `step-count-${i}`;
                return (
                  <li key={i} class={isBroken ? 'step-row is-broken' : 'step-row'}>
                    <span class="step-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div class="step-main">
                      <ul class="step-objects">
                        {st.objects.map((o) => {
                          const text = describeSpec(o, scene);
                          const on = targets.has(o.id);
                          return (
                            <li key={o.id} class={on ? 'step-obj is-target' : 'step-obj'}>
                              <span class="step-desc">{text}</span>
                              <button
                                type="button"
                                class="star-btn"
                                aria-pressed={on}
                                aria-label={`Step ${i + 1} target: ${text}`}
                                title={on ? 'Target (tap to unmark)' : 'Mark as target'}
                                onClick={() => editor.toggleTarget(o.id)}
                              >
                                <StarIcon filled={on} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <div class="step-hint">
                        <input
                          type="text"
                          class="step-hint-input"
                          value={st.nudge}
                          maxLength={NUDGE_MAX}
                          // What players see for a step without its own hint.
                          placeholder={NUDGE_FALLBACK}
                          aria-label={`Hint for step ${i + 1}`}
                          aria-describedby={countId}
                          spellcheck
                          onInput={(e) => editor.setNudge(i, e.currentTarget.value)}
                        />
                        <span id={countId} class="step-count">
                          <span class="sr-only">Characters: </span>
                          {st.nudge.length}/{NUDGE_MAX}
                        </span>
                      </div>
                      {isBroken && (
                        <div class="step-broken">
                          <span class="broken-flag">Broken</span>
                          <span class="broken-why">
                            {i === broken
                              ? 'No longer fits the figure.'
                              : `Waits on step ${broken + 1}.`}
                          </span>
                          <button
                            type="button"
                            class="text-btn broken-remove"
                            onClick={() => editor.removeFrom(i)}
                          >
                            Remove from here
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
