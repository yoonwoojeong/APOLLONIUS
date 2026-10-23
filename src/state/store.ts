import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { Construction } from '../construction/construction';
import type { ApplyResult, Command } from '../construction/types';
import { LEVELS, isBuiltInLevelId, levelById } from '../levels';
import type { GoalMatch, Level, LevelId, ToolId } from '../levels/types';
import { deriveFacts } from '../reasoning/facts';
import { nextHint, type Hint } from '../reasoning/hints';
import { isRobust } from '../reasoning/robustness';
import { mergeStars, scoreStars, type Stars } from '../reasoning/stars';
import { loadProgress, saveProgress, type Progress } from './persistence';

export interface Completion {
  stars: Stars;
  explanation: string;
  match: GoalMatch;
  unlocked?: ToolId;
}

type Tier = 0 | 1 | 2 | 3;

/** How a custom (author-made) level reports back; it never touches progress. */
export interface CustomLevelOpts {
  onComplete?: (stars: Stars) => void;
  onExit: () => void;
  /** No completion at all (the editor's Solve mode). */
  sandbox?: boolean;
}

export function createStore(storage: Storage | null) {
  const screen = signal<'title' | 'map' | 'level' | 'problems' | 'editor'>('title');
  const currentLevel = signal<Level>(LEVELS[0]!);
  const levelId = computed(() => currentLevel.value.id);
  /** Options of the open custom level; null while a built-in level is open. */
  const custom = signal<CustomLevelOpts | null>(null);
  const isCustom = computed(() => custom.value !== null);
  /** The open custom level is the editor's Solve sandbox (no completion, no hints). */
  const isSandbox = computed(() => !!custom.value?.sandbox);
  const tool = signal<ToolId>('point');
  const revision = signal(0);
  const hintTier = signal<Tier>(0);
  const completion = signal<Completion | null>(null);
  const progress = signal<Progress>(loadProgress(storage));
  const lastResult = signal<ApplyResult | null>(null);

  const level = (): Level => currentLevel.value;
  const newConstruction = (l: Level): Construction =>
    new Construction(l.givens, l.labels, l.sceneDiameter);
  let construction = newConstruction(level());
  let lastStep: number | null = null;
  let maxTier: Tier = 0; // highest hint tier used in this attempt; not reset on step change

  const hint: ReadonlySignal<Hint | null> = computed(() => {
    void revision.value;
    return nextHint(level(), construction.scene());
  });

  const persist = (): void => saveProgress(storage, progress.value);

  const isUnlocked = (id: LevelId): boolean => {
    const i = LEVELS.findIndex((l) => l.id === id);
    if (i <= 0) return i === 0;
    const prev = LEVELS[i - 1]!;
    return progress.value.levels[prev.id]?.stars[0] === true;
  };

  /** A custom level's tools are authoritative; built-in levels gate perp-bisector on its unlock. */
  const availableTools = (): ToolId[] =>
    custom.value
      ? level().tools
      : level().tools.filter(
          (t) => t !== 'perp-bisector' || progress.value.unlockedTools.includes(t),
        );

  /** Re-evaluates the goal after every change: sets the completion, or clears a stale one. */
  const checkCompletion = (): void => {
    const opts = custom.peek();
    if (opts?.sandbox) return;
    const l = level();
    const scene = construction.scene();
    const match = l.goal(scene);
    const met = !!match && isRobust(l, construction.specs());
    if (completion.peek()) {
      if (!met) completion.value = null;
      return;
    }
    if (!match || !met) return;
    const stars = scoreStars(construction.moves(), l.targets);
    if (opts || !isBuiltInLevelId(l.id)) {
      completion.value = { stars, explanation: l.explain(deriveFacts(scene), scene, match), match };
      opts?.onComplete?.(stars);
      return;
    }
    const old = progress.value.levels[l.id];
    const merged = old ? mergeStars(old.stars, stars) : stars;
    const unlockedTools = [...progress.value.unlockedTools];
    const newlyUnlocked = l.unlocks && !unlockedTools.includes(l.unlocks) ? l.unlocks : undefined;
    if (newlyUnlocked) unlockedTools.push(newlyUnlocked);
    progress.value = {
      ...progress.value,
      levels: {
        ...progress.value.levels,
        [l.id]: { stars: merged, hintsUsed: Math.max(old?.hintsUsed ?? 0, maxTier) },
      },
      unlockedTools,
    };
    persist();
    completion.value = {
      stars,
      explanation: l.explain(deriveFacts(scene), scene, match),
      match,
      ...(newlyUnlocked ? { unlocked: newlyUnlocked } : {}),
    };
  };

  const changed = (): void => {
    revision.value++;
    checkCompletion();
    const step = hint.peek()?.stepIndex ?? null;
    if (step !== lastStep) {
      lastStep = step;
      hintTier.value = 0;
    }
  };

  const open = (l: Level, opts: CustomLevelOpts | null): void => {
    currentLevel.value = l;
    custom.value = opts;
    construction = newConstruction(l);
    completion.value = null;
    lastResult.value = null;
    hintTier.value = 0;
    maxTier = 0;
    tool.value = 'point';
    revision.value++;
    lastStep = hint.peek()?.stepIndex ?? null;
    screen.value = 'level';
  };
  const openLevel = (id: LevelId): void => open(levelById(id), null);

  const resumeLevel = (): LevelId =>
    LEVELS.find((l) => isUnlocked(l.id) && !progress.value.levels[l.id]?.stars[0])?.id ??
    LEVELS[LEVELS.length - 1]!.id;

  return {
    screen,
    currentLevel: currentLevel as ReadonlySignal<Level>,
    levelId,
    isCustom,
    isSandbox,
    tool,
    revision,
    hintTier,
    hint,
    completion,
    progress,
    lastResult,
    construction: (): Construction => construction,
    availableTools,
    isUnlocked,
    resumeLevel,
    openLevel,
    openCustomLevel(l: Level, opts: CustomLevelOpts): void {
      open(l, opts);
    },
    exitCustomLevel(): void {
      custom.peek()?.onExit();
    },
    /**
     * Closes the open custom level without calling its onExit: the store falls back to an empty
     * construction of the first built-in level, so stray game input cannot touch the old one.
     */
    closeCustomLevel(to: 'problems' | 'editor'): void {
      if (!custom.peek()) return;
      custom.value = null;
      currentLevel.value = LEVELS[0]!;
      construction = newConstruction(level());
      completion.value = null;
      lastResult.value = null;
      hintTier.value = 0;
      maxTier = 0;
      tool.value = 'point';
      revision.value++;
      lastStep = hint.peek()?.stepIndex ?? null;
      screen.value = to;
    },
    /** Reopens the current level from scratch (a custom one with the same options); not a sandbox. */
    replayLevel(): void {
      if (custom.peek()?.sandbox) return;
      open(level(), custom.peek());
    },
    selectTool(t: ToolId): void {
      if (availableTools().includes(t)) tool.value = t;
    },
    apply(cmd: Command): ApplyResult {
      const r = construction.apply(cmd);
      lastResult.value = r;
      if (r.ok) changed();
      return r;
    },
    undo(): void {
      if (construction.undo()) changed();
    },
    redo(): void {
      if (construction.redo()) changed();
    },
    reset(): void {
      lastResult.value = construction.apply({ type: 'reset' });
      changed();
    },
    requestHint(): void {
      if (hint.peek() && hintTier.value < 3) {
        hintTier.value = (hintTier.value + 1) as Tier;
        maxTier = Math.max(maxTier, hintTier.value) as Tier;
      }
    },
    nextLevel(): void {
      const i = LEVELS.findIndex((l) => l.id === levelId.value);
      const next = LEVELS[i + 1];
      if (next && isUnlocked(next.id)) openLevel(next.id);
      else screen.value = 'map';
    },
    goToMap(): void {
      screen.value = 'map';
    },
    setTheme(theme: 'light' | 'dark'): void {
      progress.value = { ...progress.value, theme };
      persist();
    },
  };
}

export type Store = ReturnType<typeof createStore>;
