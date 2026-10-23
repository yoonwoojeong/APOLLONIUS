import { ArrowIcon } from './icons';
import './screens.css';

interface Props {
  hasProgress: boolean;
  onStart: () => void;
}

/** A shallow arc under the name: its centre lies far above, so it reads as a smile of a circle. */
const ARC = { w: 320, h: 26, x0: 8, x1: 312, y: 5, r: 760 };

/**
 * The quiet title screen (§3.1): the name, an underline that draws on as a construction arc,
 * and one action — Begin on first launch, Continue for a returning player.
 */
export function TitleScreen({ hasProgress, onStart }: Props) {
  return (
    <main class="title-screen">
      <div class="title-block">
        <h1 class="title-word">Apollonius</h1>
        <svg class="title-arc" viewBox={`0 0 ${ARC.w} ${ARC.h}`} aria-hidden="true">
          <path
            class="draw-in"
            d={`M${ARC.x0} ${ARC.y}A${ARC.r} ${ARC.r} 0 0 0 ${ARC.x1} ${ARC.y}`}
            pathLength={1}
          />
          <circle class="title-arc-end pop-in" cx={ARC.x0} cy={ARC.y} r={2.5} />
          <circle class="title-arc-end pop-in" cx={ARC.x1} cy={ARC.y} r={2.5} />
        </svg>
        <p class="title-sub">Compass &amp; straightedge puzzles</p>
        <button type="button" class="btn is-primary title-start" onClick={onStart}>
          {hasProgress ? 'Continue' : 'Begin'}
          <ArrowIcon />
        </button>
      </div>
    </main>
  );
}
