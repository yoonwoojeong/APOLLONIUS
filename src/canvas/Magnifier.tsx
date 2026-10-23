import type { Vec } from '../geometry/vec';
import { LOUPE_SIZE, LOUPE_ZOOM, magnifierPlacement } from './shapes';

interface Props {
  /** Touch point in canvas pixels; the loupe is hidden when null. */
  point: Vec | null;
  size: { width: number; height: number };
  /** Id of the element to mirror (the canvas scene group). */
  sceneId?: string;
}

/** Touch loupe: a 2× view of the scene, ghost and snap around the finger, offset above it. */
export function Magnifier({ point, size, sceneId = 'scene-root' }: Props) {
  if (!point) return null;
  const at = magnifierPlacement(point, size);
  const h = LOUPE_SIZE / 2;
  return (
    <div
      class="magnifier"
      data-testid="magnifier"
      aria-hidden="true"
      style={{ left: `${at.x - h}px`, top: `${at.y - h}px` }}
    >
      <svg width={LOUPE_SIZE} height={LOUPE_SIZE} viewBox={`0 0 ${LOUPE_SIZE} ${LOUPE_SIZE}`}>
        <use
          href={`#${sceneId}`}
          transform={`translate(${h} ${h}) scale(${LOUPE_ZOOM}) translate(${-point.x} ${-point.y})`}
        />
        <path class="reticle" d={`M ${h - 6} ${h} H ${h + 6} M ${h} ${h - 6} V ${h + 6}`} />
      </svg>
    </div>
  );
}
