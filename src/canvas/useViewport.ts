import { useEffect, useRef, useState, type MutableRef } from 'preact/hooks';
import type { Vec } from '../geometry/vec';
import { fit, panBy, zoomAt, type Rect, type Viewport } from './viewport';

const PADDING = 24;
const FIT_MS = 200;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface ViewportControl {
  hostRef: MutableRef<HTMLDivElement | null>;
  size: { width: number; height: number } | null;
  vp: Viewport | null;
  /** The latest viewport, for event handlers. */
  vpRef: MutableRef<Viewport | null>;
  fitScale: number;
  /** True once the player has panned or zoomed since the last fit. */
  movedRef: MutableRef<boolean>;
  /** Player pan by `delta` then zoom by `factor` about `at` (screen px); keeps their view after. */
  move: (delta: Vec, at: Vec, factor: number) => void;
  /** Ease back to the fitted view and resume refitting on resize. */
  refit: () => void;
}

/**
 * Owns the canvas viewport: fills the host element, fits `bounds` on mount, on `resetKey`
 * change and on resize until the player zooms or pans, then keeps their view. Wheel zooms at
 * the cursor on `svgRef` (non-passive so the page does not scroll).
 */
export function useViewport(
  bounds: Rect,
  resetKey: unknown,
  svgRef: MutableRef<SVGSVGElement | null>,
): ViewportControl {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [vp, setVpState] = useState<Viewport | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  const userMoved = useRef(false);
  const fitAnim = useRef(0);
  const live = useRef({ bounds, size });
  live.current = { bounds, size };

  const fitted = (s: { width: number; height: number }): Viewport =>
    fit(live.current.bounds, s.width, s.height, PADDING);
  const fitScale = size ? fitted(size).scale : 1;

  const setVp = (v: Viewport): void => {
    vpRef.current = v;
    setVpState(v);
  };

  const move = (delta: Vec, at: Vec, factor: number): void => {
    const v = vpRef.current;
    const s = live.current.size;
    if (!v || !s) return;
    // zoomAt does not guard its factor: drop NaN, infinite and non-positive values.
    const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
    const fs = fitted(s).scale;
    cancelAnimationFrame(fitAnim.current);
    userMoved.current = true;
    setVp(zoomAt(panBy(v, delta), at, f, { min: MIN_ZOOM * fs, max: MAX_ZOOM * fs }));
  };

  const refit = (): void => {
    const s = live.current.size;
    const from = vpRef.current;
    if (!s || !from) return;
    const to = fitted(s);
    userMoved.current = false;
    cancelAnimationFrame(fitAnim.current);
    if (reducedMotion()) return setVp(to);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / FIT_MS);
      const e = 1 - (1 - k) ** 3;
      setVp({
        ...to,
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        scale: from.scale * (to.scale / from.scale) ** e,
      });
      if (k < 1) fitAnim.current = requestAnimationFrame(step);
    };
    fitAnim.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ width: r.width, height: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(fitAnim.current);
    };
  }, []);

  useEffect(() => {
    if (!size) return;
    const cur = vpRef.current;
    if (!userMoved.current || !cur) setVp(fitted(size));
    else setVp({ ...cur, width: size.width, height: size.height });
  }, [size?.width, size?.height]);

  useEffect(() => {
    userMoved.current = false;
    cancelAnimationFrame(fitAnim.current);
    const s = live.current.size;
    if (s) setVp(fitted(s));
  }, [resetKey]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // ctrlKey marks a trackpad pinch, whose deltas are much smaller.
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      const r = svg.getBoundingClientRect();
      move(
        { x: 0, y: 0 },
        { x: e.clientX - r.left, y: e.clientY - r.top },
        Math.min(2, Math.max(0.5, factor)),
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  return { hostRef, size, vp, vpRef, fitScale, movedRef: userMoved, move, refit };
}
