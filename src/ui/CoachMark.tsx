import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Vec } from '../geometry/vec';
import type { Box } from './coachPlacement';

/** Matches `--t-ui`: the old caption fades out before the next one fades in. */
export const COACH_FADE_MS = 180;

interface Props {
  /** The current step's caption; null fades the mark out (the live region stays mounted). */
  text: string | null;
  /** Top-left corner (in the parent's coordinates) for a caption of the measured size. */
  place?: (box: Box) => Vec | null;
}

/**
 * A tutorial caption floating over the canvas. It is a `role="status"` live region that is
 * mounted empty and then updated in place, so every new step is announced. Pointer events
 * pass through it to the canvas.
 */
export function CoachMark({ text, place }: Props) {
  const [shown, setShown] = useState('');
  const [visible, setVisible] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ shown, visible });
  live.current = { shown, visible };

  useEffect(() => {
    if (text === null) {
      setVisible(false);
      return;
    }
    const { shown: now, visible: on } = live.current;
    if (text === now || !now || !on) {
      setShown(text);
      setVisible(true);
      return;
    }
    setVisible(false);
    const t = window.setTimeout(() => {
      setShown(text);
      setVisible(true);
    }, COACH_FADE_MS);
    return () => window.clearTimeout(t);
  }, [text]);

  // Measure the caption whenever its text changes; the parent places it by its size.
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    const next = { w: e.offsetWidth, h: e.offsetHeight };
    if (!box || box.w !== next.w || box.h !== next.h) setBox(next);
  }, [shown]);

  const at = box && place ? place(box) : null;
  return (
    <div
      ref={el}
      class={visible && shown ? 'coach is-visible' : 'coach'}
      role="status"
      aria-hidden={text === null ? 'true' : undefined}
      data-placed={at ? 'true' : undefined}
      style={at ? { left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` } : undefined}
    >
      {shown}
    </div>
  );
}
