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

/** A target's identity: its step's signature and its position in that step. */
const targetKey = (stepSig: string, index: number): string => JSON.stringify([stepSig, index]);

/** Ids a def refers to. */
function refIds(def: ObjDef): ObjId[] {
  const d = def as Record<string, unknown>;
  return ['a', 'b', 'center', 'through', 'curve']
    .map((k) => (Object.hasOwn(d, k) ? d[k] : undefined))
    .filter((v): v is ObjId => typeof v === 'string');
}

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
  const targets = signal<ObjId[]>([]);
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

  /** Every nudge ever written, by step signature: undo/redo or Reset+Undo bring them back. */
  const nudges = new Map<string, string>();
  /** Targets by step signature + object position, so an undone target returns on redo. */
  const targetKeys = new Set<string>();
  /** Every solution object id this editor has seen (never reused for something else). */
  const knownIds = new Set<ObjId>();
  const remember = (steps: { objects: ObjSpec[] }[]): void => {
    for (const s of steps) for (const o of s.objects) knownIds.add(o.id);
  };

  /** Structural forms, interned to short tokens for the editor's lifetime (keeps keys linear). */
  const interned = new Map<string, string>();
  const intern = (form: unknown): string => {
    const text = canonicalJson(form);
    let token = interned.get(text);
    if (token === undefined) {
      token = `s${interned.size}`;
      interned.set(text, token);
    }
    return token;
  };

  /**
   * Each step's id-free signature: its objects' defs with every referenced solution object
   * replaced by that object's structural token. Any other reference (a given — present or
   * deleted) stays `{ given: id }`: given ids are stable, while solution ids are reissued
   * whenever Solve reopens, so they never take part.
   */
  const sigsOf = (steps: { objects: ObjSpec[] }[]): string[] => {
    const tokens = new Map<ObjId, string>();
    const ref = (id: ObjId): string => tokens.get(id) ?? intern({ given: id });
    return steps.map((st) => {
      const forms = st.objects.map((o) => {
        const t = intern(renameDef(o.def, new Map(refIds(o.def).map((r) => [r, ref(r)]))));
        tokens.set(o.id, t);
        return t;
      });
      return canonicalJson(forms);
    });
  };

  const keyOf = (id: ObjId): string | null => {
    const steps = solution.peek();
    const sigs = sigsOf(steps);
    for (let j = 0; j < steps.length; j++) {
      const i = steps[j]!.objects.findIndex((o) => o.id === id);
      if (i >= 0) return targetKey(sigs[j]!, i);
    }
    return null;
  };

  /** Active targets: the remembered ones whose object is in the solution now. */
  const refreshTargets = (): void => {
    const byKey = new Map<string, ObjId>();
    const steps = solution.peek();
    const sigs = sigsOf(steps);
    steps.forEach((s, j) => s.objects.forEach((o, i) => byKey.set(targetKey(sigs[j]!, i), o.id)));
    const next = [...targetKeys].flatMap((k) => {
      const id = byKey.get(k);
      return id === undefined ? [] : [id];
    });
    if (JSON.stringify(next) !== JSON.stringify(targets.peek())) targets.value = next;
  };

  remember(opened.solution);
  sigsOf(opened.solution).forEach((k, i) => nudges.set(k, opened.solution[i]!.nudge));
  for (const t of opened.targets) {
    const k = keyOf(t);
    if (k) targetKeys.add(k);
  }
  refreshTargets();

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
      targets: targets.value,
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

  /** Ids a new given must not take: anything in, referred to by, or ever seen in the problem. */
  const usedIds = (): Set<ObjId> =>
    new Set([
      ...setup.peek().givens.map((g) => g.id),
      ...solution.peek().flatMap((s) => s.objects.flatMap((o) => [o.id, ...refIds(o.def)])),
      ...targets.peek(),
      ...knownIds,
    ]);

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
    closeSandbox();
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

  /** Closes the sandbox in the game (without its onExit), so stray input can't reach it. */
  function closeSandbox(): void {
    if (sandbox && game.currentLevel.peek() === sandbox) game.closeCustomLevel('editor');
    sandbox = null;
    tail = [];
  }

  /** Renames tail objects whose ids a new game step took, so ids stay unique. */
  const dedupeTail = (gameSteps: ObjSpec[][]): void => {
    const taken = new Set([
      ...setup.peek().givens.map((g) => g.id),
      ...gameSteps.flat().map((o) => o.id),
    ]);
    const clashes = tail.flatMap((s) => s.objects.map((o) => o.id)).filter((id) => taken.has(id));
    if (!clashes.length) return;
    // Fresh ids lie beyond every id seen, so a renamed object never takes a remembered one.
    const all = [...taken, ...knownIds, ...tail.flatMap((s) => s.objects.map((o) => o.id))];
    let n = Math.max(0, ...all.map(idNumber));
    const map = new Map(clashes.map((id) => [id, `o${++n}`]));
    // Signatures are id-free, so renamed steps keep their nudges and targets as they are.
    tail = tail.map((s) => ({
      ...s,
      objects: s.objects.map((o) => ({ id: map.get(o.id) ?? o.id, def: renameDef(o.def, map) })),
    }));
    remember(tail);
  };

  const syncFromGame = (): void => {
    const gameSteps = game.construction().steps();
    dedupeTail(gameSteps);
    const fromGame = gameSteps.map((objects) => ({ objects }));
    remember(fromGame);
    const sigs = sigsOf([...fromGame, ...tail]);
    solution.value = [
      ...gameSteps.map((objects, i) => ({ objects, nudge: nudges.get(sigs[i]!) ?? '' })),
      ...tail,
    ];
    refreshTargets();
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
      game.openCustomLevel(level, { sandbox: true, onExit: () => setMode('setup') });
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
    nudges.set(sigsOf(steps)[i]!, text);
    solution.value = steps.map((s, j) => (j === i ? step : s));
    const g = i - (steps.length - tail.length);
    if (g >= 0) tail = tail.map((s, j) => (j === g ? step : s));
  };

  /** Toggles a solution object as a target (ids not in the solution are ignored). */
  const toggleTarget = (id: ObjId): void => {
    const k = keyOf(id);
    if (!k) return;
    if (!targetKeys.delete(k)) targetKeys.add(k);
    refreshTargets();
  };

  /** Drops steps ≥ i (and targets on them); in Solve the game construction is trimmed too. */
  const removeFrom = (i: number): void => {
    const steps = solution.peek();
    if (i < 0 || i >= steps.length) return;
    const sigs = sigsOf(steps);
    for (let k = i; k < steps.length; k++) {
      steps[k]!.objects.forEach((_, j) => targetKeys.delete(targetKey(sigs[k]!, j)));
    }
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
      refreshTargets();
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
    closeSandbox();
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
    closeSandbox();
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
    save(); // never drop a pending edit
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
    dispose(); // saves first
    closeSandbox();
    game.screen.value = 'problems';
  }

  return {
    localId,
    /** The game store this editor drives (Solve and Test play in it). */
    game,
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
