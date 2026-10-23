import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { Construction } from '../construction/construction';
import type { ApplyResult, Command } from '../construction/types';
import { LEVELS, levelById } from '../levels';
import type { GoalMatch, LevelId, ToolId } from '../levels/types';
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

export function createStore(storage: Storage | null) {
  const screen = signal<'title' | 'map' | 'level'>('title');
  const levelId = signal<LevelId>(LEVELS[0]!.id);
  const tool = signal<ToolId>('point');
  const revision = signal(0);
  const hintTier = signal<Tier>(0);
  const completion = signal<Completion | null>(null);
  const progress = signal<Progress>(loadProgress(storage));
  const lastResult = signal<ApplyResult | null>(null);

  const level = () => levelById(levelId.value);
  const newConstruction = (id: LevelId): Construction => {
    const l = levelById(id);
    return new Construction(l.givens, l.labels, l.sceneDiameter);
  };
  let construction = newConstruction(levelId.value);
  let lastStep: number | null = null;

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

  const availableTools = (): ToolId[] =>
    level().tools.filter((t) => t !== 'perp-bisector' || progress.value.unlockedTools.includes(t));

  const checkCompletion = (): void => {
    if (completion.peek()) return;
    const l = level();
    const scene = construction.scene();
    const match = l.goal(scene);
    if (!match || !isRobust(l, construction.specs())) return;
    const stars = scoreStars(construction.moves(), l.targets);
    const old = progress.value.levels[l.id];
    const merged = old ? mergeStars(old.stars, stars) : stars;
    const unlockedTools = [...progress.value.unlockedTools];
    if (l.unlocks && !unlockedTools.includes(l.unlocks)) unlockedTools.push(l.unlocks);
    progress.value = {
      ...progress.value,
      levels: {
        ...progress.value.levels,
        [l.id]: { stars: merged, hintsUsed: Math.max(old?.hintsUsed ?? 0, hintTier.value) },
      },
      unlockedTools,
    };
    persist();
    completion.value = {
      stars,
      explanation: l.explain(deriveFacts(scene), scene, match),
      match,
      ...(l.unlocks ? { unlocked: l.unlocks } : {}),
    };
  };

  const changed = (): void => {
    revision.value++;
    checkCompletion(); // before the tier reset, so hintsUsed sees the tier in force
    const step = hint.peek()?.stepIndex ?? null;
    if (step !== lastStep) {
      lastStep = step;
      hintTier.value = 0;
    }
  };

  const openLevel = (id: LevelId): void => {
    levelId.value = id;
    construction = newConstruction(id);
    completion.value = null;
    lastResult.value = null;
    hintTier.value = 0;
    tool.value = 'point';
    revision.value++;
    lastStep = hint.peek()?.stepIndex ?? null;
    screen.value = 'level';
  };

  const resumeLevel = (): LevelId =>
    LEVELS.find((l) => isUnlocked(l.id) && !progress.value.levels[l.id]?.stars[0])?.id ??
    LEVELS[LEVELS.length - 1]!.id;

  return {
    screen,
    levelId,
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
      if (hint.peek() && hintTier.value < 3) hintTier.value = (hintTier.value + 1) as Tier;
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
