import { useEffect, useRef } from 'preact/hooks';
import type { Hint } from '../reasoning/hints';
import { CloseIcon, HintIcon } from './icons';

interface Props {
  hint: Hint;
  tier: 1 | 2 | 3;
  onMore: () => void;
  onClose: () => void;
}

/**
 * Non-modal hint popover (§7.3): tier 1 nudges in words, tier 2 makes the canvas glow the
 * step's inputs, tier 3 draws the step as a dashed gold ghost. Focus moves in on open.
 */
export function HintPanel({ hint, tier, onMore, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  // "More help" disappears at tier 3: keep focus in the panel rather than on the page.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus({ preventScroll: true });
  }, [tier]);

  return (
    <div
      ref={ref}
      class="hint-panel"
      role="dialog"
      aria-label="Hint"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div class="hint-head">
        <span class="hint-eyebrow">
          <HintIcon />
          Hint
        </span>
        <span class="hint-steps" aria-label={`Level ${tier} of 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} class={n <= tier ? 'hint-step is-on' : 'hint-step'} />
          ))}
        </span>
        <button type="button" class="icon-btn hint-close" aria-label="Close hint" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p class="hint-nudge">{hint.nudge}</p>
      <div class="hint-tiers" aria-live="polite">
        {tier >= 2 && (
          <p class="hint-tier">
            <span class="hint-swatch is-where" aria-hidden="true" />
            <span>
              <strong>Show me where</strong>
              <span class="hint-caption">The objects to use are glowing.</span>
            </span>
          </p>
        )}
        {tier >= 3 && (
          <p class="hint-tier">
            <span class="hint-swatch is-step" aria-hidden="true" />
            <span>
              <strong>Show the next step</strong>
              <span class="hint-caption">Trace the dashed gold preview.</span>
            </span>
          </p>
        )}
      </div>
      {tier < 3 && (
        <button type="button" class="hint-more" onClick={onMore}>
          More help
        </button>
      )}
    </div>
  );
}
