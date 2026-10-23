import { computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { Construction } from '../construction/construction';
import type { ObjDef, ObjId, ObjSpec } from '../construction/types';
import type { Vec } from '../geometry/vec';
import type { Level, ToolId } from '../levels/types';
import { frame } from '../levels/view';
import { loadDrafts, saveDrafts, type Draft, type DraftProblem } from '../problems/drafts';
import { LIMITS, problemPoints, type Problem, type ProblemStep } from '../problems/format';
import { canonicalJson, problemHash } from '../problems/hash';
import { toLevel, type ProblemLevelId } from '../problems/load';
import { validate } from '../problems/validate';
import { mergeStars, type Stars } from '../reasoning/stars';
import type { Store } from '../state/store';
import { applyEdit, type SetupEdit, type SetupModel } from './setupGestures';

export type EditorMode = 'setup' | 'solve' | 'details' | 'test';

export interface EditorDetails {
  title: string;
  goalText: string;
  explain: string;
  author: string;
  perpBisector: boolean;
  /** null = use the solution's own moves. */
  par: { L: number; E: number } | null;
}

const AUTOSAVE_MS = 500;
const BASE_TOOLS: ToolId[] = ['point', 'line', 'circle'];
const ALL_TOOLS: ToolId[] = [...BASE_TOOLS, 'perp-bisector'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/** A, B, … Z, then A1 … Z9. */
const LABEL_POOL = [
  ...LETTERS,
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => LETTERS.map((l) => l + n)),
];
/** World box used to frame a figure with fewer than two points. */
const FALLBACK_FRAME = { view: { x: -4, y: -3, w: 8, h: 6 }, sceneDiameter: 10 };

// --- Normalising an unchecked draft --------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, k: string): unknown =>
  Object.hasOwn(o, k) ? o[k] : undefined;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const isSpec = (x: unknown): x is ObjSpec => {
  if (!isObj(x)) return false;
  const def = own(x, 'def');
  return typeof own(x, 'id') === 'string' && isObj(def) && typeof own(def, 'type') === 'string';
};
const specs = (x: unknown): ObjSpec[] => arr(x).filter(isSpec);
const count = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

interface Opened {
  setup: SetupModel;
  solution: ProblemStep[];
  targets: ObjId[];
  details: EditorDetails;
}

function normalise(raw: unknown): Opened {
  const p = isObj(raw) ? raw : {};
  const labelsRaw = own(p, 'labels');
  const labels = Object.fromEntries(
    isObj(labelsRaw)
      ? Object.entries(labelsRaw).filter((e): e is [string, string] => typeof e[1] === 'string')
      : [],
  );
  const solution = arr(own(p, 'solution'))
    .filter(isObj)
    .map((s) => ({ objects: specs(own(s, 'objects')), nudge: str(own(s, 'nudge')) }));
  const par = own(p, 'par');
  return {
    setup: { givens: specs(own(p, 'givens')), labels },
    solution,
    targets: arr(own(p, 'targets')).filter((t): t is string => typeof t === 'string'),
    details: {
      title: str(own(p, 'title')),
      goalText: str(own(p, 'goalText')),
      explain: str(own(p, 'explain')),
      author: str(own(p, 'author')),
      perpBisector: arr(own(p, 'tools')).includes('perp-bisector'),
      par:
        isObj(par) && count(own(par, 'L')) && count(own(par, 'E'))
          ? { L: own(par, 'L') as number, E: own(par, 'E') as number }
          : null,
    },
  };
}

// --- Geometry helpers ----------------------------------------------------------------------

const clampCoord = (v: number): number => Math.max(-LIMITS.coordMax, Math.min(LIMITS.coordMax, v));
const clampVec = (v: Vec): Vec => ({ x: clampCoord(v.x), y: clampCoord(v.y) });

function clampDef(def: ObjDef): ObjDef {
  if (def.type === 'given-point') return { ...def, pos: clampVec(def.pos) };
  if (def.type === 'given-circle') return { ...def, c: clampVec(def.c) };
  return def;
}

/** Keeps every position a setup edit writes inside |x|,|y| ≤ 100. */
function clampEdit(edit: SetupEdit): SetupEdit {
  switch (edit.type) {
    case 'add':
      return { ...edit, specs: edit.specs.map((s) => ({ ...s, def: clampDef(s.def) })) };
    case 'move':
      return { ...edit, pos: clampVec(edit.pos) };
    case 'move-circle':
      return edit.c ? { ...edit, c: clampVec(edit.c) } : edit;
    default:
      return edit;
  }
}

/** The framing the validator and loader use, with a fallback for a near-empty figure. */
function frameOf(givens: ObjSpec[], solution: ProblemStep[]): typeof FALLBACK_FRAME {
  let pts: Vec[];
  try {
    pts = problemPoints({ givens, solution } as Problem).filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
  } catch {
    pts = [];
  }
  if (pts.length < 2) return FALLBACK_FRAME;
  const f = frame(pts);
  return f.sceneDiameter > 0 && Number.isFinite(f.sceneDiameter) ? f : FALLBACK_FRAME;
}

const sameObjects = (a: ObjSpec[] | undefined, b: ObjSpec[]): boolean =>
  !!a && canonicalJson(a) === canonicalJson(b);

function renameDef(def: ObjDef, map: Map<ObjId, ObjId>): ObjDef {
  const r = (id: ObjId): ObjId => map.get(id) ?? id;
  switch (def.type) {
    case 'given-line':
    case 'line':
    case 'perp-bisector':
    case 'intersection':
      return { ...def, a: r(def.a), b: r(def.b) };
    case 'circle':
      return { ...def, center: r(def.center), through: r(def.through) };
    case 'on-curve':
      return { ...def, curve: r(def.curve) };
    default:
      return def;
  }
}

const idNumber = (id: ObjId): number => {
  const m = /^o(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

// --- The editor ----------------------------------------------------------------------------

export function createEditor(
  game: Store,
  storage: Storage | null,
  draft: Draft,
  now: () => number = Date.now,
) {
  const { localId, createdAt } = draft;
  const levelId: ProblemLevelId = `problem:${localId}`;
  const opened = normalise(draft.problem);

  const mode = signal<EditorMode>('setup');
  const setup = signal<SetupModel>(opened.setup);
  const solution = signal<ProblemStep[]>(opened.solution);
  const targets = signal<ObjId[]>(opened.targets);
  const details = signal<EditorDetails>(opened.details);
  const testedHash = signal<string | undefined>(
    typeof draft.testedHash === 'string' ? draft.testedHash : undefined,
  );
  const stars = signal<Stars | undefined>(draft.stars);
  const saveFailed = signal(false);

  // Replays the solution as the game would: the first step that fails to apply is broken.
  const replayed = computed((): { broken: number | null; moves: { L: number; E: number } } => {
    const { givens, labels } = setup.value;
    const steps = solution.value;
    try {
      const c = new Construction(givens, labels, frameOf(givens, steps).sceneDiameter);
      for (let i = 0; i < steps.length; i++) {
        if (!c.apply({ type: 'add', objects: steps[i]!.objects }).ok) {
          return { broken: i, moves: c.moves() };
        }
      }
      return { broken: null, moves: c.moves() };
    } catch {
      return { broken: steps.length ? 0 : null, moves: { L: 0, E: 0 } };
    }
  });
  const broken = computed(() => replayed.value.broken);

  /** A stored par equal to the solution's own moves means "follow the solution". */
  {
    const par = opened.details.par;
    const m = replayed.peek().moves;
    if (par && par.L === m.L && par.E === m.E) details.value = { ...details.peek(), par: null };
  }

  const solutionIds = computed(
    () => new Set(solution.value.flatMap((s) => s.objects.map((o) => o.id))),
  );

  const problem = computed((): DraftProblem => {
    const d = details.value;
    const m = replayed.value.moves;
    const { givens, labels } = setup.value;
    const explain = d.explain.trim();
    const author = d.author.trim();
    return {
      format: 'apollonius-problem',
      version: 1,
      title: d.title.trim(),
      goalText: d.goalText.trim(),
      ...(explain ? { explain } : {}),
      ...(author ? { author } : {}),
      tools: d.perpBisector ? [...ALL_TOOLS] : [...BASE_TOOLS],
      givens,
      labels,
      solution: solution.value.map((s) => ({ objects: s.objects, nudge: s.nudge.trim() })),
      // Targets whose object is gone (e.g. undone in Solve) come back with it on redo.
      targets: targets.value.filter((t) => solutionIds.value.has(t)),
      par: d.par ? { L: Math.max(d.par.L, m.L), E: Math.max(d.par.E, m.E) } : m,
    };
  });

  const validation = computed(() => validate(problem.value));
  const tested = computed(
    () =>
      testedHash.value !== undefined && testedHash.value === problemHash(problem.value as Problem),
  );
  const modeDone = computed((): Record<EditorMode, boolean> => {
    const p = problem.value;
    return {
      setup: (p.givens?.length ?? 0) >= LIMITS.givensMin,
      solve: (p.solution?.length ?? 0) > 0 && broken.value === null && (p.targets?.length ?? 0) > 0,
      details: !!p.title && !!p.goalText,
      test: tested.value,
    };
  });

  // --- Setup ------------------------------------------------------------------------------

  const past = signal<SetupModel[]>([]);
  const future = signal<SetupModel[]>([]);
  let gestureSnapshot: SetupModel | null = null;
  let idCounter = 0;
  let pendingLabels = new Set<string>();

  const usedIds = (): Set<ObjId> =>
    new Set([...setup.peek().givens.map((g) => g.id), ...solutionIds.peek()]);

  /** A fresh `g<n>` id; successive calls never repeat. */
  const allocId = (): ObjId => {
    const used = usedIds();
    let id: ObjId;
    do id = `g${++idCounter}`;
    while (used.has(id));
    return id;
  };

  /** The next unused point label; successive calls (within a gesture) are distinct. */
  const nextLabel = (): string => {
    const used = new Set(Object.values(setup.peek().labels));
    const label = LABEL_POOL.find((l) => !used.has(l) && !pendingLabels.has(l)) ?? '';
    pendingLabels.add(label);
    return label;
  };

  /** A Setup change makes an open Solve sandbox stale, so leave Solve. */
  const leaveSolve = (): void => {
    sandbox = null;
    tail = [];
    if (mode.peek() === 'solve') mode.value = 'setup';
  };

  const record = (before: SetupModel): void => {
    past.value = [...past.peek(), before];
    future.value = [];
  };

  const applySetup = (edit: SetupEdit): void => {
    const before = setup.peek();
    const next = applyEdit(before, clampEdit(edit));
    pendingLabels = new Set();
    if (next === before) return;
    leaveSolve();
    setup.value = next;
    if (!gestureSnapshot) record(before);
  };

  const beginSetupGesture = (): void => {
    gestureSnapshot = setup.peek();
    pendingLabels = new Set();
  };
  const endSetupGesture = (): void => {
    const snap = gestureSnapshot;
    gestureSnapshot = null;
    pendingLabels = new Set();
    if (snap && snap !== setup.peek()) record(snap);
  };
  const cancelSetupGesture = (): void => {
    const snap = gestureSnapshot;
    gestureSnapshot = null;
    pendingLabels = new Set();
    if (snap) setup.value = snap;
  };

  const undoSetup = (): void => {
    const p = past.peek();
    const prev = p[p.length - 1];
    if (!prev || gestureSnapshot) return;
    leaveSolve();
    future.value = [setup.peek(), ...future.peek()];
    past.value = p.slice(0, -1);
    setup.value = prev;
  };
  const redoSetup = (): void => {
    const [next, ...rest] = future.peek();
    if (!next || gestureSnapshot) return;
    leaveSolve();
    past.value = [...past.peek(), setup.peek()];
    future.value = rest;
    setup.value = next;
  };

  // --- Solve ------------------------------------------------------------------------------

  /** The open sandbox level (Solve syncs only while the game shows it). */
  let sandbox: Level | null = null;
  /** The broken steps found when Solve opened: kept after the game's steps, never dropped. */
  let tail: ProblemStep[] = [];
  let replaying = false;

  /** Renames tail objects whose ids a new game step took, so ids stay unique. */
  const dedupeTail = (gameSteps: ObjSpec[][]): void => {
    const taken = new Set([
      ...setup.peek().givens.map((g) => g.id),
      ...gameSteps.flat().map((o) => o.id),
    ]);
    const clashes = tail.flatMap((s) => s.objects.map((o) => o.id)).filter((id) => taken.has(id));
    if (!clashes.length) return;
    const all = [...taken, ...tail.flatMap((s) => s.objects.map((o) => o.id))];
    let n = Math.max(0, ...all.map(idNumber));
    const map = new Map(clashes.map((id) => [id, `o${++n}`]));
    tail = tail.map((s) => ({
      ...s,
      objects: s.objects.map((o) => ({ id: map.get(o.id) ?? o.id, def: renameDef(o.def, map) })),
    }));
    targets.value = targets.peek().map((t) => map.get(t) ?? t);
  };

  const syncFromGame = (): void => {
    const gameSteps = game.construction().steps();
    dedupeTail(gameSteps);
    const prev = solution.peek();
    solution.value = [
      ...gameSteps.map((objects, i) => ({
        objects,
        nudge: sameObjects(prev[i]?.objects, objects) ? prev[i]!.nudge : '',
      })),
      ...tail,
    ];
  };

  const solving = (): boolean =>
    !replaying &&
    sandbox !== null &&
    mode.peek() === 'solve' &&
    game.currentLevel.peek() === sandbox;

  const disposeSync = effect(() => {
    void game.revision.value;
    if (solving()) syncFromGame();
  });

  const enterSolve = (): void => {
    const { givens, labels } = setup.peek();
    const steps = solution.peek();
    const { view, sceneDiameter } = frameOf(givens, steps);
    const level: Level = {
      id: levelId,
      title: details.peek().title.trim(),
      goalText: details.peek().goalText.trim(),
      givens: structuredClone(givens),
      labels: { ...labels },
      view,
      sceneDiameter,
      targets: { L: 0, E: 0 },
      tools: [...ALL_TOOLS],
      goal: () => null,
      reference: [],
      explain: () => '',
    };
    replaying = true;
    try {
      sandbox = level;
      tail = [];
      mode.value = 'solve';
      game.openCustomLevel(level, { sandbox: true, onExit: exit });
      game.screen.value = 'editor';
      for (let i = 0; i < steps.length; i++) {
        if (!game.apply({ type: 'add', objects: steps[i]!.objects }).ok) {
          tail = steps.slice(i);
          break;
        }
      }
      game.lastResult.value = null;
    } finally {
      replaying = false;
    }
    syncFromGame();
  };

  const setNudge = (i: number, text: string): void => {
    const steps = solution.peek();
    if (!steps[i]) return;
    const step = { ...steps[i], nudge: text };
    solution.value = steps.map((s, j) => (j === i ? step : s));
    const g = i - (steps.length - tail.length);
    if (g >= 0) tail = tail.map((s, j) => (j === g ? step : s));
  };

  const toggleTarget = (id: ObjId): void => {
    const t = targets.peek();
    targets.value = t.includes(id) ? t.filter((x) => x !== id) : [...t, id];
  };

  /** Drops steps ≥ i (and targets on them); in Solve the game construction is trimmed too. */
  const removeFrom = (i: number): void => {
    const steps = solution.peek();
    if (i < 0 || i >= steps.length) return;
    const gone = new Set(steps.slice(i).flatMap((s) => s.objects.map((o) => o.id)));
    targets.value = targets.peek().filter((t) => !gone.has(t));
    if (solving()) {
      const gameLen = steps.length - tail.length;
      tail = i >= gameLen ? tail.slice(0, i - gameLen) : [];
      replaying = true;
      try {
        while (game.construction().steps().length > i && game.construction().canUndo()) game.undo();
      } finally {
        replaying = false;
      }
      syncFromGame();
    } else {
      solution.value = steps.slice(0, i);
    }
  };

  // --- Details ------------------------------------------------------------------------------

  const setDetails = (patch: Partial<EditorDetails>): void => {
    const next = { ...details.peek(), ...patch };
    if (patch.par) {
      const m = replayed.peek().moves;
      next.par = { L: Math.max(patch.par.L, m.L), E: Math.max(patch.par.E, m.E) };
    }
    details.value = next;
  };

  const setMode = (m: EditorMode): void => {
    if (m === 'solve') {
      enterSolve();
      return;
    }
    sandbox = null;
    tail = [];
    mode.value = m;
    game.screen.value = 'editor';
  };

  // --- Test ---------------------------------------------------------------------------------

  /** Plays the problem in the game; false (and nothing happens) while it is invalid. */
  const startTest = (): boolean => {
    const v = validation.peek();
    if (!v.ok) return false;
    const hash = problemHash(problem.peek() as Problem);
    const level = toLevel(structuredClone(v.problem), levelId);
    sandbox = null;
    tail = [];
    mode.value = 'test';
    game.openCustomLevel(level, {
      onComplete: (s) => {
        testedHash.value = hash;
        const old = stars.peek();
        stars.value = old ? mergeStars(old, s) : s;
      },
      onExit: () => {
        game.screen.value = 'editor';
        mode.value = 'test';
      },
    });
    return true;
  };

  // --- Autosave -----------------------------------------------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const save = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    const th = testedHash.peek();
    const st = stars.peek();
    const d: Draft = {
      localId,
      createdAt,
      updatedAt: now(),
      problem: problem.peek(),
      ...(th !== undefined ? { testedHash: th } : {}),
      ...(st !== undefined ? { stars: st } : {}),
    };
    const all = loadDrafts(storage);
    const i = all.findIndex((x) => x.localId === localId);
    const next = i >= 0 ? all.map((x, j) => (j === i ? d : x)) : [...all, d];
    const ok = saveDrafts(storage, next);
    saveFailed.value = !ok;
    if (ok) dirty = false;
  };

  let first = true;
  const disposeAutosave = effect(() => {
    void problem.value;
    void testedHash.value;
    void stars.value;
    if (first) {
      first = false;
      return;
    }
    dirty = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(save, AUTOSAVE_MS);
  });

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') save();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    disposeSync();
    disposeAutosave();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };

  /** Saves now and returns to My problems. */
  function exit(): void {
    save();
    dispose();
    sandbox = null;
    game.screen.value = 'problems';
  }

  return {
    localId,
    mode: mode as Signal<EditorMode>,
    setup: setup as Signal<SetupModel>,
    solution: solution as Signal<ProblemStep[]>,
    broken: broken as ReadonlySignal<number | null>,
    targets: targets as Signal<ObjId[]>,
    details: details as Signal<EditorDetails>,
    validation: validation as ReadonlySignal<ReturnType<typeof validate>>,
    problem: problem as ReadonlySignal<DraftProblem>,
    tested: tested as ReadonlySignal<boolean>,
    modeDone: modeDone as ReadonlySignal<Record<EditorMode, boolean>>,
    saveFailed: saveFailed as Signal<boolean>,
    canUndoSetup: computed(() => past.value.length > 0) as ReadonlySignal<boolean>,
    canRedoSetup: computed(() => future.value.length > 0) as ReadonlySignal<boolean>,
    setMode,
    allocId,
    nextLabel,
    applySetup,
    undoSetup,
    redoSetup,
    beginSetupGesture,
    endSetupGesture,
    cancelSetupGesture,
    enterSolve,
    setNudge,
    toggleTarget,
    removeFrom,
    setDetails,
    startTest,
    exit,
    dispose,
  };
}

export type Editor = ReturnType<typeof createEditor>;
