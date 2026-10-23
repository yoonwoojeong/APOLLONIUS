import { useEffect, useId, useRef } from 'preact/hooks';
import type { ToolId } from '../levels/types';
import type { Stars } from '../reasoning/stars';
import { ArrowIcon, PerpBisectorIcon, STAR_PATH as STAR } from './icons';

interface Props {
  stars: Stars;
  explanation: string;
  /** Move targets, so each star can say what it stands for. */
  targets: { L: number; E: number };
  /** Set only when this completion newly unlocked a tool. */
  unlocked?: ToolId;
  /** Absent on the last level: Map becomes the primary action. */
  onNext?: () => void;
  onReplay: () => void;
  onMap: () => void;
}

const TOOL_TITLES: Record<ToolId, string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  'perp-bisector': 'Perpendicular Bisector',
};

/**
 * The completion card (§5.5): slides up after the gold draw-on, stars fill one by one,
 * then the "why it works" sentence and Next / Replay / Map. Focus lands on the primary action.
 */
export function CompletionCard(p: Props) {
  const headingId = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const earned = p.stars.filter(Boolean).length;
  const labels = [
    'Reached the goal',
    `Within ${p.targets.L} moves (L)`,
    `Within ${p.targets.E} moves (E)`,
  ];

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section class="completion" role="dialog" aria-labelledby={headingId}>
      <h2 id={headingId} class="completion-title">
        Solved
      </h2>
      <p class="sr-only">{earned} of 3 stars</p>
      <ul class="stars">
        {labels.map((label, i) => (
          <li key={i} class="star" data-earned={String(p.stars[i])} style={{ '--i': i }}>
            <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true">
              <path class="star-outline" d={STAR} />
              {p.stars[i] && <path class="star-fill" d={STAR} />}
            </svg>
            <span class="star-label">
              {label}
              <span class="sr-only">{p.stars[i] ? ': earned' : ': not earned'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p class="completion-why">{p.explanation}</p>
      {p.unlocked && (
        <p class="completion-unlock">
          {p.unlocked === 'perp-bisector' && <PerpBisectorIcon />}
          New tool: {TOOL_TITLES[p.unlocked]}
        </p>
      )}
      <div class="completion-actions">
        {p.onNext && (
          <button type="button" class="btn" onClick={p.onMap}>
            Map
          </button>
        )}
        <button type="button" class="btn" onClick={p.onReplay}>
          Replay
        </button>
        {p.onNext ? (
          <button ref={primary} type="button" class="btn is-primary" onClick={p.onNext}>
            Next
            <ArrowIcon />
          </button>
        ) : (
          <button ref={primary} type="button" class="btn is-primary" onClick={p.onMap}>
            Map
          </button>
        )}
      </div>
    </section>
  );
}
