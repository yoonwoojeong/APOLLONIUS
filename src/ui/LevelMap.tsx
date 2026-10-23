import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Level, LevelId } from '../levels/types';
import type { Progress } from '../state/persistence';
import { STAR_PATH } from './icons';
import './screens.css';

interface Props {
  levels: Level[];
  progress: Progress;
  isUnlocked: (id: LevelId) => boolean;
  /** The level Continue would open; its node is subtly emphasised and the inked arc ends there. */
  current: LevelId;
  onOpen: (id: LevelId) => void;
}

type Vec = { x: number; y: number };

/**
 * One circular arc in its own viewBox. Angles run from the bulge direction `d`, positive
 * towards `t`, so the arc sweeps clockwise on screen from the first node to the last.
 */
interface Arc {
  w: number;
  h: number;
  c: Vec;
  r: number;
  d: Vec;
  t: Vec;
  /** Half the angle spanned by the nodes. */
  spread: number;
  /** Half the angle of the drawn arc: it overshoots the end nodes like a construction line. */
  reach: number;
}

/** Wide screens: a gentle arc bulging upwards across the page. */
const WIDE: Arc = {
  w: 1000,
  h: 380,
  c: { x: 500, y: 1100 },
  r: 1000,
  d: { x: 0, y: -1 },
  t: { x: 1, y: 0 },
  spread: Math.asin(410 / 1000),
  reach: Math.asin(488 / 1000),
};

/** Phones: the same arc turned upright, bulging right, titles beside the nodes. */
const NARROW: Arc = {
  w: 100,
  h: 170,
  c: { x: -170, y: 85 },
  r: 200,
  d: { x: 1, y: 0 },
  t: { x: 0, y: 1 },
  spread: Math.asin(75 / 200),
  reach: Math.asin(84 / 200),
};

const at = (a: Arc, theta: number): Vec => ({
  x: a.c.x + a.r * (Math.cos(theta) * a.d.x + Math.sin(theta) * a.t.x),
  y: a.c.y + a.r * (Math.cos(theta) * a.d.y + Math.sin(theta) * a.t.y),
});

const nodeAngle = (a: Arc, i: number, n: number): number =>
  n < 2 ? 0 : -a.spread + (2 * a.spread * i) / (n - 1);

const f = (v: number): string => v.toFixed(2);

function arcPath(a: Arc, from: number, to: number): string {
  const p = at(a, from);
  const q = at(a, to);
  return `M${f(p.x)} ${f(p.y)}A${a.r} ${a.r} 0 0 1 ${f(q.x)} ${f(q.y)}`;
}

function ArcLayer({ arc, n, done, cls }: { arc: Arc; n: number; done: number; cls: string }) {
  return (
    <svg class={`map-arc ${cls}`} viewBox={`0 0 ${arc.w} ${arc.h}`} aria-hidden="true">
      <path class="map-arc-base draw-in" d={arcPath(arc, -arc.reach, arc.reach)} pathLength={1} />
      {done > 0 && (
        <path
          class="map-arc-done draw-in"
          d={arcPath(arc, nodeAngle(arc, 0, n), nodeAngle(arc, done, n))}
          pathLength={1}
        />
      )}
    </svg>
  );
}

const pct = (v: number, of: number): string => `${f((v / of) * 100)}%`;

/**
 * The level map (§6): six nodes on one circular arc, drawn on like a construction. The arc
 * is inked from the first node to the current one; the rest stays a ghost.
 */
export function LevelMap({ levels, progress, isUnlocked, current, onOpen }: Props) {
  const n = levels.length;
  const done = Math.max(
    0,
    levels.findIndex((l) => l.id === current),
  );
  const solved = levels.filter((l) => progress.levels[l.id]?.stars[0]).length;
  const starCount = levels.reduce(
    (s, l) => s + (progress.levels[l.id]?.stars.filter(Boolean).length ?? 0),
    0,
  );

  // Stroke widths are in viewBox units (pathLength dashes break under non-scaling-stroke),
  // so the stage publishes its width and the CSS keeps the arc at 1.5 px.
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e) el.style.setProperty('--stage-w', String(e.contentRect.width || 1));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <main class="map">
      <header class="map-head">
        <h1 class="map-title">Levels</h1>
        <p class="map-summary">
          {solved} of {n} solved · {starCount} of {3 * n} stars
        </p>
      </header>
      <div class="map-stage" ref={stage}>
        <ArcLayer arc={WIDE} n={n} done={done} cls="is-wide" />
        <ArcLayer arc={NARROW} n={n} done={done} cls="is-narrow" />
        <ol class="map-nodes">
          {levels.map((l, i) => {
            const w = at(WIDE, nodeAngle(WIDE, i, n));
            const m = at(NARROW, nodeAngle(NARROW, i, n));
            const open = isUnlocked(l.id);
            const stars = progress.levels[l.id]?.stars ?? [false, false, false];
            const earned = stars.filter(Boolean).length;
            const name = `Level ${l.number}: ${l.title}, ${open ? `${earned} of 3 stars` : 'locked'}`;
            return (
              <li
                key={l.id}
                class="map-item"
                style={{
                  '--wx': pct(w.x, WIDE.w),
                  '--wy': pct(w.y, WIDE.h),
                  '--nx': pct(m.x, NARROW.w),
                  '--ny': pct(m.y, NARROW.h),
                  '--i': i / Math.max(1, n - 1),
                }}
              >
                <button
                  type="button"
                  class="map-node"
                  data-solved={String(stars[0])}
                  aria-label={name}
                  aria-current={open && l.id === current ? 'step' : undefined}
                  aria-disabled={open ? undefined : 'true'}
                  disabled={!open}
                  onClick={() => onOpen(l.id)}
                >
                  <span class="map-dot" aria-hidden="true" />
                  <span class="map-label">
                    <span class="map-num">{l.number}</span> <span class="map-name">{l.title}</span>
                  </span>
                  <span class="map-stars" aria-hidden="true">
                    {stars.map((s, k) => (
                      <svg key={k} class="map-star" data-earned={String(s)} viewBox="0 0 24 24">
                        <path d={STAR_PATH} />
                      </svg>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}
